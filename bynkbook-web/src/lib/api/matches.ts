import { apiFetch } from "@/lib/api/client";

export async function listMatches(args: {
  businessId: string;
  accountId: string;
  bankTransactionId?: string;
  entryId?: string;
}) {
  const { businessId, accountId, bankTransactionId, entryId } = args;
  const sp = new URLSearchParams();
  if (bankTransactionId) sp.set("bankTransactionId", bankTransactionId);
  if (entryId) sp.set("entryId", entryId);
  const qs = sp.toString();
  const path = `/v1/businesses/${businessId}/accounts/${accountId}/matches${qs ? `?${qs}` : ""}`;
  return apiFetch(path, { method: "GET" });
}

export async function createMatch(args: {
  businessId: string;
  accountId: string;
  bankTransactionId: string;
  entryId: string;
  matchType: "FULL" | "PARTIAL";
  matchedAmountCents: string; // signed string
}) {
  const { businessId, accountId, ...body } = args;
  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/matches`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function unmatchBankTransaction(args: {
  businessId: string;
  accountId: string;
  bankTransactionId: string;
}) {
  const { businessId, accountId, bankTransactionId } = args;
  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/bank-transactions/${bankTransactionId}/unmatch`,
    { method: "POST", body: "{}" }
  );
}

export async function markEntryAdjustment(args: {
  businessId: string;
  accountId: string;
  entryId: string;
  reason: string;
}) {
  const { businessId, accountId, entryId, reason } = args;
  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/entries/${entryId}/mark-adjustment`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}
