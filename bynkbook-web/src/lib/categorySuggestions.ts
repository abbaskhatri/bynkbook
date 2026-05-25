export type CategorySuggestionLike = {
  category_id?: unknown;
  categoryId?: unknown;
  category_name?: unknown;
  categoryName?: unknown;
  confidence?: unknown;
  confidence_label?: unknown;
  confidenceLabel?: unknown;
  confidence_tier?: unknown;
  confidenceTier?: unknown;
  reason?: unknown;
  warning?: unknown;
  requiresUserConfirmation?: unknown;
  review_only?: unknown;
  reviewOnly?: unknown;
  protected?: unknown;
  is_protected?: unknown;
  isProtected?: unknown;
  protected_class?: unknown;
  protectedClass?: unknown;
  merchant_normalized?: unknown;
  merchantNormalized?: unknown;
};

function hasCategoryId(suggestion: CategorySuggestionLike | null | undefined) {
  return !!String(suggestion?.category_id ?? suggestion?.categoryId ?? "").trim();
}

function isMarkedReviewOnlyOrProtected(suggestion: CategorySuggestionLike | null | undefined) {
  if (!suggestion) return false;

  return (
    suggestion.requiresUserConfirmation === true ||
    suggestion.review_only === true ||
    suggestion.reviewOnly === true ||
    suggestion.protected === true ||
    suggestion.is_protected === true ||
    suggestion.isProtected === true ||
    !!String(suggestion.protected_class ?? suggestion.protectedClass ?? "").trim()
  );
}

function hasWarning(suggestion: CategorySuggestionLike | null | undefined) {
  return !!String(suggestion?.warning ?? "").trim();
}

function hasRiskyBulkApplyLanguage(suggestion: CategorySuggestionLike | null | undefined) {
  const text = [
    suggestion?.category_name,
    suggestion?.categoryName,
    suggestion?.reason,
    suggestion?.merchant_normalized,
    suggestion?.merchantNormalized,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");

  // Core risky terms: government/tax, payroll, financial transfers, equity, reversals.
  // Deliberately excludes "ach" and "american express" as standalone terms — too broad.
  return /\b(irs|eftps|treasury|tax|payroll|adp|gusto|paychex|credit card payment|card payoff|visa payment|loan|principal|interest|refund|chargeback|owner draw|owner contribution|equity|zelle|wire transfer|intercompany transfer)\b/.test(text);
}

export function categorySuggestionConfidenceValue(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function isBulkSafeCategorySuggestion(
  suggestion: CategorySuggestionLike | null | undefined,
  suggestionIndex: number
) {
  if (suggestionIndex !== 0) return false;
  if (!hasCategoryId(suggestion)) return false;
  if (isMarkedReviewOnlyOrProtected(suggestion)) return false;
  if (hasWarning(suggestion)) return false;
  if (hasRiskyBulkApplyLanguage(suggestion)) return false;

  const confidence = categorySuggestionConfidenceValue(suggestion?.confidence);
  if (confidence === null || confidence < 85) return false;

  const tier = String(suggestion?.confidence_tier ?? suggestion?.confidenceTier ?? "")
    .trim()
    .toUpperCase();

  return tier === "SAFE_DETERMINISTIC" || tier === "STRONG_SUGGESTION";
}

