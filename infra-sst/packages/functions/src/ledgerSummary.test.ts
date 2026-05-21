import { afterEach, describe, expect, test, vi } from "vitest";

const businessId = "biz-1";
const accountId = "acct-1";

function event(queryStringParameters: Record<string, string> = {}) {
  return {
    pathParameters: { businessId, accountId },
    queryStringParameters: {
      from: "2026-04-01",
      to: "2026-04-30",
      ...queryStringParameters,
    },
    requestContext: {
      authorizer: { jwt: { claims: { sub: "actor" } } },
      http: {
        method: "GET",
        path: `/v1/businesses/${businessId}/accounts/${accountId}/ledger-summary`,
      },
    },
  };
}

async function loadHandler() {
  vi.resetModules();

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role: "OWNER" })),
    },
    account: {
      findFirst: vi.fn(async () => ({
        opening_balance_cents: 1000n,
        opening_balance_date: new Date("2026-01-01T00:00:00.000Z"),
      })),
    },
    entry: {
      aggregate: vi.fn(async (args: any) => {
        const where = args?.where ?? {};
        expect(where).toMatchObject({
          business_id: businessId,
          account_id: accountId,
          deleted_at: null,
          status: { notIn: ["DELETED", "SOFT_DELETED", "VOIDED", "REMOVED"] },
          type: { in: ["INCOME", "EXPENSE"] },
        });

        if (where.amount_cents?.gt === 0n) return { _sum: { amount_cents: 5000n } };
        if (where.amount_cents?.lt === 0n) return { _sum: { amount_cents: -1200n } };
        if (where.date?.lte && !where.date?.gte) return { _sum: { amount_cents: 3300n } };
        return { _sum: { amount_cents: 3800n } };
      }),
    },
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));

  const mod = await import("./ledgerSummary");
  return { handler: mod.handler, prisma };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("ledger summary active accounting totals", () => {
  test("excludes inactive and non-income-expense entries from totals and balance", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(event());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(prisma.entry.aggregate).toHaveBeenCalledTimes(4);
    expect(body.totals).toEqual({
      income_cents: "5000",
      expense_cents: "1200",
      net_cents: "3800",
    });
    expect(body.balance_cents).toBe("4300");
  });
});
