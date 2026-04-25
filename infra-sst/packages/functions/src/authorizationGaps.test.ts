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
});
