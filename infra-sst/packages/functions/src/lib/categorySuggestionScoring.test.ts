import { describe, expect, test } from "vitest";
import { isBulkSafeCategorySuggestion } from "./categorySuggestionScoring";

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
