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
