import { apiFetch } from "@/lib/api/client";

export type BankTransactionStatusFilter = "all" | "matched" | "unmatched";

export type BankTransactionsListResponse = {
  ok?: boolean;
  items: any[];
  nextCursor?: string | null;
  /**
   * Total bank-transactions matching the (filtered) where-base, ignoring
   * cursor. Populated server-side starting with the perf/bank-tx-total-count
   * deploy. Older deploys won't return this field.
   */
  totalCount?: number;
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
  allowPossibleDuplicate?: boolean;
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
    allowPossibleDuplicate,
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
        allowPossibleDuplicate: allowPossibleDuplicate === true,
      }),
    }
  );
}

export async function cleanupPlaidOverlap(args: {
  businessId: string;
  accountId: string;
}): Promise<{ ok?: boolean; removedCount?: number; throughDate?: string | null; message?: string }> {
  const { businessId, accountId } = args;
  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/bank-transactions/cleanup-plaid-overlap`,
    { method: "POST", body: "{}" }
  );
}
