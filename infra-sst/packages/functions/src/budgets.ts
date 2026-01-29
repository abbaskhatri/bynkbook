import { getPrisma } from "./lib/db";
import { authorizeWrite } from "./lib/authz";
import { logActivity } from "./lib/activityLog";

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

function qs(event: any) {
  return event?.queryStringParameters ?? {};
}

function getPath(event: any) {
  return String(event?.requestContext?.http?.path ?? "");
}

async function getMyRole(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

// Phase 6A: deny-by-default write permissions
function canWrite(role: string | null) {
  const r = (role ?? "").toString().trim().toUpperCase();
  return r === "OWNER" || r === "ADMIN" || r === "BOOKKEEPER" || r === "ACCOUNTANT";
}

function requireMonth(v: any) {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  return s;
}

function monthStartYmd(month: string) {
  return `${month}-01`;
}

function nextMonth(month: string) {
  const [yy, mm] = month.split("-").map((x) => Number(x));
  if (!yy || !mm) return null;
  const d = new Date(Date.UTC(yy, mm - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function toUtcStart(ymd: string) {
  // Entries store date as YYYY-MM-DDT00:00:00Z (see entries handler)
  return new Date(`${ymd}T00:00:00Z`);
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method ?? "GET";
  const path = getPath(event);

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "" } = pp(event);
  const biz = String(businessId ?? "").trim();
  if (!biz) return json(400, { ok: false, error: "Missing businessId" });

  const prisma = await getPrisma();
  const role = await getMyRole(prisma, biz, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  // Routes:
  // GET /v1/businesses/{businessId}/budgets?month=YYYY-MM
  // PUT /v1/businesses/{businessId}/budgets?month=YYYY-MM  body: { updates: [{ category_id, budget_cents }] }

  if (path !== `/v1/businesses/${biz}/budgets`) return json(404, { ok: false, error: "Not Found" });

  const q = qs(event);
  const month = requireMonth(q.month);
  if (!month) return json(400, { ok: false, error: "month is required (YYYY-MM)" });

  const start = toUtcStart(monthStartYmd(month));
  const nm = nextMonth(month);
  if (!nm) return json(400, { ok: false, error: "Invalid month" });
  const endExclusive = toUtcStart(monthStartYmd(nm));

  if (method === "GET") {
    // Budgets rows for this month
    const budgets = await prisma.budget.findMany({
      where: { business_id: biz, month },
      select: { id: true, category_id: true, budget_cents: true, updated_at: true },
      orderBy: [{ updated_at: "desc" }],
    });

    // All categories (non-archived) for table basis
    const cats = await prisma.category.findMany({
      where: { business_id: biz, archived_at: null },
      select: { id: true, name: true, archived_at: true },
      orderBy: [{ name: "asc" }],
    });

    // Expense actuals grouped by category within month
    const grouped = await prisma.entry.groupBy({
      by: ["category_id"],
      where: {
        business_id: biz,
        deleted_at: null,
        type: "EXPENSE",
        date: { gte: start, lt: endExclusive },
      },
      _sum: { amount_cents: true },
    });

    const actualAbsByCatId = new Map<string, bigint>();
    for (const g of grouped as any[]) {
      const cid = g.category_id ? String(g.category_id) : null;
      if (!cid) continue; // uncategorized excluded for v1
      const sum = (g._sum?.amount_cents ?? 0n) as bigint; // negative (expense)
      const abs = sum < 0n ? -sum : sum;
      actualAbsByCatId.set(cid, abs);
    }

    const budgetByCatId = new Map<string, { budget_cents: string; budget_id: string }>();
    for (const b of budgets as any[]) {
      budgetByCatId.set(String(b.category_id), {
        budget_cents: (b.budget_cents ?? 0n).toString(),
        budget_id: String(b.id),
      });
    }

    const rows = cats.map((c: any) => {
      const cid = String(c.id);
      const b = budgetByCatId.get(cid);
      const actual = actualAbsByCatId.get(cid) ?? 0n;
      return {
        category_id: cid,
        category_name: String(c.name),
        budget_cents: b?.budget_cents ?? "0",
        actual_cents: actual.toString(), // positive abs
      };
    });

    return json(200, { ok: true, month, rows });
  }

  if (method === "PUT") {
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    const az = await authorizeWrite(prisma, {
      businessId: biz,
      scopeAccountId: null,
      actorUserId: sub,
      actorRole: role,
      actionKey: "budgets.write",
      requiredLevel: "FULL",
      endpointForLog: "PUT /v1/businesses/{businessId}/budgets",
    });

    if (!az.allowed) {
      return json(403, {
        ok: false,
        error: "Policy denied",
        code: "POLICY_DENIED",
        actionKey: "budgets.write",
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

    const updates = Array.isArray(body?.updates) ? body.updates : null;
    if (!updates || updates.length === 0) return json(400, { ok: false, error: "updates is required" });

    // Validate categories exist in business + not archived
    const catIds = updates.map((u: any) => String(u.category_id ?? "")).filter((x: string) => !!x);
    const cats = await prisma.category.findMany({
      where: { business_id: biz, id: { in: catIds }, archived_at: null },
      select: { id: true },
    });
    const allowed = new Set(cats.map((c: any) => String(c.id)));

    const results: any[] = [];

    for (const u of updates) {
      const category_id = String(u?.category_id ?? "").trim();
      if (!category_id || !allowed.has(category_id)) {
        results.push({ category_id, ok: false, error: "Invalid category_id" });
        continue;
      }

      const centsNum = Number(u?.budget_cents);
      if (!Number.isFinite(centsNum)) {
        results.push({ category_id, ok: false, error: "budget_cents must be a number" });
        continue;
      }

      const budget_cents = BigInt(Math.max(0, Math.trunc(centsNum)));

      const row = await prisma.budget.upsert({
        where: { business_id_month_category_id: { business_id: biz, month, category_id } },
        create: {
          business_id: biz,
          month,
          category_id,
          budget_cents,
          created_at: new Date(),
          updated_at: new Date(),
        },
        update: {
          budget_cents,
          updated_at: new Date(),
        },
        select: { id: true, category_id: true, budget_cents: true, updated_at: true },
      });

      results.push({ category_id, ok: true, budget_id: String(row.id), budget_cents: row.budget_cents.toString() });
    }

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      scopeAccountId: null,
      eventType: "BUDGETS_UPSERTED",
      payloadJson: { month, count: results.filter((r) => r.ok).length },
    });

    return json(200, { ok: true, month, results });
  }

  return json(405, { ok: false, error: "Method not allowed" });
}
