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
