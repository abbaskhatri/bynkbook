import { apiFetch } from "./client";

export type ReportsRange = {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  accountId: string; // "all" or UUID
};

export type PnlResponse = {
  ok: true;
  report: "pnl";
  from: string;
  to: string;
  accountId: string;
  totals: {
    income_cents: string;
    expense_cents: string;
    net_cents: string;
    income_count: number;
    expense_count: number;
  };
};

export type PayeesResponse = {
  ok: true;
  report: "payees";
  from: string;
  to: string;
  accountId: string;
  rows: Array<{
    payee: string;
    amount_cents: string;
    count: number;
  }>;
};

function qs(params: Record<string, string>) {
  const usp = new URLSearchParams(params);
  return usp.toString();
}

export async function getPnl(businessId: string, range: ReportsRange): Promise<PnlResponse> {
  const q = qs({ from: range.from, to: range.to, accountId: range.accountId ?? "all" });
  return apiFetch(`/v1/businesses/${businessId}/reports/pnl?${q}`);
}

export async function getPayees(businessId: string, range: ReportsRange): Promise<PayeesResponse> {
  const q = qs({ from: range.from, to: range.to, accountId: range.accountId ?? "all" });
  return apiFetch(`/v1/businesses/${businessId}/reports/payees?${q}`);
}

/* ---------------- Bundle 1 ---------------- */

export type CashflowResponse = {
  ok: true;
  report: "cashflow";
  from: string;
  to: string;
  accountId: string;
  totals: {
    cash_in_cents: string;
    cash_out_cents: string;
    net_cents: string;
  };
};

export type ActivityResponse = {
  ok: true;
  report: "activity";
  from: string;
  to: string;
  accountId: string;
  totals: {
    income_cents: string;
    expense_cents: string;
    net_cents: string;
    count: number;
  };
  rows: Array<{
    date: string;
    account_id: string;
    account_name: string;
    type: "INCOME" | "EXPENSE";
    payee: string | null;
    memo: string | null;
    amount_cents: string;
    entry_id: string;
  }>;
};

export async function getCashflow(businessId: string, range: ReportsRange): Promise<CashflowResponse> {
  const q = qs({ from: range.from, to: range.to, accountId: range.accountId ?? "all" });
  return apiFetch(`/v1/businesses/${businessId}/reports/cashflow?${q}`);
}

export async function getActivity(businessId: string, range: ReportsRange): Promise<ActivityResponse> {
  const q = qs({ from: range.from, to: range.to, accountId: range.accountId ?? "all" });
  return apiFetch(`/v1/businesses/${businessId}/reports/activity?${q}`);
}

/* ---------------- Bundle B ---------------- */

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

export async function getCategories(businessId: string, range: ReportsRange): Promise<CategoriesResponse> {
  const q = qs({ from: range.from, to: range.to, accountId: range.accountId ?? "all" });
  return apiFetch(`/v1/businesses/${businessId}/reports/categories?${q}`);
}
