import { afterEach, describe, expect, test, vi } from "vitest";

function event(method: string, path: string, role: string, body?: any, sub = "actor") {
  return {
    body: body === undefined ? undefined : JSON.stringify(body),
    pathParameters: { businessId: "biz-1", role },
    requestContext: {
      authorizer: { jwt: { claims: { sub, email: `${sub}@example.com` } } },
      http: { method, path },
    },
  };
}

async function loadHandler(args?: {
  actorRole?: string | null;
  existingPolicy?: any;
  authorizeAllowed?: boolean;
}) {
  vi.resetModules();

  const existingPolicy = args?.existingPolicy;
  const actorRole = args?.actorRole === undefined ? "OWNER" : args.actorRole;
  const logActivity = vi.fn(async () => undefined);

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => (actorRole ? { role: actorRole } : null)),
    },
    businessRolePolicy: {
      findFirst: vi.fn(async () =>
        existingPolicy
          ? {
              id: "policy-1",
              policy_json: existingPolicy,
            }
          : null,
      ),
      create: vi.fn(async (call: any) => ({
        role: call.data.role,
        policy_json: call.data.policy_json,
        updated_at: new Date("2026-01-01T00:00:00.000Z"),
        updated_by_user_id: call.data.updated_by_user_id,
      })),
      update: vi.fn(async (call: any) => ({
        role: "ADMIN",
        policy_json: call.data.policy_json,
        updated_at: call.data.updated_at,
        updated_by_user_id: call.data.updated_by_user_id,
      })),
    },
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));
  vi.doMock("./lib/activityLog", () => ({
    logActivity,
  }));
  vi.doMock("./lib/authz", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./lib/authz")>();
    return {
      ...actual,
      authorizeWrite: vi.fn(async () =>
        args?.authorizeAllowed === false
          ? {
              allowed: false,
              requiredLevel: "FULL",
              policyValue: "NONE",
              policyKey: "roles_policy",
            }
          : { allowed: true },
      ),
    };
  });

  const mod = await import("./rolePolicies");
  return { handler: mod.handler, prisma, logActivity };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("role policy update guards", () => {
  test("partial update merges into backend defaults without converting missing keys to NONE", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(
      event("PUT", "/v1/businesses/biz-1/role-policies/ADMIN", "ADMIN", {
        policy_json: { reports: "FULL" },
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(prisma.businessRolePolicy.create).toHaveBeenCalledOnce();

    const saved = prisma.businessRolePolicy.create.mock.calls[0][0].data.policy_json;
    expect(saved.reports).toBe("FULL");
    expect(saved.invoices).toBe("VIEW");
    expect(saved.team_management).toBe("FULL");
    expect(saved.snapshots).toBe("FULL");
    expect(saved.exports).toBe("FULL");
    expect(saved.roles_policy).toBe("VIEW");
    expect(saved.billing).not.toBe("NONE");
  });

  test("partial update preserves existing stored keys unless explicitly changed", async () => {
    const { handler, prisma } = await loadHandler({
      existingPolicy: {
        dashboard: "VIEW",
        exports: "NONE",
        roles_policy: "VIEW",
      },
    });

    const res = await handler(
      event("PUT", "/v1/businesses/biz-1/role-policies/ADMIN", "ADMIN", {
        policy_json: { reports: "FULL" },
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(prisma.businessRolePolicy.update).toHaveBeenCalledOnce();

    const saved = prisma.businessRolePolicy.update.mock.calls[0][0].data.policy_json;
    expect(saved.reports).toBe("FULL");
    expect(saved.dashboard).toBe("VIEW");
    expect(saved.exports).toBe("NONE");
    expect(saved.ledger).toBe("FULL");
    expect(saved.snapshots).toBe("FULL");
  });

  test("unknown policy key is rejected", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(
      event("PUT", "/v1/businesses/biz-1/role-policies/ADMIN", "ADMIN", {
        policy_json: { not_a_real_key: "FULL" },
      }),
    );

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({
      code: "UNKNOWN_POLICY_KEY",
    });
    expect(prisma.businessRolePolicy.create).not.toHaveBeenCalled();
    expect(prisma.businessRolePolicy.update).not.toHaveBeenCalled();
  });

  test("ADMIN cannot update role policies", async () => {
    const { handler, prisma } = await loadHandler({ actorRole: "ADMIN" });

    const res = await handler(
      event("PUT", "/v1/businesses/biz-1/role-policies/MEMBER", "MEMBER", {
        policy_json: { reports: "VIEW" },
      }),
    );

    expect(res.statusCode).toBe(403);
    expect(prisma.businessRolePolicy.create).not.toHaveBeenCalled();
    expect(prisma.businessRolePolicy.update).not.toHaveBeenCalled();
  });

  test("non-member cannot update role policies", async () => {
    const { handler, prisma } = await loadHandler({ actorRole: null });

    const res = await handler(
      event("PUT", "/v1/businesses/biz-1/role-policies/MEMBER", "MEMBER", {
        policy_json: { reports: "VIEW" },
      }),
    );

    expect(res.statusCode).toBe(403);
    expect(prisma.businessRolePolicy.create).not.toHaveBeenCalled();
    expect(prisma.businessRolePolicy.update).not.toHaveBeenCalled();
  });
});
