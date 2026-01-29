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

  // GET /v1/businesses/{businessId}/reports/cashflow (Bundle 1)
  if (path === `/v1/businesses/${biz}/reports/cashflow`) {
    const inAgg = await prisma.entry.aggregate({
      where: { ...baseWhere, amount_cents: { gt: 0n } },
      _sum: { amount_cents: true },
    });

    const outAgg = await prisma.entry.aggregate({
      where: { ...baseWhere, amount_cents: { lt: 0n } },
      _sum: { amount_cents: true },
    });

    const allAgg = await prisma.entry.aggregate({
      where: baseWhere,
      _sum: { amount_cents: true },
    });

    const cashIn = (inAgg?._sum?.amount_cents ?? 0n) as bigint;
    const cashOut = (outAgg?._sum?.amount_cents ?? 0n) as bigint; // negative
    const net = (allAgg?._sum?.amount_cents ?? 0n) as bigint;

    return json(200, {
      ok: true,
      report: "cashflow",
      from: fromYmd,
      to: toYmd,
      accountId,
      totals: {
        cash_in_cents: cashIn.toString(),
        cash_out_cents: cashOut.toString(),
        net_cents: net.toString(),
      },
    });
  }

  // GET /v1/businesses/{businessId}/reports/activity (Bundle 1)
  if (path === `/v1/businesses/${biz}/reports/activity`) {
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

    const accounts = await prisma.account.findMany({
      where: { business_id: biz, ...(accountId === "all" ? {} : { id: accountId }) },
      select: { id: true, name: true },
    });
    const accountNameById = new Map<string, string>(accounts.map((a: any) => [String(a.id), String(a.name)]));

    const rows = await prisma.entry.findMany({
      where: baseWhere,
      orderBy: [{ date: "desc" }, { id: "desc" }], // no created_at assumption
      select: {
        id: true,
        date: true,
        account_id: true,
        type: true,
        payee: true,
        memo: true,
        amount_cents: true,
      },
    });

    return json(200, {
      ok: true,
      report: "activity",
      from: fromYmd,
      to: toYmd,
      accountId,
      totals: {
        income_cents: income.toString(),
        expense_cents: expense.toString(),
        net_cents: (income + expense).toString(),
        count: Number((incomeAgg?._count?._all ?? 0) + (expenseAgg?._count?._all ?? 0)),
      },
      rows: rows.map((r: any) => ({
        date: String(r.date).slice(0, 10),
        account_id: String(r.account_id),
        account_name: accountNameById.get(String(r.account_id)) ?? "Account",
        type: String(r.type),
        payee: r.payee ?? null,
        memo: r.memo ?? null,
        amount_cents: (r.amount_cents ?? 0n).toString(),
        entry_id: String(r.id),
      })),
    });
  }

  // GET /v1/businesses/{businessId}/reports/categories (Category System v2)
  if (path === `/v1/businesses/${biz}/reports/categories`) {
    const grouped = await prisma.entry.groupBy({
      by: ["category_id"],
      where: baseWhere,
      _sum: { amount_cents: true },
      _count: { _all: true },
      orderBy: [{ _sum: { amount_cents: "desc" } }],
      take: 500,
    });

    const catIds = grouped
      .map((g: any) => g.category_id)
      .filter((x: any) => !!x)
      .map((x: any) => String(x));

    const cats = catIds.length
      ? await prisma.category.findMany({
          where: { business_id: biz, id: { in: catIds } },
          select: { id: true, name: true, archived_at: true },
        })
      : [];

    const nameById = new Map<string, string>(cats.map((c: any) => [String(c.id), String(c.name)]));

    const rows = grouped.map((g: any) => {
      const id = g.category_id ? String(g.category_id) : null;
      const name = id ? nameById.get(id) ?? "Uncategorized" : "Uncategorized";
      return {
        category_id: id,
        category: name,
        amount_cents: (g._sum?.amount_cents ?? 0n).toString(),
        count: Number(g._count?._all ?? 0),
      };
    });

    // Ensure Uncategorized bucket exists even if not returned
    if (!rows.some((r: any) => r.category_id === null)) {
      rows.push({ category_id: null, category: "Uncategorized", amount_cents: "0", count: 0 });
    }

    return json(200, {
      ok: true,
      report: "categories",
      from: fromYmd,
      to: toYmd,
      accountId,
      rows,
    });
  }

  return json(404, { ok: false, error: "Not found" });
}
