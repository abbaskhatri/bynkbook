import type { CandidateCategory, Direction } from "./categoryMemory";
import { normalizeFreeText } from "./categoryMerchantNormalize";

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

export function buildHeuristicSuggestions(args: {
  item: HeuristicInputItem;
  categories: CandidateCategory[];
  history: HeuristicHistoryRow[];
  limit: number;
}) {
  const limit = clampSuggestionLimit(args.limit);
  const categoryById = new Map(args.categories.map((c) => [c.id, c]));
  const scoreByCat = new Map<string, number>();
  const reasonByCat = new Map<string, string>();

  const itemTokens = new Set(args.item.tokens ?? []);
  const itemMerchant = String(args.item.merchant_normalized ?? "").trim();

  for (const row of args.history ?? []) {
    const categoryId = String(row?.category_id ?? "").trim();
    if (!categoryId) continue;
    if (!categoryById.has(categoryId)) continue;
    if (historyDirection(row) !== args.item.direction) continue;

    let score = scoreByCat.get(categoryId) ?? 0;
    let reason = reasonByCat.get(categoryId) ?? "Matched your account history";

    score += 1.5;

    const rowMerchant = normalizeFreeText(row?.payee ?? "");
    const rowMemo = normalizeFreeText(row?.memo ?? "");
    const rowTokens = new Set(
      `${rowMerchant} ${rowMemo}`
        .trim()
        .split(" ")
        .map((x) => x.trim())
        .filter(Boolean)
    );

    if (itemMerchant && rowMerchant && itemMerchant === rowMerchant) {
      score += 18;
      reason = "Exact merchant match in account history";
    } else if (itemTokens.size && rowTokens.size) {
      const sim = jaccard(itemTokens, rowTokens);
      if (sim >= 0.6) {
        score += 10;
        reason = "Strong keyword match in account history";
      } else if (sim >= 0.3) {
        score += 5;
        reason = "Keyword overlap with account history";
      }
    }

    if (args.item.vendor_id && row?.vendor_id && String(args.item.vendor_id) === String(row.vendor_id)) {
      score += 8;
      reason = "Matched vendor-linked account history";
    }

    scoreByCat.set(categoryId, score);
    reasonByCat.set(categoryId, reason);
  }

  const scored = Array.from(scoreByCat.entries())
    .map(([category_id, score]) => ({
      category_id,
      category_name: categoryById.get(category_id)?.name ?? "—",
      score,
      reason: reasonByCat.get(category_id) ?? "Matched your account history",
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.category_name.localeCompare(b.category_name))
    .slice(0, limit);

  if (!scored.length) return [] as HeuristicSuggestion[];

  const topScore = scored[0]?.score ?? 1;

  return scored.map((row, index) => {
    const relative = row.score / Math.max(1, topScore);

    let confidence = 58 + relative * 22;
    if (row.reason.includes("Exact merchant match")) confidence += 10;
    if (row.reason.includes("vendor-linked")) confidence += 6;
    if (index > 0) confidence -= index * 5;

    return {
      category_id: row.category_id,
      category_name: row.category_name,
      confidence: clampInt(confidence, 60, 94),
      reason: row.reason,
    };
  });
}