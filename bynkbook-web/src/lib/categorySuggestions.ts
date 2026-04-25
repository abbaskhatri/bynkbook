export type CategorySuggestionLike = {
  category_id?: unknown;
  categoryId?: unknown;
  confidence?: unknown;
  confidence_tier?: unknown;
  confidenceTier?: unknown;
  review_only?: unknown;
  reviewOnly?: unknown;
  protected?: unknown;
  is_protected?: unknown;
  isProtected?: unknown;
  protected_class?: unknown;
  protectedClass?: unknown;
};

function hasCategoryId(suggestion: CategorySuggestionLike | null | undefined) {
  return !!String(suggestion?.category_id ?? suggestion?.categoryId ?? "").trim();
}

function isMarkedReviewOnlyOrProtected(suggestion: CategorySuggestionLike | null | undefined) {
  if (!suggestion) return false;

  return (
    suggestion.review_only === true ||
    suggestion.reviewOnly === true ||
    suggestion.protected === true ||
    suggestion.is_protected === true ||
    suggestion.isProtected === true ||
    !!String(suggestion.protected_class ?? suggestion.protectedClass ?? "").trim()
  );
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

  const confidence = categorySuggestionConfidenceValue(suggestion?.confidence);
  if (confidence === null || confidence < 85) return false;

  const tier = String(suggestion?.confidence_tier ?? suggestion?.confidenceTier ?? "")
    .trim()
    .toUpperCase();

  return tier === "SAFE_DETERMINISTIC" || tier === "STRONG_SUGGESTION";
}

