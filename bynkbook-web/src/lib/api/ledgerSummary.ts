import { apiFetch } from "@/lib/api/client";

export type LedgerSummary = {
  ok: boolean;
  business_id: string;
  account_id: string;
  range: { from: string; to: string };
  opening_balance: {
    opening_balance_cents: string;
    opening_balance_date: string;
  };
  totals: {
    income_cents: string;
    expense_cents: string;
    net_cents: string;
  };
  balance_cents: string;
};

export async function getLedgerSummary(params: {
  businessId: string;
  accountId: string;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}): Promise<LedgerSummary> {
  const { businessId, accountId, from, to } = params;
  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/ledger-summary?from=${from}&to=${to}`
  ) as any;
}
