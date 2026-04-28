import { apiFetch } from "@/lib/api/client";

export type BankTransactionStatusFilter = "all" | "matched" | "unmatched";

export type BankTransactionsListResponse = {
  ok?: boolean;
  items: any[];
  nextCursor?: string | null;
};

export async function listBankTransactions(args: {
  businessId: string;
  accountId: string;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  status?: BankTransactionStatusFilter;
  limit?: number;
  cursor?: string | null;
}): Promise<BankTransactionsListResponse> {
  const { businessId, accountId, from, to, status, limit, cursor } = args;
  const sp = new URLSearchParams();
  if (from) sp.set("from", from);
  if (to) sp.set("to", to);
  if (status) sp.set("status", status);
  if (limit != null) sp.set("limit", String(limit));
  if (cursor) sp.set("cursor", cursor);

  const qs = sp.toString();
  const path = `/v1/businesses/${businessId}/accounts/${accountId}/bank-transactions${qs ? `?${qs}` : ""}`;
  return apiFetch(path, { method: "GET" });
}

export async function createEntryFromBankTransaction(args: {
  businessId: string;
  accountId: string;
  bankTransactionId: string;
  autoMatch?: boolean;
  memo?: string;
  method?: string;
  category_id?: string;
  suggested_category_id?: string;
}) {
  const {
    businessId,
    accountId,
    bankTransactionId,
    autoMatch,
    memo,
    method,
    category_id,
    suggested_category_id,
  } = args;

  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/bank-transactions/${bankTransactionId}/create-entry`,
    {
      method: "POST",
      body: JSON.stringify({
        autoMatch: !!autoMatch,
        memo: memo ?? "",
        method: method ?? "",
        category_id: category_id ?? "",
        suggested_category_id: suggested_category_id ?? "",
      }),
    }
  );
}
