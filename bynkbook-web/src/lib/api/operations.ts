import { apiFetch } from "@/lib/api/client";

export type BankHealthState = "HEALTHY" | "SYNCING" | "STALE" | "NEVER_SYNCED" | "NEEDS_ATTENTION" | "NOT_CONNECTED";

export type OperationsBankAccount = {
  account_id: string;
  account_name: string;
  account_type: string;
  institution_name: string;
  mask: string;
  connected: boolean;
  connection_status: string;
  health: BankHealthState;
  error_code: string | null;
  error_message: string | null;
  last_sync_at: string | null;
  sync_age_hours: number | null;
  has_new_transactions: boolean;
  new_accounts_available: boolean;
  ledger_balance_cents: string;
  bank_balance_cents: string | null;
  bank_balance_at: string | null;
  pending_count: number;
  posted_count: number;
  unmatched_count: number;
};

export type TransferCandidate = {
  id: string;
  outbound_bank_transaction_id: string;
  inbound_bank_transaction_id: string;
  from_account_id: string;
  from_account_name: string;
  to_account_id: string;
  to_account_name: string;
  outbound_date: string;
  inbound_date: string;
  amount_cents: string;
  outbound_name: string;
  inbound_name: string;
  date_distance_days: number;
  confidence: "HIGH" | "MEDIUM" | "REVIEW";
  reason: string;
};

export type OperationsOverview = {
  ok: true;
  generated_at: string;
  bank_health: {
    healthy_count: number;
    attention_count: number;
    not_connected_count: number;
    pending_count: number;
    accounts: OperationsBankAccount[];
  };
  close_readiness: {
    ready: boolean;
    blockers: {
      open_issues: number;
      uncategorized_entries: number;
      unmatched_bank_transactions: number;
      pending_bank_transactions: number;
      unhealthy_bank_connections: number;
    };
  };
  categorization: {
    uncategorized_count: number;
    learned_merchant_rules: number;
    safe_reuse_rules: number;
    accepted_feedback: number;
    overridden_feedback: number;
    acceptance_rate: number | null;
  };
  transfer_candidates: TransferCandidate[];
  forecast: {
    starting_cash_cents: string;
    weeks: Array<{
      week_start: string;
      cash_in_cents: string;
      cash_out_cents: string;
      net_cents: string;
      ending_cash_cents: string;
      events: number;
    }>;
    recurring: Array<{
      key: string;
      payee: string;
      type: string;
      amount_cents: string;
      cadence_days: number;
      observations: number;
      last_date: string;
      confidence: "HIGH" | "MEDIUM";
    }>;
    methodology: string;
  };
};

export async function getOperationsOverview(businessId: string): Promise<OperationsOverview> {
  return apiFetch(`/v1/businesses/${businessId}/operations/overview?weeks=13`, { method: "GET" });
}

export async function applyTransferPair(params: {
  businessId: string;
  candidate: TransferCandidate;
}) {
  return apiFetch(`/v1/businesses/${params.businessId}/operations/transfer-pairs`, {
    method: "POST",
    body: JSON.stringify({
      outbound_bank_transaction_id: params.candidate.outbound_bank_transaction_id,
      inbound_bank_transaction_id: params.candidate.inbound_bank_transaction_id,
      confirmed: true,
    }),
  });
}
