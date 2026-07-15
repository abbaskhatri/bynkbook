import { describe, expect, test } from "vitest";

import type { AccountsSummaryRow } from "@/lib/api/reports";
import {
  calculateCashRunway,
  sumLedgerCashCents,
  summarizeBankCash,
} from "@/lib/dashboardMetrics";

function row(overrides: Partial<AccountsSummaryRow>): AccountsSummaryRow {
  return {
    account_id: "account-1",
    name: "Account",
    type: "CHECKING",
    balance_cents: "0",
    ledger_balance_cents: "0",
    bank_balance_cents: null,
    bank_balance_at: null,
    bank_last_sync_at: null,
    bank_connection_status: null,
    ...overrides,
  };
}

describe("dashboard balance metrics", () => {
  test("ledger cash includes cash accounts and excludes credit cards", () => {
    const total = sumLedgerCashCents([
      row({ type: "CHECKING", ledger_balance_cents: "10000" }),
      row({ type: "SAVINGS", ledger_balance_cents: "25000" }),
      row({ type: "CASH", ledger_balance_cents: "5000" }),
      row({ type: "CREDIT_CARD", ledger_balance_cents: "-12000" }),
    ]);

    expect(total).toBe("40000");
  });

  test("bank cash reports partial coverage and excludes cash books and credit cards", () => {
    const summary = summarizeBankCash([
      row({
        type: "CHECKING",
        bank_connection_status: "CONNECTED",
        bank_balance_cents: "11000",
        bank_balance_at: "2026-07-15T10:00:00.000Z",
      }),
      row({ type: "SAVINGS", bank_connection_status: "CONNECTED", bank_balance_cents: null }),
      row({ type: "CASH", bank_balance_cents: "9000" }),
      row({ type: "CREDIT_CARD", bank_balance_cents: "-7000" }),
    ]);

    expect(summary).toEqual({
      totalCents: "11000",
      snapshotCount: 1,
      eligibleCount: 2,
      oldestSnapshotAt: "2026-07-15T10:00:00.000Z",
      complete: false,
    });
  });

  test("runway uses three completed months and ignores the current partial month", () => {
    const runway = calculateCashRunway({
      cashBalanceCents: "120000",
      asOf: "2026-04-15",
      monthly: [
        { month: "2026-01", cash_in_cents: "0", cash_out_cents: "-30000", net_cents: "-30000" },
        { month: "2026-02", cash_in_cents: "0", cash_out_cents: "-60000", net_cents: "-60000" },
        { month: "2026-03", cash_in_cents: "0", cash_out_cents: "-90000", net_cents: "-90000" },
        { month: "2026-04", cash_in_cents: "0", cash_out_cents: "-300000", net_cents: "-300000" },
      ],
    });

    expect(runway).toEqual({ display: "2.0 months", tooltip: "Runway: 2.0 months" });
  });
});
