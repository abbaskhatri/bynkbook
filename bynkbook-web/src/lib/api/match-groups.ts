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
