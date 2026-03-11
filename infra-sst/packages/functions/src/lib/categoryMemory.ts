export type Direction = "INCOME" | "EXPENSE";

export type CandidateCategory = {
  id: string;
  name: string;
};

export type CategoryMemoryRowLite = {
  business_id: string;
  merchant_normalized: string;
  direction: string;
  category_id: string;
  accept_count: number;
  override_count: number;
  last_used_at?: Date | string | null;
  confidence_score?: number | null;
};

export type MemorySuggestion = {
  category_id: string;
  category_name: string;
  confidence: number;
  reason: string;
};

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function tokenizeMerchantKey(value: string): string[] {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function hasAnyToken(tokens: string[], values: string[]) {
  const set = new Set(tokens);
  for (const value of values) {
    if (set.has(value)) return true;
  }
  return false;
}

function merchantKeyQuality(merchantNormalized: string) {
  const tokens = tokenizeMerchantKey(merchantNormalized);
  const joined = tokens.join(" ");

  if (!tokens.length) {
    return {
      quality: "weak" as const,
      tokenCount: 0,
      genericPenalty: 18,
      noisyPenalty: 18,
      strongSignalBonus: 0,
    };
  }

  const genericOnly = new Set([
    "payment",
    "purchase",
    "deposit",
    "withdrawal",
    "transfer",
    "transaction",
    "online",
    "pending",
    "card",
    "debit",
    "credit",
    "check",
    "bank",
  ]);

  const noisyTokenCount = tokens.filter(
    (t) =>
      t.length <= 2 ||
      /^\d+$/.test(t) ||
      /^(ref|trace|trn|conf|auth|id|seq)$/.test(t),
  ).length;

  const genericTokenCount = tokens.filter((t) => genericOnly.has(t)).length;

  const hasTaxSignal = hasAnyToken(tokens, [
    "irs",
    "eftps",
    "usataxpymt",
    "treas",
    "treasury",
    "tax",
    "agency",
  ]);

  const hasPayrollSignal = hasAnyToken(tokens, [
    "adp",
    "gusto",
    "paychex",
    "intuit",
    "quickbooks",
    "payroll",
    "processor",
  ]);

  const strongSignalBonus = hasTaxSignal || hasPayrollSignal ? 6 : 0;

  if (tokens.length <= 1 && !strongSignalBonus) {
    return {
      quality: "weak" as const,
      tokenCount: tokens.length,
      genericPenalty: 12,
      noisyPenalty: noisyTokenCount > 0 ? 8 : 0,
      strongSignalBonus,
    };
  }

  if (genericTokenCount >= Math.max(1, Math.ceil(tokens.length * 0.6))) {
    return {
      quality: "weak" as const,
      tokenCount: tokens.length,
      genericPenalty: 14,
      noisyPenalty: noisyTokenCount > 0 ? 6 : 0,
      strongSignalBonus,
    };
  }

  if (noisyTokenCount >= Math.max(2, Math.ceil(tokens.length * 0.5)) && !strongSignalBonus) {
    return {
      quality: "weak" as const,
      tokenCount: tokens.length,
      genericPenalty: 6,
      noisyPenalty: 12,
      strongSignalBonus,
    };
  }

  if (tokens.length >= 2 || strongSignalBonus) {
    return {
      quality: "good" as const,
      tokenCount: tokens.length,
      genericPenalty: genericTokenCount > 0 ? 2 : 0,
      noisyPenalty: noisyTokenCount > 1 ? 2 : 0,
      strongSignalBonus,
    };
  }

  return {
    quality: "weak" as const,
    tokenCount: tokens.length,
    genericPenalty: 10,
    noisyPenalty: 8,
    strongSignalBonus,
  };
}

function recencyAdjustment(lastUsedAt: any): number {
  if (!lastUsedAt) return 0;

  const ms = new Date(lastUsedAt).getTime();
  if (!Number.isFinite(ms)) return 0;

  const ageDays = Math.max(0, (Date.now() - ms) / (1000 * 60 * 60 * 24));

  if (ageDays <= 30) return 4;
  if (ageDays <= 90) return 2;
  if (ageDays <= 180) return 1;
  if (ageDays <= 365) return 0;
  return -2;
}

export function directionFromEntryTypeOrAmount(entryType: any, amountCents: bigint): Direction {
  const t = String(entryType ?? "").toUpperCase().trim();

  if (t === "INCOME") return "INCOME";
  if (t === "EXPENSE") return "EXPENSE";

  return amountCents < 0n ? "EXPENSE" : "INCOME";
}

export function buildMemoryKey(merchantNormalized: string, direction: Direction): string {
  return `${merchantNormalized}__${direction}`;
}

function computeConfidence(row: CategoryMemoryRowLite): number {
  const keyInfo = merchantKeyQuality(String(row?.merchant_normalized ?? ""));

  const stored = Number(row?.confidence_score ?? 0);
  if (Number.isFinite(stored) && stored > 0) {
    const adjustedStored =
      stored -
      keyInfo.genericPenalty -
      keyInfo.noisyPenalty +
      keyInfo.strongSignalBonus +
      recencyAdjustment(row?.last_used_at);

    const maxStored =
      keyInfo.quality === "good"
        ? 99
        : keyInfo.strongSignalBonus > 0
          ? 90
          : 84;

    return clampInt(adjustedStored, 60, maxStored);
  }

  const accepts = Number(row?.accept_count ?? 0);
  const overrides = Number(row?.override_count ?? 0);
  const total = accepts + overrides;

  if (total <= 0) {
    const weakBase = 60 - keyInfo.genericPenalty - keyInfo.noisyPenalty + keyInfo.strongSignalBonus;
    const weakMax = keyInfo.quality === "good" ? 68 : 64;
    return clampInt(weakBase, 60, weakMax);
  }

  const ratio = accepts / Math.max(1, total);
  const strongVolumeBoost =
    accepts >= 8 ? 10 :
    accepts >= 5 ? 7 :
    accepts >= 3 ? 4 :
    accepts >= 2 ? 2 : 0;

  const weakVolumeBoost =
    accepts >= 6 ? 5 :
    accepts >= 4 ? 3 :
    accepts >= 2 ? 1 : 0;

  const penalty = Math.min(22, overrides * 4);

  let confidence =
    66 +
    ratio * 18 +
    (keyInfo.quality === "good" ? strongVolumeBoost : weakVolumeBoost) -
    penalty -
    keyInfo.genericPenalty -
    keyInfo.noisyPenalty +
    keyInfo.strongSignalBonus +
    recencyAdjustment(row?.last_used_at);

  if (accepts <= 1 && keyInfo.quality !== "good" && keyInfo.strongSignalBonus === 0) {
    confidence = Math.min(confidence, 74);
  }

  if (ratio < 0.67 && keyInfo.quality !== "good") {
    confidence = Math.min(confidence, 76);
  }

  if (overrides >= accepts && keyInfo.quality !== "good") {
    confidence = Math.min(confidence, 72);
  }

  const maxConfidence =
    keyInfo.quality === "good"
      ? 97
      : keyInfo.strongSignalBonus > 0
        ? 88
        : 82;

  return clampInt(confidence, 60, maxConfidence);
}

export function buildCategoryMemoryMap(
  rows: CategoryMemoryRowLite[],
  categoryById: Map<string, CandidateCategory>
) {
  const out = new Map<string, MemorySuggestion[]>();

  for (const row of rows ?? []) {
    const merchantNormalized = String(row?.merchant_normalized ?? "").trim();
    const direction = String(row?.direction ?? "").trim().toUpperCase();
    const categoryId = String(row?.category_id ?? "").trim();

    if (!merchantNormalized) continue;
    if (direction !== "INCOME" && direction !== "EXPENSE") continue;
    if (!categoryId) continue;

    const cat = categoryById.get(categoryId);
    if (!cat) continue;

    const key = buildMemoryKey(merchantNormalized, direction as Direction);
    const next = out.get(key) ?? [];

    const keyInfo = merchantKeyQuality(merchantNormalized);

    next.push({
      category_id: cat.id,
      category_name: cat.name,
      confidence: computeConfidence(row),
      reason:
        keyInfo.quality === "good" || keyInfo.strongSignalBonus > 0
          ? "Learned from your accepted category history"
          : "Learned from prior category history for a similar merchant",
    });

    out.set(key, next);
  }

  for (const [key, items] of out.entries()) {
    items.sort((a, b) => b.confidence - a.confidence || a.category_name.localeCompare(b.category_name));
    out.set(key, items.slice(0, 3));
  }

  return out;
}

export function buildMemorySuggestion(args: {
  memoryMap: Map<string, MemorySuggestion[]>;
  merchant_normalized: string;
  direction: Direction;
  limit: number;
}) {
  const key = buildMemoryKey(args.merchant_normalized, args.direction);
  const items = args.memoryMap.get(key) ?? [];
  return items.slice(0, Math.max(1, Math.min(3, args.limit || 3)));
}