import { afterEach, describe, expect, test, vi } from "vitest";

function event(queryStringParameters: Record<string, string>, businessId = "biz-1", accountId = "acct-1") {
  return {
    pathParameters: { businessId, accountId },
    queryStringParameters,
    requestContext: {
      authorizer: { jwt: { claims: { sub: "actor" } } },
      http: {
        method: "GET",
        path: `/v1/businesses/${businessId}/accounts/${accountId}/bank-transactions`,
      },
    },
  };
}

function project(row: any, select: any) {
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).filter((key) => select[key]).map((key) => [key, row[key]]));
}

function tx(id: string, posted: string, created: string, overrides: Record<string, any> = {}) {
  return {
    id,
    business_id: "biz-1",
    account_id: "acct-1",
    posted_date: new Date(`${posted}T00:00:00.000Z`),
    created_at: new Date(created),
    name: id,
    amount_cents: -100n,
    is_pending: false,
    iso_currency_code: "USD",
    source: "PLAID",
    source_parser: null,
    source_upload_id: null,
    import_hash: null,
    is_removed: false,
    ...overrides,
  };
}

function matchesScalar(value: any, expected: any) {
  if (expected instanceof Date && value instanceof Date) return value.getTime() === expected.getTime();
  return value === expected;
}

function rowMatchesWhere(row: any, where: any): boolean {
  if (!where) return true;

  for (const [key, expected] of Object.entries(where)) {
    if (key === "AND") {
      if (!(expected as any[]).every((clause) => rowMatchesWhere(row, clause))) return false;
      continue;
    }

    if (key === "OR") {
      if (!(expected as any[]).some((clause) => rowMatchesWhere(row, clause))) return false;
      continue;
    }

    if (key === "id" && expected && typeof expected === "object") {
      const idsIn = (expected as any).in as string[] | undefined;
      const idsNotIn = (expected as any).notIn as string[] | undefined;
      const idLt = (expected as any).lt as string | undefined;
      if (idsIn && !idsIn.includes(row.id)) return false;
      if (idsNotIn && idsNotIn.includes(row.id)) return false;
      if (idLt && !(row.id < idLt)) return false;
      continue;
    }

    if ((key === "posted_date" || key === "created_at") && expected && typeof expected === "object" && !(expected instanceof Date)) {
      const value = row[key] as Date;
      const exp = expected as any;
      if (exp.gte && value.getTime() < exp.gte.getTime()) return false;
      if (exp.lte && value.getTime() > exp.lte.getTime()) return false;
      if (exp.lt && value.getTime() >= exp.lt.getTime()) return false;
      continue;
    }

    if (!matchesScalar(row[key], expected)) return false;
  }

  return true;
}

async function loadHandler(options: {
  rows: any[];
  matchGroupBankIds?: string[];
  bankMatchIds?: string[];
}) {
  vi.resetModules();

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async (args: any) =>
        args?.where?.business_id === "biz-1" && args?.where?.user_id === "actor" ? { role: "OWNER" } : null
      ),
    },
    account: {
      findFirst: vi.fn(async (args: any) =>
        args?.where?.business_id === "biz-1" && args?.where?.id === "acct-1" ? { id: "acct-1" } : null
      ),
    },
    matchGroupBank: {
      findMany: vi.fn(async (args: any) =>
        (options.matchGroupBankIds ?? []).map((id) => project({ bank_transaction_id: id }, args?.select))
      ),
    },
    bankMatch: {
      findMany: vi.fn(async (args: any) =>
        (options.bankMatchIds ?? []).map((id) => project({ bank_transaction_id: id }, args?.select))
      ),
    },
    bankTransaction: {
      findMany: vi.fn(async (args: any) => {
        const filtered = options.rows
          .filter((row) => rowMatchesWhere(row, args?.where))
          .sort((a, b) => {
            const postedDiff = b.posted_date.getTime() - a.posted_date.getTime();
            if (postedDiff !== 0) return postedDiff;
            const createdDiff = b.created_at.getTime() - a.created_at.getTime();
            if (createdDiff !== 0) return createdDiff;
            return String(b.id).localeCompare(String(a.id));
          })
          .slice(0, args?.take ?? undefined);

        return filtered.map((row) => project(row, args?.select));
      }),
    },
  };

  vi.doMock("./lib/db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));

  const mod = await import("./bankTransactions");
  return { handler: mod.handler, prisma };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("bank transactions list status and pagination", () => {
  test("status=unmatched returns unmatched rows even when many newer matched rows exist", async () => {
    const matched = Array.from({ length: 501 }, (_x, i) =>
      tx(`m-${String(i).padStart(3, "0")}`, "2026-04-30", `2026-04-30T12:${String(i % 60).padStart(2, "0")}:00.000Z`)
    );
    const unmatched = [
      tx("u-002", "2026-04-26", "2026-04-26T12:00:00.000Z"),
      tx("u-001", "2026-04-25", "2026-04-25T12:00:00.000Z"),
    ];
    const { handler } = await loadHandler({ rows: [...matched, ...unmatched], matchGroupBankIds: matched.map((row) => row.id) });

    const res = await handler(event({ status: "unmatched", limit: "2" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.items.map((row: any) => row.id)).toEqual(["u-002", "u-001"]);
  });

  test("status=matched returns active MatchGroup and legacy BankMatch rows", async () => {
    const rows = [
      tx("matched-group", "2026-04-28", "2026-04-28T12:00:00.000Z"),
      tx("matched-legacy", "2026-04-27", "2026-04-27T12:00:00.000Z"),
      tx("unmatched", "2026-04-29", "2026-04-29T12:00:00.000Z"),
    ];
    const { handler } = await loadHandler({
      rows,
      matchGroupBankIds: ["matched-group"],
      bankMatchIds: ["matched-legacy"],
    });

    const res = await handler(event({ status: "matched", limit: "10" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.items.map((row: any) => row.id)).toEqual(["matched-group", "matched-legacy"]);
  });

  test("status filter is applied before limit", async () => {
    const rows = [
      tx("matched-newest", "2026-04-30", "2026-04-30T12:00:00.000Z"),
      tx("unmatched-older", "2026-04-20", "2026-04-20T12:00:00.000Z"),
    ];
    const { handler } = await loadHandler({ rows, matchGroupBankIds: ["matched-newest"] });

    const res = await handler(event({ status: "unmatched", limit: "1" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.items.map((row: any) => row.id)).toEqual(["unmatched-older"]);
  });

  test("returns nextCursor when more rows exist", async () => {
    const rows = [
      tx("u-003", "2026-04-28", "2026-04-28T12:00:00.000Z"),
      tx("u-002", "2026-04-27", "2026-04-27T12:00:00.000Z"),
      tx("u-001", "2026-04-26", "2026-04-26T12:00:00.000Z"),
    ];
    const { handler } = await loadHandler({ rows });

    const res = await handler(event({ status: "unmatched", limit: "2" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.items.map((row: any) => row.id)).toEqual(["u-003", "u-002"]);
    expect(typeof body.nextCursor).toBe("string");
  });

  test("cursor fetch returns the next page", async () => {
    const rows = [
      tx("u-003", "2026-04-28", "2026-04-28T12:00:00.000Z"),
      tx("u-002", "2026-04-27", "2026-04-27T12:00:00.000Z"),
      tx("u-001", "2026-04-26", "2026-04-26T12:00:00.000Z"),
    ];
    const { handler } = await loadHandler({ rows });

    const first = await handler(event({ status: "unmatched", limit: "2" }));
    const firstBody = JSON.parse(first.body);
    const second = await handler(event({ status: "unmatched", limit: "2", cursor: firstBody.nextCursor }));
    const secondBody = JSON.parse(second.body);

    expect(second.statusCode).toBe(200);
    expect(secondBody.items.map((row: any) => row.id)).toEqual(["u-001"]);
    expect(secondBody.nextCursor).toBeNull();
  });

  test("preserves business and account scoping", async () => {
    const rows = [
      tx("scoped", "2026-04-28", "2026-04-28T12:00:00.000Z"),
      tx("other-account", "2026-04-29", "2026-04-29T12:00:00.000Z", { account_id: "acct-2" }),
      tx("other-business", "2026-04-30", "2026-04-30T12:00:00.000Z", { business_id: "biz-2" }),
    ];
    const { handler, prisma } = await loadHandler({ rows });

    const res = await handler(event({ status: "all", limit: "10" }));
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.items.map((row: any) => row.id)).toEqual(["scoped"]);
    expect(prisma.bankTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          business_id: "biz-1",
          account_id: "acct-1",
          is_removed: false,
        }),
      })
    );
  });
});
