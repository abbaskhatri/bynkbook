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
});
