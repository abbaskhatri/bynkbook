import type { RolePolicyRow } from "@/lib/api/rolePolicies";

/**
 * Phase 7.2B: Frontend hint-only permission checks.
 * Backend remains the source of truth; this only disables UI actions to reduce avoidable 403s.
 */

export type PolicyValue = "NONE" | "VIEW" | "FULL";
export type PolicyValueOrUnknown = PolicyValue | null;

export function normalizePolicyValue(v: unknown): PolicyValueOrUnknown {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "NONE" || s === "VIEW" || s === "FULL") return s;
  return null;
}

/**
 * Returns the stored policy value for a given business role + key.
 * - If the role row is missing, returns null (unknown) so we do NOT block UI unnecessarily.
 */
export function getRolePolicyValue(
  rows: RolePolicyRow[] | null | undefined,
  businessRole: string | null | undefined,
  policyKey: string
): PolicyValueOrUnknown {
  const role = String(businessRole ?? "").trim().toUpperCase();
  if (!role) return null;

  const key = String(policyKey ?? "").trim();
  if (!key) return null;

  const list = rows ?? [];
  const row = list.find((r) => String(r.role ?? "").trim().toUpperCase() === role);
  if (!row) return null;

  const raw = (row.policy_json ?? {})[key];
  return normalizePolicyValue(raw);
}

/**
 * Returns true/false when the policy is known; otherwise returns null (unknown).
 * Rule: write requires FULL.
 */
export function canWriteByRolePolicy(
  rows: RolePolicyRow[] | null | undefined,
  businessRole: string | null | undefined,
  policyKey: string
): boolean | null {
  const v = getRolePolicyValue(rows, businessRole, policyKey);
  if (v === null) return null; // unknown => do not block UI
  return v === "FULL";
}
