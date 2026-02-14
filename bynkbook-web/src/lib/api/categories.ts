import { apiFetch } from "./client";

export type CategoryRow = {
  id: string;
  name: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function listCategories(
  businessId: string,
  opts?: { includeArchived?: boolean }
): Promise<{ ok: true; rows: CategoryRow[] }> {
  const qs = new URLSearchParams({
    includeArchived: opts?.includeArchived ? "true" : "false",
  }).toString();
  return apiFetch(`/v1/businesses/${businessId}/categories?${qs}`);
}

export async function createCategory(businessId: string, name: string): Promise<{ ok: true; row: CategoryRow }> {
  return apiFetch(`/v1/businesses/${businessId}/categories`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function updateCategory(
  businessId: string,
  categoryId: string,
  patch: { name?: string; archived?: boolean }
): Promise<{ ok: true; row: CategoryRow }> {
  return apiFetch(`/v1/businesses/${businessId}/categories/${categoryId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteCategory(businessId: string, categoryId: string): Promise<{ ok: true }> {
  return apiFetch(`/v1/businesses/${businessId}/categories/${categoryId}`, {
    method: "DELETE",
  });
}
