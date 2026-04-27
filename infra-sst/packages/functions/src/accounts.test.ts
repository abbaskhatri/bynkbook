import { afterEach, describe, expect, test, vi } from "vitest";

function event(method: string, path: string, businessId: string, accountId?: string, body?: any, sub = "actor") {
  return {
    body: body === undefined ? undefined : JSON.stringify(body),
    pathParameters: { businessId, ...(accountId ? { accountId } : {}) },
    requestContext: {
      authorizer: { jwt: { claims: { sub, email: `${sub}@example.com` } } },
      http: { method, path },
    },
  };
}

function project(row: any, select: any) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

async function loadHandler(role = "OWNER") {
  vi.resetModules();

  const accounts = [
    {
      id: "acct-a",
      business_id: "biz-a",
      name: "Operating",
      type: "CHECKING",
      opening_balance_cents: 0n,
      opening_balance_date: new Date("2026-01-01T00:00:00.000Z"),
      archived_at: null,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: "acct-b",
      business_id: "biz-b",
      name: "Other Business",
      type: "SAVINGS",
      opening_balance_cents: 0n,
      opening_balance_date: new Date("2026-01-01T00:00:00.000Z"),
      archived_at: new Date("2026-01-02T00:00:00.000Z"),
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      updated_at: new Date("2026-01-01T00:00:00.000Z"),
    },
  ];

  const zeroCount = vi.fn(async () => 0);
  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async (args: any) => (args?.where?.business_id === "biz-a" && args?.where?.user_id === "actor" ? { role } : null)),
    },
    account: {
      findFirst: vi.fn(async (args: any) => {
        const row = accounts.find((account) => account.id === args?.where?.id && account.business_id === args?.where?.business_id);
        return row ? project(row, args?.select) : null;
      }),
      updateMany: vi.fn(async (args: any) => {
        let count = 0;
        for (const account of accounts) {
          if (account.id === args?.where?.id && account.business_id === args?.where?.business_id) {
            Object.assign(account, args.data, { updated_at: new Date("2026-01-03T00:00:00.000Z") });
            count += 1;
          }
        }
        return { count };
      }),
      deleteMany: vi.fn(async (args: any) => {
        const index = accounts.findIndex((account) => account.id === args?.where?.id && account.business_id === args?.where?.business_id);
        if (index < 0) return { count: 0 };
        accounts.splice(index, 1);
        return { count: 1 };
      }),
    },
    entry: { count: zeroCount },
    bankTransaction: { count: zeroCount },
    bankMatch: { count: zeroCount },
    bankConnection: {
      count: zeroCount,
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    upload: { count: zeroCount },
    reconcileSnapshot: { count: zeroCount },
    transfer: { count: zeroCount },
    $transaction: vi.fn(async (ops: Promise<any>[]) => Promise.all(ops)),
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));

  const mod = await import("./accounts");
  return { handler: mod.handler, prisma };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("account business scoping", () => {
  test("blocks a Business A user from patching a Business B account", async () => {
    const { handler, prisma } = await loadHandler("OWNER");

    const res = await handler(
      event("PATCH", "/v1/businesses/biz-a/accounts/acct-b", "biz-a", "acct-b", {
        name: "Cross-business edit",
      }),
    );

    expect(res.statusCode).toBe(404);
    expect(prisma.account.updateMany).not.toHaveBeenCalled();
  });

  test.each([
    ["archive", "/v1/businesses/biz-a/accounts/acct-b/archive"],
    ["unarchive", "/v1/businesses/biz-a/accounts/acct-b/unarchive"],
  ])("blocks a Business A user from %s on a Business B account", async (_action, path) => {
    const { handler, prisma } = await loadHandler("OWNER");

    const res = await handler(event("POST", path, "biz-a", "acct-b"));

    expect(res.statusCode).toBe(404);
    expect(prisma.account.updateMany).not.toHaveBeenCalled();
    expect(prisma.bankConnection.deleteMany).not.toHaveBeenCalled();
  });

  test("blocks a Business A user from deleting a Business B account", async () => {
    const { handler, prisma } = await loadHandler("OWNER");

    const res = await handler(event("DELETE", "/v1/businesses/biz-a/accounts/acct-b", "biz-a", "acct-b"));

    expect(res.statusCode).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.account.deleteMany).not.toHaveBeenCalled();
  });

  test("allows same-business patch and scopes the update by business id and account id", async () => {
    const { handler, prisma } = await loadHandler("BOOKKEEPER");

    const res = await handler(
      event("PATCH", "/v1/businesses/biz-a/accounts/acct-a", "biz-a", "acct-a", {
        name: "Updated Operating",
      }),
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.account.name).toBe("Updated Operating");
    expect(prisma.account.updateMany).toHaveBeenCalledWith({
      where: { id: "acct-a", business_id: "biz-a" },
      data: { name: "Updated Operating" },
    });
  });

  test("allows same-business archive and unarchive with scoped updates", async () => {
    const { handler, prisma } = await loadHandler("OWNER");

    const archiveRes = await handler(event("POST", "/v1/businesses/biz-a/accounts/acct-a/archive", "biz-a", "acct-a"));
    const unarchiveRes = await handler(event("POST", "/v1/businesses/biz-a/accounts/acct-a/unarchive", "biz-a", "acct-a"));

    expect(archiveRes.statusCode).toBe(200);
    expect(unarchiveRes.statusCode).toBe(200);
    expect(prisma.account.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "acct-a", business_id: "biz-a" },
      data: { archived_at: expect.any(Date) },
    });
    expect(prisma.account.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "acct-a", business_id: "biz-a" },
      data: { archived_at: null },
    });
    expect(prisma.bankConnection.deleteMany).toHaveBeenCalledWith({ where: { business_id: "biz-a", account_id: "acct-a" } });
  });

  test("allows same-business delete with scoped delete after eligibility checks", async () => {
    const { handler, prisma } = await loadHandler("OWNER");

    const res = await handler(event("DELETE", "/v1/businesses/biz-a/accounts/acct-a", "biz-a", "acct-a"));

    expect(res.statusCode).toBe(200);
    expect(prisma.account.deleteMany).toHaveBeenCalledWith({ where: { id: "acct-a", business_id: "biz-a" } });
  });

  test("preserves existing role gates for account mutations", async () => {
    const { handler, prisma } = await loadHandler("MEMBER");

    const patchRes = await handler(
      event("PATCH", "/v1/businesses/biz-a/accounts/acct-a", "biz-a", "acct-a", {
        name: "Denied",
      }),
    );
    const archiveRes = await handler(event("POST", "/v1/businesses/biz-a/accounts/acct-a/archive", "biz-a", "acct-a"));

    expect(patchRes.statusCode).toBe(403);
    expect(archiveRes.statusCode).toBe(403);
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
    expect(prisma.account.updateMany).not.toHaveBeenCalled();
  });
});
