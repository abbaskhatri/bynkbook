import { apiFetch } from "@/lib/api/client";

export type RolePolicyRow = {
  role: string;
  policy_json: Record<string, string>;
  updated_at: string;
  updated_by_user_id: string;
};

export async function getRolePolicies(businessId: string): Promise<{ items: RolePolicyRow[]; notEnforcedYet: boolean }> {
  return apiFetch(`/v1/businesses/${businessId}/role-policies`);
}

export async function upsertRolePolicy(
  businessId: string,
  role: string,
  policy_json: Record<string, string>
): Promise<{ item: RolePolicyRow; notEnforcedYet: boolean }> {
  return apiFetch(`/v1/businesses/${businessId}/role-policies/${encodeURIComponent(role)}`, {
    method: "PUT",
    body: JSON.stringify({ policy_json }),
  });
}
