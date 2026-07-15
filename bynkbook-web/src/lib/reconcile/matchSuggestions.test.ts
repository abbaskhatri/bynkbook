import { describe, expect, test } from "vitest";

import {
  buildOneToOneSuggestions,
  buildReconcileSuggestions,
} from "./matchSuggestions";

function bank(overrides: Record<string, unknown> = {}) {
  return {
    id: "bank-1",
    posted_date: "2026-07-14",
    name: "Bank transaction",
    amount_cents: "-110400",
    is_pending: false,
    ...overrides,
  };
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: "entry-1",
    date: "2026-07-07",
    payee: "Ledger entry",
    amount_cents: "-110400",
    ...overrides,
  };
}

describe("reconciliation match suggestions", () => {
  test("surfaces a delayed exact match for review instead of hiding it", () => {
    const suggestions = buildOneToOneSuggestions({
      bankTransactions: [bank({ name: "Check 1567" })],
      expectedEntries: [entry({ payee: "LED Import" })],
      asOfDate: "2026-07-15",
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      bankTxnId: "bank-1",
      entryIds: ["entry-1"],
      quality: "REVIEW",
      postingLagDays: 7,
    });
    expect(suggestions[0].cautionReasons).toContain("Delayed bank posting");
  });

  test("treats a unique check reference as ready across a longer clearing window", () => {
    const suggestions = buildOneToOneSuggestions({
      bankTransactions: [bank({ posted_date: "2026-07-30", name: "Check 1567" })],
      expectedEntries: [entry({ ref: "1567" })],
      asOfDate: "2026-07-31",
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].quality).toBe("READY");
    expect(suggestions[0].confidence).toBe(0.99);
    expect(suggestions[0].reasons).toContain("Reference match");
  });

  test("does not suggest stale exact amounts without identity evidence", () => {
    const suggestions = buildOneToOneSuggestions({
      bankTransactions: [bank({ posted_date: "2026-07-23" })],
      expectedEntries: [entry()],
      asOfDate: "2026-07-24",
    });

    expect(suggestions).toEqual([]);
  });

  test("does not suggest pending bank transactions, opposite directions, or post-dated entries", () => {
    const suggestions = buildOneToOneSuggestions({
      bankTransactions: [
        bank({ id: "pending", is_pending: true }),
        bank({ id: "direction", is_pending: false, amount_cents: "110400" }),
        bank({ id: "future", is_pending: false, posted_date: "2026-07-14" }),
      ],
      expectedEntries: [entry({ date: "2026-07-17" })],
      asOfDate: "2026-07-15",
    });

    expect(suggestions).toEqual([]);
  });

  test("marks an exact next-day sole candidate ready", () => {
    const suggestions = buildOneToOneSuggestions({
      bankTransactions: [bank({ posted_date: "2026-07-08" })],
      expectedEntries: [entry()],
      asOfDate: "2026-07-15",
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].quality).toBe("READY");
  });

  test("accepts a direct counterparty match at three days but not one generic shared word", () => {
    const direct = buildOneToOneSuggestions({
      bankTransactions: [bank({ posted_date: "2026-07-10", name: "Royal LED" })],
      expectedEntries: [entry({ payee: "Royal LED" })],
      asOfDate: "2026-07-15",
    });
    const generic = buildOneToOneSuggestions({
      bankTransactions: [bank({ posted_date: "2026-07-10", name: "Check payment" })],
      expectedEntries: [entry({ payee: "Check vendor" })],
      asOfDate: "2026-07-15",
    });

    expect(direct[0]?.quality).toBe("READY");
    expect(generic[0]?.quality).toBe("REVIEW");
  });

  test("keeps ambiguous equal-amount candidates in review", () => {
    const suggestions = buildOneToOneSuggestions({
      bankTransactions: [bank({ posted_date: "2026-07-08" })],
      expectedEntries: [entry(), entry({ id: "entry-2", payee: "Another vendor" })],
      asOfDate: "2026-07-15",
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].quality).toBe("REVIEW");
    expect(suggestions[0].candidateCount).toBe(2);
    expect(suggestions[0].cautionReasons).toContain("2 possible ledger entries");
  });

  test("assigns each bank transaction and ledger entry at most once", () => {
    const suggestions = buildOneToOneSuggestions({
      bankTransactions: [
        bank({ id: "bank-a", posted_date: "2026-07-08" }),
        bank({ id: "bank-b", posted_date: "2026-07-09" }),
      ],
      expectedEntries: [
        entry({ id: "entry-a" }),
        entry({ id: "entry-b", date: "2026-07-08" }),
      ],
      asOfDate: "2026-07-15",
    });

    expect(suggestions).toHaveLength(2);
    expect(new Set(suggestions.map((suggestion) => suggestion.bankTxnId)).size).toBe(2);
    expect(new Set(suggestions.flatMap((suggestion) => suggestion.entryIds)).size).toBe(2);
  });

  test("preserves maximum one-to-one coverage when one bank has only one candidate", () => {
    const suggestions = buildOneToOneSuggestions({
      bankTransactions: [
        bank({ id: "bank-check", posted_date: "2026-07-30", name: "Check 1567" }),
        bank({ id: "bank-near", posted_date: "2026-07-08" }),
      ],
      expectedEntries: [
        entry({ id: "entry-check", ref: "1567" }),
        entry({ id: "entry-near", date: "2026-07-08" }),
      ],
      asOfDate: "2026-07-31",
    });

    expect(suggestions).toHaveLength(2);
    expect(suggestions.find((suggestion) => suggestion.bankTxnId === "bank-check")?.entryIds).toEqual(["entry-check"]);
    expect(suggestions.find((suggestion) => suggestion.bankTxnId === "bank-near")?.entryIds).toEqual(["entry-near"]);
  });

  test("finds split totals without reusing records already claimed one-to-one", () => {
    const suggestions = buildReconcileSuggestions({
      bankTransactions: [
        bank({ id: "bank-direct", amount_cents: "-5000", posted_date: "2026-07-08" }),
        bank({ id: "bank-split", amount_cents: "-10000", posted_date: "2026-07-08" }),
      ],
      expectedEntries: [
        entry({ id: "entry-direct", amount_cents: "-5000" }),
        entry({ id: "entry-split-a", amount_cents: "-6000" }),
        entry({ id: "entry-split-b", amount_cents: "-4000" }),
      ],
      asOfDate: "2026-07-15",
    });

    expect(suggestions.map((suggestion) => suggestion.kind)).toEqual(["ONE_TO_ONE", "SPLIT"]);
    const usedEntries = suggestions.flatMap((suggestion) => suggestion.entryIds);
    expect(new Set(usedEntries).size).toBe(usedEntries.length);
  });

  test("finds combined bank totals as review-only suggestions", () => {
    const suggestions = buildReconcileSuggestions({
      bankTransactions: [
        bank({ id: "bank-a", amount_cents: "2500", posted_date: "2026-07-08" }),
        bank({ id: "bank-b", amount_cents: "7500", posted_date: "2026-07-08" }),
      ],
      expectedEntries: [entry({ id: "entry-combined", amount_cents: "10000" })],
      asOfDate: "2026-07-15",
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      kind: "COMBINE",
      quality: "REVIEW",
      entryIds: ["entry-combined"],
    });
    expect([...suggestions[0].bankTxnIds].sort()).toEqual(["bank-a", "bank-b"]);
  });
});
