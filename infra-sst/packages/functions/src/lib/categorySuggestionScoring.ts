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

type KeywordCategoryFamily = {
  id: string;
  direction: Direction;
  categoryAliases: string[];
  tokenSignals: string[];
  phraseSignals: string[];
  confidence: number;
  reason: string;
};

const KEYWORD_CATEGORY_FAMILIES: KeywordCategoryFamily[] = [
  {
    id: "fuel",
    direction: "EXPENSE",
    categoryAliases: ["fuel", "gas", "gasoline", "auto fuel", "vehicle fuel", "car fuel", "automobile expense", "auto expense", "vehicle expense"],
    tokenSignals: ["bp", "chevron", "exxon", "fuel", "gas", "gasoline", "quiktrip", "shell", "mobil", "marathon", "citgo", "valero", "sunoco", "speedway", "racetrac", "wawa"],
    phraseSignals: ["fuel stop", "gas station", "gasoline station"],
    confidence: 84,
    reason: "Matched fuel merchant keyword; Direction matched expense",
  },
  {
    id: "bank_fees",
    direction: "EXPENSE",
    categoryAliases: ["bank fee", "bank fees", "bank service charge", "service charge", "overdraft", "wire fee", "fees"],
    tokenSignals: ["overdraft", "nsf"],
    phraseSignals: ["bank fee", "bank fees", "service charge", "overdraft fee", "wire fee", "monthly maintenance fee", "returned item fee", "nsf fee"],
    confidence: 83,
    reason: "Matched bank fee keyword; Direction matched expense",
  },
  {
    id: "software_subscriptions",
    direction: "EXPENSE",
    categoryAliases: ["software", "subscriptions", "software subscription", "software subscriptions", "saas", "apps", "digital services", "computer software", "internet software"],
    tokenSignals: ["software", "subscription", "subscriptions", "saas", "app", "apps", "adobe", "microsoft", "google", "openai", "github", "dropbox", "slack", "notion", "zoom", "figma", "canva"],
    phraseSignals: ["software subscription", "digital service", "digital services", "cloud subscription", "web services", "google workspace", "microsoft 365"],
    confidence: 83,
    reason: "Matched software subscription keyword; Direction matched expense",
  },
  {
    id: "shipping_postage",
    direction: "EXPENSE",
    categoryAliases: ["shipping", "postage", "freight", "delivery", "courier"],
    tokenSignals: ["fedex", "ups", "usps", "dhl", "postage", "shipping", "freight", "courier"],
    phraseSignals: ["postal service", "shipping charge", "freight charge"],
    confidence: 84,
    reason: "Matched shipping or postage keyword; Direction matched expense",
  },
  {
    id: "utilities",
    direction: "EXPENSE",
    categoryAliases: ["utilities", "utility", "electric", "gas utility", "water", "internet", "phone", "telephone", "telecom", "cell phone"],
    tokenSignals: ["utility", "utilities", "electric", "water", "internet", "comcast", "xfinity", "verizon", "att", "at&t", "spectrum", "tmobile", "t-mobile", "frontier", "centurylink", "coned", "pge"],
    phraseSignals: ["electric bill", "water bill", "utility bill", "internet bill", "phone bill", "mobile phone", "cell phone"],
    confidence: 84,
    reason: "Matched utility provider keyword; Direction matched expense",
  },
  {
    id: "insurance",
    direction: "EXPENSE",
    categoryAliases: ["insurance", "business insurance", "liability insurance"],
    tokenSignals: ["insurance", "premium", "geico", "progressive", "statefarm"],
    phraseSignals: ["insurance premium", "liability insurance", "business insurance"],
    confidence: 84,
    reason: "Matched insurance keyword; Direction matched expense",
  },
  {
    id: "rent_lease",
    direction: "EXPENSE",
    categoryAliases: ["rent", "lease", "office rent", "warehouse rent"],
    tokenSignals: ["rent", "lease", "landlord"],
    phraseSignals: ["monthly rent", "office rent", "warehouse rent", "lease payment"],
    confidence: 84,
    reason: "Matched rent or lease keyword; Direction matched expense",
  },
  {
    id: "office_supplies",
    direction: "EXPENSE",
    categoryAliases: ["office supplies", "supplies", "office", "printing", "printer supplies"],
    tokenSignals: ["staples", "officedepot", "office", "depot", "printing", "ink", "toner"],
    phraseSignals: ["office depot", "office supply", "office supplies", "printing services", "printer ink"],
    confidence: 83,
    reason: "Matched office supply keyword; Direction matched expense",
  },
  {
    id: "meals",
    direction: "EXPENSE",
    categoryAliases: ["meals", "meal", "meals entertainment", "meals and entertainment", "food", "restaurant", "restaurants", "business meals"],
    tokenSignals: ["restaurant", "restaurants", "cafe", "coffee", "starbucks", "doordash", "ubereats", "grubhub", "toast", "mcdonalds", "chickfila", "chipotle", "subway", "panera"],
    phraseSignals: ["business meal", "business meals", "meal expense", "restaurant charge", "food delivery"],
    confidence: 82,
    reason: "Matched meals or restaurant keyword; Direction matched expense",
  },
  {
    id: "travel",
    direction: "EXPENSE",
    categoryAliases: ["travel", "travel expense", "airfare", "lodging", "hotel", "hotels", "transportation"],
    tokenSignals: ["airlines", "airline", "uber", "lyft", "taxi", "hotel", "hotels", "hilton", "marriott", "hyatt", "delta", "united", "southwest", "american"],
    phraseSignals: ["air travel", "airline ticket", "hotel stay", "travel expense", "ride share", "rideshare"],
    confidence: 82,
    reason: "Matched travel merchant keyword; Direction matched expense",
  },
  {
    id: "advertising",
    direction: "EXPENSE",
    categoryAliases: ["advertising", "marketing", "ads", "promotion", "promotions"],
    tokenSignals: ["facebook", "meta", "google", "adwords", "instagram", "tiktok", "linkedin", "yelp", "mailchimp", "constantcontact"],
    phraseSignals: ["google ads", "facebook ads", "meta ads", "ad campaign", "advertising campaign", "marketing service"],
    confidence: 83,
    reason: "Matched advertising or marketing keyword; Direction matched expense",
  },
  {
    id: "merchant_fees",
    direction: "EXPENSE",
    categoryAliases: ["merchant fees", "merchant fee", "processing fees", "processing fee", "credit card fees", "bankcard fees"],
    tokenSignals: ["stripe", "square", "paypal", "merchant", "processor"],
    phraseSignals: ["merchant fee", "merchant fees", "processing fee", "processing fees", "card processing fee", "stripe fee", "square fee", "paypal fee"],
    confidence: 84,
    reason: "Matched merchant processing fee keyword; Direction matched expense",
  },
  {
    id: "repairs",
    direction: "EXPENSE",
    categoryAliases: ["repairs", "repair", "maintenance", "repairs maintenance", "repairs and maintenance"],
    tokenSignals: ["repair", "repairs", "maintenance", "plumbing", "electrician", "hvac", "mechanic", "hardware"],
    phraseSignals: ["repair service", "maintenance service", "building maintenance", "equipment repair", "plumbing repair"],
    confidence: 83,
    reason: "Matched repair or maintenance keyword; Direction matched expense",
  },
  {
    id: "contract_labor",
    direction: "EXPENSE",
    categoryAliases: ["contract labor", "contractor", "contractors", "subcontractor", "subcontractors", "freelancer", "freelancers", "outside services"],
    tokenSignals: ["upwork", "fiverr", "freelancer", "contractor", "subcontractor"],
    phraseSignals: ["contract labor", "contractor payment", "subcontractor payment", "freelance work", "outside services"],
    confidence: 82,
    reason: "Matched contract labor keyword; Direction matched expense",
  },
  {
    id: "dues_subscriptions",
    direction: "EXPENSE",
    categoryAliases: ["dues", "dues subscriptions", "dues and subscriptions", "membership", "memberships"],
    tokenSignals: ["membership", "memberships", "association", "chamber"],
    phraseSignals: ["membership dues", "annual dues", "professional dues", "association dues"],
    confidence: 82,
    reason: "Matched dues or membership keyword; Direction matched expense",
  },
  {
    id: "interest_income",
    direction: "INCOME",
    categoryAliases: ["interest income", "bank interest", "interest"],
    tokenSignals: ["interest"],
    phraseSignals: ["interest paid", "interest credit", "interest income"],
    confidence: 84,
    reason: "Matched interest income keyword; Direction matched income",
  },
  {
    id: "income_deposit",
    direction: "INCOME",
    categoryAliases: ["sale", "sales", "revenue", "income", "merchant deposit", "bankcard deposit"],
    tokenSignals: ["btot"],
    phraseSignals: ["bankcard deposit", "btot dep", "merchant deposit", "card deposit", "deposit"],
    confidence: 83,
    reason: "Matched income deposit keyword; Direction matched income",
  },
  {
    id: "tax",
    direction: "EXPENSE",
    categoryAliases: ["tax", "taxes", "payroll tax", "sales tax", "federal tax", "irs", "income tax", "tax expense"],
    tokenSignals: ["irs", "eftps", "usataxpymt", "tax", "taxes", "treasury"],
    phraseSignals: ["tax pymt", "tax payment", "tax payments", "state tax", "federal tax", "income tax", "eftps payment"],
    confidence: 84,
    reason: "Matched tax payment keyword; Direction matched expense",
  },
  {
    id: "payroll",
    direction: "EXPENSE",
    categoryAliases: ["payroll", "payroll expense", "wages", "salary", "salaries"],
    tokenSignals: ["adp", "gusto", "paychex", "payroll"],
    phraseSignals: ["payroll debit", "payroll expense", "payroll processor", "direct deposit payroll"],
    confidence: 84,
    reason: "Matched payroll processor keyword; Direction matched expense",
  },
];

const AMBIGUOUS_KEYWORD_TOKENS = new Set([
  "zelle",
  "check",
  "payment",
  "transfer",
  "payroll",
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

function singularizeToken(token: string) {
  if (token.length <= 3) return token;
  if (token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.endsWith("ses")) return token.slice(0, -2);
  if (token.endsWith("s")) return token.slice(0, -1);
  return token;
}

function categoryNameVariants(value: unknown) {
  const normalized = normalizedCategoryName(value);
  if (!normalized) return new Set<string>();

  const tokens = normalized.split(" ").filter(Boolean);
  const singularTokens = tokens.map(singularizeToken);
  const variants = new Set<string>([
    normalized,
    singularTokens.join(" "),
  ]);

  for (const token of tokens) variants.add(token);
  for (const token of singularTokens) variants.add(token);

  for (let i = 0; i < singularTokens.length - 1; i++) {
    variants.add(`${singularTokens[i]} ${singularTokens[i + 1]}`);
  }

  return variants;
}

function categoryMatchesFamily(category: CandidateCategory, family: KeywordCategoryFamily) {
  const variants = categoryNameVariants(category.name);
  const aliases = family.categoryAliases.map(normalizedCategoryName);

  for (const alias of aliases) {
    if (!alias) continue;
    if (variants.has(alias)) return true;

    const aliasTokens = alias.split(" ").map(singularizeToken).filter(Boolean);
    if (aliasTokens.length && aliasTokens.every((token) => variants.has(token))) return true;
  }

  return false;
}

function findFamilyCategory(categories: CandidateCategory[], family: KeywordCategoryFamily) {
  return (categories ?? []).find((category) => categoryMatchesFamily(category, family)) ?? null;
}

function hasFamilyKeywordSignal(family: KeywordCategoryFamily, tokens: Set<string>, normalizedContext: string) {
  for (const phrase of family.phraseSignals) {
    if (normalizedContext.includes(normalizedCategoryName(phrase))) return true;
  }

  for (const token of family.tokenSignals) {
    if (tokens.has(normalizedCategoryName(token))) return true;
  }

  return false;
}

function hasStrongFamilyKeywordSignal(family: KeywordCategoryFamily, tokens: Set<string>, normalizedContext: string) {
  for (const phrase of family.phraseSignals) {
    const normalizedPhrase = normalizedCategoryName(phrase);
    if (normalizedPhrase === "deposit") continue;
    if (normalizedContext.includes(normalizedPhrase)) return true;
  }

  for (const token of family.tokenSignals) {
    if (tokens.has(normalizedCategoryName(token))) return true;
  }

  return false;
}

function hasAmbiguousKeywordToken(tokens: Set<string>) {
  for (const token of AMBIGUOUS_KEYWORD_TOKENS) {
    if (tokens.has(token)) return true;
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
  const hasAmbiguousToken = hasAmbiguousKeywordToken(itemContextTokens);

  for (const family of KEYWORD_CATEGORY_FAMILIES) {
    if (args.item.direction !== family.direction) continue;
    if (!hasFamilyKeywordSignal(family, itemContextTokens, normalizedContext)) continue;
    if (hasAmbiguousToken && !hasStrongFamilyKeywordSignal(family, itemContextTokens, normalizedContext)) continue;

    const category = findFamilyCategory(args.categories, family);
    if (!category) continue;

    suggestions.push({
      category_id: category.id,
      category_name: category.name,
      confidence: family.confidence,
      reason: family.reason,
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
    suggestion.requiresUserConfirmation === true ||
    suggestion.review_only === true ||
    suggestion.reviewOnly === true ||
    suggestion.protected === true ||
    suggestion.is_protected === true ||
    suggestion.isProtected === true ||
    !!String(suggestion.protected_class ?? suggestion.protectedClass ?? "").trim()
  );
}

function suggestionHasWarning(suggestion: CategorySuggestionSafetyInput | null | undefined) {
  return !!String(suggestion?.warning ?? "").trim();
}

function suggestionHasRiskyBulkApplyLanguage(suggestion: CategorySuggestionSafetyInput | null | undefined) {
  const text = [
    suggestion?.category_name,
    suggestion?.categoryName,
    suggestion?.reason,
    suggestion?.merchant_normalized,
    suggestion?.merchantNormalized,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");

  return /\b(irs|eftps|treasury|tax|payroll|adp|gusto|paychex|credit card|card payment|amex|american express|visa payment|mastercard|loan|principal|interest|refund|chargeback|owner draw|owner contribution|equity|zelle|ach|wire|transfer|online banking|card payoff)\b/.test(text);
}

export function isBulkSafeCategorySuggestion(
  suggestion: CategorySuggestionSafetyInput | null | undefined,
  suggestionIndex: number
) {
  if (suggestionIndex !== 0) return false;
  if (!suggestionHasCategoryId(suggestion)) return false;
  if (suggestionMarkedReviewOnlyOrProtected(suggestion)) return false;
  if (suggestionHasWarning(suggestion)) return false;
  if (suggestionHasRiskyBulkApplyLanguage(suggestion)) return false;

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
