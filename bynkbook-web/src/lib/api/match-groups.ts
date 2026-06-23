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

export type MatchGroupPlacementSummary = {
  ok: true;
  activeBankLinks: Array<{
    bank_transaction_id: string;
    match_group_id: string;
    matched_amount_cents: string;
  }>;
  activeEntryLinks: Array<{
    entry_id: string;
    match_group_id: string;
    matched_amount_cents: string;
  }>;
  partial: boolean;
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

export async function getMatchGroupPlacementSummary(args: {
  businessId: string;
  accountId: string;
  bankTransactionIds?: string[];
  entryIds?: string[];
  from?: string;
  to?: string;
}): Promise<MatchGroupPlacementSummary> {
  const { businessId, accountId, bankTransactionIds, entryIds, from, to } = args;

  return apiFetch(`/v1/businesses/${businessId}/accounts/${accountId}/match-groups/placement-summary`, {
    method: "POST",
    body: JSON.stringify({
      bankTransactionIds: bankTransactionIds ?? [],
      entryIds: entryIds ?? [],
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
  });
}

const PLACEMENT_SUMMARY_BANK_ID_CHUNK = 1000;
const PLACEMENT_SUMMARY_ENTRY_ID_CHUNK = 500;

function uniqueIds(ids: string[] | undefined) {
  return Array.from(new Set((ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean)));
}

function chunks<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function mergePlacementSummaries(items: MatchGroupPlacementSummary[]): MatchGroupPlacementSummary {
  const bankLinks = new Map<string, MatchGroupPlacementSummary["activeBankLinks"][number]>();
  const entryLinks = new Map<string, MatchGroupPlacementSummary["activeEntryLinks"][number]>();
  let partial = false;

  for (const item of items) {
    if (item?.partial) partial = true;

    for (const link of item?.activeBankLinks ?? []) {
      const key = `${String(link.match_group_id ?? "")}:${String(link.bank_transaction_id ?? "")}`;
      if (key !== ":") bankLinks.set(key, link);
    }

    for (const link of item?.activeEntryLinks ?? []) {
      const key = `${String(link.match_group_id ?? "")}:${String(link.entry_id ?? "")}`;
      if (key !== ":") entryLinks.set(key, link);
    }
  }

  return {
    ok: true,
    activeBankLinks: Array.from(bankLinks.values()),
    activeEntryLinks: Array.from(entryLinks.values()),
    partial,
  };
}

export async function getChunkedMatchGroupPlacementSummary(args: {
  businessId: string;
  accountId: string;
  bankTransactionIds?: string[];
  entryIds?: string[];
  from?: string;
  to?: string;
}): Promise<MatchGroupPlacementSummary> {
  const bankTransactionIds = uniqueIds(args.bankTransactionIds);
  const entryIds = uniqueIds(args.entryIds);

  const requests: Promise<MatchGroupPlacementSummary>[] = [];

  for (const bankChunk of chunks(bankTransactionIds, PLACEMENT_SUMMARY_BANK_ID_CHUNK)) {
    requests.push(getMatchGroupPlacementSummary({ ...args, bankTransactionIds: bankChunk, entryIds: [] }));
  }

  for (const entryChunk of chunks(entryIds, PLACEMENT_SUMMARY_ENTRY_ID_CHUNK)) {
    requests.push(getMatchGroupPlacementSummary({ ...args, bankTransactionIds: [], entryIds: entryChunk }));
  }

  if (requests.length === 0) {
    return { ok: true, activeBankLinks: [], activeEntryLinks: [], partial: false };
  }

  return mergePlacementSummaries(await Promise.all(requests));
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
