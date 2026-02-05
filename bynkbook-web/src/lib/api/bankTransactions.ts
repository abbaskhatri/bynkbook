import { apiFetch } from "@/lib/api/client";

export async function listBankTransactions(args: {
  businessId: string;
  accountId: string;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
  limit?: number;
}) {
  const { businessId, accountId, from, to, limit } = args;
  const sp = new URLSearchParams();
  if (from) sp.set("from", from);
  if (to) sp.set("to", to);
  if (limit != null) sp.set("limit", String(limit));

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
}) {
  const { businessId, accountId, bankTransactionId, autoMatch, memo, method, category_id } = args;

  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/bank-transactions/${bankTransactionId}/create-entry`,
    {
      method: "POST",
      body: JSON.stringify({
        autoMatch: !!autoMatch,
        memo: memo ?? "",
        method: method ?? "",
        category_id: category_id ?? "",
      }),
    }
  );
}
