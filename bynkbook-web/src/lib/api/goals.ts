import { apiFetch } from "./client";

export type GoalRow = {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  month_start: string; // YYYY-MM
  month_end: string | null; // YYYY-MM
  target_cents: string; // positive cents
  progress_cents: string; // positive abs cents (EXPENSE only)
  status: string; // ACTIVE | PAUSED | ARCHIVED
  created_at: string;
  updated_at: string;
};

export async function listGoals(businessId: string): Promise<{ ok: true; rows: GoalRow[] }> {
  return apiFetch(`/v1/businesses/${businessId}/goals`);
}

export async function createGoal(
  businessId: string,
  payload: {
    name: string;
    category_id: string;
    month_start: string; // YYYY-MM
    month_end?: string | null; // YYYY-MM or null
    target_cents: number;
    status?: string; // ACTIVE|PAUSED|ARCHIVED
  }
): Promise<{ ok: true; goal_id: string }> {
  return apiFetch(`/v1/businesses/${businessId}/goals`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function patchGoal(
  businessId: string,
  goalId: string,
  patch: Partial<{
    name: string;
    category_id: string;
    month_start: string;
    month_end: string | null;
    target_cents: number;
    status: string;
  }>
): Promise<{ ok: true; goal_id: string }> {
  return apiFetch(`/v1/businesses/${businessId}/goals/${goalId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
