import type { CandidateCategory, Direction } from "./categoryMemory";
import {
  normalizeFreeText,
  normalizeMerchant,
  tokenizeMerchantText,
} from "./categoryMerchantNormalize";

export type HeuristicInputItem = {
  id: string;
  merchant_normalized: string;
  payee_or_name: string;
  memo: string;
  vendor_id?: string | null;
  direction: Direction;
  amount_cents: bigint;
  tokens: string[];
};

export type HeuristicHistoryRow = {
  id: string;
  date?: Date | string | null;
  payee?: string | null;
  memo?: string | null;
  vendor_id?: string | null;
  category_id?: string | null;
  amount_cents?: bigint | string | number | null;
  type?: string | null;
};

export type HeuristicSuggestion = {
  category_id: string;
  category_name: string;
  confidence: number;
  reason: string;
};

export type CategorySuggestionSafetyInput = {
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

type CategoryEvidence = {
  score: number;
  exactMerchantHits: number;
  strongKeywordHits: number;
  moderateKeywordHits: number;
  vendorHits: number;
  highSignalHits: number;
  supportingRows: number;
  reason: string;
};

const LOW_SIGNAL_TOKENS = new Set([
  "test",
  "sample",
  "demo",
  "qa",
]);

const FUEL_CATEGORY_NAMES = new Set(["fuel"]);

const FUEL_KEYWORD_TOKENS = new Set([
  "bp",
  "chevron",
  "exxon",
  "fuel",
  "gas",
  "gasoline",
  "quiktrip",
  "shell",
]);

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function amountToBigInt(v: any): bigint {
  try {
    if (typeof v === "bigint") return v;
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
}

function historyDirection(row: HeuristicHistoryRow): Direction {
  const t = String(row?.type ?? "").toUpperCase().trim();
  if (t === "INCOME") return "INCOME";
  if (t === "EXPENSE") return "EXPENSE";
  return amountToBigInt(row?.amount_cents) < 0n ? "EXPENSE" : "INCOME";
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni <= 0 ? 0 : inter / uni;
}

function parseDateMs(value: any): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function recencyWeight(rowDate: any): number {
  const ms = parseDateMs(rowDate);
  if (!ms) return 1;

  const ageDays = Math.max(0, (Date.now() - ms) / (1000 * 60 * 60 * 24));

  if (ageDays <= 30) return 1.15;
  if (ageDays <= 90) return 1.08;
  if (ageDays <= 180) return 1.0;
  if (ageDays <= 365) return 0.92;
  return 0.82;
}

function supportingRowWeight(hitIndex: number): number {
  if (hitIndex <= 0) return 1.0;
  if (hitIndex === 1) return 0.72;
  if (hitIndex === 2) return 0.5;
  if (hitIndex === 3) return 0.35;
  return 0.2;
}

function hasAnyToken(tokens: Set<string>, values: string[]) {
  for (const v of values) {
    if (tokens.has(v)) return true;
  }
  return false;
}

function isLowSignalToken(token: string) {
  return LOW_SIGNAL_TOKENS.has(String(token ?? "").trim().toLowerCase());
}

function meaningfulIntersectionSize(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const token of a) {
    if (isLowSignalToken(token)) continue;
    if (b.has(token)) inter += 1;
  }
  return inter;
}

function hasTaxSignal(tokens: Set<string>) {
  return hasAnyToken(tokens, [
    "irs",
    "eftps",
    "usataxpymt",
    "treas",
    "treasury",
    "tax",
    "agency",
  ]);
}

function hasPayrollSignal(tokens: Set<string>) {
  return hasAnyToken(tokens, [
    "adp",
    "gusto",
    "paychex",
    "intuit",
    "quickbooks",
    "payroll",
    "processor",
  ]);
}

function hasHighSignalEntity(tokens: Set<string>) {
  return hasTaxSignal(tokens) || hasPayrollSignal(tokens);
}

function confidenceTierFromEvidence(e: CategoryEvidence, relativeToTop: number, index: number) {
  let confidence = 56 + relativeToTop * 18;

  if (e.exactMerchantHits > 0) confidence += 14;
  if (e.vendorHits > 0) confidence += 8;
  if (e.highSignalHits > 0) confidence += 7;
  if (e.strongKeywordHits > 0) confidence += 5;
  if (e.moderateKeywordHits > 0 && e.strongKeywordHits === 0) confidence += 2;

  const strongEvidenceCount =
    (e.exactMerchantHits > 0 ? 1 : 0) +
    (e.vendorHits > 0 ? 1 : 0) +
    (e.highSignalHits > 0 ? 1 : 0) +
    (e.strongKeywordHits > 0 ? 1 : 0);

  if (strongEvidenceCount === 0) {
    confidence = Math.min(confidence, 72);
  } else if (strongEvidenceCount === 1 && e.exactMerchantHits === 0 && e.vendorHits === 0) {
    confidence = Math.min(confidence, 82);
  }

  if (index > 0) confidence -= index * 5;

  return clampInt(confidence, 60, 94);
}

export function clampSuggestionLimit(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 3;
  return Math.max(1, Math.min(3, Math.round(n)));
}

export function confidenceTierFromScore(score: number) {
  if (score >= 95) return "SAFE_DETERMINISTIC" as const;
  if (score >= 85) return "STRONG_SUGGESTION" as const;
  if (score >= 60) return "ALTERNATE" as const;
  return "REVIEW_BUCKET" as const;
}

function normalizedCategoryName(value: unknown) {
  return normalizeFreeText(value).replace(/\s+/g, " ").trim();
}

function findFuelCategory(categories: CandidateCategory[]) {
  return (categories ?? []).find((category) => FUEL_CATEGORY_NAMES.has(normalizedCategoryName(category.name))) ?? null;
}

function hasFuelKeywordSignal(tokens: Set<string>, normalizedContext: string) {
  if (
    normalizedContext.includes("fuel stop") ||
    normalizedContext.includes("gas station")
  ) {
    return true;
  }

  for (const token of tokens) {
    if (FUEL_KEYWORD_TOKENS.has(token)) return true;
  }

  return false;
}

export function buildKeywordCategorySuggestions(args: {
  item: HeuristicInputItem;
  categories: CandidateCategory[];
  limit: number;
}) {
  const limit = clampSuggestionLimit(args.limit);
  const suggestions: HeuristicSuggestion[] = [];
  const itemContextTokens = new Set(tokenizeMerchantText(args.item.payee_or_name ?? "", args.item.memo ?? ""));
  const normalizedContext = normalizeFreeText(`${args.item.payee_or_name ?? ""} ${args.item.memo ?? ""}`);
  const fuelCategory = findFuelCategory(args.categories);

  if (fuelCategory && hasFuelKeywordSignal(itemContextTokens, normalizedContext)) {
    suggestions.push({
      category_id: fuelCategory.id,
      category_name: fuelCategory.name,
      confidence: 84,
      reason: "Matched fuel or gas merchant keywords",
    });
  }

  return suggestions.slice(0, limit);
}

function suggestionConfidenceValue(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return clampInt(n, 0, 100);
}

function suggestionHasCategoryId(suggestion: CategorySuggestionSafetyInput | null | undefined) {
  return !!String(suggestion?.category_id ?? suggestion?.categoryId ?? "").trim();
}

function suggestionMarkedReviewOnlyOrProtected(suggestion: CategorySuggestionSafetyInput | null | undefined) {
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

export function isBulkSafeCategorySuggestion(
  suggestion: CategorySuggestionSafetyInput | null | undefined,
  suggestionIndex: number
) {
  if (suggestionIndex !== 0) return false;
  if (!suggestionHasCategoryId(suggestion)) return false;
  if (suggestionMarkedReviewOnlyOrProtected(suggestion)) return false;

  const confidence = suggestionConfidenceValue(suggestion?.confidence);
  if (confidence === null || confidence < 85) return false;

  const tier = String(suggestion?.confidence_tier ?? suggestion?.confidenceTier ?? "")
    .trim()
    .toUpperCase();

  return tier === "SAFE_DETERMINISTIC" || tier === "STRONG_SUGGESTION";
}

export function buildHeuristicSuggestions(args: {
  item: HeuristicInputItem;
  categories: CandidateCategory[];
  history: HeuristicHistoryRow[];
  limit: number;
}) {
  const limit = clampSuggestionLimit(args.limit);
  const categoryById = new Map(args.categories.map((c) => [c.id, c]));
  const evidenceByCat = new Map<string, CategoryEvidence>();

  const itemMerchant = String(args.item.merchant_normalized ?? "").trim();
  const itemTokens = new Set(args.item.tokens ?? []);
  const itemContextMerchant = normalizeMerchant(args.item.payee_or_name ?? "", args.item.memo ?? "");
  const itemContextTokens = new Set(tokenizeMerchantText(args.item.payee_or_name ?? "", args.item.memo ?? ""));

  for (const token of itemTokens) itemContextTokens.add(token);
  if (itemMerchant) {
    for (const token of itemMerchant.split(" ").map((x) => x.trim()).filter(Boolean)) {
      if (isLowSignalToken(token)) continue;
      itemContextTokens.add(token);
    }
  }

  const itemHasTaxSignal = hasTaxSignal(itemContextTokens);
  const itemHasPayrollSignal = hasPayrollSignal(itemContextTokens);

  for (const row of args.history ?? []) {
    const categoryId = String(row?.category_id ?? "").trim();
    if (!categoryId) continue;
    if (!categoryById.has(categoryId)) continue;
    if (historyDirection(row) !== args.item.direction) continue;

    const existing = evidenceByCat.get(categoryId) ?? {
      score: 0,
      exactMerchantHits: 0,
      strongKeywordHits: 0,
      moderateKeywordHits: 0,
      vendorHits: 0,
      highSignalHits: 0,
      supportingRows: 0,
      reason: "Matched your account history",
    };

    const rowMerchant = normalizeMerchant(row?.payee ?? "", row?.memo ?? "");
    const rowTokens = new Set(tokenizeMerchantText(row?.payee ?? "", row?.memo ?? ""));
    const rowHasTaxSignal = hasTaxSignal(rowTokens);
    const rowHasPayrollSignal = hasPayrollSignal(rowTokens);

    let rowScore = 0;
    let rowReason = existing.reason;

    const recency = recencyWeight(row?.date);
    const supportWeight = supportingRowWeight(existing.supportingRows);

    const exactMerchant =
      !!itemMerchant &&
      !!rowMerchant &&
      (itemMerchant === rowMerchant || (!!itemContextMerchant && itemContextMerchant === rowMerchant));

    const sameVendor =
      !!args.item.vendor_id &&
      !!row?.vendor_id &&
      String(args.item.vendor_id) === String(row.vendor_id);

    const tokenSim = itemContextTokens.size && rowTokens.size ? jaccard(itemContextTokens, rowTokens) : 0;
    const meaningfulOverlap = meaningfulIntersectionSize(itemContextTokens, rowTokens);

    const sameHighSignalFamily =
      (itemHasTaxSignal && rowHasTaxSignal) || (itemHasPayrollSignal && rowHasPayrollSignal);

    if (exactMerchant) {
      rowScore += 16;
      rowReason = "Exact merchant match in account history";
      existing.exactMerchantHits += 1;
    }

    if (sameVendor) {
      rowScore += 10;
      rowReason = "Matched vendor-linked account history";
      existing.vendorHits += 1;
    }

    if (sameHighSignalFamily) {
      rowScore += 9;
      rowReason = itemHasTaxSignal
        ? "Matched tax-related account history"
        : "Matched payroll-related account history";
      existing.highSignalHits += 1;
    }

    if (!exactMerchant && tokenSim >= 0.62) {
      rowScore += 8;
      rowReason = "Strong keyword match in account history";
      existing.strongKeywordHits += 1;
    } else if (!exactMerchant && meaningfulOverlap > 0 && tokenSim >= 0.35) {
      rowScore += 3.5;
      if (!sameHighSignalFamily && !sameVendor) {
        rowReason = "Keyword overlap with account history";
      }
      existing.moderateKeywordHits += 1;
    }

    if (rowScore > 0) {
      rowScore += 1.25 * supportWeight;
    } else if (meaningfulOverlap > 0 && tokenSim >= 0.2) {
      rowScore += 0.5 * supportWeight;
    }

    rowScore *= recency;

    existing.score += rowScore;
    existing.supportingRows += 1;
    existing.reason = rowReason;

    evidenceByCat.set(categoryId, existing);
  }

  const scored = Array.from(evidenceByCat.entries())
    .map(([category_id, e]) => {
      let adjustedScore = e.score;

      const strongEvidenceCount =
        (e.exactMerchantHits > 0 ? 1 : 0) +
        (e.vendorHits > 0 ? 1 : 0) +
        (e.highSignalHits > 0 ? 1 : 0) +
        (e.strongKeywordHits > 0 ? 1 : 0);

      if (strongEvidenceCount === 0 && e.supportingRows >= 4) {
        adjustedScore *= 0.72;
      } else if (strongEvidenceCount === 1 && e.exactMerchantHits === 0 && e.vendorHits === 0 && e.supportingRows >= 5) {
        adjustedScore *= 0.84;
      }

      if (itemHasTaxSignal && e.highSignalHits === 0 && e.exactMerchantHits === 0 && e.vendorHits === 0) {
        adjustedScore *= 0.82;
      }

      if (itemHasPayrollSignal && e.highSignalHits === 0 && e.exactMerchantHits === 0 && e.vendorHits === 0) {
        adjustedScore *= 0.84;
      }

      return {
        category_id,
        category_name: categoryById.get(category_id)?.name ?? "—",
        score: adjustedScore,
        evidence: e,
        reason: e.reason,
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.category_name.localeCompare(b.category_name))
    .slice(0, limit);

  if (!scored.length) return [] as HeuristicSuggestion[];

  const topScore = scored[0]?.score ?? 1;

  return scored.map((row, index) => {
    const relative = row.score / Math.max(1, topScore);
    const confidence = confidenceTierFromEvidence(row.evidence, relative, index);

    return {
      category_id: row.category_id,
      category_name: row.category_name,
      confidence,
      reason: row.reason,
    };
  });
}
