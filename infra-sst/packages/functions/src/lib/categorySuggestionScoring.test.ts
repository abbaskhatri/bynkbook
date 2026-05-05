import { describe, expect, test } from "vitest";
import { normalizeMerchant, tokenizeMerchantText } from "./categoryMerchantNormalize";
import {
  buildHeuristicSuggestions,
  buildKeywordCategorySuggestions,
  confidenceTierFromScore,
  isBulkSafeCategorySuggestion,
} from "./categorySuggestionScoring";
import type { Direction } from "./categoryMemory";

function keywordItem(args: {
  payee: string;
  memo?: string;
  direction?: Direction;
  amount_cents?: bigint;
}) {
  const direction = args.direction ?? "EXPENSE";
  const amount_cents = args.amount_cents ?? (direction === "EXPENSE" ? -4200n : 4200n);

  return {
    id: "entry-1",
    merchant_normalized: normalizeMerchant(args.payee, args.memo ?? ""),
    payee_or_name: args.payee,
    memo: args.memo ?? "",
    direction,
    amount_cents,
    tokens: tokenizeMerchantText(args.payee, args.memo ?? ""),
  };
}

describe("isBulkSafeCategorySuggestion", () => {
  test("allows SAFE_DETERMINISTIC 95", () => {
    expect(
      isBulkSafeCategorySuggestion(
        { category_id: "cat-1", confidence_tier: "SAFE_DETERMINISTIC", confidence: 95 },
        0
      )
    ).toBe(true);
  });

  test("allows STRONG_SUGGESTION 85", () => {
    expect(
      isBulkSafeCategorySuggestion(
        { category_id: "cat-1", confidence_tier: "STRONG_SUGGESTION", confidence: 85 },
        0
      )
    ).toBe(true);
  });

  test("rejects ALTERNATE 84", () => {
    expect(
      isBulkSafeCategorySuggestion(
        { category_id: "cat-1", confidence_tier: "ALTERNATE", confidence: 84 },
        0
      )
    ).toBe(false);
  });

  test("rejects missing confidence", () => {
    expect(
      isBulkSafeCategorySuggestion(
        { category_id: "cat-1", confidence_tier: "STRONG_SUGGESTION" },
        0
      )
    ).toBe(false);
  });

  test("rejects non-top suggestion", () => {
    expect(
      isBulkSafeCategorySuggestion(
        { category_id: "cat-1", confidence_tier: "SAFE_DETERMINISTIC", confidence: 95 },
        1
      )
    ).toBe(false);
  });

  test("rejects missing category ID", () => {
    expect(
      isBulkSafeCategorySuggestion(
        { confidence_tier: "SAFE_DETERMINISTIC", confidence: 95 },
        0
      )
    ).toBe(false);
  });

  test("rejects review-only or protected suggestions", () => {
    expect(
      isBulkSafeCategorySuggestion(
        { category_id: "cat-1", confidence_tier: "SAFE_DETERMINISTIC", confidence: 95, review_only: true },
        0
      )
    ).toBe(false);

    expect(
      isBulkSafeCategorySuggestion(
        { category_id: "cat-1", confidence_tier: "SAFE_DETERMINISTIC", confidence: 95, protected_class: "TRANSFER" },
        0
      )
    ).toBe(false);
  });
});

describe("category keyword suggestions", () => {
  test("suggests Fuel for Test Fuel Stop when Fuel category exists", () => {
    const suggestions = buildKeywordCategorySuggestions({
      item: keywordItem({ payee: "Test Fuel Stop" }),
      categories: [
        { id: "cat-bank", name: "Bank Fees" },
        { id: "cat-fuel", name: "Fuel" },
      ],
      limit: 3,
    });

    expect(suggestions[0]).toMatchObject({
      category_id: "cat-fuel",
      category_name: "Fuel",
      confidence: 84,
    });
  });

  test("does not suggest Fuel when Fuel category is absent from active categories", () => {
    const suggestions = buildKeywordCategorySuggestions({
      item: keywordItem({ payee: "Test Fuel Stop" }),
      categories: [
        { id: "cat-bank", name: "Bank Fees" },
        { id: "cat-office", name: "Office Supplies" },
      ],
      limit: 3,
    });

    expect(suggestions).toEqual([]);
  });

  test("suggests Fuel for Test Fuel Stop when Auto/Fuel category exists", () => {
    const suggestions = buildKeywordCategorySuggestions({
      item: keywordItem({ payee: "Test Fuel Stop" }),
      categories: [
        { id: "cat-auto-fuel", name: "Auto/Fuel" },
        { id: "cat-office", name: "Office Supplies" },
      ],
      limit: 3,
    });

    expect(suggestions[0]).toMatchObject({
      category_id: "cat-auto-fuel",
      category_name: "Auto/Fuel",
      confidence: 84,
      reason: expect.stringContaining("Matched fuel merchant keyword"),
    });
  });

  test("suggests Bank Fees for bank fee or service charge merchant when Bank Fees exists", () => {
    const bankFeeSuggestions = buildKeywordCategorySuggestions({
      item: keywordItem({ payee: "Monthly bank fee" }),
      categories: [{ id: "cat-bank-fees", name: "Bank Fees" }],
      limit: 3,
    });

    expect(bankFeeSuggestions[0]).toMatchObject({
      category_id: "cat-bank-fees",
      category_name: "Bank Fees",
      confidence: 83,
      reason: expect.stringContaining("Matched bank fee keyword"),
    });

    const serviceChargeSuggestions = buildKeywordCategorySuggestions({
      item: keywordItem({ payee: "Bank service charge" }),
      categories: [{ id: "cat-bank-fees", name: "Bank Fees" }],
      limit: 3,
    });

    expect(serviceChargeSuggestions[0]?.category_id).toBe("cat-bank-fees");
  });

  test("suggests Software/Subscriptions for software subscription memo when category exists", () => {
    const suggestions = buildKeywordCategorySuggestions({
      item: keywordItem({ payee: "Acme Cloud", memo: "software subscription monthly" }),
      categories: [
        { id: "cat-software", name: "Software & Subscriptions" },
        { id: "cat-bank", name: "Bank Fees" },
      ],
      limit: 3,
    });

    expect(suggestions[0]).toMatchObject({
      category_id: "cat-software",
      category_name: "Software & Subscriptions",
      confidence: 83,
      reason: expect.stringContaining("Matched software subscription keyword"),
    });
  });

  test("suggests Sale/Sales income category for bankcard or btot deposit when direction is INCOME", () => {
    const bankcardSuggestions = buildKeywordCategorySuggestions({
      item: keywordItem({
        payee: "Bankcard Deposit",
        memo: "merchant batch",
        direction: "INCOME",
        amount_cents: 125000n,
      }),
      categories: [
        { id: "cat-sales", name: "Sales / Revenue" },
        { id: "cat-bank", name: "Bank Fees" },
      ],
      limit: 3,
    });

    expect(bankcardSuggestions[0]).toMatchObject({
      category_id: "cat-sales",
      category_name: "Sales / Revenue",
      confidence: 83,
      reason: expect.stringContaining("Matched income deposit keyword"),
    });

    const btotSuggestions = buildKeywordCategorySuggestions({
      item: keywordItem({
        payee: "BTOT DEP",
        memo: "card deposit",
        direction: "INCOME",
        amount_cents: 87500n,
      }),
      categories: [{ id: "cat-sales", name: "Sales" }],
      limit: 3,
    });

    expect(btotSuggestions[0]?.category_id).toBe("cat-sales");
  });

  test("does not suggest Sale/Sales for bankcard-like EXPENSE direction", () => {
    const suggestions = buildKeywordCategorySuggestions({
      item: keywordItem({ payee: "Bankcard Deposit", memo: "merchant batch", direction: "EXPENSE" }),
      categories: [{ id: "cat-sales", name: "Sales" }],
      limit: 3,
    });

    expect(suggestions).toEqual([]);
  });

  test("does not suggest Fuel for income or refund direction", () => {
    const suggestions = buildKeywordCategorySuggestions({
      item: keywordItem({
        payee: "Shell fuel refund",
        direction: "INCOME",
        amount_cents: 4200n,
      }),
      categories: [{ id: "cat-fuel", name: "Fuel" }],
      limit: 3,
    });

    expect(suggestions).toEqual([]);
  });

  test("ambiguous Zelle memo does not produce strong keyword suggestion", () => {
    const suggestions = buildKeywordCategorySuggestions({
      item: keywordItem({ payee: "Zelle payment", memo: "payment" }),
      categories: [
        { id: "cat-sales", name: "Sales" },
        { id: "cat-bank", name: "Bank Fees" },
        { id: "cat-software", name: "Software & Subscriptions" },
      ],
      limit: 3,
    });

    expect(suggestions).toEqual([]);
  });

  test("ambiguous check memo does not produce strong keyword suggestion", () => {
    const suggestions = buildKeywordCategorySuggestions({
      item: keywordItem({ payee: "Check payment", memo: "check 1203" }),
      categories: [
        { id: "cat-sales", name: "Sales" },
        { id: "cat-bank", name: "Bank Fees" },
      ],
      limit: 3,
    });

    expect(suggestions).toEqual([]);
  });

  test("income and expense keyword direction mismatches remain not bulk safe", () => {
    const saleExpenseSuggestions = buildKeywordCategorySuggestions({
      item: keywordItem({ payee: "Bankcard Deposit", direction: "EXPENSE" }),
      categories: [{ id: "cat-sales", name: "Sales" }],
      limit: 3,
    });
    const fuelIncomeSuggestions = buildKeywordCategorySuggestions({
      item: keywordItem({ payee: "Test Fuel Stop", direction: "INCOME", amount_cents: 4200n }),
      categories: [{ id: "cat-fuel", name: "Fuel" }],
      limit: 3,
    });

    expect(saleExpenseSuggestions).toEqual([]);
    expect(fuelIncomeSuggestions).toEqual([]);
    expect(isBulkSafeCategorySuggestion(saleExpenseSuggestions[0] ?? null, 0)).toBe(false);
    expect(isBulkSafeCategorySuggestion(fuelIncomeSuggestions[0] ?? null, 0)).toBe(false);
  });

  test("Fuel keyword suggestion remains review-only under existing bulk safety rules", () => {
    const confidence = 84;

    expect(
      isBulkSafeCategorySuggestion(
        {
          category_id: "cat-fuel",
          confidence,
          confidence_tier: confidenceTierFromScore(confidence),
        },
        0
      )
    ).toBe(false);
  });
});

describe("heuristic token similarity", () => {
  test("generic test-token overlap alone does not recommend unrelated categories", () => {
    const suggestions = buildHeuristicSuggestions({
      item: {
        id: "entry-1",
        merchant_normalized: normalizeMerchant("Test Fuel Stop"),
        payee_or_name: "Test Fuel Stop",
        memo: "",
        direction: "EXPENSE",
        amount_cents: -4200n,
        tokens: tokenizeMerchantText("Test Fuel Stop"),
      },
      categories: [
        { id: "cat-bank", name: "Bank Fees" },
        { id: "cat-office", name: "Office Supplies" },
      ],
      history: [
        {
          id: "hist-1",
          payee: "Test Bank Fees",
          memo: "",
          category_id: "cat-bank",
          amount_cents: -1200n,
          type: "EXPENSE",
        },
        {
          id: "hist-2",
          payee: "Test Office Supplies",
          memo: "",
          category_id: "cat-office",
          amount_cents: -2500n,
          type: "EXPENSE",
        },
      ],
      limit: 3,
    });

    expect(suggestions).toEqual([]);
  });

  test("strong memory or history suggestion sorts ahead of generic keyword match", () => {
    const heuristic = buildHeuristicSuggestions({
      item: keywordItem({ payee: "Acme Cloud", memo: "software subscription" }),
      categories: [
        { id: "cat-software", name: "Software & Subscriptions" },
        { id: "cat-consulting", name: "Consulting" },
      ],
      history: [
        {
          id: "hist-1",
          payee: "Acme Cloud",
          memo: "software subscription",
          category_id: "cat-consulting",
          amount_cents: -12000n,
          type: "EXPENSE",
          date: new Date(),
        },
      ],
      limit: 3,
    });

    const keyword = buildKeywordCategorySuggestions({
      item: keywordItem({ payee: "Acme Cloud", memo: "software subscription" }),
      categories: [
        { id: "cat-software", name: "Software & Subscriptions" },
        { id: "cat-consulting", name: "Consulting" },
      ],
      limit: 3,
    });

    const merged = [...heuristic, ...keyword].sort((a, b) => b.confidence - a.confidence);

    expect(heuristic[0]?.category_id).toBe("cat-consulting");
    expect(keyword[0]?.category_id).toBe("cat-software");
    expect(merged[0]?.category_id).toBe("cat-consulting");
    expect(Number(merged[0]?.confidence ?? 0)).toBeGreaterThan(Number(keyword[0]?.confidence ?? 0));
  });
});
