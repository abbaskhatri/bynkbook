import { getPrisma } from "./lib/db";

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  };
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

function parseDate(s: any): Date | null {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function monthKey(d: Date) {
  return ymd(d).slice(0, 7);
}

function pctChange(prev: number, curr: number) {
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return null;
  if (prev === 0) return curr === 0 ? 0 : null;
  return (curr - prev) / Math.abs(prev);
}

/**
 * GET /v1/businesses/{businessId}/insights/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Computed from aggregates / bounded queries only. No hallucinations.
 */
export async function handler(event: any) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = (event?.pathParameters?.businessId ?? "").toString().trim();
  if (!businessId) return json(400, { ok: false, error: "Missing businessId" });

  const qs = event?.queryStringParameters ?? {};
  const toIn = parseDate(qs?.to);
  const fromIn = parseDate(qs?.from);

  const to = toIn ?? new Date();
  const from = fromIn ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const prisma = await getPrisma();

  const role = await requireMembership(prisma, businessId, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  // MoM baseline: compare this range vs prior equal-length range
  const days = Math.max(7, Math.min(62, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) || 30));
  const prevTo = new Date(from.getTime() - 1 * 24 * 60 * 60 * 1000);
  const prevFrom = new Date(prevTo.getTime() - days * 24 * 60 * 60 * 1000);

  // Use entry sums (bounded + indexed by business/date) for INCOME/EXPENSE only
  const sumRange = async (a: Date, b: Date) => {
    const rows = await prisma.entry.aggregate({
      where: {
        business_id: businessId,
        deleted_at: null,
        type: { in: ["INCOME", "EXPENSE"] },
        date: {
          gte: new Date(`${ymd(a)}T00:00:00Z`),
          lte: new Date(`${ymd(b)}T00:00:00Z`),
        },
      },
      _sum: { amount_cents: true },
    });

    const total = rows?._sum?.amount_cents;
    const n = typeof total === "bigint" ? Number(total) : Number(total ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const currTotal = await sumRange(from, to);
  const prevTotal = await sumRange(prevFrom, prevTo);

  // For expenses/income, we’ll separate by sign:
  const sumByType = async (a: Date, b: Date, type: "INCOME" | "EXPENSE") => {
    const rows = await prisma.entry.aggregate({
      where: {
        business_id: businessId,
        deleted_at: null,
        type,
        date: {
          gte: new Date(`${ymd(a)}T00:00:00Z`),
          lte: new Date(`${ymd(b)}T00:00:00Z`),
        },
      },
      _sum: { amount_cents: true },
    });

    const total = rows?._sum?.amount_cents;
    const n = typeof total === "bigint" ? Number(total) : Number(total ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const currIncome = await sumByType(from, to, "INCOME");
  const prevIncome = await sumByType(prevFrom, prevTo, "INCOME");

  const currExpense = await sumByType(from, to, "EXPENSE");
  const prevExpense = await sumByType(prevFrom, prevTo, "EXPENSE");

  // Top payee shift (bounded)
  const topPayees = await prisma.entry.groupBy({
    by: ["payee"],
    where: {
      business_id: businessId,
      deleted_at: null,
      type: "EXPENSE",
      date: {
        gte: new Date(`${ymd(from)}T00:00:00Z`),
        lte: new Date(`${ymd(to)}T00:00:00Z`),
      },
      payee: { not: null },
    },
    _sum: { amount_cents: true },
    orderBy: { _sum: { amount_cents: "asc" } }, // EXPENSE amounts are negative; asc => biggest magnitude
    take: 5,
  });

  const insights: any[] = [];

  const expPct = pctChange(prevExpense, currExpense);
  if (expPct !== null) {
    const pct = Math.round(expPct * 100);
    insights.push({
      id: "expenses_mom",
      type: "DELTA",
      title: "Expenses change",
      value: pct,
      unit: "PCT",
      severity: Math.abs(pct) >= 20 ? "HIGH" : Math.abs(pct) >= 10 ? "MED" : "LOW",
      reason: `Compared ${monthKey(prevFrom)} vs ${monthKey(from)} (same ${days}d window)`,
      drilldown: { href: `/reports?tab=pnl&from=${encodeURIComponent(ymd(from))}&to=${encodeURIComponent(ymd(to))}` },
    });
  }

  const incPct = pctChange(prevIncome, currIncome);
  if (incPct !== null) {
    const pct = Math.round(incPct * 100);
    insights.push({
      id: "income_mom",
      type: "DELTA",
      title: "Income change",
      value: pct,
      unit: "PCT",
      severity: Math.abs(pct) >= 20 ? "HIGH" : Math.abs(pct) >= 10 ? "MED" : "LOW",
      reason: `Compared ${monthKey(prevFrom)} vs ${monthKey(from)} (same ${days}d window)`,
      drilldown: { href: `/reports?tab=pnl&from=${encodeURIComponent(ymd(from))}&to=${encodeURIComponent(ymd(to))}` },
    });
  }

  const top1 = topPayees?.[0];
  if (top1?.payee) {
    insights.push({
      id: "top_payee",
      type: "TOP",
      title: "Top expense payee",
      value: String(top1.payee).slice(0, 80),
      unit: "TEXT",
      severity: "LOW",
      reason: "Highest total spend in selected range",
      drilldown: { href: `/ledger?from=${encodeURIComponent(ymd(from))}&to=${encodeURIComponent(ymd(to))}&payee=${encodeURIComponent(String(top1.payee))}` },
    });
  }

  // Return small payload
  return json(200, {
    ok: true,
    range: { from: ymd(from), to: ymd(to) },
    insights,
    meta: { version: "ins_v1", computedFrom: "AGGREGATES_ONLY" },
  });
}