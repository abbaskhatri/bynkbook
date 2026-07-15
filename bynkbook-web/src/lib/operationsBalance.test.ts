import { describe, expect, test } from "vitest";

import type { OperationsBankAccount } from "@/lib/api/operations";
import { describeOperationsBalance } from "@/lib/operationsBalance";

function account(overrides: Partial<OperationsBankAccount>): OperationsBankAccount {
  return {
    account_id: "account-1",
    account_name: "Operating checking",
    account_type: "CHECKING",
    institution_name: "Bank",
    mask: "1234",
    connected: true,
    connection_status: "CONNECTED",
    health: "HEALTHY",
    error_code: null,
    error_message: null,
    last_sync_at: "2026-07-15T12:00:00Z",
    sync_age_hours: 0,
    has_new_transactions: false,
    new_accounts_available: false,
    opening_balance_cents: "0",
    opening_balance_date: "2026-01-01",
    ledger_balance_cents: "10000",
    bank_balance_cents: "10000",
    bank_balance_at: "2026-07-15T12:00:00Z",
    balance_comparable: true,
    balance_difference_cents: "0",
    balance_status: "BALANCED",
    pending_count: 0,
    pending_amount_cents: "0",
    posted_count: 1,
    unmatched_count: 0,
    unmatched_amount_cents: "0",
    expected_count: 0,
    expected_amount_cents: "0",
    ...overrides,
  };
}

describe("operations balance review", () => {
  test("distinguishes a healthy feed from balanced books", () => {
    expect(describeOperationsBalance(account({})).label).toBe("Books balanced");
    expect(describeOperationsBalance(account({
      balance_difference_cents: "-74041",
      balance_status: "OPENING_OR_FEED_GAP",
    }))).toEqual(expect.objectContaining({
      label: "Books differ",
      detail: expect.stringContaining("opening balance"),
    }));
  });

  test("prioritizes unmatched and pending activity explanations", () => {
    expect(describeOperationsBalance(account({
      balance_status: "UNRECONCILED_ACTIVITY",
      unmatched_count: 2,
      expected_count: 1,
    })).detail).toContain("2 unmatched bank and 1 unmatched ledger");
    expect(describeOperationsBalance(account({
      balance_status: "PENDING_ACTIVITY",
      pending_count: 1,
    })).detail).toContain("1 pending bank transaction is");
  });

  test("refuses to calculate a difference across different balance dates", () => {
    expect(describeOperationsBalance(account({
      balance_comparable: false,
      balance_difference_cents: null,
      balance_status: "STALE_SNAPSHOT",
    }))).toEqual(expect.objectContaining({
      label: "Snapshot stale",
      detail: expect.stringContaining("no variance is calculated"),
    }));
  });
});
