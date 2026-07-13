import { afterEach, describe, expect, test, vi } from "vitest";

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";

function previewEvent(overrides: Record<string, any> = {}) {
  return {
    pathParameters: {
      businessId: overrides.businessId ?? BUSINESS_ID,
    },
    queryStringParameters: {
      from: overrides.from ?? "2026-01-01",
      to: overrides.to ?? "2026-01-31",
      accountId: overrides.accountId ?? ACCOUNT_ID,
    },
    requestContext: {
      authorizer: { jwt: { claims: { sub: overrides.userId ?? "user-1" } } },
      http: {
        method: "GET",
        path: `/v1/businesses/${overrides.businessId ?? BUSINESS_ID}/closed-periods/preview`,
      },
    },
  };
}

async function loadHandler(options: {
  role?: string | null;
  total?: number;
  reconciled?: number;
  issuesOpen?: number;
  uncategorized?: number;
} = {}) {
  vi.resetModules();

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () =>
        options.role === undefined ? { role: "OWNER" } : options.role ? { role: options.role } : null
      ),
    },
    $queryRawUnsafe: vi.fn(async (query: string) => {
      if (query.includes("active_match_group_amounts")) return [{ n: options.reconciled ?? 0 }];
      if (query.includes("FROM \"entry_issues\"")) return [{ n: options.issuesOpen ?? 0 }];
      if (query.includes("e.category_id IS NULL")) return [{ n: options.uncategorized ?? 0 }];
      return [{ n: options.total ?? 0 }];
    }),
    closedPeriod: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));
  vi.doMock("./lib/activityLog", () => ({
    logActivity: vi.fn(),
  }));

  const mod = await import("./closedPeriods");
  return { handler: mod.handler, prisma };
}

function rawQueryTexts(prisma: any): string[] {
  return (prisma.$queryRawUnsafe as any).mock.calls.map((call: any[]) => String(call[0]));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("closed period preview", () => {
  test("counts reconciled entries from active match groups separately from category completeness", async () => {
    const { handler, prisma } = await loadHandler({
      total: 3,
      reconciled: 2,
      issuesOpen: 1,
      uncategorized: 1,
    });

    const res = await handler(previewEvent());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.stats).toMatchObject({
      entries_total: 3,
      entries_reconciled: 2,
      entries_unreconciled: 1,
      issues_open: 1,
      entries_uncategorized: 1,
      is_clean: false,
    });

    const reconciledQuery = rawQueryTexts(prisma).find((query) => query.includes("active_match_group_amounts"));
    expect(reconciledQuery).toBeTruthy();
    expect(reconciledQuery).toContain("FROM \"match_group_entry\" mge");
    expect(reconciledQuery).toContain("INNER JOIN \"match_group\" mg");
    expect(reconciledQuery).toContain("mg.status = 'ACTIVE'");
    expect(reconciledQuery).toContain("mg.voided_at IS NULL");
    expect(reconciledQuery).toContain("FROM \"match_group_bank\" mgb");
    expect(reconciledQuery).toContain("COALESCE(mgm.matched_abs_cents, 0) >= ABS(e.amount_cents)");
    expect(reconciledQuery).not.toContain("category_id IS NULL");
  });

  test("excludes opening balance rows from period totals and issue counts", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(previewEvent());
    expect(res.statusCode).toBe(200);

    for (const queryText of rawQueryTexts(prisma).filter((query) => !query.includes("e.category_id IS NULL"))) {
      expect(queryText).toContain("UPPER(COALESCE(e.type, '')) <> 'OPENING'");
      expect(queryText).toContain("NOT LIKE 'opening balance%'");
    }

    const uncategorizedQuery = rawQueryTexts(prisma).find((query) => query.includes("e.category_id IS NULL"));
    expect(uncategorizedQuery).toContain("NOT LIKE 'opening balance%'");
    expect(uncategorizedQuery).toContain("NOT IN ('VOIDED', 'DELETED', 'SOFT_DELETED', 'REMOVED')");
  });

  test("rejects non-member access before preview queries", async () => {
    const { handler, prisma } = await loadHandler({ role: null });

    const res = await handler(previewEvent());

    expect(res.statusCode).toBe(403);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
