import { afterEach, describe, expect, test, vi } from "vitest";

const now = new Date("2026-04-25T12:00:00.000Z");

function event(status = "OPEN", query: Record<string, any> = {}) {
  return {
    queryStringParameters: { status, ...query },
    pathParameters: { businessId: "biz-1", accountId: "acct-1" },
    requestContext: {
      authorizer: { jwt: { claims: { sub: "user-1" } } },
      http: { method: "GET" },
    },
  };
}

function issue(overrides: Record<string, any> = {}) {
  return {
    id: "issue-1",
    business_id: "biz-1",
    account_id: "acct-1",
    entry_id: "entry-1",
    issue_type: "STALE_CHECK",
    status: "OPEN",
    severity: "WARNING",
    group_key: null,
    details: "Issue details",
    detected_at: now,
    resolved_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function entry(overrides: Record<string, any> = {}) {
  return {
    id: "entry-1",
    business_id: "biz-1",
    account_id: "acct-1",
    date: new Date("2026-04-01T00:00:00.000Z"),
    payee: "Acme Supplies",
    memo: "Office supplies",
    amount_cents: -12345n,
    type: "EXPENSE",
    method: "card",
    category_id: "cat-1",
    category: { name: "Office" },
    deleted_at: null,
    ...overrides,
  };
}

function defaultIssues() {
  return [
    issue({
      id: "issue-1",
      entry_id: "entry-1",
      issue_type: "DUPLICATE",
      group_key: "dup-1",
      details: "Potential duplicate",
    }),
    issue({
      id: "issue-2",
      entry_id: "entry-2",
      issue_type: "DUPLICATE",
      group_key: "dup-1",
      details: "Potential duplicate",
    }),
    issue({
      id: "issue-3",
      entry_id: "entry-3",
      issue_type: "STALE_CHECK",
      group_key: null,
      details: "Stale check",
      detected_at: new Date("2026-04-24T12:00:00.000Z"),
    }),
  ];
}

function defaultEntries() {
  return [
    entry({ id: "entry-1" }),
    entry({
      id: "entry-2",
      memo: null,
      category_id: null,
      category: null,
    }),
    entry({
      id: "entry-3",
      date: new Date("2026-01-01T00:00:00.000Z"),
      payee: "Old Check",
      memo: "Uncleared",
      amount_cents: -5000n,
      method: "check",
      category_id: "cat-2",
      category: { name: "Bank fees" },
    }),
  ];
}

function matchesValue(actual: any, expected: any): boolean {
  if (expected && typeof expected === "object" && !Array.isArray(expected) && !(expected instanceof Date)) {
    if ("in" in expected) return expected.in.map(String).includes(String(actual));
    if ("notIn" in expected) return !expected.notIn.map(String).includes(String(actual));
    if ("not" in expected) return expected.not === null ? actual !== null : actual !== expected.not;
  }

  if (expected === null) return actual === null;
  return String(actual) === String(expected);
}

function rowMatchesWhere(row: any, where: Record<string, any> = {}) {
  for (const [key, expected] of Object.entries(where)) {
    if (!matchesValue(row[key], expected)) return false;
  }
  return true;
}

function project(row: any, select: Record<string, boolean> | undefined) {
  if (!select) return row;
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

async function loadHandler(options: { issues?: any[]; entries?: any[] } = {}) {
  vi.resetModules();

  const issueRows = [...(options.issues ?? defaultIssues())];
  const entryRows = [...(options.entries ?? defaultEntries())];

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role: "OWNER" })),
    },
    account: {
      findFirst: vi.fn(async () => ({ id: "acct-1" })),
    },
    entryIssue: {
      findMany: vi.fn(async (args: any) =>
        issueRows
          .filter((row) => rowMatchesWhere(row, args?.where ?? {}))
          .sort((a, b) => new Date(b.detected_at).getTime() - new Date(a.detected_at).getTime())
          .map((row) => project(row, args?.select))
      ),
    },
    entry: {
      findMany: vi.fn(async (args: any) =>
        entryRows
          .filter((row) => rowMatchesWhere(row, args?.where ?? {}))
          .map((row) => project(row, args?.select))
      ),
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

  test("entryIds filters to requested active scoped entry ids", async () => {
    const { handler } = await loadHandler({
      issues: [
        ...defaultIssues(),
        issue({ id: "issue-4", entry_id: "entry-4", issue_type: "MISSING_CATEGORY" }),
      ],
      entries: [...defaultEntries(), entry({ id: "entry-4", category_id: null, category: null })],
    });

    const res = await handler(event("OPEN", { entryIds: "entry-3,entry-4" }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.issues.map((row: any) => row.id).sort()).toEqual(["issue-3", "issue-4"]);
  });

  test("entryIds outside the business/account are ignored safely", async () => {
    const { handler, prisma } = await loadHandler({
      issues: [
        ...defaultIssues(),
        issue({ id: "issue-other", business_id: "biz-2", account_id: "acct-2", entry_id: "entry-other" }),
      ],
      entries: [
        ...defaultEntries(),
        entry({ id: "entry-other", business_id: "biz-2", account_id: "acct-2" }),
      ],
    });

    const res = await handler(event("OPEN", { entryIds: "entry-other" }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.issues).toEqual([]);
    expect(prisma.entryIssue.findMany).not.toHaveBeenCalled();
  });

  test("deleted entry ids are excluded", async () => {
    const { handler } = await loadHandler({
      issues: [
        ...defaultIssues(),
        issue({ id: "issue-deleted", entry_id: "entry-deleted", issue_type: "STALE_CHECK" }),
      ],
      entries: [
        ...defaultEntries(),
        entry({ id: "entry-deleted", deleted_at: new Date("2026-04-20T00:00:00.000Z") }),
      ],
    });

    const res = await handler(event("OPEN", { entryIds: "entry-deleted" }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.issues).toEqual([]);
  });

  test("duplicate group expansion returns peer duplicate issues", async () => {
    const { handler } = await loadHandler();

    const res = await handler(event("OPEN", { entryIds: "entry-1" }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.issues.map((row: any) => row.id).sort()).toEqual(["issue-1", "issue-2"]);
    expect(body.issues.map((row: any) => row.entry_id).sort()).toEqual(["entry-1", "entry-2"]);
  });

  test("no entryIds preserves account-wide behavior", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(event("OPEN"));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.issues.map((row: any) => row.id).sort()).toEqual(["issue-1", "issue-2", "issue-3"]);
    expect(prisma.entryIssue.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        business_id: "biz-1",
        account_id: "acct-1",
        status: "OPEN",
      }),
    }));
  });

  test("status filtering is preserved with entryIds", async () => {
    const { handler } = await loadHandler({
      issues: [
        issue({ id: "issue-open", entry_id: "entry-3", status: "OPEN", issue_type: "STALE_CHECK" }),
        issue({ id: "issue-resolved", entry_id: "entry-3", status: "RESOLVED", issue_type: "STALE_CHECK" }),
      ],
    });

    const res = await handler(event("RESOLVED", { entryIds: "entry-3" }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.status).toBe("RESOLVED");
    expect(body.issues.map((row: any) => row.id)).toEqual(["issue-resolved"]);
  });
});
