import { apiFetch } from "./client";

function qs(params: Record<string, string>) {
  const usp = new URLSearchParams(params);
  return usp.toString();
}

export type ReportsMonthRange = {
  from: string; // YYYY-MM-DD (month start)
  to: string;   // YYYY-MM-DD (month end)
  accountId: string; // "all" or UUID
  ytd?: boolean; // toggle
};

export type PnlSummaryResponse = {
  ok: true;
  report: "pnl_summary";
  from: string;
  to: string;
  accountId: string;
  period: {
    income_cents: string;
    expense_cents: string;
    net_cents: string;
    income_count: number;
    expense_count: number;
  };
  ytd: null | {
    from: string;
    to: string;
    income_cents: string;
    expense_cents: string;
    net_cents: string;
  };
  monthly: Array<{
    month: string; // YYYY-MM
    income_cents: string;
    expense_cents: string;
    net_cents: string;
  }>;
};

export async function getPnlSummary(businessId: string, r: ReportsMonthRange): Promise<PnlSummaryResponse> {
  const q = qs({
    from: r.from,
    to: r.to,
    accountId: r.accountId ?? "all",
    ytd: r.ytd ? "1" : "0",
  });
  return apiFetch(`/v1/businesses/${businessId}/reports/pnl/summary?${q}`);
}

export type CashflowSeriesResponse = {
  ok: true;
  report: "cashflow_series";
  from: string;
  to: string;
  accountId: string;
  totals: {
    cash_in_cents: string;
    cash_out_cents: string; // negative (expenses)
    net_cents: string;
  };
  monthly: Array<{
    month: string; // YYYY-MM
    cash_in_cents: string;
    cash_out_cents: string;
    net_cents: string;
  }>;
};

export async function getCashflowSeries(businessId: string, r: ReportsMonthRange): Promise<CashflowSeriesResponse> {
  const q = qs({
    from: r.from,
    to: r.to,
    accountId: r.accountId ?? "all",
    ytd: r.ytd ? "1" : "0",
  });
  return apiFetch(`/v1/businesses/${businessId}/reports/cashflow/series?${q}`);
}

export type AccountsSummaryResponse = {
  ok: true;
  report: "accounts_summary";
  asOf: string; // YYYY-MM-DD
  includeArchived: boolean;
  accountId: string;
  rows: Array<{
    account_id: string;
    name: string;
    type: string;
    balance_cents: string;
  }>;
};

export async function getAccountsSummary(
  businessId: string,
  args: { asOf: string; accountId: string; includeArchived?: boolean }
): Promise<AccountsSummaryResponse> {
  // NOTE: backend uses standard from/to, but accounts summary only cares about `to` for asOf.
  const q = qs({
    from: args.asOf,
    to: args.asOf,
    accountId: args.accountId ?? "all",
    includeArchived: args.includeArchived ? "1" : "0",
  });
  return apiFetch(`/v1/businesses/${businessId}/reports/accounts/summary?${q}`);
}

export type ApAgingResponse = {
  ok: true;
  report: "ap_aging";
  asOf: string;
  rows: Array<{
    vendor_id: string;
    vendor: string;
    current_cents: string;
    b1_30_cents: string;
    b31_60_cents: string;
    b61_90_cents: string;
    b90p_cents: string;
    total_cents: string;
  }>;
};

export async function getApAging(businessId: string, args: { asOf: string }): Promise<ApAgingResponse> {
  const q = qs({ from: args.asOf, to: args.asOf, accountId: "all" });
  return apiFetch(`/v1/businesses/${businessId}/reports/ap/aging?${q}`);
}

export type ApAgingVendorResponse = {
  ok: true;
  report: "ap_aging_vendor";
  asOf: string;
  vendorId: string;
  rows: Array<{
    bill_id: string;
    invoice_date: string;
    due_date: string;
    status: string;
    memo: string | null;
    amount_cents: string;
    applied_cents: string;
    outstanding_cents: string;
    past_due_days: number;
  }>;
};

export async function getApAgingVendor(businessId: string, args: { asOf: string; vendorId: string }): Promise<ApAgingVendorResponse> {
  const q = qs({ from: args.asOf, to: args.asOf, accountId: "all" });
  return apiFetch(`/v1/businesses/${businessId}/reports/ap/aging/${args.vendorId}?${q}`);
}

export type CategoriesResponse = {
  ok: true;
  report: "categories";
  from: string;
  to: string;
  accountId: string;
  rows: Array<{
    category_id: string | null;
    category: string;
    amount_cents: string;
    count: number;
  }>;
};

export async function getCategories(businessId: string, range: { from: string; to: string; accountId: string }): Promise<CategoriesResponse> {
  const q = qs({ from: range.from, to: range.to, accountId: range.accountId ?? "all" });
  return apiFetch(`/v1/businesses/${businessId}/reports/categories?${q}`);
}

export type CategoriesDetailResponse = {
  ok: true;
  report: "categories_detail";
  from: string;
  to: string;
  accountId: string;
  categoryId: string | null;
  page: number;
  take: number;
  total: number;
  rows: Array<{
    entry_id: string;
    date: string;
    type: "INCOME" | "EXPENSE";
    payee: string | null;
    memo: string | null;
    amount_cents: string;
  }>;
};

export async function getCategoriesDetail(
  businessId: string,
  args: { from: string; to: string; accountId: string; categoryId: string | null; page: number; take: number }
): Promise<CategoriesDetailResponse> {
  const q = qs({
    from: args.from,
    to: args.to,
    accountId: args.accountId ?? "all",
    categoryId: args.categoryId === null ? "null" : String(args.categoryId),
    page: String(args.page),
    take: String(args.take),
  });
  return apiFetch(`/v1/businesses/${businessId}/reports/categories/detail?${q}`);
}
