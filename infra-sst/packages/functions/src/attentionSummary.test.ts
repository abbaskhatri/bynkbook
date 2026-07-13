import { afterEach, describe, expect, test, vi } from "vitest";

function event(overrides: Record<string, any> = {}) {
  return {
    pathParameters: {
      businessId: overrides.businessId ?? "11111111-1111-4111-8111-111111111111",
      accountId: overrides.accountId ?? "22222222-2222-4222-8222-222222222222",
    },
    requestContext: {
      authorizer: { jwt: { claims: { sub: overrides.userId ?? "user-1" } } },
      http: { method: overrides.method ?? "GET" },
    },
  };
}

async function loadHandler(options: {
  role?: string | null;
  account?: any;
  issueRows?: any[];
  bankUnmatchedRows?: any[];
  bankUnmatchedError?: Error;
  uncategorizedCount?: number;
} = {}) {
  vi.resetModules();

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => options.role === undefined ? { role: "OWNER" } : options.role ? { role: options.role } : null),
    },
    account: {
      findFirst: vi.fn(async () => options.account === undefined ? { id: "22222222-2222-4222-8222-222222222222" } : options.account),
    },
    entry: {
      count: vi.fn(async () => options.uncategorizedCount ?? 0),
    },
    entryIssue: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $queryRaw: vi.fn(async (strings: any) => {
      const queryText = String(strings);
      if (queryText.includes("FROM bank_transaction bt")) {
        if (options.bankUnmatchedError) throw options.bankUnmatchedError;
        return options.bankUnmatchedRows ?? [{ bank_unmatched_count: 0 }];
      }
      return options.issueRows ?? [{ issue_count: 0 }];
    }),
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));

  const mod = await import("./attentionSummary");
  return { handler: mod.handler, prisma };
}

type RawQueryCall = { text: string; values: any[] };

function rawQueryCalls(prisma: any): RawQueryCall[] {
  return (prisma.$queryRaw as any).mock.calls.map((call: any[]) => ({
    text: String(call[0]),
    values: call.slice(1),
  }));
}

function bankUnmatchedQuery(prisma: any) {
  const call = rawQueryCalls(prisma).find((item: RawQueryCall) => item.text.includes("FROM bank_transaction bt"));
  expect(call).toBeTruthy();
  return call as RawQueryCall;
}

function issueQuery(prisma: any) {
  const call = rawQueryCalls(prisma).find((item: RawQueryCall) => item.text.includes("FROM entry_issues i"));
  expect(call).toBeTruthy();
  return call as RawQueryCall;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("attention summary", () => {
  test("returns scoped actionable issue and uncategorized counts", async () => {
    const { handler, prisma } = await loadHandler({
      issueRows: [{ issue_count: 3 }],
      bankUnmatchedRows: [{ bank_unmatched_count: 5 }],
      uncategorizedCount: 7,
    });

    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      issue_count: 3,
      uncategorized_count: 7,
      bank_unmatched_count: 5,
    });

    expect(prisma.userBusinessRole.findFirst).toHaveBeenCalledWith({
      where: { business_id: "11111111-1111-4111-8111-111111111111", user_id: "user-1" },
      select: { role: true },
    });
    expect(prisma.account.findFirst).toHaveBeenCalledWith({
      where: {
        id: "22222222-2222-4222-8222-222222222222",
        business_id: "11111111-1111-4111-8111-111111111111",
      },
      select: { id: true },
    });
  });

  test("rejects non-member access before count queries", async () => {
    const { handler, prisma } = await loadHandler({ role: null });

    const res = await handler(event());
    expect(res.statusCode).toBe(403);
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.entry.count).not.toHaveBeenCalled();
  });

  test("rejects cross-business account access before count queries", async () => {
    const { handler, prisma } = await loadHandler({ account: null });

    const res = await handler(event());
    expect(res.statusCode).toBe(404);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.entry.count).not.toHaveBeenCalled();
  });

  test("issue count query is open duplicate/stale scoped and excludes deleted entries", async () => {
    const { handler, prisma } = await loadHandler({ issueRows: [{ issue_count: 2 }] });

    const res = await handler(event());
    expect(res.statusCode).toBe(200);

    const { text: queryText, values: queryValues } = issueQuery(prisma);
    expect(queryText).toContain("i.status = 'OPEN'");
    expect(queryText).toContain("i.issue_type = ANY");
    expect(queryValues).toContainEqual(["DUPLICATE", "STALE_CHECK"]);
    expect(queryText).toContain("e.deleted_at IS NULL");
    expect(queryText).toContain("duplicate_group_count >= 2");
  });

  test("uncategorized count matches the actionable income and expense review queue", async () => {
    const { handler, prisma } = await loadHandler({ uncategorizedCount: 4 });

    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    expect(prisma.entry.count).toHaveBeenCalledWith({
      where: {
        business_id: "11111111-1111-4111-8111-111111111111",
        account_id: "22222222-2222-4222-8222-222222222222",
        category_id: null,
        deleted_at: null,
        type: { in: ["EXPENSE", "INCOME"] },
        status: { notIn: ["VOIDED", "DELETED", "SOFT_DELETED", "REMOVED"] },
        NOT: [
          { payee: { startsWith: "opening balance", mode: "insensitive" } },
        ],
      },
    });
  });

  test("does not run issue scan or mutate issue rows", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    expect(prisma.entryIssue.findMany).not.toHaveBeenCalled();
    expect(prisma.entryIssue.count).not.toHaveBeenCalled();
    expect(prisma.entryIssue.create).not.toHaveBeenCalled();
    expect(prisma.entryIssue.update).not.toHaveBeenCalled();
    expect(prisma.entryIssue.updateMany).not.toHaveBeenCalled();
  });

  test("bank_unmatched_count counts scoped active unmatched bank transactions", async () => {
    const { handler, prisma } = await loadHandler({
      bankUnmatchedRows: [{ bank_unmatched_count: 6 }],
    });

    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ bank_unmatched_count: 6 });

    const { text: queryText, values: queryValues } = bankUnmatchedQuery(prisma);
    expect(queryText).toContain("SELECT COUNT(*)::int AS bank_unmatched_count");
    expect(queryText).toContain("FROM bank_transaction bt");
    expect(queryText).toContain("bt.business_id =");
    expect(queryText).toContain("bt.account_id =");
    expect(queryValues).toContain("11111111-1111-4111-8111-111111111111");
    expect(queryValues).toContain("22222222-2222-4222-8222-222222222222");
  });

  test("preserves issue and category counts when bank unmatched count is unavailable", async () => {
    const { handler } = await loadHandler({
      issueRows: [{ issue_count: 3 }],
      uncategorizedCount: 7,
      bankUnmatchedError: new Error("bank count unavailable"),
    });

    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      issue_count: 3,
      uncategorized_count: 7,
      bank_unmatched_count: null,
    });
  });

  test("bank_unmatched_count excludes is_removed bank transactions", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(event());
    expect(res.statusCode).toBe(200);

    const { text: queryText } = bankUnmatchedQuery(prisma);
    expect(queryText).toContain("bt.is_removed = false");
  });

  test("bank_unmatched_count excludes active MatchGroup-linked bank transactions", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(event());
    expect(res.statusCode).toBe(200);

    const { text: queryText } = bankUnmatchedQuery(prisma);
    expect(queryText).toContain("NOT EXISTS");
    expect(queryText).toContain("FROM match_group_bank mgb");
    expect(queryText).toContain("INNER JOIN match_group mg");
    expect(queryText).toContain("mgb.bank_transaction_id = bt.id");
    expect(queryText).toContain("mg.status = 'ACTIVE'");
  });

  test("bank_unmatched_count includes voided or inactive MatchGroup-linked bank transactions", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(event());
    expect(res.statusCode).toBe(200);

    const { text: queryText } = bankUnmatchedQuery(prisma);
    expect(queryText).toContain("mg.status = 'ACTIVE'");
    expect(queryText).not.toContain("mg.status <> 'ACTIVE'");
    expect(queryText).not.toContain("mg.voided_at IS NULL");
  });

  test("bank_unmatched_count excludes unvoided legacy BankMatch transactions", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(event());
    expect(res.statusCode).toBe(200);

    const { text: queryText } = bankUnmatchedQuery(prisma);
    expect(queryText).toContain("FROM bank_match bm");
    expect(queryText).toContain("bm.bank_transaction_id = bt.id");
    expect(queryText).toContain("bm.voided_at IS NULL");
  });

  test("bank_unmatched_count includes voided legacy BankMatch transactions", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(event());
    expect(res.statusCode).toBe(200);

    const { text: queryText } = bankUnmatchedQuery(prisma);
    expect(queryText).toContain("bm.voided_at IS NULL");
    expect(queryText).not.toContain("bm.voided_at IS NOT NULL");
  });

  test("bank_unmatched_count preserves cross-business and account isolation", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(event({
      businessId: "33333333-3333-4333-8333-333333333333",
      accountId: "44444444-4444-4444-8444-444444444444",
    }));
    expect(res.statusCode).toBe(200);

    const { text: queryText, values: queryValues } = bankUnmatchedQuery(prisma);
    expect(queryText).toContain("bt.business_id =");
    expect(queryText).toContain("bt.account_id =");
    expect(queryText).toContain("mgb.business_id = bt.business_id");
    expect(queryText).toContain("mgb.account_id = bt.account_id");
    expect(queryText).toContain("bm.business_id = bt.business_id");
    expect(queryText).toContain("bm.account_id = bt.account_id");
    expect(queryValues).toContain("33333333-3333-4333-8333-333333333333");
    expect(queryValues).toContain("44444444-4444-4444-8444-444444444444");
  });
});
