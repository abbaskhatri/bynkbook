import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import { authorizeWrite } from "./lib/authz";
import { assertNotClosedPeriod } from "./lib/closedPeriods";
import { randomUUID } from "node:crypto";

const ENTRY_TYPES = ["EXPENSE", "INCOME", "TRANSFER", "ADJUSTMENT"] as const;
const ENTRY_STATUS = ["EXPECTED", "CLEARED"] as const;

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function pp(event: any) {
  return event?.pathParameters ?? {};
}

function qs(event: any) {
  return event?.queryStringParameters ?? {};
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

async function requireAccountInBusiness(prisma: any, businessId: string, accountId: string) {
  const acct = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { id: true },
  });
  return !!acct;
}

// Phase 6A: deny-by-default write permissions
function canWrite(role: string | null) {
  const r = (role ?? "").toString().trim().toUpperCase();
  return r === "OWNER" || r === "ADMIN" || r === "BOOKKEEPER" || r === "ACCOUNTANT";
}

export async function handler(event: any) {
  console.log("ENTRIES_HANDLER_VERSION", "v-transfer-fields-1");
  console.log("ENTRIES_HANDLER_VERSION", "v3-transfer-display");
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path;

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "", accountId = "", entryId = "" } = pp(event);
  const biz = businessId.toString().trim();
  const acct = accountId.toString().trim();
  const ent = entryId.toString().trim();

  if (!biz || !acct) return json(400, { ok: false, error: "Missing businessId/accountId" });

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, biz, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  const acctOk = await requireAccountInBusiness(prisma, biz, acct);
  if (!acctOk) return json(404, { ok: false, error: "Account not found in this business" });

  // GET /entries
  if (method === "GET" && path?.includes(`/v1/businesses/${biz}/accounts/${acct}/entries`)) {
    const q = qs(event);
    const includeDeleted = q.include_deleted === "true";
    const limitRaw = q.limit ?? "200";
    const limit = Math.max(1, Math.min(500, Number(limitRaw) || 200));

    const rows = await prisma.entry.findMany({
      where: {
        business_id: biz,
        account_id: acct,
        ...(includeDeleted ? {} : { deleted_at: null }),
      },
      orderBy: [{ date: "desc" }, { created_at: "desc" }],
      take: limit,
    });

    // Durable transfer display fields (no frontend session maps):
    // IMPORTANT: derive other account from the transfer record (not from entry legs),
    // so display remains correct even if one leg is missing in legacy data.
    const transferIds = Array.from(
      new Set(
        rows
          .map((r: any) => r.transfer_id)
          .filter((x: any) => !!x)
          .map((x: any) => String(x))
      )
    );

    const transferDisplayById = new Map<
      string,
      { other_account_id: string; other_account_name: string; direction: "IN" | "OUT" }
    >();

    if (transferIds.length > 0) {
      const transfers = await prisma.transfer.findMany({
        where: { business_id: biz, id: { in: transferIds } },
        select: { id: true, from_account_id: true, to_account_id: true },
      });

      const transferById = new Map<string, { from: string; to: string }>();
      for (const t of transfers) {
        transferById.set(String(t.id), { from: String(t.from_account_id), to: String(t.to_account_id) });
      }

      const accountIds = Array.from(
        new Set(
          transfers.flatMap((t) => [String(t.from_account_id), String(t.to_account_id)])
        )
      );

      const acctRows = await prisma.account.findMany({
        where: { business_id: biz, id: { in: accountIds } },
        select: { id: true, name: true },
      });

      const acctNameById = new Map<string, string>();
      for (const a of acctRows) acctNameById.set(String(a.id), String(a.name));

      for (const tid of transferIds) {
        const tr = transferById.get(tid);
        if (!tr) continue;

        // other account is based on transfer endpoints
        const otherId = tr.from === acct ? tr.to : tr.from;

        // direction is relative to THIS account row (sign of amount in this account)
        const row = rows.find((r: any) => String(r.transfer_id) === tid);
        // If multiple rows share same transfer_id in this account list, direction is still correct for the row itself.
        // We'll compute direction per-row in response mapping too, but this gives a safe default.
        const amt = row ? BigInt(String(row.amount_cents)) : 0n;
        const direction: "IN" | "OUT" = amt < 0n ? "OUT" : "IN";

        transferDisplayById.set(tid, {
          other_account_id: otherId,
          other_account_name: acctNameById.get(otherId) ?? "Other account",
          direction,
        });
      }
    }

    // Category name map (include archived): map ids -> names
    const catIds = Array.from(
      new Set(
        rows
          .map((r: any) => r.category_id)
          .filter((x: any) => !!x)
          .map((x: any) => String(x))
      )
    );

    const categoryNameById = new Map<string, string>();
    if (catIds.length > 0) {
      const cats = await prisma.category.findMany({
        where: { business_id: biz, id: { in: catIds } },
        select: { id: true, name: true },
      });
      for (const c of cats) categoryNameById.set(String(c.id), String(c.name));
    }

    // Vendor name map: map vendor_ids -> names
    const vendorIds = Array.from(
      new Set(
        rows
          .map((r: any) => r.vendor_id)
          .filter((x: any) => !!x)
          .map((x: any) => String(x))
      )
    );

    const vendorNameById = new Map<string, string>();
    if (vendorIds.length > 0) {
      const vendors = await prisma.vendor.findMany({
        where: { business_id: biz, id: { in: vendorIds } },
        select: { id: true, name: true },
      });
      for (const v of vendors) vendorNameById.set(String(v.id), String(v.name));
    }

    return json(200, {
      ok: true,
      entries: rows.map((e) => {
        const tid = e.transfer_id ? String(e.transfer_id) : null;
        const transferDisplay = tid ? transferDisplayById.get(tid) : null;

        return {
          id: e.id,
          business_id: e.business_id,
          account_id: e.account_id,
          date: e.date,
          payee: e.payee,
          memo: e.memo,
          amount_cents: String(e.amount_cents),
          type: e.type,
          method: e.method,
          status: e.status,

          // Categories
          category_id: e.category_id,
          category_name: e.category_id
            ? categoryNameById.get(String(e.category_id)) ?? null
            : null,

          // Vendor link (persisted)
          vendor_id: (e as any).vendor_id ?? null,
          vendor_name: (e as any).vendor_id ? (vendorNameById.get(String((e as any).vendor_id)) ?? null) : null,

          // Transfers (DURABLE, BACKEND-DERIVED)
          transfer_id: e.transfer_id,
          transfer_other_account_name: transferDisplay?.other_account_name ?? null,
          transfer_other_account_id: transferDisplay?.other_account_id ?? null,
          transfer_direction:
            e.transfer_id
              ? (BigInt(String(e.amount_cents)) < 0n ? "OUT" : "IN")
              : null,

          is_adjustment: e.is_adjustment,
          created_at: e.created_at,
          updated_at: e.updated_at,
          deleted_at: e.deleted_at,
        };
      })
    });
  }

  // POST /entries (create)
  if (method === "POST" && path?.endsWith("/entries")) {
    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const date = (body?.date ?? "").toString().trim(); // YYYY-MM-DD
    const payee = body?.payee ?? null;
    const memo = body?.memo ?? null;

    // Category (optional)
    const categoryIdRaw = body?.category_id ?? body?.categoryId ?? null;
    const category_id = categoryIdRaw ? categoryIdRaw.toString().trim() : null;

    const type = (body?.type ?? "").toString().trim();
    const methodField = body?.method ?? null;
    const status = (body?.status ?? "EXPECTED").toString().trim();
    const amountRaw = body?.amount_cents;

    if (!date) return json(400, { ok: false, error: "date is required (YYYY-MM-DD)" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(400, { ok: false, error: "date must be YYYY-MM-DD" });

    // Stage 2A: closed period enforcement (409 CLOSED_PERIOD)
    const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: date });
    if (!cp.ok) return cp.response;

    if (!ENTRY_TYPES.includes(type as any)) return json(400, { ok: false, error: "Invalid type" });
    if (!ENTRY_STATUS.includes(status as any)) return json(400, { ok: false, error: "Invalid status" });

    if (type === "TRANSFER") {
      return json(400, { ok: false, error: "Use /transfers for TRANSFER entries" });
    }

    if (!Number.isFinite(Number(amountRaw))) return json(400, { ok: false, error: "amount_cents must be a number" });
    const amountIn = BigInt(Math.trunc(Number(amountRaw)));

    let amount: bigint = amountIn;

    // Enforce sign rules
    if (type === "INCOME") amount = amountIn < 0n ? -amountIn : amountIn; // +abs
    if (type === "EXPENSE") amount = amountIn > 0n ? -amountIn : amountIn; // -abs
    // ADJUSTMENT keeps sign exactly as provided (no normalization)

    // Category System v2: validate category_id (if provided) belongs to this business and is not archived.
    // This prevents bad IDs from being stored and keeps Ledger/Issues/Reports consistent.
    if (category_id) {
      const hit = await prisma.category.findFirst({
        where: { id: category_id, business_id: biz, archived_at: null },
        select: { id: true },
      });
      if (!hit) return json(400, { ok: false, error: "Invalid category" });
    }

    const entryUuid = randomUUID();
    const created = await prisma.entry.create({
      data: {
        id: entryUuid,
        business_id: biz,
        account_id: acct,
        date: new Date(date + "T00:00:00Z"),
        payee,
        memo,
        category_id,
        amount_cents: amount,
        type,
        method: methodField,
        status,
        is_adjustment: type === "ADJUSTMENT",
        adjusted_at: type === "ADJUSTMENT" ? new Date() : null,
        adjusted_by_user_id: type === "ADJUSTMENT" ? sub : null,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    return json(201, {
      ok: true,
      entry: {
        id: created.id,
        business_id: created.business_id,
        account_id: created.account_id,
        date,
        amount_cents: created.amount_cents.toString(),
        type: created.type,
        status: created.status,
        category_id: created.category_id,
      },
    });
  }

  // DELETE /entries/{entryId} (soft delete)
  if (method === "DELETE" && ent) {
    const existing = await prisma.entry.findFirst({
      where: { id: ent, business_id: biz, account_id: acct, deleted_at: null },
      select: { date: true },
    });

    // Idempotent delete
    if (!existing) {
      const already = await prisma.entry.findFirst({
        where: { id: ent, business_id: biz, account_id: acct, deleted_at: { not: null } },
        select: { id: true },
      });
      if (already) return json(200, { ok: true, deleted: true, entry_id: ent, already_deleted: true });
      return json(404, { ok: false, error: "Entry not found" });
    }

    // Closed period enforcement
    const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: existing.date });
    if (!cp.ok) return cp.response;

    await prisma.$transaction(async (tx) => {
      // 1) Void any ACTIVE matches for this entry (brings bank txn back to Unmatched)
      await tx.bankMatch.updateMany({
        where: {
          business_id: biz,
          entry_id: ent,
          voided_at: null,
        },
        data: {
          voided_at: new Date(),
          voided_by_user_id: sub,
        },
      });

      // 2) Soft-delete the entry
      await tx.entry.updateMany({
        where: {
          id: ent,
          business_id: biz,
          account_id: acct,
          deleted_at: null,
        },
        data: {
          deleted_at: new Date(),
          updated_at: new Date(),
        },
      });
    });

    return json(200, { ok: true, deleted: true, entry_id: ent });
  }

  // POST /entries/{entryId}/restore
  if (method === "POST" && ent && path?.endsWith("/restore")) {
    const existing = await prisma.entry.findFirst({
      where: { id: ent, business_id: biz, account_id: acct },
      select: { date: true },
    });
    if (!existing) return json(404, { ok: false, error: "Entry not found" });

    // Stage 2A: closed period enforcement (409 CLOSED_PERIOD)
    const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: existing.date });
    if (!cp.ok) return cp.response;

    await prisma.entry.updateMany({
      where: {
        id: ent,
        business_id: biz,
        account_id: acct,
      },
      data: {
        deleted_at: null,
        updated_at: new Date(),
      },
    });

    return json(200, { ok: true, restored: true, entry_id: ent });
  }

  // POST /entries/{entryId}/mark-adjustment (Phase 4D v1)
  if (method === "POST" && ent && path?.endsWith("/mark-adjustment")) {
    // Phase 6A: enforce write permission (deny-by-default)
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    const az = await authorizeWrite(prisma, {
      businessId: biz,
      scopeAccountId: acct,
      actorUserId: sub,
      actorRole: role,
      actionKey: "reconcile.adjustment.mark",
      requiredLevel: "FULL",
      endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/mark-adjustment",
    });

    if (!az.allowed) {
      return json(403, {
        ok: false,
        error: "Policy denied",
        code: "POLICY_DENIED",
        actionKey: "reconcile.adjustment.mark",
        requiredLevel: az.requiredLevel,
        policyValue: az.policyValue,
        policyKey: az.policyKey,
      });
    }

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const reason = (body?.reason ?? "").toString().trim();
    if (!reason) return json(400, { ok: false, error: "reason is required" });

    const existing = await prisma.entry.findFirst({
      where: { id: ent, business_id: biz, account_id: acct, deleted_at: null },
      select: { date: true },
    });
    if (!existing) return json(404, { ok: false, error: "Entry not found" });

    // Stage 2A: closed period enforcement (409 CLOSED_PERIOD)
    const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: existing.date });
    if (!cp.ok) return cp.response;

    const updated = await prisma.entry.updateMany({
      where: {
        id: ent,
        business_id: biz,
        account_id: acct,
        deleted_at: null,
      },
      data: {
        is_adjustment: true,
        type: "ADJUSTMENT",
        adjusted_at: new Date(),
        adjusted_by_user_id: sub,
        adjustment_reason: reason,
        updated_at: new Date(),
      },
    });

    if (updated.count === 0) return json(404, { ok: false, error: "Entry not found" });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      scopeAccountId: acct,
      eventType: "RECONCILE_ENTRY_ADJUSTMENT_MARKED",
      payloadJson: { account_id: acct, entry_id: ent },
    });

    return json(200, { ok: true, entry_id: ent, isAdjustment: true });
  }

  // POST /entries/{entryId}/unmark-adjustment (Phase 6D)
  if (method === "POST" && ent && path?.endsWith("/unmark-adjustment")) {
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    const az = await authorizeWrite(prisma, {
      businessId: biz,
      scopeAccountId: acct,
      actorUserId: sub,
      actorRole: role,
      actionKey: "reconcile.adjustment.unmark",
      requiredLevel: "FULL",
      endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/entries/{entryId}/unmark-adjustment",
    });

    if (!az.allowed) {
      return json(403, {
        ok: false,
        error: "Policy denied",
        code: "POLICY_DENIED",
        actionKey: "reconcile.adjustment.unmark",
        requiredLevel: az.requiredLevel,
        policyValue: az.policyValue,
        policyKey: az.policyKey,
      });
    }

    const existing = await prisma.entry.findFirst({
      where: { id: ent, business_id: biz, account_id: acct, deleted_at: null },
      select: { date: true, amount_cents: true },
    });
    if (!existing) return json(404, { ok: false, error: "Entry not found" });

    // Stage 2A: closed period enforcement (409 CLOSED_PERIOD)
    const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: existing.date });
    if (!cp.ok) return cp.response;

    const updated = await prisma.entry.updateMany({
      where: {
        id: ent,
        business_id: biz,
        account_id: acct,
        deleted_at: null,
      },
      data: {
        is_adjustment: false,
        type: existing.amount_cents >= 0 ? "INCOME" : "EXPENSE",
        adjusted_at: null,
        adjusted_by_user_id: null,
        adjustment_reason: null,
        updated_at: new Date(),
      },
    });

    if (updated.count === 0) return json(404, { ok: false, error: "Entry not found" });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      scopeAccountId: acct,
      eventType: "RECONCILE_ENTRY_ADJUSTMENT_UNMARKED",
      payloadJson: { account_id: acct, entry_id: ent },
    });

    return json(200, { ok: true, entry_id: ent, isAdjustment: false });
  }

  return json(404, { ok: false, error: "Not Found", method, path });
}

