import { afterEach, describe, expect, test, vi } from "vitest";

function event(status = "OPEN") {
  return {
    queryStringParameters: { status },
    pathParameters: { businessId: "biz-1", accountId: "acct-1" },
    requestContext: {
      authorizer: { jwt: { claims: { sub: "user-1" } } },
      http: { method: "GET" },
    },
  };
}

async function loadHandler() {
  vi.resetModules();

  const now = new Date("2026-04-25T12:00:00.000Z");
  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role: "OWNER" })),
    },
    account: {
      findFirst: vi.fn(async () => ({ id: "acct-1" })),
    },
    entryIssue: {
      findMany: vi.fn(async () => [
        {
          id: "issue-1",
          entry_id: "entry-1",
          issue_type: "DUPLICATE",
          status: "OPEN",
          severity: "WARNING",
          group_key: "dup-1",
          details: "Potential duplicate",
          detected_at: now,
          resolved_at: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: "issue-2",
          entry_id: "entry-2",
          issue_type: "DUPLICATE",
          status: "OPEN",
          severity: "WARNING",
          group_key: "dup-1",
          details: "Potential duplicate",
          detected_at: now,
          resolved_at: null,
          created_at: now,
          updated_at: now,
        },
        {
          id: "issue-3",
          entry_id: "entry-3",
          issue_type: "STALE_CHECK",
          status: "OPEN",
          severity: "WARNING",
          group_key: null,
          details: "Stale check",
          detected_at: now,
          resolved_at: null,
          created_at: now,
          updated_at: now,
        },
      ]),
    },
    entry: {
      findMany: vi.fn(async (args: any) => {
        if (args?.where?.deleted_at?.not === null) return [];
        return [
          {
            id: "entry-1",
            date: new Date("2026-04-01T00:00:00.000Z"),
            payee: "Acme Supplies",
            memo: "Office supplies",
            amount_cents: -12345n,
            type: "EXPENSE",
            method: "card",
            category_id: "cat-1",
            category: { name: "Office" },
          },
          {
            id: "entry-2",
            date: new Date("2026-04-01T00:00:00.000Z"),
            payee: "Acme Supplies",
            memo: null,
            amount_cents: -12345n,
            type: "EXPENSE",
            method: "card",
            category_id: null,
            category: null,
          },
          {
            id: "entry-3",
            date: new Date("2026-01-01T00:00:00.000Z"),
            payee: "Old Check",
            memo: "Uncleared",
            amount_cents: -5000n,
            type: "EXPENSE",
            method: "check",
            category_id: "cat-2",
            category: { name: "Bank fees" },
          },
        ];
      }),
    },
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));

  const mod = await import("./issuesList");
  return { handler: mod.handler, prisma };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("issues list", () => {
  test("includes entry snapshot fields for issue row rendering", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(event());
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.issues).toHaveLength(3);
    expect(body.issues[0]).toMatchObject({
      id: "issue-1",
      entry_id: "entry-1",
      entry_date: "2026-04-01",
      entry_payee: "Acme Supplies",
      entry_memo: "Office supplies",
      entry_amount_cents: "-12345",
      entry_type: "EXPENSE",
      entry_method: "card",
      entry_category_id: "cat-1",
      entry_category_name: "Office",
    });
    expect(prisma.entry.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ["entry-1", "entry-2", "entry-3"] },
      }),
    }));
  });
});
