import { apiFetch } from "./client";

export type BudgetRow = {
  category_id: string;
  category_name: string;
  budget_cents: string; // positive cents as string
  actual_cents: string; // positive abs cents as string (EXPENSE only)
};

export async function getBudgets(businessId: string, month: string): Promise<{ ok: true; month: string; rows: BudgetRow[] }> {
  const qs = new URLSearchParams({ month }).toString();
  return apiFetch(`/v1/businesses/${businessId}/budgets?${qs}`);
}

export async function putBudgets(
  businessId: string,
  month: string,
  updates: Array<{ category_id: string; budget_cents: number }>
): Promise<{ ok: true; month: string; results: Array<{ category_id: string; ok: boolean; error?: string }> }> {
  const qs = new URLSearchParams({ month }).toString();
  return apiFetch(`/v1/businesses/${businessId}/budgets?${qs}`, {
    method: "PUT",
    body: JSON.stringify({ updates }),
  });
}
