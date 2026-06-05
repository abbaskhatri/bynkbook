import { afterEach, describe, expect, test, vi } from "vitest";

const businessId = "biz-1";
const accountId = "acct-1";

function event(queryStringParameters: Record<string, string> = {}) {
  return {
    pathParameters: { businessId, accountId },
    queryStringParameters,
    requestContext: {
      authorizer: { jwt: { claims: { sub: "actor" } } },
      http: {
        method: "GET",
        path: `/v1/businesses/${businessId}/accounts/${accountId}/entries`,
      },
    },
  };
}

function entry(overrides: Record<string, any>) {
  return {
    id: overrides.id,
    business_id: businessId,
    account_id: accountId,
    date: new Date(overrides.date + "T00:00:00.000Z"),
    created_at: new Date(overrides.created_at),
    updated_at: new Date(overrides.created_at),
    payee: overrides.payee ?? "Payee",
    memo: overrides.memo ?? null,
    amount_cents: BigInt(overrides.amount_cents),
    type: overrides.type ?? (BigInt(overrides.amount_cents) < 0n ? "EXPENSE" : "INCOME"),
    method: overrides.method ?? "OTHER",
    status: overrides.status ?? "EXPECTED",
    category_id: overrides.category_id ?? null,
    vendor_id: overrides.vendor_id ?? null,
    transfer_id: overrides.transfer_id ?? null,
    entry_kind: overrides.entry_kind ?? "GENERAL",
    is_adjustment: overrides.is_adjustment ?? false,
    deleted_at: overrides.deleted_at ?? null,
  };
}

function project(row: any, select: any) {
  if (!row || !select) return row ? { ...row } : row;
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

function sameDate(a: any, b: any) {
  return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
}

function valueMatches(value: any, expected: any): boolean {
  if (expected && typeof expected === "object" && !(expected instanceof Date)) {
    if ("not" in expected) return value !== expected.not;
    if ("lt" in expected) return value < expected.lt;
    if ("lte" in expected && !(value <= expected.lte)) return false;
    if ("gte" in expected && !(value >= expected.gte)) return false;
    if ("lte" in expected || "gte" in expected) return true;
    if (Array.isArray(expected.in)) return expected.in.includes(value);
    if ("contains" in expected) return String(value ?? "").toLowerCase().includes(String(expected.contains).toLowerCase());
    if ("startsWith" in expected) return String(value ?? "").toLowerCase().startsWith(String(expected.startsWith).toLowerCase());
  }
  if (sameDate(value, expected)) return true;
  return value === expected;
}

function rowMatchesWhere(row: any, where: any): boolean {
  for (const [key, expected] of Object.entries(where ?? {})) {
    if (key === "AND") {
      if (!(expected as any[]).every((part) => rowMatchesWhere(row, part))) return false;
      continue;
    }
    if (key === "OR") {
      if (!(expected as any[]).some((part) => rowMatchesWhere(row, part))) return false;
      continue;
    }
    if (key === "NOT") {
      const parts = Array.isArray(expected) ? expected : [expected];
      if (parts.some((part) => rowMatchesWhere(row, part))) return false;
      continue;
    }
    if (!valueMatches(row[key], expected)) return false;
  }
  return true;
}

function sortRows(rows: any[], order: "asc" | "desc") {
  return rows.slice().sort((a, b) => {
    const sign = order === "asc" ? 1 : -1;
    if (a.date.getTime() !== b.date.getTime()) return (a.date.getTime() - b.date.getTime()) * sign;
    if (a.created_at.getTime() !== b.created_at.getTime()) {
      return (a.created_at.getTime() - b.created_at.getTime()) * sign;
    }
    return (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) * sign;
  });
}

async function loadHandler(rowsInput: any[]) {
  vi.resetModules();

  const rows = rowsInput.slice();

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async (args: any) =>
        args?.where?.business_id === businessId && args?.where?.user_id === "actor" ? { role: "OWNER" } : null
      ),
    },
    account: {
      findFirst: vi.fn(async (args: any) => {
        if (args?.where?.business_id !== businessId || args?.where?.id !== accountId) return null;
        if (args?.select?.opening_balance_cents) return { opening_balance_cents: 100n };
        return { id: accountId };
      }),
      findMany: vi.fn(async () => []),
    },
    entry: {
      findMany: vi.fn(async (args: any) => {
        const order = args?.orderBy?.[0]?.date === "asc" ? "asc" : "desc";
        const filtered = sortRows(rows.filter((row) => rowMatchesWhere(row, args?.where)), order);
        const taken = typeof args?.take === "number" ? filtered.slice(0, args.take) : filtered;
        return taken.map((row) => project(row, args?.select));
      }),
      findFirst: vi.fn(async (args: any) => {
        const order = args?.orderBy?.[0]?.date === "asc" ? "asc" : "desc";
        const filtered = sortRows(rows.filter((row) => rowMatchesWhere(row, args?.where)), order);
        if (!filtered.length) return null;
        return project(filtered[0], args?.select);
      }),
      count: vi.fn(async (args: any) => rows.filter((row) => rowMatchesWhere(row, args?.where)).length),
      aggregate: vi.fn(async (args: any) => {
        const filtered = rows.filter((row) => rowMatchesWhere(row, args?.where));
        const out: any = {};
        if (args?._sum) {
          out._sum = {};
          for (const key of Object.keys(args._sum)) {
            if (args._sum[key]) {
              out._sum[key] = filtered.reduce((acc: bigint, row: any) => {
                const v = row?.[key];
                if (typeof v === "bigint") return acc + v;
                if (v == null) return acc;
                return acc + BigInt(String(v));
              }, 0n);
            }
          }
        }
        return out;
      }),
    },
    transfer: {
      findMany: vi.fn(async () => []),
    },
    category: {
      findMany: vi.fn(async () => []),
    },
    vendor: {
      findMany: vi.fn(async () => []),
    },
  };

  vi.doMock("./lib/db", () => ({ getPrisma: vi.fn(async () => prisma) }));
  vi.doMock("./lib/activityLog", () => ({ logActivity: vi.fn() }));
  vi.doMock("./lib/authz", () => ({ authorizeWrite: vi.fn(async () => ({ allowed: true })) }));
  vi.doMock("./lib/categoryMemoryWriteback", () => ({ writeCategoryMemoryFeedback: vi.fn() }));
  vi.doMock("./aiCategorySuggestions", () => ({ computeCategorySuggestionsForItems: vi.fn(async () => ({ suggestionsById: {} })) }));
  vi.doMock("./lib/categorySuggestionScoring", () => ({ isBulkSafeCategorySuggestion: vi.fn(() => false) }));

  const mod = await import("./entries");
  return { handler: mod.handler, prisma };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("entries list pagination and canonical balances", () => {
  test("returns hasMore, nextCursor, totalCount, and older entries on the next page", async () => {
    const { handler } = await loadHandler([
      entry({ id: "11111111-1111-4111-8111-111111111111", date: "2026-01-01", created_at: "2026-01-01T10:00:00.000Z", amount_cents: "1000" }),
      entry({ id: "22222222-2222-4222-8222-222222222222", date: "2026-02-01", created_at: "2026-02-01T10:00:00.000Z", amount_cents: "-500", deleted_at: new Date("2026-02-02T00:00:00.000Z") }),
      entry({ id: "33333333-3333-4333-8333-333333333333", date: "2026-03-01", created_at: "2026-03-01T10:00:00.000Z", amount_cents: "-200" }),
    ]);

    const first = await handler(event({ limit: "2", include_deleted: "true" }));
    const firstBody = JSON.parse(first.body);

    expect(first.statusCode).toBe(200);
    expect(firstBody.entries.map((e: any) => e.id)).toEqual([
      "33333333-3333-4333-8333-333333333333",
      "22222222-2222-4222-8222-222222222222",
    ]);
    expect(firstBody.totalCount).toBe(3);
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const second = await handler(event({ limit: "2", include_deleted: "true", cursor: firstBody.nextCursor }));
    const secondBody = JSON.parse(second.body);

    expect(secondBody.entries.map((e: any) => e.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(secondBody.hasMore).toBe(false);
    expect(secondBody.nextCursor).toBeNull();
  });

  test("includeDeleted does not affect active running balances and deleted rows are audit-only", async () => {
    const rows = [
      entry({ id: "11111111-1111-4111-8111-111111111111", date: "2026-01-01", created_at: "2026-01-01T10:00:00.000Z", amount_cents: "1000" }),
      entry({ id: "22222222-2222-4222-8222-222222222222", date: "2026-02-01", created_at: "2026-02-01T10:00:00.000Z", amount_cents: "-500", deleted_at: new Date("2026-02-02T00:00:00.000Z") }),
      entry({ id: "33333333-3333-4333-8333-333333333333", date: "2026-03-01", created_at: "2026-03-01T10:00:00.000Z", amount_cents: "-200" }),
    ];
    const { handler } = await loadHandler(rows);

    const activeOnly = JSON.parse((await handler(event({ limit: "10" }))).body);
    const withDeleted = JSON.parse((await handler(event({ limit: "10", include_deleted: "true" }))).body);

    const activeMarch = activeOnly.entries.find((e: any) => e.id === "33333333-3333-4333-8333-333333333333");
    const deletedFeb = withDeleted.entries.find((e: any) => e.id === "22222222-2222-4222-8222-222222222222");
    const withDeletedMarch = withDeleted.entries.find((e: any) => e.id === "33333333-3333-4333-8333-333333333333");
    const withDeletedJan = withDeleted.entries.find((e: any) => e.id === "11111111-1111-4111-8111-111111111111");

    expect(activeOnly.totalCount).toBe(2);
    expect(withDeleted.totalCount).toBe(3);
    expect(activeMarch.running_balance_cents).toBe("900");
    expect(withDeletedMarch.running_balance_cents).toBe("900");
    expect(withDeletedJan.running_balance_cents).toBe("1100");
    expect(deletedFeb.running_balance_cents).toBeNull();
  });

  test("list query remains scoped to the requested business and account", async () => {
    const { handler, prisma } = await loadHandler([
      entry({ id: "11111111-1111-4111-8111-111111111111", date: "2026-01-01", created_at: "2026-01-01T10:00:00.000Z", amount_cents: "1000" }),
    ]);

    await handler(event({ limit: "10" }));

    expect(prisma.entry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          business_id: businessId,
          account_id: accountId,
          deleted_at: null,
        }),
      })
    );
    expect(prisma.entry.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ business_id: businessId, account_id: accountId, deleted_at: null }),
    });
  });

  test("uncategorized category review pages older rows with truthful count", async () => {
    const categoryId = "cat-1";
    const { handler } = await loadHandler([
      entry({ id: "11111111-1111-4111-8111-111111111111", date: "2026-01-01", created_at: "2026-01-01T10:00:00.000Z", amount_cents: "-100" }),
      entry({ id: "22222222-2222-4222-8222-222222222222", date: "2026-02-01", created_at: "2026-02-01T10:00:00.000Z", amount_cents: "-200", type: "TRANSFER" }),
      entry({ id: "33333333-3333-4333-8333-333333333333", date: "2026-03-01", created_at: "2026-03-01T10:00:00.000Z", amount_cents: "300" }),
      entry({ id: "44444444-4444-4444-8444-444444444444", date: "2026-04-01", created_at: "2026-04-01T10:00:00.000Z", amount_cents: "-400", category_id: categoryId }),
      entry({ id: "55555555-5555-4555-8555-555555555555", date: "2026-05-01", created_at: "2026-05-01T10:00:00.000Z", amount_cents: "-500" }),
      entry({ id: "66666666-6666-4666-8666-666666666666", date: "2026-06-01", created_at: "2026-06-01T10:00:00.000Z", amount_cents: "-600", payee: "Opening balance import" }),
    ]);

    const first = await handler(event({
      limit: "2",
      type: "EXPENSE,INCOME",
      uncategorized: "true",
      exclude_opening: "true",
    }));
    const firstBody = JSON.parse(first.body);

    expect(first.statusCode).toBe(200);
    expect(firstBody.entries.map((e: any) => e.id)).toEqual([
      "55555555-5555-4555-8555-555555555555",
      "33333333-3333-4333-8333-333333333333",
    ]);
    expect(firstBody.totalCount).toBe(3);
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const second = await handler(event({
      limit: "2",
      type: "EXPENSE,INCOME",
      uncategorized: "true",
      exclude_opening: "true",
      cursor: firstBody.nextCursor,
    }));
    const secondBody = JSON.parse(second.body);

    expect(secondBody.entries.map((e: any) => e.id)).toEqual(["11111111-1111-4111-8111-111111111111"]);
    expect(secondBody.totalCount).toBe(3);
    expect(secondBody.hasMore).toBe(false);
    expect(secondBody.nextCursor).toBeNull();
  });

  test("uncategorized pagination preserves search and date filters", async () => {
    const { handler, prisma } = await loadHandler([
      entry({ id: "11111111-1111-4111-8111-111111111111", date: "2026-01-01", created_at: "2026-01-01T10:00:00.000Z", amount_cents: "-100", payee: "Coffee Jan" }),
      entry({ id: "22222222-2222-4222-8222-222222222222", date: "2026-02-01", created_at: "2026-02-01T10:00:00.000Z", amount_cents: "-200", payee: "Coffee Feb" }),
      entry({ id: "33333333-3333-4333-8333-333333333333", date: "2026-03-01", created_at: "2026-03-01T10:00:00.000Z", amount_cents: "-300", payee: "Office Mar" }),
      entry({ id: "44444444-4444-4444-8444-444444444444", date: "2026-04-01", created_at: "2026-04-01T10:00:00.000Z", amount_cents: "-400", payee: "Coffee Apr" }),
    ]);

    const res = await handler(event({
      limit: "10",
      type: "EXPENSE,INCOME",
      uncategorized: "true",
      exclude_opening: "true",
      search: "coffee",
      date_from: "2026-02-01",
      date_to: "2026-03-31",
    }));
    const body = JSON.parse(res.body);

    expect(body.entries.map((e: any) => e.id)).toEqual(["22222222-2222-4222-8222-222222222222"]);
    expect(body.totalCount).toBe(1);
    expect(prisma.entry.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        business_id: businessId,
        account_id: accountId,
        deleted_at: null,
        category_id: null,
        type: { in: ["EXPENSE", "INCOME"] },
        date: {
          gte: new Date("2026-02-01T00:00:00Z"),
          lte: new Date("2026-03-31T00:00:00Z"),
        },
      }),
    });
  });
});
