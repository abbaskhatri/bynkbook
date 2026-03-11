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
  const stored = Number(row?.confidence_score ?? 0);
  if (Number.isFinite(stored) && stored > 0) {
    return clampInt(stored, 60, 99);
  }

  const accepts = Number(row?.accept_count ?? 0);
  const overrides = Number(row?.override_count ?? 0);
  const total = accepts + overrides;

  if (total <= 0) return 60;

  const ratio = accepts / Math.max(1, total);
  const volumeBoost = Math.min(12, accepts * 2);
  const penalty = Math.min(18, overrides * 3);

  return clampInt(68 + ratio * 18 + volumeBoost - penalty, 60, 99);
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

    next.push({
      category_id: cat.id,
      category_name: cat.name,
      confidence: computeConfidence(row),
      reason: "Learned from your accepted category history",
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