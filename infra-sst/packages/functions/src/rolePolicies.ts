import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";

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

const ROLE_ALLOWLIST = new Set(["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT", "MEMBER"]);
const ACCESS_ALLOWLIST = new Set(["NONE", "VIEW", "FULL"]);

// Strict allowlist of permission keys (UI matrix uses these)
const PERM_KEYS = [
  "dashboard",
  "ledger",
  "reconcile",
  "issues",
  "vendors",
  "invoices",
  "reports",
  "settings",
  "bank_connections",
  "team_management",
  "billing",
  "ai_automation",
] as const;
const PERM_KEY_SET = new Set<string>(PERM_KEYS);

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

function validatePolicyJson(input: any) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!PERM_KEY_SET.has(k)) return null;
    const vv = String(v ?? "").trim().toUpperCase();
    if (!ACCESS_ALLOWLIST.has(vv)) return null;
    out[k] = vv;
  }

  // Ensure all known keys exist (fill missing as NONE)
  for (const k of PERM_KEYS) {
    if (!out[k]) out[k] = "NONE";
  }

  return out;
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

    // Store-only: return saved rows; UI will fill defaults for missing roles
    return json(200, { ok: true, items: rows, notEnforcedYet: true });
  }

  // PUT /v1/businesses/{businessId}/role-policies/{role} (OWNER-only edit/save)
  if (method === "PUT" && path === `/v1/businesses/${biz}/role-policies/${String(role ?? "")}`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });
    if (!isOwner(myRole)) return json(403, { ok: false, error: "Only OWNER can edit role policies" });

    const targetRole = normalizeRole(String(role ?? ""));
    if (!targetRole) return json(400, { ok: false, error: "Invalid role" });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const policy = validatePolicyJson(body?.policy_json);
    if (!policy) return json(400, { ok: false, error: "Invalid policy_json" });

    const existing = await prisma.businessRolePolicy.findFirst({
      where: { business_id: biz, role: targetRole },
      select: { id: true },
    });

    let changedKeysCount = Object.keys(policy).length;

    if (existing?.id) {
      try {
        const prev = await prisma.businessRolePolicy.findFirst({
          where: { id: existing.id },
          select: { policy_json: true },
        });

        const prevObj = (prev?.policy_json ?? {}) as Record<string, any>;
        let n = 0;
        for (const k of Object.keys(policy)) {
          if (String(prevObj[k] ?? "NONE").toUpperCase() !== String((policy as any)[k]).toUpperCase()) n++;
        }
        changedKeysCount = n;
      } catch {
        // ignore
      }
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

    return json(200, { ok: true, item: saved, notEnforcedYet: true });
  }

  return json(404, { ok: false, error: "Not found" });
}
