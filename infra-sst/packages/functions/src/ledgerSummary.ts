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

export async function handler(event: any) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "", accountId = "" } = pp(event);
  const biz = businessId.toString().trim();
  const acct = accountId.toString().trim();
  if (!biz || !acct) return json(400, { ok: false, error: "Missing businessId/accountId" });

  const q = qs(event);
  const from = (q.from ?? "").toString().trim();
  const to = (q.to ?? "").toString().trim();
  if (!from || !to) return json(400, { ok: false, error: "Query params required: from=YYYY-MM-DD&to=YYYY-MM-DD" });

  const fromDate = new Date(from + "T00:00:00Z");
  const toDate = new Date(to + "T00:00:00Z");
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return json(400, { ok: false, error: "Invalid from/to date. Use YYYY-MM-DD." });
  }

  const prisma = await getPrisma();

  const role = await requireMembership(prisma, biz, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  const account = await prisma.account.findFirst({
    where: { id: acct, business_id: biz },
    select: { opening_balance_cents: true, opening_balance_date: true },
  });
  if (!account) return json(404, { ok: false, error: "Account not found in this business" });

  const whereRangeBase: any = {
    business_id: biz,
    account_id: acct,
    deleted_at: null,
    // Lock: TRANSFER entries must be excluded from totals (P&L / cashflow / dashboard)
    type: { not: "TRANSFER" },
    date: { gte: fromDate, lte: toDate },
  };

  const incomeAgg = await prisma.entry.aggregate({
    where: { ...whereRangeBase, amount_cents: { gt: BigInt(0) } },
    _sum: { amount_cents: true },
  });

  const expenseAgg = await prisma.entry.aggregate({
    where: { ...whereRangeBase, amount_cents: { lt: BigInt(0) } },
    _sum: { amount_cents: true },
  });

  const netAgg = await prisma.entry.aggregate({
    where: whereRangeBase,
    _sum: { amount_cents: true },
  });

  const sumToAgg = await prisma.entry.aggregate({
    where: {
      business_id: biz,
      account_id: acct,
      deleted_at: null,
      date: { lte: toDate },
    },
    _sum: { amount_cents: true },
  });

  const income = (incomeAgg._sum.amount_cents ?? BigInt(0));
  const expenseNeg = (expenseAgg._sum.amount_cents ?? BigInt(0)); // negative
  const expense = expenseNeg < BigInt(0) ? -expenseNeg : BigInt(0);
  const net = (netAgg._sum.amount_cents ?? BigInt(0));

  const sumTo = (sumToAgg._sum.amount_cents ?? BigInt(0));
  const opening = account.opening_balance_cents ?? BigInt(0);
  const balance = opening + sumTo;

  return json(200, {
    ok: true,
    business_id: biz,
    account_id: acct,
    range: { from, to },
    opening_balance: {
      opening_balance_cents: opening.toString(),
      opening_balance_date: account.opening_balance_date.toISOString(),
    },
    totals: {
      income_cents: income.toString(),
      expense_cents: expense.toString(),
      net_cents: net.toString(),
    },
    balance_cents: balance.toString(),
  });
}
