import { afterEach, describe, expect, test, vi } from "vitest";

const baseConn = {
  business_id: "biz-1",
  account_id: "acct-1",
  plaid_item_id: "item-1",
  plaid_account_id: "plaid-acct-1",
  access_token_ciphertext: "ciphertext",
  effective_start_date: new Date("2026-01-01T00:00:00Z"),
  sync_cursor: null,
  has_new_transactions: true,
  opening_adjustment_created_at: new Date("2026-01-02T00:00:00Z"),
};

function makeTransaction(overrides: Record<string, any>) {
  return {
    transaction_id: "txn-1",
    account_id: "plaid-acct-1",
    date: "2026-04-15",
    authorized_date: "2026-04-14",
    amount: 12.34,
    name: "Coffee",
    merchant_name: "Coffee",
    pending: false,
    iso_currency_code: "USD",
    ...overrides,
  };
}

async function loadSyncTransactions(options: {
  conn?: Record<string, any>;
  plaid?: Record<string, any>;
  prisma?: Record<string, any>;
}) {
  vi.resetModules();

  const plaid = {
    accountsBalanceGet: vi.fn(async () => ({
      data: {
        accounts: [{ account_id: "plaid-acct-1", balances: { current: 100 } }],
      },
    })),
    transactionsSync: vi.fn(async () => ({
      data: {
        added: [],
        modified: [],
        removed: [],
        next_cursor: "cursor-next",
        has_more: false,
      },
    })),
    ...options.plaid,
  };

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role: "OWNER" })),
    },
    account: {
      findFirst: vi.fn(async () => ({ id: "acct-1" })),
      update: vi.fn(async () => ({})),
    },
    bankConnection: {
      findFirst: vi.fn(async () => ({ ...baseConn, ...options.conn })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    bankTransaction: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 0),
      aggregate: vi.fn(async () => ({ _sum: { amount_cents: 0n } })),
    },
    entry: {
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
    ...options.prisma,
  };

  vi.doMock("./db", () => ({
    getPrisma: vi.fn(async () => prisma),
  }));
  vi.doMock("./plaidClient", () => ({
    getPlaidClient: vi.fn(async () => plaid),
  }));
  vi.doMock("./plaidCrypto", () => ({
    decryptAccessToken: vi.fn(async () => "access-token-redacted"),
    encryptAccessToken: vi.fn(async () => "ciphertext"),
  }));

  const mod = await import("./plaidService");
  return { syncTransactions: mod.syncTransactions, plaid, prisma };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("syncTransactions", () => {
  test("only upserts transactions for the mapped Plaid account and safely scopes removals", async () => {
    const matchingAdded = makeTransaction({ transaction_id: "txn-added-mapped" });
    const otherAdded = makeTransaction({ transaction_id: "txn-added-other", account_id: "plaid-acct-2" });
    const matchingModified = makeTransaction({ transaction_id: "txn-modified-mapped", amount: 5 });

    const { syncTransactions, prisma } = await loadSyncTransactions({
      plaid: {
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [matchingAdded, otherAdded],
            modified: [matchingModified],
            removed: [{ transaction_id: "txn-removed" }],
            next_cursor: "cursor-next",
            has_more: false,
          },
        })),
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    expect(res.statusCode).toBe(200);

    const createCalls = (prisma.bankTransaction.create as any).mock.calls as any[][];
    const updateCalls = (prisma.bankTransaction.updateMany as any).mock.calls as any[][];
    const createdIds = createCalls.map((call) => call[0].data.plaid_transaction_id);
    expect(createdIds).toEqual(["txn-added-mapped", "txn-modified-mapped"]);
    expect(createdIds).not.toContain("txn-added-other");

    const removedCall = updateCalls.find((call) => call[0].where?.plaid_transaction_id === "txn-removed");
    expect(removedCall).toBeDefined();
    expect(removedCall![0].where).toMatchObject({
      business_id: "biz-1",
      account_id: "acct-1",
      plaid_transaction_id: "txn-removed",
      plaid_account_id: "plaid-acct-1",
    });
  });

  test("preserves duplicate handling for mapped transactions and clears has_new_transactions after successful drain", async () => {
    const { syncTransactions, prisma } = await loadSyncTransactions({
      plaid: {
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [],
            modified: [makeTransaction({ transaction_id: "txn-existing", amount: 7 })],
            removed: [],
            next_cursor: "cursor-next",
            has_more: false,
          },
        })),
      },
      prisma: {
        bankTransaction: {
          deleteMany: vi.fn(async () => ({ count: 0 })),
          create: vi.fn(async () => {
            throw new Error("duplicate");
          }),
          updateMany: vi.fn(async () => ({ count: 1 })),
          count: vi.fn(async () => 0),
          aggregate: vi.fn(async () => ({ _sum: { amount_cents: 0n } })),
        },
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.duplicateCount).toBe(1);

    const connectionUpdateCalls = (prisma.bankConnection.updateMany as any).mock.calls as any[][];
    const finalConnectionUpdate = connectionUpdateCalls.at(-1)![0];
    expect(finalConnectionUpdate.data).toMatchObject({
      sync_cursor: "cursor-next",
      has_new_transactions: false,
      status: "CONNECTED",
      error_code: null,
      error_message: null,
    });
  });

  test("persists sanitized Plaid failure details without clearing has_new_transactions or storing secrets", async () => {
    const { syncTransactions, prisma } = await loadSyncTransactions({
      plaid: {
        accountsBalanceGet: vi.fn(async () => {
          const error: any = new Error("invalid access_token access-sandbox-secret123 for secret topsecret");
          error.response = {
            data: {
              error_code: "INVALID_ACCESS_TOKEN",
              error_message: "access_token access-sandbox-secret123 does not match this Plaid environment",
            },
          };
          throw error;
        }),
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(502);
    expect(body).toEqual({ ok: false, error: "Plaid sync failed", errorCode: "INVALID_ACCESS_TOKEN" });

    const connectionUpdateCalls = (prisma.bankConnection.updateMany as any).mock.calls as any[][];
    const failureUpdate = connectionUpdateCalls.at(-1)![0];
    expect(failureUpdate.data).toMatchObject({
      status: "ERROR",
      error_code: "INVALID_ACCESS_TOKEN",
    });
    expect(failureUpdate.data).not.toHaveProperty("has_new_transactions");
    expect(failureUpdate.data.error_message).toContain("access_token [redacted]");
    expect(failureUpdate.data.error_message).not.toContain("access-sandbox-secret123");
    expect(failureUpdate.data.error_message).not.toContain("topsecret");
  });
});
