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

  // Reports are cash-basis from Entries and MUST include only INCOME + EXPENSE by default.
  const baseWhere: any = {
    business_id: biz,
    deleted_at: null,
    type: { in: ["INCOME", "EXPENSE"] },
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

  function parseBool(v: any) {
    const s = String(v ?? "").trim().toLowerCase();
    return s === "1" || s === "true" || s === "yes" || s === "y";
  }

  function monthKey(d: Date) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function ymdToDate(ymd: string) {
    return new Date(`${ymd}T00:00:00Z`);
  }

  function addMonthsUtc(d: Date, deltaMonths: number) {
    const out = new Date(d);
    const y = out.getUTCFullYear();
    const m = out.getUTCMonth();
    out.setUTCFullYear(y, m + deltaMonths, 1);
    out.setUTCHours(0, 0, 0, 0);
    return out;
  }

  function fiscalYtdStartYmd(toYmdLocal: string, fiscalStartMonth: number) {
    // fiscalStartMonth: 1..12
    const d = ymdToDate(toYmdLocal);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1; // 1..12
    const startYear = m >= fiscalStartMonth ? y : y - 1;
    const mm = String(fiscalStartMonth).padStart(2, "0");
    return `${startYear}-${mm}-01`;
  }

  // ------------------------------ NEW: P&L summary (monthly + optional YTD toggle) ------------------------------
  // GET /v1/businesses/{businessId}/reports/pnl/summary
  if (path === `/v1/businesses/${biz}/reports/pnl/summary`) {
    const ytd = parseBool(q.ytd);

    const bizRow = await prisma.business.findUnique({
      where: { id: biz },
      select: { fiscal_year_start_month: true },
    });

    const fiscalStartMonth = Number(bizRow?.fiscal_year_start_month ?? 1);
    const ytdFrom = fiscalYtdStartYmd(toYmd, fiscalStartMonth);

    const periodIncomeAgg = await prisma.entry.aggregate({
      where: { ...baseWhere, type: "INCOME" },
      _sum: { amount_cents: true },
      _count: { _all: true },
    });

    const periodExpenseAgg = await prisma.entry.aggregate({
      where: { ...baseWhere, type: "EXPENSE" },
      _sum: { amount_cents: true },
      _count: { _all: true },
    });

    const periodIncome = (periodIncomeAgg?._sum?.amount_cents ?? 0n) as bigint;
    const periodExpense = (periodExpenseAgg?._sum?.amount_cents ?? 0n) as bigint;

    let ytdTotals = null as any;
    let monthly: any[] = [];

    if (ytd) {
      const ytdFromDate = toUtcStart(ytdFrom);
      const ytdToExclusive = toDateExclusive;

      const ytdWhere: any = {
        business_id: biz,
        deleted_at: null,
        type: { in: ["INCOME", "EXPENSE"] },
        date: { gte: ytdFromDate, lt: ytdToExclusive },
        ...(accountId === "all" ? {} : { account_id: accountId }),
      };

      const ytdIncomeAgg = await prisma.entry.aggregate({
        where: { ...ytdWhere, type: "INCOME" },
        _sum: { amount_cents: true },
      });

      const ytdExpenseAgg = await prisma.entry.aggregate({
        where: { ...ytdWhere, type: "EXPENSE" },
        _sum: { amount_cents: true },
      });

      const ytdIncome = (ytdIncomeAgg?._sum?.amount_cents ?? 0n) as bigint;
      const ytdExpense = (ytdExpenseAgg?._sum?.amount_cents ?? 0n) as bigint;

      ytdTotals = {
        from: ytdFrom,
        to: toYmd,
        income_cents: ytdIncome.toString(),
        expense_cents: ytdExpense.toString(),
        net_cents: (ytdIncome + ytdExpense).toString(),
      };

      // Monthly series (fiscal YTD → selected month)
      // NOTE: using raw SQL for a single grouped query (no per-row loops).
      let rows: Array<{ month: Date; income_cents: bigint; expense_cents: bigint; net_cents: bigint }> = [];

      if (accountId === "all") {
        rows = await prisma.$queryRaw`
          SELECT
            date_trunc('month', e.date)::date AS month,
            COALESCE(SUM(CASE WHEN e.type='INCOME' THEN e.amount_cents ELSE 0 END), 0)::bigint AS income_cents,
            COALESCE(SUM(CASE WHEN e.type='EXPENSE' THEN e.amount_cents ELSE 0 END), 0)::bigint AS expense_cents,
            COALESCE(SUM(e.amount_cents), 0)::bigint AS net_cents
          FROM entry e
          WHERE e.business_id = ${biz}::uuid
            AND e.deleted_at IS NULL
            AND e.type IN ('INCOME','EXPENSE')
            AND e.date >= ${ytdFromDate}::date
            AND e.date < ${ytdToExclusive}::date
          GROUP BY 1
          ORDER BY 1 ASC
        `;
      } else {
        rows = await prisma.$queryRaw`
          SELECT
            date_trunc('month', e.date)::date AS month,
            COALESCE(SUM(CASE WHEN e.type='INCOME' THEN e.amount_cents ELSE 0 END), 0)::bigint AS income_cents,
            COALESCE(SUM(CASE WHEN e.type='EXPENSE' THEN e.amount_cents ELSE 0 END), 0)::bigint AS expense_cents,
            COALESCE(SUM(e.amount_cents), 0)::bigint AS net_cents
          FROM entry e
          WHERE e.business_id = ${biz}::uuid
            AND e.deleted_at IS NULL
            AND e.type IN ('INCOME','EXPENSE')
            AND e.date >= ${ytdFromDate}::date
            AND e.date < ${ytdToExclusive}::date
            AND e.account_id = ${accountId}::uuid
          GROUP BY 1
          ORDER BY 1 ASC
        `;
      }

      monthly = rows.map((r: any) => ({
        month: String(r.month).slice(0, 7), // YYYY-MM
        income_cents: (r.income_cents ?? 0n).toString(),
        expense_cents: (r.expense_cents ?? 0n).toString(),
        net_cents: (r.net_cents ?? 0n).toString(),
      }));
    } else {
      // When YTD is off: return a single-month row for consistency
      monthly = [
        {
          month: monthKey(fromDate),
          income_cents: periodIncome.toString(),
          expense_cents: periodExpense.toString(),
          net_cents: (periodIncome + periodExpense).toString(),
        },
      ];
    }

    return json(200, {
      ok: true,
      report: "pnl_summary",
      from: fromYmd,
      to: toYmd,
      accountId,
      period: {
        income_cents: periodIncome.toString(),
        expense_cents: periodExpense.toString(),
        net_cents: (periodIncome + periodExpense).toString(),
        income_count: Number(periodIncomeAgg?._count?._all ?? 0),
        expense_count: Number(periodExpenseAgg?._count?._all ?? 0),
      },
      ytd: ytdTotals,
      monthly,
    });
  }

  // ------------------------------ NEW: Cashflow series (cash in/out + net + trend) ------------------------------
  // GET /v1/businesses/{businessId}/reports/cashflow/series
  if (path === `/v1/businesses/${biz}/reports/cashflow/series`) {
    const ytd = parseBool(q.ytd);

    const bizRow = await prisma.business.findUnique({
      where: { id: biz },
      select: { fiscal_year_start_month: true },
    });

    const fiscalStartMonth = Number(bizRow?.fiscal_year_start_month ?? 1);

    // Series range:
    // - YTD ON: fiscal YTD start → selected period end
    // - YTD OFF: last 12 months ending on selected period end
    const seriesFromYmd = ytd ? fiscalYtdStartYmd(toYmd, fiscalStartMonth) : (() => {
      const end = ymdToDate(toYmd);
      const start = addMonthsUtc(end, -11);
      const y = start.getUTCFullYear();
      const m = String(start.getUTCMonth() + 1).padStart(2, "0");
      return `${y}-${m}-01`;
    })();

    const seriesFromDate = toUtcStart(seriesFromYmd);
    const seriesToExclusive = toDateExclusive;

    const whereSeries: any = {
      business_id: biz,
      deleted_at: null,
      type: { in: ["INCOME", "EXPENSE"] },
      date: { gte: seriesFromDate, lt: seriesToExclusive },
      ...(accountId === "all" ? {} : { account_id: accountId }),
    };

    const totalsIn = await prisma.entry.aggregate({
      where: { ...whereSeries, type: "INCOME" },
      _sum: { amount_cents: true },
    });
    const totalsOut = await prisma.entry.aggregate({
      where: { ...whereSeries, type: "EXPENSE" },
      _sum: { amount_cents: true },
    });
    const totalsAll = await prisma.entry.aggregate({
      where: whereSeries,
      _sum: { amount_cents: true },
    });

    const cashIn = (totalsIn?._sum?.amount_cents ?? 0n) as bigint;
    const cashOut = (totalsOut?._sum?.amount_cents ?? 0n) as bigint; // negative by Phase 3 rule
    const net = (totalsAll?._sum?.amount_cents ?? 0n) as bigint;

    let rows: Array<{ month: Date; cash_in_cents: bigint; cash_out_cents: bigint; net_cents: bigint }> = [];

    if (accountId === "all") {
      rows = await prisma.$queryRaw`
        SELECT
          date_trunc('month', e.date)::date AS month,
          COALESCE(SUM(CASE WHEN e.type='INCOME' THEN e.amount_cents ELSE 0 END), 0)::bigint AS cash_in_cents,
          COALESCE(SUM(CASE WHEN e.type='EXPENSE' THEN e.amount_cents ELSE 0 END), 0)::bigint AS cash_out_cents,
          COALESCE(SUM(e.amount_cents), 0)::bigint AS net_cents
        FROM entry e
        WHERE e.business_id = ${biz}::uuid
          AND e.deleted_at IS NULL
          AND e.type IN ('INCOME','EXPENSE')
          AND e.date >= ${seriesFromDate}::date
          AND e.date < ${seriesToExclusive}::date
        GROUP BY 1
        ORDER BY 1 ASC
      `;
    } else {
      rows = await prisma.$queryRaw`
        SELECT
          date_trunc('month', e.date)::date AS month,
          COALESCE(SUM(CASE WHEN e.type='INCOME' THEN e.amount_cents ELSE 0 END), 0)::bigint AS cash_in_cents,
          COALESCE(SUM(CASE WHEN e.type='EXPENSE' THEN e.amount_cents ELSE 0 END), 0)::bigint AS cash_out_cents,
          COALESCE(SUM(e.amount_cents), 0)::bigint AS net_cents
        FROM entry e
        WHERE e.business_id = ${biz}::uuid
          AND e.deleted_at IS NULL
          AND e.type IN ('INCOME','EXPENSE')
          AND e.date >= ${seriesFromDate}::date
          AND e.date < ${seriesToExclusive}::date
          AND e.account_id = ${accountId}::uuid
        GROUP BY 1
        ORDER BY 1 ASC
      `;
    }

    return json(200, {
      ok: true,
      report: "cashflow_series",
      from: seriesFromYmd,
      to: toYmd,
      accountId,
      totals: {
        cash_in_cents: cashIn.toString(),
        cash_out_cents: cashOut.toString(),
        net_cents: net.toString(),
      },
      monthly: rows.map((r: any) => ({
        month: String(r.month).slice(0, 7),
        cash_in_cents: (r.cash_in_cents ?? 0n).toString(),
        cash_out_cents: (r.cash_out_cents ?? 0n).toString(),
        net_cents: (r.net_cents ?? 0n).toString(),
      })),
    });
  }

  // ------------------------------ NEW: Accounts summary (balances as-of, exclude archived by default) ------------------------------
  // GET /v1/businesses/{businessId}/reports/accounts/summary
  if (path === `/v1/businesses/${biz}/reports/accounts/summary`) {
    const includeArchived = parseBool(q.includeArchived);
    const asOfYmd = toYmd;
    const asOfDate = toUtcStart(asOfYmd);

    const accounts = await prisma.account.findMany({
      where: {
        business_id: biz,
        ...(includeArchived ? {} : { archived_at: null }),
        ...(accountId === "all" ? {} : { id: accountId }),
      },
      select: {
        id: true,
        name: true,
        type: true,
        opening_balance_cents: true,
      },
      orderBy: [{ name: "asc" }],
    });

    if (accounts.length === 0) {
      return json(200, {
        ok: true,
        report: "accounts_summary",
        asOf: asOfYmd,
        includeArchived,
        accountId,
        rows: [],
      });
    }

    const ids = accounts.map((a: any) => String(a.id));

    const sums: Array<{ account_id: string; sum_cents: bigint }> = await prisma.$queryRaw`
      SELECT e.account_id::text as account_id, COALESCE(SUM(e.amount_cents), 0)::bigint as sum_cents
      FROM entry e
      WHERE e.business_id = ${biz}::uuid
        AND e.deleted_at IS NULL
        AND e.type IN ('INCOME','EXPENSE')
        AND e.date <= ${asOfDate}::date
        AND e.account_id = ANY(${ids}::uuid[])
      GROUP BY e.account_id
    `;

    const sumByAccount = new Map<string, bigint>(sums.map((r: any) => [String(r.account_id), (r.sum_cents ?? 0n) as bigint]));

    const rows = accounts.map((a: any) => {
      const open = (a.opening_balance_cents ?? 0n) as bigint;
      const mov = sumByAccount.get(String(a.id)) ?? 0n;
      const bal = open + mov;
      return {
        account_id: String(a.id),
        name: String(a.name),
        type: String(a.type),
        balance_cents: bal.toString(),
      };
    });

    return json(200, {
      ok: true,
      report: "accounts_summary",
      asOf: asOfYmd,
      includeArchived,
      accountId,
      rows,
    });
  }

  // ------------------------------ NEW: AP Aging (vendor buckets + vendor detail) ------------------------------
  // GET /v1/businesses/{businessId}/reports/ap/aging
  if (path === `/v1/businesses/${biz}/reports/ap/aging`) {
    const asOfYmd = toYmd;
    const asOfDate = toUtcStart(asOfYmd);

    const rows: Array<any> = await prisma.$queryRaw`
      WITH applied AS (
        SELECT bill_id, COALESCE(SUM(applied_amount_cents), 0)::bigint AS applied_cents
        FROM bill_payment_application
        WHERE business_id = ${biz}::uuid
          AND is_active = true
        GROUP BY bill_id
      ),
      open_bills AS (
        SELECT
          b.id,
          b.vendor_id,
          b.due_date::date AS due_date,
          (b.amount_cents - COALESCE(a.applied_cents, 0))::bigint AS outstanding_cents,
          (${asOfDate}::date - b.due_date::date) AS past_due_days
        FROM bill b
        LEFT JOIN applied a ON a.bill_id = b.id
        WHERE b.business_id = ${biz}::uuid
          AND b.voided_at IS NULL
          AND b.status IN ('OPEN','PARTIAL')
      )
      SELECT
        v.id::text AS vendor_id,
        v.name AS vendor,
        COALESCE(SUM(CASE WHEN ob.outstanding_cents > 0 AND ob.past_due_days <= 0 THEN ob.outstanding_cents ELSE 0 END), 0)::bigint AS current_cents,
        COALESCE(SUM(CASE WHEN ob.outstanding_cents > 0 AND ob.past_due_days BETWEEN 1 AND 30 THEN ob.outstanding_cents ELSE 0 END), 0)::bigint AS b1_30_cents,
        COALESCE(SUM(CASE WHEN ob.outstanding_cents > 0 AND ob.past_due_days BETWEEN 31 AND 60 THEN ob.outstanding_cents ELSE 0 END), 0)::bigint AS b31_60_cents,
        COALESCE(SUM(CASE WHEN ob.outstanding_cents > 0 AND ob.past_due_days BETWEEN 61 AND 90 THEN ob.outstanding_cents ELSE 0 END), 0)::bigint AS b61_90_cents,
        COALESCE(SUM(CASE WHEN ob.outstanding_cents > 0 AND ob.past_due_days >= 91 THEN ob.outstanding_cents ELSE 0 END), 0)::bigint AS b90p_cents,
        COALESCE(SUM(CASE WHEN ob.outstanding_cents > 0 THEN ob.outstanding_cents ELSE 0 END), 0)::bigint AS total_cents
      FROM vendor v
      LEFT JOIN open_bills ob ON ob.vendor_id = v.id
      WHERE v.business_id = ${biz}::uuid
      GROUP BY v.id, v.name
      HAVING COALESCE(SUM(CASE WHEN ob.outstanding_cents > 0 THEN ob.outstanding_cents ELSE 0 END), 0) <> 0
      ORDER BY total_cents DESC, v.name ASC
      LIMIT 500
    `;

    return json(200, {
      ok: true,
      report: "ap_aging",
      asOf: asOfYmd,
      rows: rows.map((r: any) => ({
        vendor_id: String(r.vendor_id),
        vendor: String(r.vendor),
        current_cents: (r.current_cents ?? 0n).toString(),
        b1_30_cents: (r.b1_30_cents ?? 0n).toString(),
        b31_60_cents: (r.b31_60_cents ?? 0n).toString(),
        b61_90_cents: (r.b61_90_cents ?? 0n).toString(),
        b90p_cents: (r.b90p_cents ?? 0n).toString(),
        total_cents: (r.total_cents ?? 0n).toString(),
      })),
    });
  }

  // GET /v1/businesses/{businessId}/reports/ap/aging/{vendorId}
  if (path === `/v1/businesses/${biz}/reports/ap/aging/${String(pp(event)?.vendorId ?? "")}`) {
    const vendorId = String(pp(event)?.vendorId ?? "").trim();
    if (!vendorId) return json(400, { ok: false, error: "Missing vendorId" });

    const asOfYmd = toYmd;
    const asOfDate = toUtcStart(asOfYmd);

    const rows: Array<any> = await prisma.$queryRaw`
      WITH applied AS (
        SELECT bill_id, COALESCE(SUM(applied_amount_cents), 0)::bigint AS applied_cents
        FROM bill_payment_application
        WHERE business_id = ${biz}::uuid
          AND is_active = true
        GROUP BY bill_id
      )
      SELECT
        b.id::text AS bill_id,
        b.invoice_date::date AS invoice_date,
        b.due_date::date AS due_date,
        b.amount_cents::bigint AS amount_cents,
        COALESCE(a.applied_cents, 0)::bigint AS applied_cents,
        (b.amount_cents - COALESCE(a.applied_cents, 0))::bigint AS outstanding_cents,
        (${asOfDate}::date - b.due_date::date) AS past_due_days,
        b.status AS status,
        b.memo AS memo
      FROM bill b
      LEFT JOIN applied a ON a.bill_id = b.id
      WHERE b.business_id = ${biz}::uuid
        AND b.vendor_id = ${vendorId}::uuid
        AND b.voided_at IS NULL
        AND b.status IN ('OPEN','PARTIAL')
      ORDER BY b.due_date ASC, b.invoice_date ASC
      LIMIT 500
    `;

    return json(200, {
      ok: true,
      report: "ap_aging_vendor",
      asOf: asOfYmd,
      vendorId,
      rows: rows.map((r: any) => ({
        bill_id: String(r.bill_id),
        invoice_date: String(r.invoice_date).slice(0, 10),
        due_date: String(r.due_date).slice(0, 10),
        status: String(r.status),
        memo: r.memo ?? null,
        amount_cents: (r.amount_cents ?? 0n).toString(),
        applied_cents: (r.applied_cents ?? 0n).toString(),
        outstanding_cents: (r.outstanding_cents ?? 0n).toString(),
        past_due_days: Number(r.past_due_days ?? 0),
      })),
    });
  }

  // ------------------------------ NEW: Category drilldown (paged entries list) ------------------------------
  // GET /v1/businesses/{businessId}/reports/categories/detail?categoryId=...&page=1&take=50
  if (path === `/v1/businesses/${biz}/reports/categories/detail`) {
    const categoryIdRaw = String(q.categoryId ?? "").trim();
    const take = Math.min(Math.max(Number(q.take ?? 50), 10), 200);
    const page = Math.max(Number(q.page ?? 1), 1);
    const skip = (page - 1) * take;

    const where: any = {
      ...baseWhere,
      ...(categoryIdRaw === "" ? {} : categoryIdRaw === "null" ? { category_id: null } : { category_id: categoryIdRaw }),
    };

    const rows = await prisma.entry.findMany({
      where,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      select: {
        id: true,
        date: true,
        type: true,
        payee: true,
        memo: true,
        amount_cents: true,
      },
      take,
      skip,
    });

    const total = await prisma.entry.count({ where });

    return json(200, {
      ok: true,
      report: "categories_detail",
      from: fromYmd,
      to: toYmd,
      accountId,
      categoryId: categoryIdRaw === "" ? null : categoryIdRaw,
      page,
      take,
      total,
      rows: rows.map((r: any) => ({
        entry_id: String(r.id),
        date: String(r.date).slice(0, 10),
        type: String(r.type),
        payee: r.payee ?? null,
        memo: r.memo ?? null,
        amount_cents: (r.amount_cents ?? 0n).toString(),
      })),
    });
  }

  return json(404, { ok: false, error: "Not found" });
}
