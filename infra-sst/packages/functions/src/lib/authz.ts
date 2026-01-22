import { logActivity } from "./activityLog";

export type AuthzMode = "OFF" | "SOFT" | "ENFORCE" | "ENFORCE_ONLY";
export type RequiredLevel = "VIEW" | "FULL";
export type PolicyValue = "NONE" | "VIEW" | "FULL";

const MODES = new Set<AuthzMode>(["OFF", "SOFT", "ENFORCE", "ENFORCE_ONLY"]);
const LEVELS = new Set<RequiredLevel>(["VIEW", "FULL"]);
const POLICY_VALUES = new Set<PolicyValue>(["NONE", "VIEW", "FULL"]);

// Phase 7.2 lock: authorizeWrite() is called only AFTER allowlist passes.
// Therefore allowlist is always logged as PASS and is NOT evaluated inside authorizeWrite().

/**
 * Default policies live in code (Option 1).
 * Keys correspond to stored policy_json keys (store-only today).
 */
const DEFAULTS: Record<string, Record<string, PolicyValue>> = {
  OWNER: {
    dashboard: "FULL",
    ledger: "FULL",
    reconcile: "FULL",
    issues: "FULL",
    vendors: "FULL",
    invoices: "FULL",
    reports: "FULL",
    settings: "FULL",
    bank_connections: "FULL",
    team_management: "FULL",
    billing: "FULL",
    ai_automation: "FULL",
    snapshots: "FULL",
    exports: "FULL",
    roles_policy: "FULL",
  },
  ADMIN: {
    dashboard: "FULL",
    ledger: "FULL",
    reconcile: "FULL",
    issues: "FULL",
    vendors: "FULL",
    invoices: "VIEW",
    reports: "VIEW",
    settings: "FULL",
    bank_connections: "FULL",
    team_management: "FULL",
    billing: "FULL",
    ai_automation: "VIEW",
    snapshots: "FULL",
    exports: "FULL",
    roles_policy: "VIEW",
  },
  BOOKKEEPER: {
    dashboard: "VIEW",
    ledger: "FULL",
    reconcile: "FULL",
    issues: "FULL",
    vendors: "VIEW",
    invoices: "VIEW",
    reports: "VIEW",
    settings: "VIEW",
    bank_connections: "VIEW",
    team_management: "NONE",
    billing: "NONE",
    ai_automation: "VIEW",
    snapshots: "FULL",
    exports: "FULL",
    roles_policy: "NONE",
  },
  ACCOUNTANT: {
    dashboard: "VIEW",
    ledger: "VIEW",
    reconcile: "FULL",
    issues: "FULL",
    vendors: "VIEW",
    invoices: "VIEW",
    reports: "FULL",
    settings: "VIEW",
    bank_connections: "VIEW",
    team_management: "NONE",
    billing: "NONE",
    ai_automation: "VIEW",
    snapshots: "FULL",
    exports: "FULL",
    roles_policy: "NONE",
  },
  MEMBER: {
    dashboard: "VIEW",
    ledger: "VIEW",
    reconcile: "VIEW",
    issues: "VIEW",
    vendors: "NONE",
    invoices: "NONE",
    reports: "VIEW",
    settings: "NONE",
    bank_connections: "NONE",
    team_management: "NONE",
    billing: "NONE",
    ai_automation: "NONE",
    snapshots: "VIEW",
    exports: "NONE",
    roles_policy: "NONE",
  },
};

/**
 * Map actionKey -> policy key (not endpoint-based).
 * Handlers provide actionKey + requiredLevel explicitly.
 */
const ACTION_POLICY_KEY: Record<string, string> = {
  // Team
  "team.invite.create": "team_management",
  "team.invite.revoke": "team_management",
  "team.invite.accept": "team_management",
  "team.member.role_change": "team_management",
  "team.member.remove": "team_management",

  // Role policies
  "roles.policy.update": "roles_policy",

  // Reconcile
  "reconcile.match.create": "reconcile",
  "reconcile.match.void": "reconcile",
  "reconcile.adjustment.mark": "reconcile",
  "reconcile.adjustment.unmark": "reconcile",

  // Snapshots
  "snapshots.create": "snapshots",
  "snapshots.export.download": "exports",
};

function normalizeMode(m: any): AuthzMode {
  const v = String(m ?? "").trim().toUpperCase() as AuthzMode;
  return MODES.has(v) ? v : "OFF";
}

function normalizeLevel(v: any): RequiredLevel {
  const s = String(v ?? "").trim().toUpperCase() as RequiredLevel;
  return LEVELS.has(s) ? s : "FULL";
}

function normalizePolicyValue(v: any): PolicyValue {
  const s = String(v ?? "").trim().toUpperCase() as PolicyValue;
  return POLICY_VALUES.has(s) ? s : "NONE";
}

function policyAllows(policyValue: PolicyValue, required: RequiredLevel): boolean {
  if (required === "VIEW") return policyValue === "VIEW" || policyValue === "FULL";
  return policyValue === "FULL";
}

async function getBusinessAuthzMode(prisma: any, businessId: string): Promise<AuthzMode> {
  // Optional emergency override: AUTHZ_FORCE_MODE=OFF|SOFT
  const forced = process.env.AUTHZ_FORCE_MODE?.trim();
  if (forced) {
    const fm = normalizeMode(forced);
    // limit override scope to OFF or SOFT only (safety)
    if (fm === "OFF" || fm === "SOFT") return fm;
  }

  const row = await prisma.business.findFirst({
    where: { id: businessId },
    select: { authz_mode: true },
  });
  return normalizeMode(row?.authz_mode);
}

async function getPolicyForRole(prisma: any, businessId: string, role: string): Promise<Record<string, PolicyValue>> {
  const R = String(role ?? "").toUpperCase();
  const fallback = DEFAULTS[R] ?? DEFAULTS["MEMBER"];

  const row = await prisma.businessRolePolicy.findFirst({
    where: { business_id: businessId, role: R },
    select: { policy_json: true },
  });

  if (!row?.policy_json || typeof row.policy_json !== "object") return fallback;

  const obj = row.policy_json as Record<string, any>;
  const merged: Record<string, PolicyValue> = { ...fallback };
  for (const [k, v] of Object.entries(obj)) {
    merged[k] = normalizePolicyValue(v);
  }
  return merged;
}

function actionWave(actionKey: string): number {
  // Wave 1: business admin writes (team + role policies)
  if (
    actionKey === "team.invite.create" ||
    actionKey === "team.invite.revoke" ||
    actionKey === "team.member.role_change" ||
    actionKey === "team.member.remove" ||
    actionKey === "roles.policy.update"
  ) return 1;

  // Wave 2: reconcile writes
  if (
    actionKey === "reconcile.match.create" ||
    actionKey === "reconcile.match.void" ||
    actionKey === "reconcile.adjustment.mark" ||
    actionKey === "reconcile.adjustment.unmark"
  ) return 2;

  // Wave 3: snapshots/exports
  if (actionKey === "snapshots.create" || actionKey === "snapshots.export.download") return 3;

  // Unknown actionKeys are never enforced in 7.2 (safe default)
  return 0;
}

async function getBusinessAuthz(prisma: any, businessId: string): Promise<{ mode: AuthzMode; wave: number }> {
  // Optional emergency override: AUTHZ_FORCE_MODE=OFF|SOFT only
  const forced = process.env.AUTHZ_FORCE_MODE?.trim();
  if (forced) {
    const fm = normalizeMode(forced);
    if (fm === "OFF" || fm === "SOFT") return { mode: fm, wave: 0 };
  }

  const row = await prisma.business.findFirst({
    where: { id: businessId },
    select: { authz_mode: true, authz_enforce_wave: true },
  });

  return {
    mode: normalizeMode(row?.authz_mode),
    wave: Number(row?.authz_enforce_wave ?? 0) || 0,
  };
}

/**
 * Phase 7.2: authorizeWrite()
 * - MUST be called only after allowlist passes (so allowlist is logged as PASS).
 * - Uses explicit actionKey + requiredLevel passed by handler (no endpoint mapping for decision).
 * - team.invite.accept is excluded from policy blocking (still logged).
 */
export async function authorizeWrite(prisma: any, args: {
  businessId: string;
  scopeAccountId?: string | null;
  actorUserId: string;
  actorRole: string;
  actionKey: string;
  requiredLevel: RequiredLevel;
  endpointForLog: string; // log-only
}) {
  const { mode, wave } = await getBusinessAuthz(prisma, args.businessId);

  const required = normalizeLevel(args.requiredLevel);
  const policyKey = ACTION_POLICY_KEY[args.actionKey] ?? null;
  const policy = await getPolicyForRole(prisma, args.businessId, args.actorRole);
  const policyValue = normalizePolicyValue(policyKey ? policy[policyKey] : "NONE");
  const wouldAllow = policyAllows(policyValue, required);

  // Always log allowlist PASS because callers invoke only after allowlist passes.
  const allowlist = "PASS";

  // Exclusion: never policy-block invite accept (onboarding safety)
  const excludedFromEnforce = args.actionKey === "team.invite.accept";

  // Determine if enforcement applies at current wave
  const akWave = actionWave(args.actionKey);
  const enforced = mode === "ENFORCE" && !excludedFromEnforce && akWave > 0 && wave >= akWave;

  if (mode === "SOFT") {
    await logActivity(prisma, {
      businessId: args.businessId,
      actorUserId: args.actorUserId,
      scopeAccountId: args.scopeAccountId ?? null,
      eventType: "AUTHZ_SOFT_EVALUATED",
      payloadJson: {
        mode: "SOFT",
        endpoint: args.endpointForLog,
        actionKey: args.actionKey,
        requiredLevel: required,
        policyKey,
        policyValue,
        result: wouldAllow ? "WOULD_ALLOW" : "WOULD_DENY",
        role: String(args.actorRole ?? "").toUpperCase(),
        allowlist,
      },
    });

    return { mode, enforced: false, allowed: true as const };
  }

  if (mode !== "ENFORCE") {
    // OFF / ENFORCE_ONLY not implemented in 7.2 (safe behavior: do nothing, allow)
    return { mode, enforced: false, allowed: true as const };
  }

  if (!enforced) {
    // In ENFORCE mode, but not enforced due to wave gating or exclusions
    await logActivity(prisma, {
      businessId: args.businessId,
      actorUserId: args.actorUserId,
      scopeAccountId: args.scopeAccountId ?? null,
      eventType: "AUTHZ_ENFORCED_SKIPPED",
      payloadJson: {
        mode: "ENFORCE",
        wave,
        actionWave: akWave,
        enforced: false,
        endpoint: args.endpointForLog,
        actionKey: args.actionKey,
        requiredLevel: required,
        policyKey,
        policyValue,
        result: "SKIPPED",
        role: String(args.actorRole ?? "").toUpperCase(),
        allowlist,
        excluded: excludedFromEnforce ? "YES" : "NO",
      },
    });

    return { mode, enforced: false, allowed: true as const };
  }

  if (!wouldAllow) {
    await logActivity(prisma, {
      businessId: args.businessId,
      actorUserId: args.actorUserId,
      scopeAccountId: args.scopeAccountId ?? null,
      eventType: "AUTHZ_ENFORCED_DENIED",
      payloadJson: {
        mode: "ENFORCE",
        wave,
        enforced: true,
        endpoint: args.endpointForLog,
        actionKey: args.actionKey,
        requiredLevel: required,
        policyKey,
        policyValue,
        result: "DENY",
        role: String(args.actorRole ?? "").toUpperCase(),
        allowlist,
      },
    });

    return {
      mode,
      enforced: true,
      allowed: false as const,
      code: "POLICY_DENIED",
      policyKey,
      policyValue,
      requiredLevel: required,
    };
  }

  // Allowed under enforcement (no log to avoid noise)
  return { mode, enforced: true, allowed: true as const };
}
