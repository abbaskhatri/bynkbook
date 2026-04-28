import { describe, expect, test } from "vitest";
import { normalizeMerchant, tokenizeMerchantText } from "./categoryMerchantNormalize";
import {
  buildHeuristicSuggestions,
  buildKeywordCategorySuggestions,
  confidenceTierFromScore,
  isBulkSafeCategorySuggestion,
} from "./categorySuggestionScoring";

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
      limit: 3,
    });

    expect(suggestions).toEqual([]);
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
});
