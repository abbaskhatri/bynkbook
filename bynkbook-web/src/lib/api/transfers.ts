import { apiFetch } from "@/lib/api/client";

export async function createTransfer(params: {
  businessId: string;
  fromAccountId: string;
  input: {
    to_account_id: string;
    date: string; // YYYY-MM-DD
    amount_cents: number; // positive cents (abs)
    payee?: string | null;
    memo?: string | null;
    method?: string | null;
    status?: string | null;
  };
}): Promise<{ ok: true; transfer_id: string; from_entry_id: string; to_entry_id: string }> {
  const { businessId, fromAccountId, input } = params;
  return apiFetch(`/v1/businesses/${businessId}/accounts/${fromAccountId}/transfers`, {
    method: "POST",
    body: JSON.stringify({
      to_account_id: input.to_account_id,
      date: input.date,
      amount_cents: input.amount_cents,
      payee: input.payee ?? null,
      memo: input.memo ?? null,
      method: input.method ?? null,
      status: input.status ?? "EXPECTED",
    }),
  });
}

export async function updateTransfer(params: {
  businessId: string;
  scopeAccountId: string;
  transferId: string;
  updates: {
    to_account_id?: string;
    date?: string; // YYYY-MM-DD
    amount_cents?: number; // positive cents (abs)
    payee?: string | null;
    memo?: string | null;
    method?: string | null;
    status?: string | null;
  };
}): Promise<{ ok: true; transfer_id: string; updated: true }> {
  const { businessId, scopeAccountId, transferId, updates } = params;
  return apiFetch(`/v1/businesses/${businessId}/accounts/${scopeAccountId}/transfers/${transferId}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function deleteTransfer(params: {
  businessId: string;
  scopeAccountId: string;
  transferId: string;
}): Promise<{ ok: true; transfer_id: string; deleted: true }> {
  const { businessId, scopeAccountId, transferId } = params;
  return apiFetch(`/v1/businesses/${businessId}/accounts/${scopeAccountId}/transfers/${transferId}`, {
    method: "DELETE",
  });
}

export async function restoreTransfer(params: {
  businessId: string;
  scopeAccountId: string;
  transferId: string;
}): Promise<{ ok: true; transfer_id: string; restored: true }> {
  const { businessId, scopeAccountId, transferId } = params;
  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${scopeAccountId}/transfers/${transferId}/restore`,
    { method: "POST" }
  );
}
