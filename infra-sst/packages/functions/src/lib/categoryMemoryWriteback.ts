import { normalizeMerchant } from "./categoryMerchantNormalize";

type WritebackConfidenceArgs = {
  merchantNormalized: string;
  acceptCount: number;
  overrideCount: number;
};

type WriteCategoryMemoryFeedbackArgs = {
  prisma: any;
  business_id: string;
  entry: {
    id?: string | null;
    payee?: string | null;
    memo?: string | null;
    amount_cents?: bigint | string | number | null;
    type?: string | null;
  };
  selected_category_id: string;
  suggested_category_id?: string | null;
};

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

function directionFromEntryTypeOrAmount(entryType: any, amountCents: bigint): "INCOME" | "EXPENSE" {
  const t = String(entryType ?? "").toUpperCase().trim();

  if (t === "INCOME") return "INCOME";
  if (t === "EXPENSE") return "EXPENSE";

  return amountCents < 0n ? "EXPENSE" : "INCOME";
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

  const genericTokenCount = tokens.filter((t) => genericOnly.has(t)).length;
  const noisyTokenCount = tokens.filter(
    (t) =>
      t.length <= 2 ||
      /^\d+$/.test(t) ||
      /^(ref|trace|trn|conf|auth|id|seq)$/.test(t),
  ).length;

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

  const strongSignal = hasTaxSignal || hasPayrollSignal;

  if (!tokens.length) {
    return {
      quality: "weak" as const,
      genericPenalty: 18,
      noisyPenalty: 18,
      strongSignalBonus: 0,
    };
  }

  if (tokens.length <= 1 && !strongSignal) {
    return {
      quality: "weak" as const,
      genericPenalty: 12,
      noisyPenalty: noisyTokenCount > 0 ? 8 : 0,
      strongSignalBonus: 0,
    };
  }

  if (genericTokenCount >= Math.max(1, Math.ceil(tokens.length * 0.6))) {
    return {
      quality: "weak" as const,
      genericPenalty: 14,
      noisyPenalty: noisyTokenCount > 0 ? 6 : 0,
      strongSignalBonus: strongSignal ? 6 : 0,
    };
  }

  if (noisyTokenCount >= Math.max(2, Math.ceil(tokens.length * 0.5)) && !strongSignal) {
    return {
      quality: "weak" as const,
      genericPenalty: 6,
      noisyPenalty: 12,
      strongSignalBonus: 0,
    };
  }

  return {
    quality: "good" as const,
    genericPenalty: genericTokenCount > 0 ? 2 : 0,
    noisyPenalty: noisyTokenCount > 1 ? 2 : 0,
    strongSignalBonus: strongSignal ? 6 : 0,
  };
}

export function computeMemoryConfidenceScore(args: WritebackConfidenceArgs): number {
  const acceptCount = Math.max(0, Number(args.acceptCount ?? 0));
  const overrideCount = Math.max(0, Number(args.overrideCount ?? 0));
  const total = acceptCount + overrideCount;
  const ratio = total > 0 ? acceptCount / total : 0;

  const keyInfo = merchantKeyQuality(args.merchantNormalized);

  const strongVolumeBoost =
    acceptCount >= 8 ? 10 :
    acceptCount >= 5 ? 7 :
    acceptCount >= 3 ? 4 :
    acceptCount >= 2 ? 2 : 0;

  const weakVolumeBoost =
    acceptCount >= 6 ? 5 :
    acceptCount >= 4 ? 3 :
    acceptCount >= 2 ? 1 : 0;

  const overridePenalty = Math.min(22, overrideCount * 4);

  let score =
    66 +
    ratio * 18 +
    (keyInfo.quality === "good" ? strongVolumeBoost : weakVolumeBoost) -
    overridePenalty -
    keyInfo.genericPenalty -
    keyInfo.noisyPenalty +
    keyInfo.strongSignalBonus;

  if (acceptCount <= 1 && keyInfo.quality !== "good" && keyInfo.strongSignalBonus === 0) {
    score = Math.min(score, 74);
  }

  if (ratio < 0.67 && keyInfo.quality !== "good") {
    score = Math.min(score, 76);
  }

  if (overrideCount >= acceptCount && keyInfo.quality !== "good") {
    score = Math.min(score, 72);
  }

  const maxScore =
    keyInfo.quality === "good"
      ? 97
      : keyInfo.strongSignalBonus > 0
        ? 88
        : 82;

  return clampInt(score, 60, maxScore);
}

async function upsertMemoryRow(args: {
  prisma: any;
  business_id: string;
  merchant_normalized: string;
  direction: "INCOME" | "EXPENSE";
  category_id: string;
  acceptIncrement: number;
  overrideIncrement: number;
}) {
  const existing = await args.prisma.categoryMemory.findFirst({
    where: {
      business_id: args.business_id,
      merchant_normalized: args.merchant_normalized,
      direction: args.direction,
      category_id: args.category_id,
    },
    select: {
      business_id: true,
      merchant_normalized: true,
      direction: true,
      category_id: true,
      accept_count: true,
      override_count: true,
    },
  });

  const nextAccept = Number(existing?.accept_count ?? 0) + args.acceptIncrement;
  const nextOverride = Number(existing?.override_count ?? 0) + args.overrideIncrement;

  const confidence_score = computeMemoryConfidenceScore({
    merchantNormalized: args.merchant_normalized,
    acceptCount: nextAccept,
    overrideCount: nextOverride,
  });

  if (existing) {
    await args.prisma.categoryMemory.updateMany({
      where: {
        business_id: args.business_id,
        merchant_normalized: args.merchant_normalized,
        direction: args.direction,
        category_id: args.category_id,
      },
      data: {
        accept_count: nextAccept,
        override_count: nextOverride,
        confidence_score,
        last_used_at: new Date(),
      },
    });
    return;
  }

  await args.prisma.categoryMemory.create({
    data: {
      business_id: args.business_id,
      merchant_normalized: args.merchant_normalized,
      direction: args.direction,
      category_id: args.category_id,
      accept_count: nextAccept,
      override_count: nextOverride,
      confidence_score,
      last_used_at: new Date(),
    },
  });
}

export async function writeCategoryMemoryFeedback(args: WriteCategoryMemoryFeedbackArgs) {
  const businessId = String(args.business_id ?? "").trim();
  const selectedCategoryId = String(args.selected_category_id ?? "").trim();
  const suggestedCategoryId = String(args.suggested_category_id ?? "").trim();

  if (!businessId || !selectedCategoryId) return;

  const merchant_normalized = normalizeMerchant(
    args.entry?.payee ?? "",
    args.entry?.memo ?? "",
  );

  if (!merchant_normalized) return;

  const amountCents = amountToBigInt(args.entry?.amount_cents);
  const direction = directionFromEntryTypeOrAmount(args.entry?.type, amountCents);

  await upsertMemoryRow({
    prisma: args.prisma,
    business_id: businessId,
    merchant_normalized,
    direction,
    category_id: selectedCategoryId,
    acceptIncrement: 1,
    overrideIncrement: 0,
  });

  if (suggestedCategoryId && suggestedCategoryId !== selectedCategoryId) {
    await upsertMemoryRow({
      prisma: args.prisma,
      business_id: businessId,
      merchant_normalized,
      direction,
      category_id: suggestedCategoryId,
      acceptIncrement: 0,
      overrideIncrement: 1,
    });
  }
}