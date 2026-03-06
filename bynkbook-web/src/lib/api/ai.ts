import { apiFetch } from "./client";

export async function queryGlobalSearch(args: { businessId: string; accountId?: string; q: string; limit?: number }) {
  const { businessId, accountId, q, limit } = args;

  return apiFetch(`/v1/businesses/${encodeURIComponent(businessId)}/search/query`, {
    method: "POST",
    body: JSON.stringify({ q, accountId, limit }),
  });
}

export async function getCategorySuggestions(args: {
  businessId: string;
  accountId: string;
  items: Array<{
    kind: "BANK_TXN" | "ENTRY";
    id: string;
    date?: string;
    amount_cents?: string | number;
    payee_or_name?: string;
    memo?: string;
  }>;
  limitPerItem?: number;
}) {
  const { businessId, accountId, items, limitPerItem } = args;

  return apiFetch(`/v1/businesses/${encodeURIComponent(businessId)}/ai/category-suggestions`, {
    method: "POST",
    body: JSON.stringify({
      accountId,
      items,
      limitPerItem: limitPerItem ?? 3,
    }),
  });
}

export async function applyCategoryBatch(args: {
  businessId: string;
  accountId: string;
  items: Array<{ entryId: string; category_id: string }>;
}) {
  const { businessId, accountId, items } = args;

  return apiFetch(
    `/v1/businesses/${encodeURIComponent(businessId)}/accounts/${encodeURIComponent(accountId)}/entries/apply-category-batch`,
    {
      method: "POST",
      body: JSON.stringify({ items }),
    }
  );
}

export async function getDashboardInsights(args: { businessId: string; from?: string; to?: string }) {
  const { businessId, from, to } = args;
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);

  const q = qs.toString();
  return apiFetch(`/v1/businesses/${encodeURIComponent(businessId)}/insights/dashboard${q ? `?${q}` : ""}`, {
    method: "GET",
  });
}

// ---------- Bundle E AI surfaces (LLM) ----------
export async function aiExplainEntry(args: { businessId: string; entryId: string }) {
  const { businessId, entryId } = args;
  return apiFetch(`/v1/ai/explain-entry`, {
    method: "POST",
    body: JSON.stringify({ businessId, entryId }),
  });
}

export async function aiExplainReport(args: { businessId: string; reportTitle: string; period?: any; summary?: any }) {
  const { businessId, reportTitle, period, summary } = args;
  return apiFetch(`/v1/ai/explain-report`, {
    method: "POST",
    body: JSON.stringify({ businessId, reportTitle, period, summary }),
  });
}

export async function aiSuggestCategory(args: {
  businessId: string;
  accountId: string;
  items: Array<{
    id: string;
    date?: string;
    amount_cents?: string | number;
    payee_or_name?: string;
    memo?: string;
  }>;
  limitPerItem?: number;
}) {
  const { businessId, accountId, items, limitPerItem } = args;
  return apiFetch(`/v1/ai/suggest-category`, {
    method: "POST",
    body: JSON.stringify({ businessId, accountId, items, limitPerItem: limitPerItem ?? 3 }),
  });
}

export async function aiSuggestReconcileBank(args: {
  businessId: string;
  bankTransaction: {
    id: string;
    posted_date?: string;
    amount_cents?: string | number;
    name?: string;
  };
  candidates: Array<{
    entryId: string;
    date?: string;
    amount_cents?: string | number;
    payee?: string;
    amount_delta_cents?: string | number;
    date_delta_days?: number;
    text_similarity?: number;
    exact_amount?: boolean;
    heuristic_score?: number;
  }>;
}) {
  const { businessId, bankTransaction, candidates } = args;
  return apiFetch(`/v1/ai/suggest-reconcile-bank`, {
    method: "POST",
    body: JSON.stringify({ businessId, bankTransaction, candidates }),
  });
}

export async function aiSuggestReconcileEntry(args: {
  businessId: string;
  entry: {
    id: string;
    date?: string;
    amount_cents?: string | number;
    payee?: string;
  };
  candidates: Array<{
    bankTransactionId: string;
    posted_date?: string;
    amount_cents?: string | number;
    name?: string;
    amount_delta_cents?: string | number;
    date_delta_days?: number;
    text_similarity?: number;
    exact_amount?: boolean;
    heuristic_score?: number;
  }>;
}) {
  const { businessId, entry, candidates } = args;
  return apiFetch(`/v1/ai/suggest-reconcile-entry`, {
    method: "POST",
    body: JSON.stringify({ businessId, entry, candidates }),
  });
}

export async function aiChat(args: { businessId: string; question: string; accountId?: string; from?: string; to?: string }) {
  const { businessId, question, accountId, from, to } = args;
  return apiFetch(`/v1/ai/chat`, {
    method: "POST",
    body: JSON.stringify({ businessId, question, accountId, from, to }),
  });
}

export async function aiAnomalies(args: { businessId: string; accountId?: string; from?: string; to?: string }) {
  const { businessId, accountId, from, to } = args;
  return apiFetch(`/v1/ai/anomalies`, {
    method: "POST",
    body: JSON.stringify({ businessId, accountId, from, to }),
  });
}

export async function aiMerchantNormalize(args: { businessId: string; payee: string; memo?: string }) {
  const { businessId, payee, memo } = args;
  return apiFetch(`/v1/ai/merchant-normalize`, {
    method: "POST",
    body: JSON.stringify({ businessId, payee, memo }),
  });
}

// Aggregates-only chat (F4)
export async function aiChatAggregates(args: { businessId: string; question: string; aggregates: any }) {
  const { businessId, question, aggregates } = args;
  return apiFetch(`/v1/ai/chat`, {
    method: "POST",
    body: JSON.stringify({ businessId, question, aggregates }),
  });
}