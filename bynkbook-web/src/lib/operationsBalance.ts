import type { OperationsBankAccount } from "@/lib/api/operations";

export type OperationsBalanceReview = {
  label: string;
  tone: "good" | "warning" | "muted";
  detail: string;
};

export function describeOperationsBalance(account: OperationsBankAccount): OperationsBalanceReview {
  if (account.balance_status === "STALE_SNAPSHOT") {
    return {
      label: "Snapshot stale",
      tone: "warning",
      detail: "The bank snapshot and ledger cutoff are on different dates, so no variance is calculated until the bank refreshes.",
    };
  }

  if (account.balance_status === "BALANCED") {
    return {
      label: "Books balanced",
      tone: "good",
      detail: "Ledger agrees with the bank's current balance.",
    };
  }

  if (account.balance_status === "UNRECONCILED_ACTIVITY") {
    const parts = [];
    if (account.unmatched_count > 0) parts.push(`${account.unmatched_count} unmatched bank`);
    if (account.expected_count > 0) parts.push(`${account.expected_count} unmatched ledger`);
    return {
      label: "Reconcile",
      tone: "warning",
      detail: `${parts.join(" and ")} ${parts.length === 1 ? "item explains" : "items explain"} part or all of the difference.`,
    };
  }

  if (account.balance_status === "PENDING_ACTIVITY") {
    return {
      label: "Pending activity",
      tone: "warning",
      detail: `${account.pending_count} pending bank ${account.pending_count === 1 ? "transaction is" : "transactions are"} not included in the bank current balance.`,
    };
  }

  if (account.balance_status === "OPENING_OR_FEED_GAP") {
    return {
      label: "Books differ",
      tone: "warning",
      detail: "All imported activity is matched. Review the opening balance, or wait for a bank transaction that has not reached Plaid yet.",
    };
  }

  return {
    label: "No bank balance",
    tone: "muted",
    detail: "A bank balance snapshot is not available for comparison.",
  };
}
