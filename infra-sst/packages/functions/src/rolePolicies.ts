import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import {
  authorizeWrite,
  defaultRolePolicyFor,
  ROLE_POLICY_KEYS,
  ROLE_POLICY_ROLES,
  type PolicyValue,
} from "./lib/authz";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function pp(event: any) {
  return event?.pathParameters ?? {};
}

function getPath(event: any) {
  return String(event?.requestContext?.http?.path ?? "");
}

const ROLE_ALLOWLIST = new Set(ROLE_POLICY_ROLES);
const ACCESS_ALLOWLIST = new Set<PolicyValue>(["NONE", "VIEW", "FULL"]);
const PERM_KEY_SET = new Set<string>(ROLE_POLICY_KEYS);

const WRITE_ROLES = new Set(["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"]);
function canWrite(role: string | null | undefined) {
  return !!role && WRITE_ROLES.has(String(role).toUpperCase());
}
function isOwner(role: string | null | undefined) {
  return String(role ?? "").toUpperCase() === "OWNER";
}

async function getMyRole(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

function normalizeRole(input: string) {
  const r = String(input ?? "").trim().toUpperCase();
  if (!ROLE_ALLOWLIST.has(r)) return null;
  return r;
}

function normalizePolicyValue(input: any): PolicyValue | null {
  const vv = String(input ?? "").trim().toUpperCase() as PolicyValue;
  if (!ACCESS_ALLOWLIST.has(vv)) return null;
  return vv;
}

function validatePolicyPatch(input: any): { ok: true; patch: Record<string, PolicyValue> } | { ok: false; error: string; code: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "policy_json must be an object", code: "INVALID_POLICY_JSON" };
  }

  const patch: Record<string, PolicyValue> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!PERM_KEY_SET.has(k)) {
      return { ok: false, error: `Unknown policy key: ${k}`, code: "UNKNOWN_POLICY_KEY" };
    }
    const vv = normalizePolicyValue(v);
    if (!vv) {
      return { ok: false, error: `Invalid policy value for ${k}`, code: "INVALID_POLICY_VALUE" };
    }
    patch[k] = vv;
  }

  return { ok: true, patch };
}

function storedPolicyOverrides(input: any): Record<string, PolicyValue> {
  const out: Record<string, PolicyValue> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;

  for (const [k, v] of Object.entries(input)) {
    if (!PERM_KEY_SET.has(k)) continue;
    const vv = normalizePolicyValue(v);
    if (!vv) continue;
    out[k] = vv;
  }

  return out;
}

function mergePolicy(targetRole: string, storedPolicy: any, patch: Record<string, PolicyValue>) {
  return {
    ...defaultRolePolicyFor(targetRole),
    ...storedPolicyOverrides(storedPolicy),
    ...patch,
  };
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method ?? "GET";
  const path = getPath(event);

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "", role = "" } = pp(event);
  const biz = String(businessId ?? "").trim();
  if (!biz) return json(400, { ok: false, error: "Missing businessId" });

  const prisma = await getPrisma();
  const myRole = await getMyRole(prisma, biz, sub);
  if (!myRole) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  // GET /v1/businesses/{businessId}/role-policies (member-readable)
  if (method === "GET" && path === `/v1/businesses/${biz}/role-policies`) {
    const rows = await prisma.businessRolePolicy.findMany({
      where: { business_id: biz },
      select: { role: true, policy_json: true, updated_at: true, updated_by_user_id: true },
      orderBy: [{ role: "asc" }],
    });

    const byRole = new Map(rows.map((row: any) => [String(row.role).toUpperCase(), row]));
    const items = ROLE_POLICY_ROLES.map((role) => {
      const stored: any = byRole.get(role);
      return {
        role,
        policy_json: mergePolicy(role, stored?.policy_json, {}),
        updated_at: stored?.updated_at ?? null,
        updated_by_user_id: stored?.updated_by_user_id ?? null,
      };
    });

    return json(200, { ok: true, items, notEnforcedYet: false });
  }

  // PUT /v1/businesses/{businessId}/role-policies/{role} (OWNER-only edit/save)
  if (method === "PUT" && path === `/v1/businesses/${biz}/role-policies/${String(role ?? "")}`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });
    if (!isOwner(myRole)) return json(403, { ok: false, error: "Only OWNER can edit role policies" });

    const az = await authorizeWrite(prisma, {
      businessId: biz,
      actorUserId: sub,
      actorRole: myRole,
      actionKey: "roles.policy.update",
      requiredLevel: "FULL",
      endpointForLog: "PUT /v1/businesses/{businessId}/role-policies/{role}",
    });

    if (!az.allowed) {
      return json(403, {
        ok: false,
        error: "Policy denied",
        code: "POLICY_DENIED",
        actionKey: "roles.policy.update",
        requiredLevel: az.requiredLevel,
        policyValue: az.policyValue,
        policyKey: az.policyKey,
      });
    }

    const targetRole = normalizeRole(String(role ?? ""));
    if (!targetRole) return json(400, { ok: false, error: "Invalid role" });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const policyPatch = validatePolicyPatch(body?.policy_json);
    if (!policyPatch.ok) {
      return json(400, { ok: false, error: policyPatch.error, code: policyPatch.code });
    }

    const existing = await prisma.businessRolePolicy.findFirst({
      where: { business_id: biz, role: targetRole },
      select: { id: true, policy_json: true },
    });

    const previousEffectivePolicy = mergePolicy(targetRole, existing?.policy_json, {});
    const policy = mergePolicy(targetRole, existing?.policy_json, policyPatch.patch);

    let changedKeysCount = 0;
    for (const key of ROLE_POLICY_KEYS) {
      if (previousEffectivePolicy[key] !== policy[key]) changedKeysCount += 1;
    }

    const saved = existing
      ? await prisma.businessRolePolicy.update({
          where: { id: existing.id },
          data: {
            policy_json: policy,
            updated_at: new Date(),
            updated_by_user_id: sub,
          },
          select: { role: true, policy_json: true, updated_at: true, updated_by_user_id: true },
        })
      : await prisma.businessRolePolicy.create({
          data: {
            business_id: biz,
            role: targetRole,
            policy_json: policy,
            updated_by_user_id: sub,
          },
          select: { role: true, policy_json: true, updated_at: true, updated_by_user_id: true },
        });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      eventType: "ROLE_POLICY_UPDATED",
      payloadJson: { role: targetRole, changed_keys_count: changedKeysCount },
    });

    return json(200, { ok: true, item: saved, notEnforcedYet: false });
  }

  return json(404, { ok: false, error: "Not found" });
}
