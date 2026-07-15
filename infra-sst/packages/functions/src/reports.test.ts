import { afterEach, describe, expect, test, vi } from "vitest";

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const SALE_CATEGORY_ID = "22222222-2222-4222-8222-222222222222";
const FUEL_CATEGORY_ID = "33333333-3333-4333-8333-333333333333";

function reportsEvent(pathSuffix: string, queryStringParameters: Record<string, string> = {}) {
  const path = `/v1/businesses/${BUSINESS_ID}${pathSuffix}`;

  return {
    queryStringParameters: {
      from: "2026-04-01",
      to: "2026-04-30",
      accountId: "all",
      ...queryStringParameters,
    },
    pathParameters: { businessId: BUSINESS_ID },
    requestContext: {
      authorizer: { jwt: { claims: { sub: "user-1" } } },
      http: {
        method: "GET",
        path,
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
    business: {
      findUnique: vi.fn(async () => ({ fiscal_year_start_month: 1 })),
    },
    account: {
      findMany: vi.fn(async () => [
        { id: "account-1", name: "Checking" },
      ]),
    },
    bankConnection: {
      findMany: vi.fn(async () => []),
    },
    category: {
      findMany: vi.fn(async () => [
        { id: SALE_CATEGORY_ID, name: "Sale", archived_at: null },
        { id: FUEL_CATEGORY_ID, name: "Fuel", archived_at: null },
      ]),
    },
    entry: {
      groupBy: vi.fn(async (args: any) => {
        if (args?.where?.type === "EXPENSE") {
          return [
            {
              category_id: FUEL_CATEGORY_ID,
              _sum: { amount_cents: -2500n },
              _count: { _all: 1 },
            },
          ];
        }

        return [
          {
            category_id: SALE_CATEGORY_ID,
            _sum: { amount_cents: 10000n },
            _count: { _all: 1 },
          },
          {
            category_id: FUEL_CATEGORY_ID,
            _sum: { amount_cents: -2500n },
            _count: { _all: 1 },
          },
        ];
      }),
      findMany: vi.fn(async (args: any) => {
        if (args?.where?.type === "EXPENSE") {
          return [
            {
              id: "expense-entry",
              date: new Date("2026-04-08T00:00:00Z"),
              type: "EXPENSE",
              payee: "Fuel Station",
              memo: null,
              amount_cents: -2500n,
            },
          ];
        }

        return [
          {
            id: "income-entry",
            date: new Date("2026-04-07T00:00:00Z"),
            type: "INCOME",
            payee: "Sale",
            memo: null,
            amount_cents: 10000n,
          },
          {
            id: "expense-entry",
            date: new Date("2026-04-08T00:00:00Z"),
            type: "EXPENSE",
            payee: "Fuel Station",
            memo: null,
            amount_cents: -2500n,
          },
        ];
      }),
      count: vi.fn(async () => 1),
      aggregate: vi.fn(async (args: any) => {
        if (args?.where?.type === "INCOME") {
          return { _sum: { amount_cents: 10000n }, _count: { _all: 1 } };
        }
        if (args?.where?.type === "EXPENSE") {
          return { _sum: { amount_cents: -2500n }, _count: { _all: 1 } };
        }
        return { _sum: { amount_cents: 7500n }, _count: { _all: 2 } };
      }),
    },
    $queryRaw: vi.fn(async () => []),
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));

  const mod = await import("./reports");
  return { handler: mod.handler, prisma };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("reports category composition", () => {
  test("/reports/categories groups expense entries only", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(reportsEvent("/reports/categories"));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(prisma.entry.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: "EXPENSE" }),
    }));
    expect(body.rows).toEqual([
      {
        category_id: FUEL_CATEGORY_ID,
        category: "Fuel",
        amount_cents: "-2500",
        count: 1,
      },
      {
        category_id: null,
        category: "Uncategorized",
        amount_cents: "0",
        count: 0,
      },
    ]);
    expect(body.rows.some((row: any) => row.category === "Sale")).toBe(false);
  });

  test("/reports/categories/detail returns expense entries only", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(
      reportsEvent("/reports/categories/detail", {
        categoryId: FUEL_CATEGORY_ID,
        page: "1",
        take: "50",
      })
    );
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(prisma.entry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        type: "EXPENSE",
        category_id: FUEL_CATEGORY_ID,
      }),
    }));
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      entry_id: "expense-entry",
      type: "EXPENSE",
      payee: "Fuel Station",
      amount_cents: "-2500",
    });
  });

  test("/reports/pnl/summary keeps income totals unchanged", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(reportsEvent("/reports/pnl/summary"));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(prisma.entry.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: "INCOME" }),
    }));
    expect(body.period).toMatchObject({
      income_cents: "10000",
      expense_cents: "-2500",
      net_cents: "7500",
      income_count: 1,
      expense_count: 1,
    });
  });

  test("/reports/activity caps rows and returns a cursor", async () => {
    const { handler, prisma } = await loadHandler();

    const res = await handler(reportsEvent("/reports/activity", { limit: "1" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(prisma.entry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 2,
      orderBy: [{ date: "desc" }, { id: "desc" }],
    }));
    expect(body.rows).toHaveLength(1);
    expect(body.meta).toMatchObject({
      limit: 1,
      hasMore: true,
    });
    expect(typeof body.meta.next_cursor).toBe("string");
  });

  test("/reports/accounts/summary keeps ledger and latest bank balances separate", async () => {
    const { handler, prisma } = await loadHandler();
    (prisma.account.findMany as any).mockResolvedValueOnce([
      {
        id: "account-1",
        name: "Checking",
        type: "CHECKING",
        opening_balance_cents: 10_000n,
        opening_balance_date: new Date("2026-04-01T00:00:00Z"),
      },
    ]);
    (prisma.$queryRaw as any).mockResolvedValueOnce([{ account_id: "account-1", sum_cents: 2_500n }]);
    (prisma.bankConnection.findMany as any).mockResolvedValueOnce([
      {
        account_id: "account-1",
        status: "CONNECTED",
        last_sync_at: new Date("2026-04-30T13:00:00Z"),
        last_known_balance_cents: 13_000n,
        last_known_balance_at: new Date("2026-04-30T12:59:00Z"),
      },
    ]);

    const res = await handler(reportsEvent("/reports/accounts/summary"));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.rows).toEqual([
      {
        account_id: "account-1",
        name: "Checking",
        type: "CHECKING",
        balance_cents: "12500",
        ledger_balance_cents: "12500",
        bank_balance_cents: "13000",
        bank_balance_at: "2026-04-30T12:59:00.000Z",
        bank_last_sync_at: "2026-04-30T13:00:00.000Z",
        bank_connection_status: "CONNECTED",
      },
    ]);
    expect(prisma.bankConnection.findMany).toHaveBeenCalledWith({
      where: { business_id: BUSINESS_ID, account_id: { in: ["account-1"] } },
      select: {
        account_id: true,
        status: true,
        last_sync_at: true,
        last_known_balance_cents: true,
        last_known_balance_at: true,
      },
    });
  });
});
