import { apiFetch } from "@/lib/api/client";

export type MatchGroupDirection = "INFLOW" | "OUTFLOW";

export type MatchGroupItem = {
  id: string;
  direction: MatchGroupDirection;
  status: "ACTIVE" | "VOIDED" | string;
  created_at: string;
  voided_at?: string | null;
  void_reason?: string | null;
  banks: Array<{
    match_group_id: string;
    bank_transaction_id: string;
    matched_amount_cents: string; // bigint serialized
  }>;
  entries: Array<{
    match_group_id: string;
    entry_id: string;
    matched_amount_cents: string; // bigint serialized
  }>;
};

export type MatchGroupRevertLedgerEntry = {
  id: string;
  date: string | null;
  payee: string | null;
  memo: string | null;
  amount_cents: string;
  type: string | null;
  status: string | null;
  source_bank_transaction_id: string | null;
  deleted_at: string | null;
  is_generated_from_bank: boolean;
  safe_to_soft_delete: boolean;
  will_soft_delete: boolean;
  will_preserve: boolean;
  preserve_reasons: string[];
  closed_period_blocked: boolean;
  closed_period_blocks_action: boolean;
};

export type MatchGroupRevertPreview = {
  ok?: boolean;
  match_group: {
    id: string;
    direction?: string;
    status: string;
    is_active: boolean;
    voided_at?: string | null;
    void_reason?: string | null;
  };
  bank_transaction: {
    id: string;
    posted_date: string;
    name: string;
    amount_cents: string;
    source?: string | null;
  } | null;
  bank_transactions: Array<{
    id: string;
    posted_date: string;
    name: string;
    amount_cents: string;
    source?: string | null;
  }>;
  ledger_entries: MatchGroupRevertLedgerEntry[];
  generated_entries_to_soft_delete: MatchGroupRevertLedgerEntry[];
  manual_entries_preserved: MatchGroupRevertLedgerEntry[];
  closed_period_blocked: boolean;
  closed_period_blocked_entry_ids: string[];
  blocked: boolean;
  block_reasons: string[];
  requires_confirmation: boolean;
  already_reverted: boolean;
  actions: Array<{ type: string; [key: string]: unknown }>;
};

export async function listMatchGroups(args: {
  businessId: string;
  accountId: string;
  status?: "active" | "all";
}) {
  const { businessId, accountId, status = "active" } = args;

  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/match-groups?status=${encodeURIComponent(status)}`, {
    method: "GET",
  });
}

export async function createMatchGroupsBatch(args: {
  businessId: string;
  accountId: string;
  items: Array<{
    client_id: string;
    // direction is optional; backend will derive from first bank and validate if provided
    direction?: MatchGroupDirection;
    bankTransactionIds: string[];
    entryIds: string[];
  }>;
}) {
  const { businessId, accountId, items } = args;

  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/match-groups/batch`, {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}

export async function voidMatchGroup(args: {
  businessId: string;
  accountId: string;
  matchGroupId: string;
  reason?: string;
}) {
  const { businessId, accountId, matchGroupId, reason } = args;

  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/match-groups/${matchGroupId}/void`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? "" }),
  });
}

export async function previewGeneratedEntryRevert(args: {
  businessId: string;
  accountId: string;
  matchGroupId?: string | null;
  bankTransactionId?: string | null;
  entryId?: string | null;
}): Promise<MatchGroupRevertPreview> {
  const { businessId, accountId, matchGroupId, bankTransactionId, entryId } = args;
  const sp = new URLSearchParams();
  if (matchGroupId) sp.set("matchGroupId", matchGroupId);
  if (bankTransactionId) sp.set("bankTransactionId", bankTransactionId);
  if (entryId) sp.set("entryId", entryId);

  return apiFetch(
    `/v1/businesses/${businessId}/accounts/${accountId}/match-groups/revert-preview?${sp.toString()}`,
    { method: "GET" }
  );
}

export async function confirmGeneratedEntryRevert(args: {
  businessId: string;
  accountId: string;
  matchGroupId?: string | null;
  bankTransactionId?: string | null;
  entryId?: string | null;
  confirmSoftDelete?: boolean;
}) {
  const { businessId, accountId, matchGroupId, bankTransactionId, entryId, confirmSoftDelete } = args;

  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/match-groups/revert`, {
    method: "POST",
    body: JSON.stringify({
      matchGroupId: matchGroupId ?? null,
      bankTransactionId: bankTransactionId ?? null,
      entryId: entryId ?? null,
      confirmSoftDelete: !!confirmSoftDelete,
    }),
  });
}
