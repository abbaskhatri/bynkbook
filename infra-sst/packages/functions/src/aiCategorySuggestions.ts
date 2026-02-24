import { getPrisma } from "./lib/db";

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

// -------------------------
// Simple in-memory TTL caches (best-effort; no DB scans)
// -------------------------
type CacheEntry<T> = { exp: number; value: T };
const historyCache = new Map<string, CacheEntry<any[]>>();
const categoriesCache = new Map<string, CacheEntry<Map<string, { id: string; name: string }>>>();

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

function normalizeText(s: any): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(s: any): string[] {
  const t = normalizeText(s);
  if (!t) return [];
  const raw = t.split(" ").map((x) => x.trim()).filter(Boolean);
  // Drop very short tokens and common noise
  const stop = new Set(["the", "and", "for", "with", "from", "to", "of", "llc", "inc", "co"]);
  return raw.filter((x) => x.length >= 2 && !stop.has(x));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const uni = a.size + b.size - inter;
  return uni ? inter / uni : 0;
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function pickTopK<T>(items: T[], k: number, score: (t: T) => number): T[] {
  const arr = [...items];
  arr.sort((x, y) => score(y) - score(x));
  return arr.slice(0, k);
}

type Suggestion = {
  category_id: string;
  category_name: string;
  confidence: number;
  reason: string;
  source: "HEURISTIC";
};

type InputItem = {
  kind: "BANK_TXN" | "ENTRY";
  id: string;
  date?: string;
  amount_cents?: string | number | bigint;
  payee_or_name?: string;
  memo?: string;
};

async function loadCategoryMap(prisma: any, businessId: string) {
  const cacheKey = `biz:${businessId}:cats:v1`;
  const cached = getCached(categoriesCache, cacheKey);
  if (cached) return cached;

  const rows = await prisma.category.findMany({
    where: { business_id: businessId, archived_at: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const m = new Map<string, { id: string; name: string }>();
  for (const r of rows) {
    const id = String(r?.id ?? "").trim();
    const name = String(r?.name ?? "").trim();
    if (id && name) m.set(id, { id, name });
  }

  setCached(categoriesCache, cacheKey, m, 10 * 60 * 1000);
  return m;
}

async function loadEntryHistory(prisma: any, businessId: string, accountId: string) {
  const cacheKey = `biz:${businessId}:acct:${accountId}:hist:v1`;
  const cached = getCached(historyCache, cacheKey);
  if (cached) return cached;

  // Keep it index-friendly + bounded
  const rows = await prisma.entry.findMany({
    where: {
      business_id: businessId,
      account_id: accountId,
      deleted_at: null,
      category_id: { not: null },
      // Income/Expense only for Phase 3/4+ correctness
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
    },
    orderBy: [{ date: "desc" }, { created_at: "desc" }],
    take: 1200,
  });

  setCached(historyCache, cacheKey, rows ?? [], 5 * 60 * 1000);
  return rows ?? [];
}

function buildSuggestions(args: {
  item: InputItem;
  categoryMap: Map<string, { id: string; name: string }>;
  history: any[];
  limit: number;
}): Suggestion[] {
  const limit = Math.max(1, Math.min(3, Number(args.limit) || 3));

  const text = `${args.item.payee_or_name ?? ""} ${args.item.memo ?? ""}`.trim();
  const tokens = new Set(tokenize(text));
  const rawPayee = normalizeText(args.item.payee_or_name);

  // Aggregate category scores
  const scoreByCat = new Map<string, number>();
  const exactPayeeCountByCat = new Map<string, number>();
  const overlapTokenSampleByCat = new Map<string, string[]>();

  // Sign-aware: avoid suggesting expense categories for income-like items (and vice versa)
  const itemSign = (() => {
    try {
      const v = args.item.amount_cents as any;
      const n = typeof v === "bigint" ? v : BigInt(String(v ?? "0"));
      if (n === 0n) return 0;
      return n < 0n ? -1 : 1;
    } catch {
      return 0;
    }
  })();

  // Baseline frequency fallback
  for (const r of args.history) {
    const catId = String(r?.category_id ?? "").trim();

    // If we know the current sign, only learn from history with the same sign.
    if (itemSign !== 0) {
      try {
        const hv = (r as any)?.amount_cents;
        const hn = typeof hv === "bigint" ? hv : BigInt(String(hv ?? "0"));
        const histSign = hn === 0n ? 0 : hn < 0n ? -1 : 1;
        if (histSign !== 0 && histSign !== itemSign) continue;
      } catch {
        // ignore and allow row
      }
    }
    if (!catId) continue;
    if (!args.categoryMap.has(catId)) continue;

    // base frequency
    scoreByCat.set(catId, (scoreByCat.get(catId) ?? 0) + 1);

    const hPayee = normalizeText(r?.payee);
    const hMemo = normalizeText(r?.memo);

    // exact-ish payee match boost
    if (rawPayee && hPayee && rawPayee === hPayee) {
      exactPayeeCountByCat.set(catId, (exactPayeeCountByCat.get(catId) ?? 0) + 1);
      scoreByCat.set(catId, (scoreByCat.get(catId) ?? 0) + 20);
      continue;
    }

    // token overlap boost
    if (tokens.size) {
      const hTokens = new Set(tokenize(`${hPayee} ${hMemo}`));
      const sim = jaccard(tokens, hTokens);
      if (sim > 0) {
        scoreByCat.set(catId, (scoreByCat.get(catId) ?? 0) + sim * 8);
        if (!overlapTokenSampleByCat.has(catId)) {
          const overlap = Array.from(tokens).filter((t) => hTokens.has(t)).slice(0, 4);
          if (overlap.length) overlapTokenSampleByCat.set(catId, overlap);
        }
      }
    }
  }

  // Convert to list
  const scored = Array.from(scoreByCat.entries())
    .map(([category_id, score]) => ({ category_id, score }))
    .filter((x) => x.score > 0 && args.categoryMap.has(x.category_id));

  if (scored.length === 0) return [];

  const top = pickTopK(scored, limit, (x) => x.score);

  // Confidence: normalize among top (cheap + stable)
  const sum = top.reduce((a, b) => a + b.score, 0) || 1;
  const max = top[0]?.score || 1;

  return top.map((t, idx) => {
    const name = args.categoryMap.get(t.category_id)?.name ?? "—";
    const freqHits = exactPayeeCountByCat.get(t.category_id) ?? 0;
    const overlap = overlapTokenSampleByCat.get(t.category_id) ?? [];

    let reason = "Based on your category history";
    if (freqHits > 0 && args.item.payee_or_name) {
      reason = `Matched your past “${String(args.item.payee_or_name).trim()}” entries (${freqHits}×)`;
    } else if (overlap.length) {
      reason = `Matched keywords: ${overlap.join(", ")}`;
    }

    const confRaw = t.score / max;
    const confAdj = idx === 0 ? confRaw : confRaw * 0.92;
    const confidence = clamp01(0.35 + confAdj * 0.55);

    return {
      category_id: t.category_id,
      category_name: name,
      confidence,
      reason,
      source: "HEURISTIC",
    };
  });
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

  const businessId = (event?.pathParameters?.businessId ?? "").toString().trim();
  if (!businessId) return json(400, { ok: false, error: "Missing businessId" });

  let body: any = {};
  try {
    body = event?.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const accountId = String(body?.accountId ?? "").trim();
  const itemsIn: unknown[] = Array.isArray(body?.items) ? body.items : [];
  const limitPerItem = Math.max(1, Math.min(3, Number(body?.limitPerItem ?? 3) || 3));

  if (!accountId) return json(400, { ok: false, error: "Missing accountId" });
  if (!itemsIn.length) return json(200, { ok: true, suggestionsById: {}, meta: { version: "catSug_v1" } });

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
    .filter((x: InputItem) => !!x.id);

  if (!items.length) return json(200, { ok: true, suggestionsById: {}, meta: { version: "catSug_v1" } });

  const prisma = await getPrisma();

  const role = await requireMembership(prisma, businessId, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  const categoryMap = await loadCategoryMap(prisma, businessId);
  const history = await loadEntryHistory(prisma, businessId, accountId);

  const suggestionsById: Record<string, Suggestion[]> = {};
  for (const it of items) {
    suggestionsById[it.id] = buildSuggestions({
      item: it,
      categoryMap,
      history,
      limit: limitPerItem,
    });
  }

  return json(200, {
    ok: true,
    suggestionsById,
    meta: { version: "catSug_v1", source: "HEURISTIC_ONLY" },
  });
}