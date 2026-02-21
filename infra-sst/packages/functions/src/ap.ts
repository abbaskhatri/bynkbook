import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import { assertNotClosedPeriod } from "./lib/closedPeriods";
import { randomUUID } from "node:crypto";

function json(statusCode: number, body: any) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function pp(event: any) {
  return event?.pathParameters ?? {};
}

function qp(event: any) {
  return event?.queryStringParameters ?? {};
}

function readBody(event: any) {
  try {
    return event?.body ? JSON.parse(event.body) : {};
  } catch {
    return null;
  }
}

function roleUpper(r: any) {
  return String(r ?? "").toUpperCase();
}

function canWrite(role: string) {
  return ["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"].includes(roleUpper(role));
}

function toBigIntSafe(v: any): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number" && Number.isFinite(v)) return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  } catch { }
  return 0n;
}

function clampLimit(raw: any) {
  const n = Number(raw);
  const safe = Number.isFinite(n) ? Math.trunc(n) : 200;
  return Math.max(1, Math.min(200, safe || 200));
}

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || "").trim());
}

export function deriveBillStatus(args: { isVoid: boolean; amount: bigint; applied: bigint }) {
  if (args.isVoid) return "VOID";
  if (args.applied <= 0n) return "OPEN";
  if (args.applied >= args.amount) return args.applied === args.amount ? "PAID" : "OPEN";
  return "PARTIAL";
}

function normalizeSpaces(s: string) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function extractApplySuffix(memo: string) {
  const m = String(memo ?? "");
  const idx = m.indexOf(" — Applied to: ");
  if (idx < 0) return { base: m, suffix: "" };
  return { base: m.slice(0, idx), suffix: m.slice(idx) };
}

function isDefaultVendorPaymentMemo(memo: string) {
  const x = normalizeSpaces(memo).toLowerCase();
  return x === "" || x === "vendor payment";
}

function buildAppliedToLabel(bills: Array<{ memo: string | null }>) {
  const names = bills
    .map((b) => normalizeSpaces(String(b.memo ?? "")))
    .filter(Boolean);

  // keep short, deterministic: first 3 + “+N more”
  const top = names.slice(0, 3);
  const more = names.length - top.length;

  if (!top.length) return "";
  return more > 0 ? `${top.join(", ")} +${more} more` : top.join(", ");
}

async function updateVendorPaymentMemoIfNeeded(tx: any, businessId: string, entryId: string) {
  const entry = await tx.entry.findFirst({
    where: { id: entryId, business_id: businessId, deleted_at: null },
    select: { id: true, memo: true, entry_kind: true },
  });
  if (!entry) return;

  const kind = String((entry as any).entry_kind ?? "GENERAL").toUpperCase();
  if (kind !== "VENDOR_PAYMENT") return;

  // Get currently applied bills for this entry
  const apps = await tx.billPaymentApplication.findMany({
    where: { business_id: businessId, entry_id: entryId, is_active: true },
    select: { bill_id: true },
  });
  const billIds = Array.from(new Set(apps.map((a: any) => String(a.bill_id))));

  const bills = billIds.length
    ? await tx.bill.findMany({
        where: { business_id: businessId, id: { in: billIds } },
        select: { id: true, memo: true },
        orderBy: [{ due_date: "asc" }, { invoice_date: "asc" }],
      })
    : [];

  const appliedLabel = buildAppliedToLabel(bills);
  const { base } = extractApplySuffix(String(entry.memo ?? ""));

  let nextMemo = "";

  if (isDefaultVendorPaymentMemo(base)) {
    // Default/empty memo: set to “Vendor payment — Applied to: …” if there are bills, else “Vendor payment”
    nextMemo = appliedLabel ? `Vendor payment — Applied to: ${appliedLabel}` : "Vendor payment";
  } else {
    // User memo: keep it, append suffix only if needed
    nextMemo = appliedLabel ? `${base} — Applied to: ${appliedLabel}` : base;
  }

  if (String(entry.memo ?? "") !== nextMemo) {
    await tx.entry.update({ where: { id: entryId }, data: { memo: nextMemo, updated_at: new Date() } });
  }
}

function ymdToDate(d: string) {
  return new Date(`${d}T00:00:00Z`);
}

async function requireRole(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

async function requireVendor(prisma: any, businessId: string, vendorId: string) {
  return prisma.vendor.findFirst({
    where: { id: vendorId, business_id: businessId },
    select: { id: true, business_id: true, name: true },
  });
}

async function computeBillAppliedMap(prisma: any, businessId: string, billIds: string[]) {
  if (!billIds.length) return new Map<string, bigint>();
  const rows = await prisma.billPaymentApplication.groupBy({
    by: ["bill_id"],
    where: { business_id: businessId, bill_id: { in: billIds }, is_active: true },
    _sum: { applied_amount_cents: true },
  });
  const m = new Map<string, bigint>();
  for (const r of rows) m.set(String(r.bill_id), toBigIntSafe(r._sum?.applied_amount_cents ?? 0));
  return m;
}

async function recomputeAndPersistBillStatuses(tx: any, businessId: string, billIds: string[]) {
  if (!billIds.length) return;
  const bills = await tx.bill.findMany({
    where: { business_id: businessId, id: { in: billIds } },
    select: { id: true, amount_cents: true, voided_at: true },
  });
  const appliedByBill = await computeBillAppliedMap(tx, businessId, billIds);

  await Promise.all(
    bills.map((b: any) => {
      const amount = toBigIntSafe(b.amount_cents);
      const applied = appliedByBill.get(String(b.id)) ?? 0n;
      const status = deriveBillStatus({ isVoid: !!b.voided_at, amount, applied });
      return tx.bill.update({ where: { id: b.id }, data: { status, updated_at: new Date() } });
    })
  );
}

async function getVendorAgingSummary(prisma: any, businessId: string, vendorId: string, asOfYmd: string) {
  const rows: any[] = await prisma.$queryRaw`
    WITH applied AS (
      SELECT bill_id, COALESCE(SUM(applied_amount_cents), 0)::bigint AS applied_cents
      FROM bill_payment_application
      WHERE business_id = ${businessId}::uuid
        AND is_active = true
      GROUP BY bill_id
    ),
    open_bills AS (
      SELECT
        b.id,
        b.due_date,
        (b.amount_cents - COALESCE(a.applied_cents, 0))::bigint AS outstanding_cents
      FROM bill b
      LEFT JOIN applied a ON a.bill_id = b.id
      WHERE b.business_id = ${businessId}::uuid
        AND b.vendor_id = ${vendorId}::uuid
        AND b.voided_at IS NULL
        AND (b.amount_cents - COALESCE(a.applied_cents, 0))::bigint > 0
    )
    SELECT
      COALESCE(SUM(outstanding_cents), 0)::bigint AS total_open_cents,
      COALESCE(SUM(CASE WHEN ((${asOfYmd}::date - due_date) <= 0) THEN outstanding_cents ELSE 0 END), 0)::bigint AS current_cents,
      COALESCE(SUM(CASE WHEN ((${asOfYmd}::date - due_date) BETWEEN 1 AND 30) THEN outstanding_cents ELSE 0 END), 0)::bigint AS days_30_cents,
      COALESCE(SUM(CASE WHEN ((${asOfYmd}::date - due_date) BETWEEN 31 AND 60) THEN outstanding_cents ELSE 0 END), 0)::bigint AS days_60_cents,
      COALESCE(SUM(CASE WHEN ((${asOfYmd}::date - due_date) > 60) THEN outstanding_cents ELSE 0 END), 0)::bigint AS days_90_plus_cents
    FROM open_bills;
  `;

  const r = rows?.[0] ?? {};
  return {
    as_of: asOfYmd,
    total_open_cents: String(r.total_open_cents ?? 0),
    aging: {
      current: String(r.current_cents ?? 0),
      days_30: String(r.days_30_cents ?? 0),
      days_60: String(r.days_60_cents ?? 0),
      days_90: String(r.days_90_plus_cents ?? 0),
    },
  };
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method ?? "GET";
  const path = String(event?.requestContext?.http?.path ?? "");

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const prisma = await getPrisma();
  const { businessId = "", vendorId = "", billId = "", accountId = "", entryId = "" } = pp(event);
  const biz = String(businessId ?? "").trim();
  if (!biz) return json(400, { ok: false, error: "Missing businessId" });

  // Defensive guards: prevent Prisma UUID crashes (return 400 instead of 500)
  const vid = String(vendorId ?? "").trim();
  const bid = String(billId ?? "").trim();
  const acct = String(accountId ?? "").trim();
  const ent = String(entryId ?? "").trim();

  if (path.includes("/vendors/") && path.includes("/bills")) {
    if (!vid || !isUuid(vid)) return json(400, { ok: false, error: "Invalid vendorId" });
  }
  if (path.includes("/bills/") && path.endsWith("/void")) {
    if (!bid || !isUuid(bid)) return json(400, { ok: false, error: "Invalid billId" });
  }
  if (path.includes("/accounts/") && path.includes("/entries/") && path.includes("/ap/")) {
    if (!acct || !isUuid(acct)) return json(400, { ok: false, error: "Invalid accountId" });
    if (!ent || !isUuid(ent)) return json(400, { ok: false, error: "Invalid entryId" });
  }

  const myRole = await requireRole(prisma, biz, sub);
  if (!myRole) return json(403, { ok: false, error: "Forbidden" });

  // ---------- Bills list (by vendor) ----------
  if (method === "GET" && vendorId && path === `/v1/businesses/${biz}/vendors/${vendorId}/bills`) {
    const q = qp(event);
    const limit = clampLimit(q.limit);
    const statusQ = String(q.status ?? "all").toLowerCase();

    const where: any = { business_id: biz, vendor_id: String(vendorId) };
    if (statusQ === "open") where.status = { in: ["OPEN", "PARTIAL"] };
    if (statusQ === "paid") where.status = "PAID";

    const bills = await prisma.bill.findMany({
      where,
      orderBy: [{ due_date: "asc" }, { created_at: "desc" }],
      take: limit,
      select: {
        id: true,
        business_id: true,
        vendor_id: true,
        invoice_date: true,
        due_date: true,
        amount_cents: true,
        status: true,
        memo: true,
        terms: true,
        upload_id: true,
        created_by_user_id: true,
        created_at: true,
        updated_at: true,
        voided_at: true,
        voided_by_user_id: true,
        void_reason: true,
      },
    });

    const billIds = bills.map((b: any) => String(b.id));
    const appliedByBill = await computeBillAppliedMap(prisma, biz, billIds);

    return json(200, {
      ok: true,
      bills: bills.map((b: any) => {
        const amount = toBigIntSafe(b.amount_cents);
        const applied = appliedByBill.get(String(b.id)) ?? 0n;
        const outstanding = amount - applied;
        const status = deriveBillStatus({ isVoid: !!b.voided_at, amount, applied });

        return {
          ...b,
          amount_cents: String(amount),
          applied_cents: String(applied),
          outstanding_cents: String(outstanding < 0n ? 0n : outstanding),
          status,
        };
      }),
    });
  }

  // ---------- Create Bill ----------
  if (method === "POST" && vendorId && path === `/v1/businesses/${biz}/vendors/${vendorId}/bills`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const body = readBody(event);
    if (!body) return json(400, { ok: false, error: "Invalid JSON body" });

    const vid = String(vendorId).trim();
    const vendor = await requireVendor(prisma, biz, vid);
    if (!vendor) return json(404, { ok: false, error: "Vendor not found" });

    const invoice_date = String(body.invoice_date ?? "").trim();
    const due_date = String(body.due_date ?? "").trim();
    const amount = toBigIntSafe(body.amount_cents);
    const memo = body.memo === undefined ? null : String(body.memo ?? "").trim() || null;
    const terms = body.terms === undefined ? null : String(body.terms ?? "").trim() || null;
    const upload_id = body.upload_id ? String(body.upload_id).trim() : null;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoice_date)) return json(400, { ok: false, error: "invoice_date must be YYYY-MM-DD" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due_date)) return json(400, { ok: false, error: "due_date must be YYYY-MM-DD" });
    if (amount <= 0n) return json(400, { ok: false, error: "amount_cents must be a positive integer" });

    // Closed period enforcement (Bill is an accounting object -> invoice_date)
    const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: invoice_date });
    if (!cp.ok) return cp.response;

    const created = await prisma.bill.create({
      data: {
        business_id: biz,
        vendor_id: vid,
        invoice_date: ymdToDate(invoice_date),
        due_date: ymdToDate(due_date),
        amount_cents: amount,
        status: "OPEN",
        memo,
        terms,
        upload_id,
        created_by_user_id: sub,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      eventType: "AP_BILL_CREATED" as any,
      payloadJson: { bill_id: created.id, vendor_id: vid, amount_cents: String(amount), due_date },
      scopeAccountId: null,
    });

    return json(201, {
      ok: true,
      bill: {
        id: created.id,
        business_id: created.business_id,
        vendor_id: created.vendor_id,
        invoice_date,
        due_date,
        amount_cents: String(created.amount_cents),
        applied_cents: "0",
        outstanding_cents: String(created.amount_cents),
        status: "OPEN",
        memo: created.memo,
        terms: created.terms,
        upload_id: created.upload_id,
        created_by_user_id: created.created_by_user_id,
        created_at: created.created_at,
        updated_at: created.updated_at,
      },
    });
  }

  // ---------- Update Bill ----------
  if (method === "PATCH" && vendorId && billId && path === `/v1/businesses/${biz}/vendors/${vendorId}/bills/${billId}`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const body = readBody(event);
    if (!body) return json(400, { ok: false, error: "Invalid JSON body" });

    const vid = String(vendorId).trim();
    const bid = String(billId).trim();

    const bill = await prisma.bill.findFirst({
      where: { id: bid, business_id: biz, vendor_id: vid },
      select: { id: true, voided_at: true, invoice_date: true },
    });
    if (!bill) return json(404, { ok: false, error: "Bill not found" });
    if (bill.voided_at) return json(409, { ok: false, error: "Bill is voided" });

    // Closed period enforcement must use the STORED invoice_date (prevents bypass)
    const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: bill.invoice_date });
    if (!cp.ok) return cp.response;

    const data: any = { updated_at: new Date() };

    // If this bill has ACTIVE applications, only allow memo and due_date edits.
    const activeAppsCount = await prisma.billPaymentApplication.count({
      where: { business_id: biz, bill_id: bid, is_active: true },
    });

    if (activeAppsCount > 0) {
      const touchesBlocked =
        body.amount_cents !== undefined ||
        body.invoice_date !== undefined ||
        body.terms !== undefined ||
        body.upload_id !== undefined;

      if (touchesBlocked) {
        return json(409, { ok: false, error: "BILL_HAS_APPLICATIONS" });
      }
    }

    if (body.invoice_date !== undefined) {
      const d = String(body.invoice_date ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json(400, { ok: false, error: "invoice_date must be YYYY-MM-DD" });
      data.invoice_date = ymdToDate(d);
    }

    if (body.due_date !== undefined) {
      const d = String(body.due_date ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json(400, { ok: false, error: "due_date must be YYYY-MM-DD" });
      data.due_date = ymdToDate(d);
    }

    if (body.memo !== undefined) data.memo = String(body.memo ?? "").trim() || null;
    if (body.terms !== undefined) data.terms = String(body.terms ?? "").trim() || null;
    if (body.upload_id !== undefined) data.upload_id = body.upload_id ? String(body.upload_id).trim() : null;

    if (body.amount_cents !== undefined) {
      const activeCount = await prisma.billPaymentApplication.count({
        where: { business_id: biz, bill_id: bid, is_active: true },
      });
      if (activeCount > 0) return json(409, { ok: false, error: "BILL_HAS_APPLICATIONS" });

      const amt = toBigIntSafe(body.amount_cents);
      if (amt <= 0n) return json(400, { ok: false, error: "amount_cents must be a positive integer" });
      data.amount_cents = amt;
    }

    const updated = await prisma.bill.update({ where: { id: bid }, data });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      eventType: "AP_BILL_UPDATED" as any,
      payloadJson: { bill_id: bid, vendor_id: vid },
      scopeAccountId: null,
    });

    return json(200, { ok: true, bill: { ...updated, amount_cents: String(updated.amount_cents) } });
  }

  // ---------- Void Bill (409 MUST_UNAPPLY_FIRST if any active apps) ----------
  if (method === "POST" && vendorId && billId && path === `/v1/businesses/${biz}/vendors/${vendorId}/bills/${billId}/void`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const vid = String(vendorId).trim();
    const bid = String(billId).trim();
    const body = readBody(event) ?? {};
    const reason = body?.reason ? String(body.reason).trim() : null;

    const bill = await prisma.bill.findFirst({
      where: { id: bid, business_id: biz, vendor_id: vid },
      select: { id: true, voided_at: true, invoice_date: true },
    });
    if (!bill) return json(404, { ok: false, error: "Bill not found" });
    if (bill.voided_at) return json(200, { ok: true, bill_id: bid, status: "VOID", already_voided: true });

    // Closed period enforcement must use the STORED invoice_date
    const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: bill.invoice_date });
    if (!cp.ok) return cp.response;

    const activeApps = await prisma.billPaymentApplication.count({
      where: { business_id: biz, bill_id: bid, is_active: true },
    });
    if (activeApps > 0) return json(409, { ok: false, error: "MUST_UNAPPLY_FIRST" });

    await prisma.bill.update({
      where: { id: bid },
      data: {
        status: "VOID",
        voided_at: new Date(),
        voided_by_user_id: sub,
        void_reason: reason,
        updated_at: new Date(),
      },
    });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      eventType: "AP_BILL_VOIDED" as any,
      payloadJson: { bill_id: bid, vendor_id: vid, reason },
      scopeAccountId: null,
    });

    return json(200, { ok: true, bill_id: bid, status: "VOID" });
  }

  // ---------- Vendor AP summary (aging; aggregate SQL) ----------
  if (method === "GET" && vendorId && path === `/v1/businesses/${biz}/vendors/${vendorId}/ap/summary`) {
    const q = qp(event);
    const asOf = String(q.asOf ?? "").trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return json(400, { ok: false, error: "asOf must be YYYY-MM-DD" });

    const vendor = await requireVendor(prisma, biz, String(vendorId));
    if (!vendor) return json(404, { ok: false, error: "Vendor not found" });

    const summary = await getVendorAgingSummary(prisma, biz, String(vendorId), asOf);
    return json(200, { ok: true, summary });
  }

  // ---------- Business vendors summary (aggregate SQL; limit <= 200) ----------
  if (method === "GET" && path === `/v1/businesses/${biz}/ap/vendors-summary`) {
    const q = qp(event);
    const asOf = String(q.asOf ?? "").trim() || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return json(400, { ok: false, error: "asOf must be YYYY-MM-DD" });

    const limit = clampLimit(q.limit);
    const vendorIds = String(q.vendor_ids ?? "").trim();
    const ids = vendorIds ? vendorIds.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200) : [];

    const rows: any[] = await prisma.$queryRaw`
      WITH vendors AS (
        SELECT id, name
        FROM vendor
        WHERE business_id = ${biz}::uuid
          AND (${ids.length}::int = 0 OR id = ANY(${ids}::uuid[]))
        ORDER BY name ASC
        LIMIT ${limit}::int
      ),
      applied AS (
        SELECT a.bill_id, COALESCE(SUM(a.applied_amount_cents), 0)::bigint AS applied_cents
        FROM bill_payment_application a
        WHERE a.business_id = ${biz}::uuid
          AND a.is_active = true
        GROUP BY a.bill_id
      ),
      open_bills AS (
        SELECT
          b.vendor_id,
          b.due_date,
          (b.amount_cents - COALESCE(ap.applied_cents, 0))::bigint AS outstanding_cents
        FROM bill b
        JOIN vendors v ON v.id = b.vendor_id
        LEFT JOIN applied ap ON ap.bill_id = b.id
        WHERE b.business_id = ${biz}::uuid
          AND b.voided_at IS NULL
          AND (b.amount_cents - COALESCE(ap.applied_cents, 0))::bigint > 0
      )
      SELECT
        v.id as vendor_id,
        v.name as vendor_name,
        COALESCE(SUM(o.outstanding_cents), 0)::bigint AS total_open_cents,
        COALESCE(SUM(CASE WHEN ((${asOf}::date - o.due_date) <= 0) THEN o.outstanding_cents ELSE 0 END), 0)::bigint AS current_cents,
        COALESCE(SUM(CASE WHEN ((${asOf}::date - o.due_date) BETWEEN 1 AND 30) THEN o.outstanding_cents ELSE 0 END), 0)::bigint AS days_30_cents,
        COALESCE(SUM(CASE WHEN ((${asOf}::date - o.due_date) BETWEEN 31 AND 60) THEN o.outstanding_cents ELSE 0 END), 0)::bigint AS days_60_cents,
        COALESCE(SUM(CASE WHEN ((${asOf}::date - o.due_date) > 60) THEN o.outstanding_cents ELSE 0 END), 0)::bigint AS days_90_plus_cents
      FROM vendors v
      LEFT JOIN open_bills o ON o.vendor_id = v.id
      GROUP BY v.id, v.name
      ORDER BY v.name ASC;
    `;

    return json(200, {
      ok: true,
      as_of: asOf,
      vendors: (rows ?? []).map((r: any) => ({
        vendor_id: String(r.vendor_id),
        vendor_name: String(r.vendor_name),
        total_open_cents: String(r.total_open_cents ?? 0),
        aging: {
          current: String(r.current_cents ?? 0),
          days_30: String(r.days_30_cents ?? 0),
          days_60: String(r.days_60_cents ?? 0),
          days_90: String(r.days_90_plus_cents ?? 0),
        },
      })),
    });
  }

  // ---------- Vendor statement CSV ----------
  if (method === "GET" && vendorId && path === `/v1/businesses/${biz}/vendors/${vendorId}/ap/statement.csv`) {
    const q = qp(event);
    const from = String(q.from ?? "").trim() || new Date(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1).toISOString().slice(0, 10);
    const to = String(q.to ?? "").trim() || new Date().toISOString().slice(0, 10);

    const vendor = await requireVendor(prisma, biz, String(vendorId));
    if (!vendor) return json(404, { ok: false, error: "Vendor not found" });

    // Bills + applied totals
    const bills = await prisma.bill.findMany({
      where: {
        business_id: biz,
        vendor_id: String(vendorId),
        invoice_date: {
          gte: new Date(from + "T00:00:00Z"),
          lte: new Date(to + "T23:59:59Z"),
        },
      },
      orderBy: [{ due_date: "asc" }, { created_at: "desc" }],
      take: 200,
      select: { id: true, invoice_date: true, due_date: true, amount_cents: true, status: true, memo: true, upload_id: true },
    });

    const billIds = bills.map((b: any) => String(b.id));
    const appliedByBill = await computeBillAppliedMap(prisma, biz, billIds);

    const lines: string[] = [];
    lines.push(`Vendor,${JSON.stringify(vendor.name)}`);
    lines.push(`From,${from}`);
    lines.push(`To,${to}`);
    lines.push("");
    lines.push("Section,BillId,InvoiceDate,DueDate,AmountCents,AppliedCents,OutstandingCents,Status,Memo,UploadId");

    for (const b of bills) {
      const amount = toBigIntSafe(b.amount_cents);
      const applied = appliedByBill.get(String(b.id)) ?? 0n;
      const outstanding = amount - applied;
      const st = String(b.status ?? "");
      lines.push([
        "BILL",
        b.id,
        String(b.invoice_date ?? "").slice(0, 10),
        String(b.due_date ?? "").slice(0, 10),
        String(amount),
        String(applied),
        String(outstanding < 0n ? 0n : outstanding),
        st,
        JSON.stringify(b.memo ?? ""),
        b.upload_id ?? "",
      ].join(","));
    }

    return {
      statusCode: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="vendor-statement-${vendorId}-${from}-to-${to}.csv"`,
      },
      body: lines.join("\n"),
    };
  }

  // ---------- Vendor-first payment: create ledger entry (entry_kind=VENDOR_PAYMENT, category=Purchase) ----------
  if (method === "POST" && vendorId && path === `/v1/businesses/${biz}/vendors/${vendorId}/payments`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const body = readBody(event);
    if (!body) return json(400, { ok: false, error: "Invalid JSON body" });

    const acctId = String(body.account_id ?? "").trim();
    const date = String(body.date ?? "").trim(); // YYYY-MM-DD
    const amountCentsIn = Number(body.amount_cents ?? 0);
    const memo = body.memo !== undefined ? String(body.memo ?? "").trim() : "Vendor payment";

    if (!acctId) return json(400, { ok: false, error: "account_id is required" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { ok: false, error: "date must be YYYY-MM-DD" });
    if (!Number.isFinite(amountCentsIn) || amountCentsIn <= 0) return json(400, { ok: false, error: "amount_cents must be positive cents" });

    const vendor = await requireVendor(prisma, biz, String(vendorId));
    if (!vendor) return json(404, { ok: false, error: "Vendor not found" });

    // Closed period enforcement
    const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: date });
    if (!cp.ok) return cp.response;

    const acctOk = await prisma.account.findFirst({ where: { id: acctId, business_id: biz }, select: { id: true } });
    if (!acctOk) return json(404, { ok: false, error: "Account not found in this business" });

    // Ensure Purchase category exists
    const purchase = await prisma.category.findFirst({
      where: { business_id: biz, name: { equals: "Purchase", mode: "insensitive" }, archived_at: null },
      select: { id: true },
    });

    const purchaseId =
      purchase?.id ??
      (await prisma.category.create({ data: { business_id: biz, name: "Purchase" }, select: { id: true } })).id;

    const entry = await prisma.entry.create({
      data: {
        id: randomUUID(),
        business_id: biz,
        account_id: acctId,
        date: new Date(date + "T00:00:00Z"),
        payee: vendor.name,
        memo: memo || "Vendor payment",
        amount_cents: BigInt(-Math.abs(Math.round(amountCentsIn))), // expense
        type: "EXPENSE",
        method: "OTHER",
        status: "EXPECTED",
        category_id: purchaseId,
        vendor_id: String(vendorId),
        entry_kind: "VENDOR_PAYMENT",
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      } as any,
      select: { id: true },
    });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      scopeAccountId: acctId,
      eventType: "AP_PAYMENT_APPLIED" as any,
      payloadJson: { vendor_id: vendorId, entry_id: entry.id, created_via: "VENDOR_PAGE" },
    });

    return json(201, { ok: true, entry_id: entry.id });
  }

  // ---------- Vendor payments summary (derived advance/unapplied) ----------
  if (method === "GET" && vendorId && path === `/v1/businesses/${biz}/vendors/${vendorId}/ap/payments-summary`) {
    const limit = clampLimit(qp(event)?.limit ?? 200);

    const rows: any[] = await prisma.$queryRaw`
      WITH payments AS (
        SELECT e.id, e.date, e.payee, e.amount_cents
        FROM entry e
        WHERE e.business_id = ${biz}::uuid
          AND e.vendor_id = ${vendorId}::uuid
          AND e.deleted_at IS NULL
          AND e.type = 'EXPENSE'
AND (
  COALESCE(e.entry_kind, 'GENERAL') = 'VENDOR_PAYMENT'
  OR EXISTS (
    SELECT 1
    FROM category c
    WHERE c.id = e.category_id
      AND c.business_id = e.business_id
      AND LOWER(c.name) = 'purchase'
      AND c.archived_at IS NULL
  )
)
        ORDER BY e.date DESC, e.created_at DESC
        LIMIT ${limit}::int
      ),
      applied AS (
        SELECT
          a.entry_id,
          COALESCE(SUM(a.applied_amount_cents), 0)::bigint AS applied_cents,
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'bill_id', b.id,
                'invoice_date', b.invoice_date,
                'memo', b.memo,
                'applied_amount_cents', a.applied_amount_cents
              )
              ORDER BY b.due_date ASC
            ) FILTER (WHERE b.id IS NOT NULL),
            '[]'::json
          ) AS applied_bills
        FROM bill_payment_application a
        JOIN bill b ON b.id = a.bill_id
        WHERE a.business_id = ${biz}::uuid
          AND a.is_active = true
          AND a.entry_id IN (SELECT id FROM payments)
        GROUP BY a.entry_id
      )
      SELECT
        p.id,
        p.date,
        p.payee,
        p.amount_cents::bigint AS amount_cents,
        COALESCE(a.applied_cents, 0)::bigint AS applied_cents,
        (ABS(p.amount_cents::bigint) - COALESCE(a.applied_cents, 0)::bigint)::bigint AS unapplied_cents,
        COALESCE(a.applied_bills, '[]'::json) AS applied_bills
      FROM payments p
      LEFT JOIN applied a ON a.entry_id = p.id
      ORDER BY p.date DESC;
    `;

    const totals: any[] = await prisma.$queryRaw`
      WITH payments AS (
        SELECT e.id, e.amount_cents::bigint AS amount_cents
        FROM entry e
        WHERE e.business_id = ${biz}::uuid
          AND e.vendor_id = ${vendorId}::uuid
          AND e.deleted_at IS NULL
          AND e.type = 'EXPENSE'
AND (
  COALESCE(e.entry_kind, 'GENERAL') = 'VENDOR_PAYMENT'
  OR EXISTS (
    SELECT 1
    FROM category c
    WHERE c.id = e.category_id
      AND c.business_id = e.business_id
      AND LOWER(c.name) = 'purchase'
      AND c.archived_at IS NULL
  )
)
      ),
      applied AS (
        SELECT entry_id, COALESCE(SUM(applied_amount_cents), 0)::bigint AS applied_cents
        FROM bill_payment_application
        WHERE business_id = ${biz}::uuid
          AND is_active = true
          AND entry_id IN (SELECT id FROM payments)
        GROUP BY entry_id
      )
      SELECT
        COALESCE(SUM(ABS(p.amount_cents)), 0)::bigint AS total_paid_abs_cents,
        COALESCE(SUM(COALESCE(a.applied_cents, 0)), 0)::bigint AS total_applied_cents
      FROM payments p
      LEFT JOIN applied a ON a.entry_id = p.id;
    `;

    const t = totals?.[0] ?? {};
    const totalPaid = toBigIntSafe(t.total_paid_abs_cents ?? 0);
    const totalApplied = toBigIntSafe(t.total_applied_cents ?? 0);
    const totalUnapplied = totalPaid - totalApplied;

    return json(200, {
      ok: true,
      totals: {
        total_paid_abs_cents: String(totalPaid),
        total_applied_cents: String(totalApplied),
        total_unapplied_cents: String(totalUnapplied < 0n ? 0n : totalUnapplied),
      },
      payments: (rows ?? []).map((r: any) => ({
        entry_id: String(r.id),
        date: String(r.date ?? "").slice(0, 10),
        payee: String(r.payee ?? ""),
        amount_cents: String(r.amount_cents ?? 0),
        applied_cents: String(r.applied_cents ?? 0),
        unapplied_cents: String(r.unapplied_cents ?? 0),
        applied_bills: Array.isArray(r.applied_bills) ? r.applied_bills : [],
      })),
    });
  }

  // ---------- Apply payment (SAME VENDOR ONLY; abs(entry.amount_cents); prevent over-apply bill + entry) ----------
  if (method === "POST" && accountId && entryId && path === `/v1/businesses/${biz}/accounts/${accountId}/entries/${entryId}/ap/apply`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const body = readBody(event);
    if (!body) return json(400, { ok: false, error: "Invalid JSON body" });

    const applications = Array.isArray(body.applications) ? body.applications : [];
    if (applications.length === 0) return json(400, { ok: false, error: "applications is required" });

    const acctId = String(accountId).trim();
    const entId = String(entryId).trim();

    const result = await prisma.$transaction(async (tx: any) => {
      const entry = await tx.entry.findFirst({
        where: { id: entId, business_id: biz, account_id: acctId, deleted_at: null },
        select: { id: true, account_id: true, amount_cents: true, vendor_id: true },
      });
      if (!entry) return { ok: false, status: 404, error: "Entry not found" };

      const entryVendorId = entry.vendor_id ? String(entry.vendor_id) : null;
      if (!entryVendorId) return { ok: false, status: 400, error: "Entry must be linked to a vendor" };

      const paymentAbs = (() => {
        const a = toBigIntSafe(entry.amount_cents);
        return a < 0n ? -a : a;
      })();

      const billIds: string[] = (applications as any[])
        .map((x: any) => String(x?.bill_id ?? "").trim())
        .filter((s: string) => !!s);

      const uniqueBillIds: string[] = Array.from(new Set<string>(billIds)).slice(0, 200);
      if (uniqueBillIds.length !== billIds.length) return { ok: false, status: 400, error: "Duplicate bill_id in applications" };

      const bills = await tx.bill.findMany({
        where: { business_id: biz, id: { in: uniqueBillIds }, vendor_id: entryVendorId, voided_at: null },
        select: { id: true, amount_cents: true },
      });
      if (bills.length !== uniqueBillIds.length) {
        return { ok: false, status: 400, error: "All bills must belong to the same vendor as the entry" };
      }

      const billById = new Map<string, bigint>();
      for (const b of bills) billById.set(String(b.id), toBigIntSafe(b.amount_cents));

      const existingEntryApps = await tx.billPaymentApplication.findMany({
        where: { business_id: biz, entry_id: entId, is_active: true },
        select: { bill_id: true, applied_amount_cents: true },
      });

      const oldByBill = new Map<string, bigint>();
      let existingEntryTotal = 0n;
      for (const a of existingEntryApps) {
        const amt = toBigIntSafe(a.applied_amount_cents);
        existingEntryTotal += amt;
        oldByBill.set(String(a.bill_id), amt);
      }

      const existingBillApplied = await computeBillAppliedMap(tx, biz, uniqueBillIds);

      let oldInPayloadTotal = 0n;
      let newPayloadTotal = 0n;

      const newAmtByBill = new Map<string, bigint>();
      for (const ap of applications) {
        const bid = String(ap?.bill_id ?? "").trim();
        const amt = toBigIntSafe(ap?.applied_amount_cents);

        if (!bid) return { ok: false, status: 400, error: "bill_id is required" };
        if (amt <= 0n) return { ok: false, status: 400, error: "applied_amount_cents must be a positive integer" };

        newPayloadTotal += amt;
        newAmtByBill.set(bid, amt);

        const oldAmt = oldByBill.get(bid) ?? 0n;
        oldInPayloadTotal += oldAmt;

        const billAmount = billById.get(bid) ?? 0n;
        const billAppliedNow = existingBillApplied.get(bid) ?? 0n;
        const billAppliedNew = billAppliedNow - oldAmt + amt;
        if (billAppliedNew > billAmount) return { ok: false, status: 409, error: "OVER_APPLY_BILL", bill_id: bid };
      }

      const newEntryTotal = existingEntryTotal - oldInPayloadTotal + newPayloadTotal;
      if (newEntryTotal > paymentAbs) return { ok: false, status: 409, error: "OVER_APPLY_ENTRY" };

      for (const [bid, amt] of newAmtByBill.entries()) {
        await tx.billPaymentApplication.upsert({
          // Prisma client uses the composite unique input name, not the SQL constraint map name.
          where: { entry_id_bill_id_is_active: { entry_id: entId, bill_id: bid, is_active: true } },
          create: {
            business_id: biz,
            account_id: acctId,
            entry_id: entId,
            bill_id: bid,
            applied_amount_cents: amt,
            applied_at: new Date(),
            created_by_user_id: sub,
            created_at: new Date(),
            is_active: true,
          },
          update: { applied_amount_cents: amt, applied_at: new Date() },
        });
      }

      await recomputeAndPersistBillStatuses(tx, biz, uniqueBillIds);

      // Update memo labeling (memo-only) for vendor payment entries
      await updateVendorPaymentMemoIfNeeded(tx, biz, entId);

      await logActivity(tx, {
        businessId: biz,
        actorUserId: sub,
        eventType: "AP_PAYMENT_APPLIED" as any,
        payloadJson: { entry_id: entId, account_id: acctId, vendor_id: entryVendorId, bills: applications },
        scopeAccountId: acctId,
      });

      return { ok: true };
    });

    if (!result.ok) return json(result.status ?? 400, { ok: false, error: result.error, bill_id: (result as any).bill_id });

    // Minimal response: affected bills (for UI patching without refetch storms)
    const updatedBills = await prisma.bill.findMany({
      where: { business_id: biz, id: { in: (Array.isArray(body?.applications) ? body.applications.map((x: any) => String(x.bill_id || "")).filter(Boolean) : []).slice(0, 200) } },
      select: { id: true, amount_cents: true, invoice_date: true, due_date: true, memo: true, status: true, voided_at: true },
    });

    const ids = updatedBills.map((b: any) => String(b.id));
    const appliedMap = await computeBillAppliedMap(prisma, biz, ids);

    return json(200, {
      ok: true,
      payment_entry_id: ent,
      updated_bills: updatedBills.map((b: any) => {
        const amount = toBigIntSafe(b.amount_cents);
        const applied = appliedMap.get(String(b.id)) ?? 0n;
        const outstanding = amount - applied;
        const status = deriveBillStatus({ isVoid: !!b.voided_at, amount, applied });
        return {
          id: b.id,
          invoice_date: String(b.invoice_date ?? "").slice(0, 10),
          due_date: String(b.due_date ?? "").slice(0, 10),
          memo: b.memo,
          status,
          amount_cents: String(amount),
          applied_cents: String(applied),
          outstanding_cents: String(outstanding < 0n ? 0n : outstanding),
        };
      }),
    });
  }

  // ---------- Unapply (auditable; SAME VENDOR ONLY) ----------
  if (method === "POST" && accountId && entryId && path === `/v1/businesses/${biz}/accounts/${accountId}/entries/${entryId}/ap/unapply`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const body = readBody(event);
    if (!body) return json(400, { ok: false, error: "Invalid JSON body" });

    const acctId = String(accountId).trim();
    const entId = String(entryId).trim();
    const reason = body?.reason ? String(body.reason).trim() : null;

    const billIds: string[] = body?.all
      ? []
      : Array.isArray(body?.bill_ids)
        ? body.bill_ids.map((x: any) => String(x ?? "").trim()).filter(Boolean)
        : [];

    const result = await prisma.$transaction(async (tx: any) => {
      const entry = await tx.entry.findFirst({
        where: { id: entId, business_id: biz, account_id: acctId, deleted_at: null },
        select: { id: true, vendor_id: true },
      });
      if (!entry) return { ok: false, status: 404, error: "Entry not found" };

      const entryVendorId = entry.vendor_id ? String(entry.vendor_id) : null;
      if (!entryVendorId) return { ok: false, status: 400, error: "Entry must be linked to a vendor" };

      const where: any = { business_id: biz, entry_id: entId, is_active: true };
      if (!body?.all) {
        if (!billIds.length) return { ok: false, status: 400, error: "bill_ids is required (or all=true)" };
        where.bill_id = { in: billIds.slice(0, 200) };
      }

      const apps = await tx.billPaymentApplication.findMany({ where, select: { id: true, bill_id: true } });
      if (!apps.length) return { ok: true };

      const affectedBillIds: string[] = Array.from(new Set<string>(apps.map((a: any) => String(a.bill_id))));
      const bills = await tx.bill.findMany({
        where: { business_id: biz, id: { in: affectedBillIds }, vendor_id: entryVendorId },
        select: { id: true },
      });
      if (bills.length !== affectedBillIds.length) return { ok: false, status: 400, error: "All bills must belong to the same vendor as the entry" };

      await tx.billPaymentApplication.updateMany({
        where: { id: { in: apps.map((a: any) => a.id) } },
        data: { is_active: false, voided_at: new Date(), voided_by_user_id: sub, void_reason: reason },
      });

      await recomputeAndPersistBillStatuses(tx, biz, affectedBillIds);

      // Update memo labeling (memo-only) for vendor payment entries
      await updateVendorPaymentMemoIfNeeded(tx, biz, entId);

      await logActivity(tx, {
        businessId: biz,
        actorUserId: sub,
        eventType: "AP_PAYMENT_UNAPPLIED" as any,
        payloadJson: { entry_id: entId, account_id: acctId, vendor_id: entryVendorId, bill_ids: affectedBillIds, reason },
        scopeAccountId: acctId,
      });

      return { ok: true };
    });

    if (!result.ok) return json(result.status ?? 400, { ok: false, error: result.error });

    // Minimal response: bills likely affected are those referenced by bill_ids (or empty if all=true)
    const bidList = Array.isArray(body?.bill_ids) ? body.bill_ids.map((x: any) => String(x || "")).filter(Boolean).slice(0, 200) : [];
    const updatedBills = bidList.length
      ? await prisma.bill.findMany({
          where: { business_id: biz, id: { in: bidList } },
          select: { id: true, amount_cents: true, invoice_date: true, due_date: true, memo: true, status: true, voided_at: true },
        })
      : [];

    const ids = updatedBills.map((b: any) => String(b.id));
    const appliedMap = await computeBillAppliedMap(prisma, biz, ids);

    return json(200, {
      ok: true,
      payment_entry_id: ent,
      updated_bills: updatedBills.map((b: any) => {
        const amount = toBigIntSafe(b.amount_cents);
        const applied = appliedMap.get(String(b.id)) ?? 0n;
        const outstanding = amount - applied;
        const status = deriveBillStatus({ isVoid: !!b.voided_at, amount, applied });
        return {
          id: b.id,
          invoice_date: String(b.invoice_date ?? "").slice(0, 10),
          due_date: String(b.due_date ?? "").slice(0, 10),
          memo: b.memo,
          status,
          amount_cents: String(amount),
          applied_cents: String(applied),
          outstanding_cents: String(outstanding < 0n ? 0n : outstanding),
        };
      }),
    });
  }

  // ---------- Unapply ALL and soft-delete payment entry (explicit, auditable) ----------
  if (method === "POST" && accountId && entryId && path === `/v1/businesses/${biz}/accounts/${accountId}/entries/${entryId}/ap/unapply-and-delete`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const body = readBody(event) ?? {};
    const acctId = String(accountId).trim();
    const entId = String(entryId).trim();
    const reason = body?.reason ? String(body.reason).trim() : "Unapply all and delete payment";

    const result = await prisma.$transaction(async (tx: any) => {
      const entry = await tx.entry.findFirst({
        where: { id: entId, business_id: biz, account_id: acctId, deleted_at: null },
        select: { id: true, vendor_id: true },
      });
      if (!entry) return { ok: false, status: 404, error: "Entry not found" };

      // Void (auditable) all active apps for this entry
      const apps = await tx.billPaymentApplication.findMany({
        where: { business_id: biz, entry_id: entId, is_active: true },
        select: { id: true, bill_id: true },
      });

      const affectedBillIds = Array.from(new Set<string>(apps.map((a: any) => String(a.bill_id))));
      if (apps.length) {
        await tx.billPaymentApplication.updateMany({
          where: { id: { in: apps.map((a: any) => a.id) } },
          data: { is_active: false, voided_at: new Date(), voided_by_user_id: sub, void_reason: reason },
        });

        await recomputeAndPersistBillStatuses(tx, biz, affectedBillIds);

        await logActivity(tx, {
          businessId: biz,
          actorUserId: sub,
          eventType: "AP_PAYMENT_UNAPPLIED" as any,
          payloadJson: { entry_id: entId, account_id: acctId, reason, bill_ids: affectedBillIds },
          scopeAccountId: acctId,
        });
      }

      // Soft delete the ledger entry explicitly (no silent cascade)
      await tx.entry.update({
        where: { id: entId },
        data: {
          deleted_at: new Date(),
          vendor_id: null,
          entry_kind: "GENERAL",
          updated_at: new Date(),
        },
      });

      return { ok: true };
    });

    if (!result.ok) return json(result.status ?? 400, { ok: false, error: result.error });
    return json(200, { ok: true });
  }

  return json(404, { ok: false, error: "Not found" });
}
