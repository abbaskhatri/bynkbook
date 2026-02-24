import { apiFetch } from "./client";

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

export async function queryGlobalSearch(args: { businessId: string; accountId?: string; q: string; limit?: number }) {
  const { businessId, accountId, q, limit } = args;

  return apiFetch(`/v1/businesses/${encodeURIComponent(businessId)}/search/query`, {
    method: "POST",
    body: JSON.stringify({ q, accountId, limit }),
  });
}