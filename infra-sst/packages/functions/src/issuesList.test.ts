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
    status: "EXPECTED",
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
    if ("lt" in expected) {
      const at = new Date(actual).getTime();
      const et = new Date(expected.lt).getTime();
      if (Number.isFinite(at) && Number.isFinite(et)) return at < et;
      return String(actual) < String(expected.lt);
    }
  }

  if (expected === null) return actual === null;
  if (actual instanceof Date || expected instanceof Date) {
    return new Date(actual).getTime() === new Date(expected).getTime();
  }
  return String(actual) === String(expected);
}

function rowMatchesWhere(row: any, where: Record<string, any> = {}) {
  for (const [key, expected] of Object.entries(where)) {
    if (key === "OR" && Array.isArray(expected)) {
      if (!expected.some((clause) => rowMatchesWhere(row, clause))) return false;
      continue;
    }
    if (!matchesValue(row[key], expected)) return false;
  }
  return true;
}

function sortRows(rows: any[], orderBy: any[] | undefined) {
  const order = Array.isArray(orderBy) && orderBy.length
    ? orderBy
    : [{ detected_at: "desc" }];

  return [...rows].sort((a, b) => {
    for (const item of order) {
      const [field, direction] = Object.entries(item)[0] as [string, string];
      const av = a[field] instanceof Date ? a[field].getTime() : String(a[field] ?? "");
      const bv = b[field] instanceof Date ? b[field].getTime() : String(b[field] ?? "");
      if (av === bv) continue;
      const cmp = av < bv ? -1 : 1;
      return direction === "desc" ? -cmp : cmp;
    }
    return 0;
  });
}

function project(row: any, select: Record<string, boolean> | undefined) {
  if (!select) return row;
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

async function loadHandler(options: { issues?: any[]; entries?: any[]; matchGroupEntries?: any[]; matchGroups?: any[] } = {}) {
  vi.resetModules();

  const issueRows = [...(options.issues ?? defaultIssues())];
  const entryRows = [...(options.entries ?? defaultEntries())];
  const matchGroupEntryRows = [...(options.matchGroupEntries ?? [])];
  const matchGroupRows = [...(options.matchGroups ?? [])];

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role: "OWNER" })),
    },
    account: {
      findFirst: vi.fn(async () => ({ id: "acct-1" })),
    },
    entryIssue: {
      findMany: vi.fn(async (args: any) =>
        sortRows(
          issueRows.filter((row) => rowMatchesWhere(row, args?.where ?? {})),
          args?.orderBy
        )
          .slice(0, typeof args?.take === "number" ? args.take : undefined)
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
    matchGroupEntry: {
      findMany: vi.fn(async (args: any) =>
        matchGroupEntryRows
          .filter((row) => rowMatchesWhere(row, args?.where ?? {}))
          .map((row) => project(row, args?.select))
      ),
    },
    matchGroup: {
      findMany: vi.fn(async (args: any) =>
        matchGroupRows
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
    expect(body.issues.find((row: any) => row.id === "issue-1")).toMatchObject({
      id: "issue-1",
      entry_id: "entry-1",
      entry_date: "2026-04-01",
      entry_payee: "Acme Supplies",
      entry_memo: "Office supplies",
      entry_amount_cents: "-12345",
      entry_type: "EXPENSE",
      entry_method: "card",
      entry_status: "EXPECTED",
      entry_category_id: "cat-1",
      entry_category_name: "Office",
    });
    expect(prisma.entry.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: expect.arrayContaining(["entry-1", "entry-2", "entry-3"]) },
      }),
    }));
  });

  test("marks issue snapshots as matched when an active match group links the entry", async () => {
    const { handler } = await loadHandler({
      matchGroupEntries: [
        {
          id: "mge-1",
          business_id: "biz-1",
          account_id: "acct-1",
          entry_id: "entry-1",
          match_group_id: "mg-active",
        },
      ],
      matchGroups: [
        {
          id: "mg-active",
          business_id: "biz-1",
          account_id: "acct-1",
          status: "ACTIVE",
          voided_at: null,
        },
      ],
    });

    const res = await handler(event());
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.issues.find((row: any) => row.id === "issue-1")).toMatchObject({
      entry_id: "entry-1",
      entry_status: "MATCHED",
    });
    expect(body.issues.find((row: any) => row.id === "issue-2")).toMatchObject({
      entry_id: "entry-2",
      entry_status: "EXPECTED",
    });
  });

  test("first page returns limit rows with hasMore and nextCursor", async () => {
    const { handler } = await loadHandler({
      issues: [
        issue({ id: "issue-3", entry_id: "entry-3", detected_at: new Date("2026-04-25T03:00:00.000Z") }),
        issue({ id: "issue-2", entry_id: "entry-2", detected_at: new Date("2026-04-25T02:00:00.000Z") }),
        issue({ id: "issue-1", entry_id: "entry-1", detected_at: new Date("2026-04-25T01:00:00.000Z") }),
      ],
    });

    const res = await handler(event("OPEN", { limit: "2" }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.issues.map((row: any) => row.id)).toEqual(["issue-3", "issue-2"]);
    expect(body.hasMore).toBe(true);
    expect(typeof body.nextCursor).toBe("string");
  });

  test("duplicate issues sort before newer stale issues", async () => {
    const { handler } = await loadHandler({
      issues: [
        issue({
          id: "issue-stale-newest",
          entry_id: "entry-3",
          issue_type: "STALE_CHECK",
          group_key: null,
          detected_at: new Date("2026-04-25T05:00:00.000Z"),
        }),
        issue({
          id: "issue-dup-2",
          entry_id: "entry-2",
          issue_type: "DUPLICATE",
          group_key: "dup-priority",
          detected_at: new Date("2026-04-25T02:00:00.000Z"),
        }),
        issue({
          id: "issue-dup-1",
          entry_id: "entry-1",
          issue_type: "DUPLICATE",
          group_key: "dup-priority",
          detected_at: new Date("2026-04-25T01:00:00.000Z"),
        }),
      ],
    });

    const res = await handler(event("OPEN", { limit: "10" }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.issues.map((row: any) => row.id)).toEqual([
      "issue-dup-2",
      "issue-dup-1",
      "issue-stale-newest",
    ]);
    expect(body.hasMore).toBe(false);
  });

  test("cursor pagination remains stable under priority ordering", async () => {
    const { handler } = await loadHandler({
      issues: [
        issue({
          id: "issue-stale-newer",
          entry_id: "entry-3",
          issue_type: "STALE_CHECK",
          group_key: null,
          detected_at: new Date("2026-04-25T06:00:00.000Z"),
        }),
        issue({
          id: "issue-dup-newer",
          entry_id: "entry-1",
          issue_type: "DUPLICATE",
          group_key: "dup-cursor",
          detected_at: new Date("2026-04-25T05:00:00.000Z"),
        }),
        issue({
          id: "issue-dup-older",
          entry_id: "entry-2",
          issue_type: "DUPLICATE",
          group_key: "dup-cursor",
          detected_at: new Date("2026-04-25T04:00:00.000Z"),
        }),
        issue({
          id: "issue-missing",
          entry_id: "entry-4",
          issue_type: "MISSING_CATEGORY",
          group_key: null,
          detected_at: new Date("2026-04-25T03:00:00.000Z"),
        }),
        issue({
          id: "issue-stale-older",
          entry_id: "entry-5",
          issue_type: "STALE_CHECK",
          group_key: null,
          detected_at: new Date("2026-04-25T02:00:00.000Z"),
        }),
        issue({
          id: "issue-other",
          entry_id: "entry-6",
          issue_type: "REVIEW_REQUIRED",
          group_key: null,
          detected_at: new Date("2026-04-25T01:00:00.000Z"),
        }),
      ],
      entries: [
        entry({ id: "entry-1" }),
        entry({ id: "entry-2" }),
        entry({ id: "entry-3" }),
        entry({ id: "entry-4", category_id: null, category: null }),
        entry({ id: "entry-5" }),
        entry({ id: "entry-6" }),
      ],
    });

    const first = await handler(event("OPEN", { limit: "2" }));
    const firstBody = JSON.parse(first.body);
    expect(firstBody.issues.map((row: any) => row.id)).toEqual(["issue-dup-newer", "issue-dup-older"]);
    expect(firstBody.hasMore).toBe(true);

    const second = await handler(event("OPEN", { limit: "2", cursor: firstBody.nextCursor }));
    const secondBody = JSON.parse(second.body);
    expect(secondBody.issues.map((row: any) => row.id)).toEqual(["issue-missing", "issue-stale-newer"]);
    expect(secondBody.hasMore).toBe(true);

    const third = await handler(event("OPEN", { limit: "2", cursor: secondBody.nextCursor }));
    const thirdBody = JSON.parse(third.body);
    expect(thirdBody.issues.map((row: any) => row.id)).toEqual(["issue-stale-older", "issue-other"]);
    expect(thirdBody.hasMore).toBe(false);
    expect(thirdBody.nextCursor).toBeNull();
  });

  test("next page returns older rows from the cursor", async () => {
    const { handler } = await loadHandler({
      issues: [
        issue({ id: "issue-3", entry_id: "entry-3", detected_at: new Date("2026-04-25T03:00:00.000Z") }),
        issue({ id: "issue-2", entry_id: "entry-2", detected_at: new Date("2026-04-25T02:00:00.000Z") }),
        issue({ id: "issue-1", entry_id: "entry-1", detected_at: new Date("2026-04-25T01:00:00.000Z") }),
      ],
    });

    const first = await handler(event("OPEN", { limit: "2" }));
    const firstBody = JSON.parse(first.body);
    const second = await handler(event("OPEN", { limit: "2", cursor: firstBody.nextCursor }));
    expect(second.statusCode).toBe(200);

    const secondBody = JSON.parse(second.body);
    expect(secondBody.issues.map((row: any) => row.id)).toEqual(["issue-1"]);
    expect(secondBody.hasMore).toBe(false);
    expect(secondBody.nextCursor).toBeNull();
  });

  test("invalid and too-large limits are normalized safely", async () => {
    const manyIssues = Array.from({ length: 102 }, (_, i) =>
      issue({
        id: `issue-${String(i + 1).padStart(3, "0")}`,
        entry_id: `entry-${String(i + 1).padStart(3, "0")}`,
        detected_at: new Date(Date.UTC(2026, 3, 25, 12, 0, 0 - i)),
      })
    );
    const manyEntries = manyIssues.map((row) => entry({ id: row.entry_id }));
    const { handler, prisma } = await loadHandler({ issues: manyIssues, entries: manyEntries });

    const invalid = await handler(event("OPEN", { limit: "nope" }));
    expect(JSON.parse(invalid.body).issues).toHaveLength(50);
    expect(prisma.entryIssue.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 51 }));

    const tooLarge = await handler(event("OPEN", { limit: "1000" }));
    const body = JSON.parse(tooLarge.body);
    expect(body.issues).toHaveLength(100);
    expect(body.hasMore).toBe(true);
    expect(prisma.entryIssue.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 101 }));
  });

  test("duplicate group crossing the seed page boundary returns active peer issues", async () => {
    const { handler } = await loadHandler({
      issues: [
        issue({
          id: "issue-3",
          entry_id: "entry-3",
          issue_type: "DUPLICATE",
          group_key: "dup-boundary",
          detected_at: new Date("2026-04-25T03:00:00.000Z"),
        }),
        issue({
          id: "issue-2",
          entry_id: "entry-2",
          issue_type: "STALE_CHECK",
          group_key: null,
          detected_at: new Date("2026-04-25T02:00:00.000Z"),
        }),
        issue({
          id: "issue-1",
          entry_id: "entry-1",
          issue_type: "DUPLICATE",
          group_key: "dup-boundary",
          detected_at: new Date("2026-04-25T01:00:00.000Z"),
        }),
      ],
    });

    const res = await handler(event("OPEN", { limit: "1" }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.issues.map((row: any) => row.id)).toEqual(["issue-3", "issue-1"]);
    expect(body.hasMore).toBe(true);
  });

  test("duplicate group with deleted peer does not surface incomplete invalid group", async () => {
    const { handler } = await loadHandler({
      issues: [
        issue({
          id: "issue-active",
          entry_id: "entry-1",
          issue_type: "DUPLICATE",
          group_key: "dup-deleted",
          detected_at: new Date("2026-04-25T03:00:00.000Z"),
        }),
        issue({
          id: "issue-deleted",
          entry_id: "entry-deleted",
          issue_type: "DUPLICATE",
          group_key: "dup-deleted",
          detected_at: new Date("2026-04-25T02:00:00.000Z"),
        }),
      ],
      entries: [
        entry({ id: "entry-1" }),
        entry({ id: "entry-deleted", deleted_at: new Date("2026-04-25T00:00:00.000Z") }),
      ],
    });

    const res = await handler(event("OPEN", { limit: "1" }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.issues).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  test("status filtering is preserved for paginated account-wide lists", async () => {
    const { handler } = await loadHandler({
      issues: [
        issue({ id: "issue-open", entry_id: "entry-1", status: "OPEN", issue_type: "STALE_CHECK" }),
        issue({ id: "issue-resolved", entry_id: "entry-2", status: "RESOLVED", issue_type: "STALE_CHECK" }),
      ],
    });

    const res = await handler(event("RESOLVED", { limit: "10" }));
    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.status).toBe("RESOLVED");
    expect(body.issues.map((row: any) => row.id)).toEqual(["issue-resolved"]);
    expect(body.hasMore).toBe(false);
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
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
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
    expect(body.summary).toEqual({
      totalCount: 3,
      countsByType: { DUPLICATE: 2, STALE_CHECK: 1 },
      duplicateGroupCount: 1,
    });
    expect(prisma.entryIssue.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        business_id: "biz-1",
        account_id: "acct-1",
        status: "OPEN",
      }),
    }));
  });

  test("summary excludes deleted entries and singleton duplicate groups", async () => {
    const { handler } = await loadHandler({
      issues: [
        ...defaultIssues(),
        issue({ id: "issue-singleton", entry_id: "entry-4", issue_type: "DUPLICATE", group_key: "dup-single" }),
        issue({ id: "issue-deleted", entry_id: "entry-deleted", issue_type: "STALE_CHECK" }),
      ],
      entries: [
        ...defaultEntries(),
        entry({ id: "entry-4" }),
        entry({ id: "entry-deleted", deleted_at: new Date("2026-04-20T00:00:00.000Z") }),
      ],
    });

    const res = await handler(event("OPEN"));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).summary).toEqual({
      totalCount: 3,
      countsByType: { DUPLICATE: 2, STALE_CHECK: 1 },
      duplicateGroupCount: 1,
    });
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
