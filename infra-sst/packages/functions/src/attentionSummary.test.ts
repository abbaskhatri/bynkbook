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
    $queryRaw: vi.fn(async () => options.issueRows ?? [{ issue_count: 0 }]),
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));

  const mod = await import("./attentionSummary");
  return { handler: mod.handler, prisma };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("attention summary", () => {
  test("returns scoped actionable issue and uncategorized counts", async () => {
    const { handler, prisma } = await loadHandler({
      issueRows: [{ issue_count: 3 }],
      uncategorizedCount: 7,
    });

    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      issue_count: 3,
      uncategorized_count: 7,
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

    const rawCall = (prisma.$queryRaw as any).mock.calls[0] as any[];
    const queryText = String(rawCall[0]);
    const queryValues = rawCall.slice(1);
    expect(queryText).toContain("i.status = 'OPEN'");
    expect(queryText).toContain("i.issue_type = ANY");
    expect(queryValues).toContainEqual(["DUPLICATE", "STALE_CHECK"]);
    expect(queryText).toContain("e.deleted_at IS NULL");
    expect(queryText).toContain("duplicate_group_count >= 2");
  });

  test("uncategorized count excludes deleted voided and opening rows", async () => {
    const { handler, prisma } = await loadHandler({ uncategorizedCount: 4 });

    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    expect(prisma.entry.count).toHaveBeenCalledWith({
      where: {
        business_id: "11111111-1111-4111-8111-111111111111",
        account_id: "22222222-2222-4222-8222-222222222222",
        category_id: null,
        deleted_at: null,
        NOT: [
          { status: "VOIDED" },
          { type: "OPENING" },
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

  test("omits bank_unmatched_count in M1", async () => {
    const { handler } = await loadHandler();

    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).not.toHaveProperty("bank_unmatched_count");
  });
});
