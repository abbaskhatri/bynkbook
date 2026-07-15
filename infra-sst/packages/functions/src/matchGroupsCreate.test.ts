import { afterEach, describe, expect, test, vi } from "vitest";

function createEvent() {
  return {
    pathParameters: { businessId: "biz-1", accountId: "acct-1" },
    body: JSON.stringify({
      bankTransactionIds: ["bank-1"],
      entryIds: ["entry-1"],
    }),
    requestContext: {
      authorizer: { jwt: { claims: { sub: "actor" } } },
      http: {
        method: "POST",
        path: "/v1/businesses/biz-1/accounts/acct-1/match-groups",
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("match group creation", () => {
  test("acquires Prisma-safe locks before creating a balanced match", async () => {
    vi.resetModules();

    const queryRawUnsafe = vi.fn(async (sql: string, ..._params: any[]) => {
      if (!sql.includes("::text AS lock_result")) {
        throw new Error("Failed to deserialize column of type void");
      }
      return [{ lock_result: "" }];
    });
    const createdBankLinks: any[] = [];
    const createdEntryLinks: any[] = [];
    const tx: any = {
      bankTransaction: {
        findMany: vi.fn(async () => [{
          id: "bank-1",
          amount_cents: -614600n,
          posted_date: new Date("2026-07-13T00:00:00.000Z"),
          is_pending: false,
        }]),
      },
      entry: {
        findMany: vi.fn(async () => [{
          id: "entry-1",
          amount_cents: -614600n,
          date: new Date("2026-07-07T00:00:00.000Z"),
          is_adjustment: false,
        }]),
      },
      matchGroupBank: {
        findFirst: vi.fn(async () => null),
        createMany: vi.fn(async ({ data }: any) => {
          createdBankLinks.push(...data);
          return { count: data.length };
        }),
      },
      matchGroupEntry: {
        findFirst: vi.fn(async () => null),
        createMany: vi.fn(async ({ data }: any) => {
          createdEntryLinks.push(...data);
          return { count: data.length };
        }),
      },
      matchGroup: {
        create: vi.fn(async () => ({
          id: "group-1",
          direction: "OUTFLOW",
          status: "ACTIVE",
          created_at: new Date("2026-07-15T00:00:00.000Z"),
        })),
      },
      activityLog: { create: vi.fn(async ({ data }: any) => data) },
      $queryRawUnsafe: queryRawUnsafe,
    };
    const prisma: any = {
      userBusinessRole: { findFirst: vi.fn(async () => ({ role: "OWNER" })) },
      account: { findFirst: vi.fn(async () => ({ id: "acct-1" })) },
      entry: tx.entry,
      closedPeriod: { findFirst: vi.fn(async () => null) },
      $transaction: vi.fn(async (callback: any) => callback(tx)),
    };

    vi.doMock("./lib/db", () => ({ getPrisma: vi.fn(async () => prisma) }));
    vi.doMock("./lib/authz", () => ({ authorizeWrite: vi.fn(async () => ({ allowed: true })) }));

    const { handler } = await import("./matchGroups");
    const response = await handler(createEvent());
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(201);
    expect(body).toEqual({ ok: true, match_group_id: "group-1" });
    expect(queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(queryRawUnsafe.mock.calls.map((call) => call[1])).toEqual([
      "match-bank:biz-1:acct-1:bank-1",
      "match-entry:biz-1:acct-1:entry-1",
    ]);
    expect(createdBankLinks).toEqual([
      expect.objectContaining({ bank_transaction_id: "bank-1", matched_amount_cents: 614600n }),
    ]);
    expect(createdEntryLinks).toEqual([
      expect.objectContaining({ entry_id: "entry-1", matched_amount_cents: 614600n }),
    ]);
  });
});
