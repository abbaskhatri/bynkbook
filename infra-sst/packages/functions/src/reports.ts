import { getPrisma } from "./lib/db";

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

function getPath(event: any) {
  return String(event?.requestContext?.http?.path ?? "");
}

function qp(event: any) {
  return event?.queryStringParameters ?? {};
}

function toUtcStart(ymd: string) {
  // Entries store date as YYYY-MM-DDT00:00:00Z (see entries handler).
  return new Date(`${ymd}T00:00:00Z`);
}

function nextUtcDay(d: Date) {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + 1);
  return out;
}

async function getMyRole(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
  const role = await getMyRole(prisma, businessId, userId);
  if (!role) return null;
  return role;
}

function normalizeAccountId(input: any) {
  const v = String(input ?? "all").trim();
  if (!v || v.toLowerCase() === "all") return "all";
  return v;
}

function normalizeYmd(input: any) {
  const v = String(input ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method ?? "GET";
  const path = getPath(event);

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const prisma = await getPrisma();

  const { businessId = "" } = pp(event);
  const biz = String(businessId ?? "").trim();
  if (!biz) return json(400, { ok: false, error: "Missing businessId" });

  const myRole = await requireMembership(prisma, biz, sub);
  if (!myRole) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  if (method !== "GET") return json(405, { ok: false, error: "Method not allowed" });

  const q = qp(event);
  const fromYmd = normalizeYmd(q.from);
  const toYmd = normalizeYmd(q.to);
  const accountId = normalizeAccountId(q.accountId);

  if (!fromYmd) return json(400, { ok: false, error: "from is required (YYYY-MM-DD)" });
  if (!toYmd) return json(400, { ok: false, error: "to is required (YYYY-MM-DD)" });

  const fromDate = toUtcStart(fromYmd);
  const toDateExclusive = nextUtcDay(toUtcStart(toYmd));

  const baseWhere: any = {
    business_id: biz,
    deleted_at: null,
    date: { gte: fromDate, lt: toDateExclusive },
    ...(accountId === "all" ? {} : { account_id: accountId }),
  };

  // GET /v1/businesses/{businessId}/reports/pnl
  if (path === `/v1/businesses/${biz}/reports/pnl`) {
    const incomeAgg = await prisma.entry.aggregate({
      where: { ...baseWhere, type: "INCOME" },
      _sum: { amount_cents: true },
      _count: { _all: true },
    });

    const expenseAgg = await prisma.entry.aggregate({
      where: { ...baseWhere, type: "EXPENSE" },
      _sum: { amount_cents: true },
      _count: { _all: true },
    });

    const income = (incomeAgg?._sum?.amount_cents ?? 0n) as bigint;
    const expense = (expenseAgg?._sum?.amount_cents ?? 0n) as bigint;

    return json(200, {
      ok: true,
      report: "pnl",
      from: fromYmd,
      to: toYmd,
      accountId,
      totals: {
        income_cents: income.toString(),
        expense_cents: expense.toString(),
        net_cents: (income + expense).toString(),
        income_count: Number(incomeAgg?._count?._all ?? 0),
        expense_count: Number(expenseAgg?._count?._all ?? 0),
      },
    });
  }

  // GET /v1/businesses/{businessId}/reports/payees
  if (path === `/v1/businesses/${biz}/reports/payees`) {
    const rows = await prisma.entry.groupBy({
      by: ["payee"],
      where: baseWhere,
      _sum: { amount_cents: true },
      _count: { _all: true },
      orderBy: [{ _sum: { amount_cents: "desc" } }],
      take: 250,
    });

    return json(200, {
      ok: true,
      report: "payees",
      from: fromYmd,
      to: toYmd,
      accountId,
      rows: rows.map((r: any) => ({
        payee: r.payee ?? "Unspecified",
        amount_cents: (r._sum?.amount_cents ?? 0n).toString(),
        count: Number(r._count?._all ?? 0),
      })),
    });
  }

  // GET /v1/businesses/{businessId}/reports/categories
  // NOTE: Your Entry model/handlers do not include category fields yet, so category reporting is not available without schema expansion.
  if (path === `/v1/businesses/${biz}/reports/categories`) {
    return json(501, {
      ok: false,
      error: "Category summary is not available yet (no category field on entries).",
      code: "NOT_IMPLEMENTED",
    });
  }

  return json(404, { ok: false, error: "Not found" });
}
