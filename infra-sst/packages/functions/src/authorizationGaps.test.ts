import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";

function event(method: string, path: string, params: Record<string, string>, body?: any, sub = "actor") {
  return {
    body: body === undefined ? undefined : JSON.stringify(body),
    pathParameters: params,
    requestContext: {
      authorizer: { jwt: { claims: { sub, email: `${sub}@example.com` } } },
      http: { method, path },
    },
  };
}

async function loadAccountsHandler(role: string) {
  vi.resetModules();

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role })),
    },
    account: {
      create: vi.fn(async (args: any) => ({
        id: args.data.id,
        business_id: args.data.business_id,
        name: args.data.name,
        type: args.data.type,
        opening_balance_cents: args.data.opening_balance_cents,
        opening_balance_date: args.data.opening_balance_date,
      })),
    },
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));

  const mod = await import("./accounts");
  return { handler: mod.handler, prisma };
}

async function loadTeamHandler(role: string) {
  vi.resetModules();

  const prisma = {
    businessInvite: {
      findFirst: vi.fn(async () => ({
        id: "invite-1",
        business_id: "biz-1",
        email: "member@example.com",
        revoked_at: null,
        accepted_at: null,
      })),
      update: vi.fn(async () => ({})),
    },
    userBusinessRole: {
      findFirst: vi.fn(async (args: any) => {
        if (args?.where?.user_id === "actor") return { role };
        return { id: "target-role-1", role: "MEMBER" };
      }),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      count: vi.fn(async () => 2),
    },
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));
  vi.doMock("./lib/authz", () => ({
    authorizeWrite: vi.fn(async () => ({ allowed: true })),
  }));
  vi.doMock("./lib/activityLog", () => ({
    logActivity: vi.fn(async () => undefined),
  }));

  const mod = await import("./team");
  return { handler: mod.handler, prisma };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("P1 authorization gaps", () => {
  test("all server-used authorizeWrite action keys are mapped and wave-gated", async () => {
    vi.resetModules();
    vi.doUnmock("./lib/authz");

    const { ACTION_POLICY_KEY, actionWave } = await import("./lib/authz");
    const srcDir = fileURLToPath(new URL(".", import.meta.url));
    const files: string[] = [];

    function walk(dir: string) {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith(".ts") || name.endsWith(".test.ts") || full.endsWith(join("lib", "authz.ts"))) {
          continue;
        }
        files.push(full);
      }
    }

    walk(srcDir);

    const actionKeys = new Set<string>();
    const actionKeyPattern = /actionKey:[^\r\n]+/g;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("authorizeWrite")) continue;
      for (const match of text.matchAll(actionKeyPattern)) {
        for (const keyMatch of match[0].matchAll(/"([^"]+)"/g)) {
          actionKeys.add(keyMatch[1]);
        }
      }
    }

    expect([...actionKeys].sort()).toEqual(expect.arrayContaining([
      "budgets.write",
      "category.review.bulk.apply",
      "goals.write",
      "ledger.transfer.write",
      "reconcile.adjustment.mark",
      "reconcile.adjustment.unmark",
      "reconcile.entry.create",
      "reconcile.entry.create.batch",
      "reconcile.match.batch",
      "reconcile.match.create",
      "reconcile.match.void",
      "reconcile.matchGroup.batchCreate",
      "reconcile.matchGroup.create",
      "reconcile.matchGroup.void",
      "roles.policy.update",
      "snapshots.create",
      "snapshots.export.download",
      "team.invite.accept",
      "team.invite.create",
      "team.invite.revoke",
      "team.member.remove",
      "team.member.role_change",
    ]));

    const unmapped = [...actionKeys].filter((key) => !(key in ACTION_POLICY_KEY));
    const unwaved = [...actionKeys].filter((key) => actionWave(key) <= 0);

    expect(unmapped).toEqual([]);
    expect(unwaved).toEqual([]);
  });

  test("denies write-role account creation without OWNER/ADMIN account management permission", async () => {
    const { handler, prisma } = await loadAccountsHandler("BOOKKEEPER");

    const res = await handler(
      event("POST", "/v1/businesses/biz-1/accounts", { businessId: "biz-1" }, {
        name: "Operating",
        type: "CHECKING",
        opening_balance_cents: 0,
        opening_balance_date: "2026-01-01T00:00:00.000Z",
      }),
    );

    expect(res.statusCode).toBe(403);
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  test("allows OWNER account creation", async () => {
    const { handler, prisma } = await loadAccountsHandler("OWNER");

    const res = await handler(
      event("POST", "/v1/businesses/biz-1/accounts", { businessId: "biz-1" }, {
        name: "Operating",
        type: "CHECKING",
        opening_balance_cents: 0,
        opening_balance_date: "2026-01-01T00:00:00.000Z",
      }),
    );

    expect(res.statusCode).toBe(201);
    expect(prisma.account.create).toHaveBeenCalledOnce();
  });

  test("denies write-role invite revoke without member-management permission", async () => {
    const { handler, prisma } = await loadTeamHandler("ACCOUNTANT");

    const res = await handler(
      event("POST", "/v1/businesses/biz-1/team/invites/invite-1/revoke", { businessId: "biz-1", inviteId: "invite-1" }),
    );

    expect(res.statusCode).toBe(403);
    expect(prisma.businessInvite.update).not.toHaveBeenCalled();
  });

  test("denies write-role member role changes without member-management permission", async () => {
    const { handler, prisma } = await loadTeamHandler("BOOKKEEPER");

    const res = await handler(
      event("PATCH", "/v1/businesses/biz-1/team/members/target", { businessId: "biz-1", userId: "target" }, { role: "ADMIN" }),
    );

    expect(res.statusCode).toBe(403);
    expect(prisma.userBusinessRole.update).not.toHaveBeenCalled();
  });

  test("denies write-role member removal without member-management permission", async () => {
    const { handler, prisma } = await loadTeamHandler("ACCOUNTANT");

    const res = await handler(
      event("DELETE", "/v1/businesses/biz-1/team/members/target", { businessId: "biz-1", userId: "target" }),
    );

    expect(res.statusCode).toBe(403);
    expect(prisma.userBusinessRole.delete).not.toHaveBeenCalled();
  });

  test("custom ai_automation policy can deny category.review.bulk.apply", async () => {
    vi.resetModules();
    vi.doUnmock("./lib/authz");

    const logActivity = vi.fn(async () => undefined);
    vi.doMock("./lib/activityLog", () => ({
      logActivity,
    }));

    const prisma = {
      business: {
        findFirst: vi.fn(async () => ({ authz_mode: "ENFORCE", authz_enforce_wave: 4 })),
      },
      businessRolePolicy: {
        findFirst: vi.fn(async () => ({ policy_json: { ai_automation: "NONE" } })),
      },
    };

    const { authorizeWrite } = await import("./lib/authz");
    const res = await authorizeWrite(prisma, {
      businessId: "biz-1",
      scopeAccountId: "acct-1",
      actorUserId: "actor",
      actorRole: "OWNER",
      actionKey: "category.review.bulk.apply",
      requiredLevel: "FULL",
      endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/entries/apply-category-batch",
    });

    expect(res).toMatchObject({
      allowed: false,
      enforced: true,
      code: "POLICY_DENIED",
      policyKey: "ai_automation",
      policyValue: "NONE",
    });
    expect(logActivity).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        eventType: "AUTHZ_ENFORCED_DENIED",
        payloadJson: expect.objectContaining({
          actionKey: "category.review.bulk.apply",
          policyKey: "ai_automation",
          policyValue: "NONE",
          result: "DENY",
        }),
      }),
    );
  });

  test.each([
    ["ledger.transfer.write", "ledger"],
    ["budgets.write", "ledger"],
    ["goals.write", "ledger"],
    ["reconcile.entry.create", "reconcile"],
    ["reconcile.match.batch", "reconcile"],
    ["reconcile.matchGroup.create", "reconcile"],
  ])("custom policy can deny %s", async (actionKey, policyKey) => {
    vi.resetModules();
    vi.doUnmock("./lib/authz");

    const logActivity = vi.fn(async () => undefined);
    vi.doMock("./lib/activityLog", () => ({
      logActivity,
    }));

    const prisma = {
      business: {
        findFirst: vi.fn(async () => ({ authz_mode: "ENFORCE", authz_enforce_wave: 4 })),
      },
      businessRolePolicy: {
        findFirst: vi.fn(async () => ({ policy_json: { [policyKey]: "NONE" } })),
      },
    };

    const { authorizeWrite } = await import("./lib/authz");
    const res = await authorizeWrite(prisma, {
      businessId: "biz-1",
      scopeAccountId: "acct-1",
      actorUserId: "actor",
      actorRole: "OWNER",
      actionKey,
      requiredLevel: "FULL",
      endpointForLog: "TEST",
    });

    expect(res).toMatchObject({
      allowed: false,
      enforced: true,
      code: "POLICY_DENIED",
      policyKey,
      policyValue: "NONE",
    });
    expect(logActivity).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({
        eventType: "AUTHZ_ENFORCED_DENIED",
        payloadJson: expect.objectContaining({
          actionKey,
          policyKey,
          policyValue: "NONE",
          result: "DENY",
        }),
      }),
    );
  });
});
