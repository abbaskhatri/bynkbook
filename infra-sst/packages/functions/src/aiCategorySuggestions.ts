import { getPrisma } from "./lib/db";
import { normalizeMerchant, tokenizeMerchantText } from "./lib/categoryMerchantNormalize";
import {
  buildCategoryMemoryMap,
  buildMemorySuggestion,
  directionFromEntryTypeOrAmount,
  type Direction,
  type CandidateCategory,
} from "./lib/categoryMemory";
import {
  buildHeuristicSuggestions,
  clampSuggestionLimit,
  confidenceTierFromScore,
  type HeuristicSuggestion,
} from "./lib/categorySuggestionScoring";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  };
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

async function requireAccountInBusiness(prisma: any, businessId: string, accountId: string) {
  const acct = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { id: true },
  });
  return !!acct;
}

type CacheEntry<T> = { exp: number; value: T };

const categoriesCache = new Map<string, CacheEntry<Array<{ id: string; name: string }>>>();
const vendorsCache = new Map<string, CacheEntry<Map<string, { id: string; name: string; default_category_id: string | null }>>>();
const historyCache = new Map<string, CacheEntry<any[]>>();
const memoryCache = new Map<string, CacheEntry<any[]>>();
const entrySnapshotCache = new Map<
  string,
  CacheEntry<Map<string, { id: string; type: string; vendor_id: string | null; payee: string; memo: string }>>
>();
const aiBatchCache = new Map<string, CacheEntry<Record<string, Suggestion[]>>>();

function nowMs() {
  return Date.now();
}

function getCached<T>(m: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = m.get(key);
  if (!hit) return null;
  if (hit.exp <= nowMs()) {
    m.delete(key);
    return null;
  }
  return hit.value;
}

function setCached<T>(m: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  m.set(key, { exp: nowMs() + ttlMs, value });
}

function shortText(v: any, max = 140) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 3)).trim()}...`;
}

function safeJsonParse(s: any) {
  try {
    return JSON.parse(String(s ?? ""));
  } catch {
    return null;
  }
}

function parseJsonModelOutput(raw: string) {
  const txt = String(raw ?? "").trim();
  const unfenced = txt.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  return safeJsonParse(unfenced) ?? safeJsonParse(txt) ?? {};
}

function clampPercent(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n);
}

function amountToBigInt(v: any): bigint {
  try {
    if (typeof v === "bigint") return v;
    return BigInt(String(v ?? "0"));
  } catch {
    return 0n;
  }
}

let cachedApiKey: string | null = null;
let cachedModel: string | null = null;

async function getSecretString(secretId: string) {
  const region = process.env.AWS_REGION || "us-east-1";
  const sm = new SecretsManagerClient({ region });
  const res = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!res.SecretString) throw new Error(`SecretString is empty for ${secretId}`);

  const raw = String(res.SecretString ?? "");

  try {
    const obj: any = JSON.parse(raw);
    if (obj && typeof obj === "object" && typeof obj.value === "string" && obj.value.trim()) {
      return obj.value;
    }
  } catch {
    // ignore non-json secret
  }

  return raw;
}

async function getOpenAiConfig() {
  const keyId = process.env.OPENAI_API_KEY_SECRET_ID;
  const modelId = process.env.OPENAI_MODEL_SECRET_ID;

  if (!keyId) throw new Error("Missing env OPENAI_API_KEY_SECRET_ID");
  if (!modelId) throw new Error("Missing env OPENAI_MODEL_SECRET_ID");

  if (!cachedApiKey) cachedApiKey = (await getSecretString(keyId)).trim();
  if (!cachedModel) cachedModel = (await getSecretString(modelId)).trim();

  if (!cachedApiKey) throw new Error("OpenAI API key is empty");
  if (!cachedModel) throw new Error("OpenAI model is empty");

  return { apiKey: cachedApiKey, model: cachedModel };
}

async function openAiText(args: {
  model: string;
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
}) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      messages: [
        { role: "system", content: args.system },
        { role: "user", content: args.user },
      ],
      temperature: 0.2,
      max_tokens: args.maxTokens,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`OpenAI error ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data: any = await res.json();
  const out = data?.choices?.[0]?.message?.content ?? "";
  return String(out ?? "").trim();
}

type SuggestionSource = "VENDOR_DEFAULT" | "MEMORY" | "HEURISTIC" | "AI";

export type CategorySuggestion = {
  category_id: string;
  category_name: string;
  confidence: number;
  confidence_tier: "SAFE_DETERMINISTIC" | "STRONG_SUGGESTION" | "ALTERNATE" | "REVIEW_BUCKET";
  reason: string;
  source: SuggestionSource;
  merchant_normalized: string;
};

type Suggestion = CategorySuggestion;

type DeterministicStrength = {
  topConfidence: number;
  secondConfidence: number;
  gap: number;
  strength: number;
  strongReason: boolean;
  weakReason: boolean;
};

export type CategorySuggestionInputItem = {
  kind: "BANK_TXN" | "ENTRY";
  id: string;
  date?: string;
  amount_cents?: string | number | bigint;
  payee_or_name?: string;
  memo?: string;
};

type InputItem = CategorySuggestionInputItem;

type ResolvedItem = InputItem & {
  type?: string;
  vendor_id?: string | null;
  merchant_normalized: string;
  direction: Direction;
};

async function loadCategories(prisma: any, businessId: string): Promise<CandidateCategory[]> {
  const cacheKey = `biz:${businessId}:cats:v2`;
  const cached = getCached(categoriesCache, cacheKey);
  if (cached) return cached;

  const rows = await prisma.category.findMany({
    where: { business_id: businessId, archived_at: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const out: CandidateCategory[] = (rows ?? []).map((r: any) => ({
    id: String(r.id),
    name: String(r.name),
  }));
  setCached(categoriesCache, cacheKey, out, 10 * 60 * 1000);
  return out;
}

async function loadVendors(prisma: any, businessId: string) {
  const cacheKey = `biz:${businessId}:vendors:v2`;
  const cached = getCached(vendorsCache, cacheKey);
  if (cached) return cached;

  const rows = await prisma.vendor.findMany({
    where: { business_id: businessId },
    select: { id: true, name: true, default_category_id: true },
    orderBy: { updated_at: "desc" },
  });

  const out = new Map<string, { id: string; name: string; default_category_id: string | null }>();
  for (const row of rows ?? []) {
    out.set(String(row.id), {
      id: String(row.id),
      name: String(row.name ?? ""),
      default_category_id: row?.default_category_id ? String(row.default_category_id) : null,
    });
  }

  setCached(vendorsCache, cacheKey, out, 5 * 60 * 1000);
  return out;
}

async function loadBusinessMemory(prisma: any, businessId: string) {
  const cacheKey = `biz:${businessId}:category-memory:v1`;
  const cached = getCached(memoryCache, cacheKey);
  if (cached) return cached;

  const rows = await prisma.categoryMemory.findMany({
    where: { business_id: businessId },
    select: {
      business_id: true,
      merchant_normalized: true,
      direction: true,
      category_id: true,
      accept_count: true,
      override_count: true,
      last_used_at: true,
      confidence_score: true,
    },
    orderBy: [
      { confidence_score: "desc" },
      { accept_count: "desc" },
      { last_used_at: "desc" },
    ],
    take: 5000,
  });

  setCached(memoryCache, cacheKey, rows ?? [], 3 * 60 * 1000);
  return rows ?? [];
}

async function loadEntrySnapshots(prisma: any, businessId: string, itemIds: string[]) {
  const ids = Array.from(new Set(itemIds.map((x) => String(x).trim()).filter(Boolean)));
  const key = `biz:${businessId}:entry-snapshots:${ids.sort().join(",")}`;
  const cached = getCached(entrySnapshotCache, key);
  if (cached) return cached;

  const rows = ids.length
    ? await prisma.entry.findMany({
        where: { business_id: businessId, id: { in: ids }, deleted_at: null },
        select: { id: true, type: true, vendor_id: true, payee: true, memo: true },
      })
    : [];

  const map = new Map<string, { id: string; type: string; vendor_id: string | null; payee: string; memo: string }>();
  for (const row of rows ?? []) {
    map.set(String(row.id), {
      id: String(row.id),
      type: String(row.type ?? ""),
      vendor_id: row?.vendor_id ? String(row.vendor_id) : null,
      payee: String(row?.payee ?? ""),
      memo: String(row?.memo ?? ""),
    });
  }

  setCached(entrySnapshotCache, key, map, 60 * 1000);
  return map;
}

async function loadAccountHistory(prisma: any, businessId: string, accountId: string) {
  const cacheKey = `biz:${businessId}:acct:${accountId}:hist:v2`;
  const cached = getCached(historyCache, cacheKey);
  if (cached) return cached;

  const rows = await prisma.entry.findMany({
    where: {
      business_id: businessId,
      account_id: accountId,
      deleted_at: null,
      category_id: { not: null },
      type: { in: ["INCOME", "EXPENSE"] },
    },
    select: {
      id: true,
      date: true,
      payee: true,
      memo: true,
      vendor_id: true,
      category_id: true,
      amount_cents: true,
      type: true,
    },
    orderBy: [{ date: "desc" }, { created_at: "desc" }],
    take: 1200,
  });

  setCached(historyCache, cacheKey, rows ?? [], 5 * 60 * 1000);
  return rows ?? [];
}

function buildVendorDefaultSuggestion(args: {
  categoryById: Map<string, CandidateCategory>;
  vendor: { id: string; name: string; default_category_id: string | null } | null;
  merchant_normalized: string;
}) {
  const categoryId = args.vendor?.default_category_id ? String(args.vendor.default_category_id) : "";
  if (!categoryId) return [] as Suggestion[];

  const cat = args.categoryById.get(categoryId);
  if (!cat) return [] as Suggestion[];

  return [
    {
      category_id: cat.id,
      category_name: cat.name,
      confidence: 95,
      confidence_tier: confidenceTierFromScore(95),
      reason: `Vendor default category${args.vendor?.name ? ` for ${shortText(args.vendor.name, 60)}` : ""}`,
      source: "VENDOR_DEFAULT" as const,
      merchant_normalized: args.merchant_normalized,
    },
  ];
}

function dedupeSuggestions(items: Suggestion[], limit: number) {
  const seen = new Set<string>();
  const out: Suggestion[] = [];

  for (const item of items) {
    const id = String(item?.category_id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
    if (out.length >= limit) break;
  }

  return out;
}

function computeDeterministicStrength(args: {
  memorySuggestions: Suggestion[];
  heuristicSuggestions: Suggestion[];
}): DeterministicStrength {
  const topMemory = args.memorySuggestions?.[0];
  const topHeuristic = args.heuristicSuggestions?.[0];

  const topConfidence = Math.max(
    Number(topMemory?.confidence ?? 0),
    Number(topHeuristic?.confidence ?? 0)
  );

  const secondConfidence = Math.max(
    Number(args.memorySuggestions?.[1]?.confidence ?? 0),
    Number(args.heuristicSuggestions?.[1]?.confidence ?? 0),
    Number(topMemory && topHeuristic ? Math.min(topMemory.confidence, topHeuristic.confidence) : 0)
  );

  const gap = Math.max(0, topConfidence - secondConfidence);
  const topReason = String(topMemory?.reason || topHeuristic?.reason || "").toLowerCase();

  const strongReason =
    topReason.includes("exact merchant") ||
    topReason.includes("vendor-linked") ||
    topReason.includes("tax-related") ||
    topReason.includes("payroll-related") ||
    topReason.includes("accepted category history");

  const weakReason =
    topReason.includes("similar merchant") ||
    topReason.includes("keyword overlap") ||
    topReason.includes("account history");

  let strength = topConfidence;

  if (strongReason) strength += 4;
  if (weakReason && !strongReason) strength -= 4;
  if (gap >= 12) strength += 4;
  else if (gap <= 4) strength -= 6;

  return {
    topConfidence,
    secondConfidence,
    gap,
    strength,
    strongReason,
    weakReason,
  };
}

function shouldRunAiFallback(args: {
  deterministic: Suggestion[];
  memorySuggestions: Suggestion[];
  heuristicSuggestions: Suggestion[];
}) {
  const top = args.deterministic?.[0];
  if (!top) return true;
  if (top.source === "VENDOR_DEFAULT") return false;

  const strength = computeDeterministicStrength({
    memorySuggestions: args.memorySuggestions,
    heuristicSuggestions: args.heuristicSuggestions,
  });

  if (strength.strength < 82) return true;
  if (strength.topConfidence < 85) return true;

  const source = String(top.source ?? "").toUpperCase();
  if (source === "MEMORY" && strength.gap <= 5 && !strength.strongReason) {
    return true;
  }

  if (source === "HEURISTIC" && strength.gap <= 4 && !strength.strongReason) {
    return true;
  }

  return false;
}

function sortAndNormalizeMergedSuggestions(items: Suggestion[], limit: number) {
  const sorted = dedupeSuggestions(
    [...items].sort((a, b) => b.confidence - a.confidence || a.category_name.localeCompare(b.category_name)),
    limit
  );

  return sorted.map((row, index) => {
    let confidence = row.confidence;

    if (row.source === "AI") {
      confidence = Math.max(60, Math.min(84, confidence));
    }

    if (index > 0 && confidence >= sorted[0].confidence) {
      confidence = Math.max(60, sorted[0].confidence - 2 - index);
    }

    return {
      ...row,
      confidence,
      confidence_tier: confidenceTierFromScore(confidence),
    } satisfies Suggestion;
  });
}

function mapHeuristicToSuggestions(args: {
  heuristics: HeuristicSuggestion[];
  merchant_normalized: string;
  limit: number;
}) {
  return dedupeSuggestions(
    (args.heuristics ?? []).slice(0, args.limit).map((h) => ({
      category_id: h.category_id,
      category_name: h.category_name,
      confidence: h.confidence,
      confidence_tier: confidenceTierFromScore(h.confidence),
      reason: h.reason,
      source: "HEURISTIC" as const,
      merchant_normalized: args.merchant_normalized,
    })),
    args.limit
  );
}

async function runAiFallback(args: {
  businessId: string;
  items: Array<{
    id: string;
    merchant_normalized: string;
    direction: Direction;
    payee_or_name: string;
    memo: string;
    amount_cents: string;
    topDeterministic: Suggestion[];
  }>;
  categories: CandidateCategory[];
  limitPerItem: number;
}) {
  if (!args.items.length) return {} as Record<string, Suggestion[]>;

  const cacheKey = JSON.stringify({
    businessId: args.businessId,
    limitPerItem: args.limitPerItem,
    categories: args.categories.map((c) => [c.id, c.name]),
    items: args.items.map((x) => ({
      id: x.id,
      merchant_normalized: x.merchant_normalized,
      direction: x.direction,
      payee_or_name: x.payee_or_name,
      memo: x.memo,
      amount_cents: x.amount_cents,
      topDeterministic: x.topDeterministic.map((s) => [s.category_id, s.confidence]),
    })),
  });

  const cached = getCached(aiBatchCache, cacheKey);
  if (cached) return cached;

  const { apiKey, model } = await getOpenAiConfig();

  const system = [
    "You rank bookkeeping category suggestions.",
    "Return strict JSON only.",
    "Do not invent categories.",
    "Only use category_id values supplied in the categories array.",
    "Prefer deterministic candidates when they fit.",
    "This fallback is only for ambiguous rows, so confidence must stay between 60 and 84.",
    "Keep each reason short and concrete.",
  ].join(" ");

  const user = JSON.stringify(
    {
      task: "Rank category suggestions for ambiguous bookkeeping rows.",
      output_format: {
        items: [
          {
            id: "row-id",
            suggestions: [
              {
                category_id: "uuid",
                confidence: 72,
                reason: "short explanation",
              },
            ],
          },
        ],
      },
      categories: args.categories,
      items: args.items.map((item) => ({
        id: item.id,
        merchant_normalized: item.merchant_normalized,
        direction: item.direction,
        payee_or_name: item.payee_or_name,
        memo: item.memo,
        amount_cents: item.amount_cents,
        deterministic_candidates: item.topDeterministic.map((s) => ({
          category_id: s.category_id,
          category_name: s.category_name,
          confidence: s.confidence,
          reason: s.reason,
        })),
      })),
    },
    null,
    2
  );

  const raw = await openAiText({
    model,
    apiKey,
    system,
    user,
    maxTokens: 1200,
  });

  const parsed: any = parseJsonModelOutput(raw);
  const itemMap = new Map<string, Suggestion[]>();
  const categoryById: Map<string, CandidateCategory> = new Map<string, CandidateCategory>(
    args.categories.map((c): [string, CandidateCategory] => [c.id, c])
  );

  for (const row of Array.isArray(parsed?.items) ? parsed.items : []) {
    const id = String(row?.id ?? "").trim();
    if (!id) continue;

    const suggestions: Suggestion[] = [];

    for (const s of Array.isArray(row?.suggestions) ? row.suggestions : []) {
      const categoryId = String(s?.category_id ?? "").trim();
      if (!categoryId) continue;

      const cat = categoryById.get(categoryId);
      if (!cat) continue;

      const confidence = Math.max(60, Math.min(84, clampPercent(s?.confidence)));

      suggestions.push({
        category_id: cat.id,
        category_name: cat.name,
        confidence,
        confidence_tier: confidenceTierFromScore(confidence),
        reason: shortText(s?.reason || "AI ranked this category for this merchant and memo.", 140),
        source: "AI",
        merchant_normalized: "",
      });
    }

    if (suggestions.length) {
      itemMap.set(id, dedupeSuggestions(suggestions, args.limitPerItem));
    }
  }

  const out: Record<string, Suggestion[]> = {};
  for (const item of args.items) {
    out[item.id] = (itemMap.get(item.id) ?? []).map((s) => ({
      ...s,
      merchant_normalized: item.merchant_normalized,
    }));
  }

  setCached(aiBatchCache, cacheKey, out, 15 * 60 * 1000);
  return out;
}

export async function computeCategorySuggestionsForItems(args: {
  prisma: any;
  businessId: string;
  accountId: string;
  items: InputItem[];
  limitPerItem?: number;
  includeAiFallback?: boolean;
}) {
  const businessId = String(args.businessId ?? "").trim();
  const accountId = String(args.accountId ?? "").trim();
  const limitPerItem = clampSuggestionLimit(args.limitPerItem ?? 3);
  const items = (args.items ?? []).slice(0, 200).filter((x) => !!String(x?.id ?? "").trim());

  if (!businessId || !accountId || !items.length) {
    return {
      suggestionsById: {} as Record<string, Suggestion[]>,
      meta: { version: "catSug_v2", source: "CATEGORY_INTELLIGENCE_ENGINE", aiBatchCap: 25, aiRequestedRows: 0 },
    };
  }

  const [categories, vendorsById, history, memoryRows, entrySnapshots] = await Promise.all([
    loadCategories(args.prisma, businessId),
    loadVendors(args.prisma, businessId),
    loadAccountHistory(args.prisma, businessId, accountId),
    loadBusinessMemory(args.prisma, businessId),
    loadEntrySnapshots(
      args.prisma,
      businessId,
      items.filter((x) => x.kind === "ENTRY").map((x) => x.id)
    ),
  ]);

  const categoryById: Map<string, CandidateCategory> = new Map<string, CandidateCategory>(
    categories.map((c): [string, CandidateCategory] => [c.id, c])
  );
  const memoryMap = buildCategoryMemoryMap(memoryRows, categoryById);

  const resolvedItems: ResolvedItem[] = items.map((it) => {
    const snap = it.kind === "ENTRY" ? entrySnapshots.get(it.id) : null;

    const payee = String(it.payee_or_name ?? snap?.payee ?? "");
    const memo = String(it.memo ?? snap?.memo ?? "");
    const amount = amountToBigInt(it.amount_cents);
    const direction = directionFromEntryTypeOrAmount(snap?.type, amount);
    const merchantNormalized = normalizeMerchant(payee, memo);

    return {
      ...it,
      payee_or_name: payee,
      memo,
      amount_cents: amount,
      type: snap?.type,
      vendor_id: snap?.vendor_id ?? null,
      merchant_normalized: merchantNormalized,
      direction,
    };
  });

  const suggestionsById: Record<string, Suggestion[]> = {};
  const aiEligible: Array<{
    id: string;
    merchant_normalized: string;
    direction: Direction;
    payee_or_name: string;
    memo: string;
    amount_cents: string;
    topDeterministic: Suggestion[];
  }> = [];

  for (const it of resolvedItems) {
    const vendor = it.vendor_id ? vendorsById.get(String(it.vendor_id)) ?? null : null;

    const vendorDefault = buildVendorDefaultSuggestion({
      categoryById,
      vendor,
      merchant_normalized: it.merchant_normalized,
    });

    const memorySuggestions = buildMemorySuggestion({
      memoryMap,
      merchant_normalized: it.merchant_normalized,
      direction: it.direction,
      limit: limitPerItem,
    }).map((s) => ({
      category_id: s.category_id,
      category_name: s.category_name,
      confidence: s.confidence,
      confidence_tier: confidenceTierFromScore(s.confidence),
      reason: s.reason,
      source: "MEMORY" as const,
      merchant_normalized: it.merchant_normalized,
    }));

    const heuristicSuggestions = buildHeuristicSuggestions({
      item: {
        id: it.id,
        merchant_normalized: it.merchant_normalized,
        payee_or_name: String(it.payee_or_name ?? ""),
        memo: String(it.memo ?? ""),
        vendor_id: it.vendor_id ?? null,
        direction: it.direction,
        amount_cents: amountToBigInt(it.amount_cents),
        tokens: tokenizeMerchantText(it.payee_or_name, it.memo),
      },
      categories,
      history,
      limit: limitPerItem,
    });

    const mappedHeuristics = mapHeuristicToSuggestions({
      heuristics: heuristicSuggestions,
      merchant_normalized: it.merchant_normalized,
      limit: limitPerItem,
    });

    const deterministic = sortAndNormalizeMergedSuggestions(
      [...vendorDefault, ...memorySuggestions, ...mappedHeuristics],
      limitPerItem
    );

    suggestionsById[it.id] = deterministic;

    if (
      args.includeAiFallback !== false &&
      aiEligible.length < 25 &&
      shouldRunAiFallback({
        deterministic,
        memorySuggestions,
        heuristicSuggestions: mappedHeuristics,
      })
    ) {
      aiEligible.push({
        id: it.id,
        merchant_normalized: it.merchant_normalized,
        direction: it.direction,
        payee_or_name: String(it.payee_or_name ?? ""),
        memo: String(it.memo ?? ""),
        amount_cents: String(it.amount_cents ?? "0"),
        topDeterministic: deterministic.slice(0, 3),
      });
    }
  }

  if (aiEligible.length) {
    try {
      const aiById = await runAiFallback({
        businessId,
        items: aiEligible,
        categories,
        limitPerItem,
      });

      for (const item of aiEligible) {
        const aiSuggestions = Array.isArray(aiById[item.id]) ? aiById[item.id] : [];
        if (!aiSuggestions.length) continue;

        suggestionsById[item.id] = sortAndNormalizeMergedSuggestions(
          [...(suggestionsById[item.id] ?? []), ...aiSuggestions],
          limitPerItem
        );
      }
    } catch {
      // keep deterministic fallback only
    }
  }

  return {
    suggestionsById,
    meta: {
      version: "catSug_v2",
      source: "CATEGORY_INTELLIGENCE_ENGINE",
      aiBatchCap: 25,
      aiRequestedRows: aiEligible.length,
    },
  };
}

/**
 * POST /v1/businesses/{businessId}/ai/category-suggestions
 * Body:
 * {
 *   accountId: string,
 *   items: [{ kind, id, date?, amount_cents?, payee_or_name?, memo? }],
 *   limitPerItem?: number
 * }
 */
export async function handler(event: any) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = String(event?.pathParameters?.businessId ?? "").trim();
  if (!businessId) return json(400, { ok: false, error: "Missing businessId" });

  let body: any = {};
  try {
    body = event?.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const accountId = String(body?.accountId ?? "").trim();
  const itemsIn: unknown[] = Array.isArray(body?.items) ? body.items : [];
  const limitPerItem = clampSuggestionLimit(body?.limitPerItem ?? 3);

  if (!accountId) return json(400, { ok: false, error: "Missing accountId" });
  if (!itemsIn.length) {
    return json(200, { ok: true, suggestionsById: {}, meta: { version: "catSug_v2" } });
  }

  const items: InputItem[] = itemsIn
    .slice(0, 200)
    .map((x: any): InputItem => {
      const k = String(x?.kind ?? "").toUpperCase();
      const kind: "BANK_TXN" | "ENTRY" = k === "BANK_TXN" ? "BANK_TXN" : "ENTRY";

      return {
        kind,
        id: String(x?.id ?? "").trim(),
        date: x?.date ? String(x.date).trim() : undefined,
        amount_cents: x?.amount_cents,
        payee_or_name: x?.payee_or_name ? String(x.payee_or_name) : "",
        memo: x?.memo ? String(x.memo) : "",
      };
    })
    .filter((x) => !!x.id);

  if (!items.length) {
    return json(200, { ok: true, suggestionsById: {}, meta: { version: "catSug_v2" } });
  }

  const prisma = await getPrisma();

  const role = await requireMembership(prisma, businessId, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  const computed = await computeCategorySuggestionsForItems({
    prisma,
    businessId,
    accountId,
    items,
    limitPerItem,
  });

  return json(200, { ok: true, suggestionsById: computed.suggestionsById, meta: computed.meta });
}
