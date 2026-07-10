import { afterEach, describe, expect, test, vi } from "vitest";
import { createHash, generateKeyPairSync, sign } from "node:crypto";

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
    accountsGet: vi.fn(async () => ({
      data: {
        accounts: [{ account_id: "plaid-acct-1", mask: "1234" }],
      },
    })),
    linkTokenCreate: vi.fn(async () => ({ data: { link_token: "link-token" } })),
    itemPublicTokenExchange: vi.fn(async () => ({ data: { access_token: "access-token-new", item_id: "item-new" } })),
    itemRemove: vi.fn(async () => ({ data: {} })),
    transactionsSync: vi.fn(async () => ({
      data: {
        added: [],
        modified: [],
        removed: [],
        next_cursor: "cursor-next",
        has_more: false,
      },
    })),
    webhookVerificationKeyGet: vi.fn(async () => ({ data: { key: testPublicJwk } })),
    ...options.plaid,
  };

  const prisma = {
    userBusinessRole: {
      findFirst: vi.fn(async () => ({ role: "OWNER" })),
    },
    account: {
      findFirst: vi.fn(async () => ({ id: "acct-1" })),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    bankConnection: {
      findFirst: vi.fn(async () => ({ ...baseConn, ...options.conn })),
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    bankTransaction: {
      findFirst: vi.fn(async () => null),
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
  return { mod, syncTransactions: mod.syncTransactions, plaid, prisma };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.PLAID_WEBHOOK_URL;
});

const { publicKey: testPublicKey, privateKey: testPrivateKey } = generateKeyPairSync("ec", {
  namedCurve: "P-256",
});
const testPublicJwk = {
  ...(testPublicKey.export({ format: "jwk" }) as Record<string, any>),
  kid: "test-kid",
  alg: "ES256",
  use: "sig",
};

function signedPlaidHeaders(rawBody: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: "test-kid" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iat: now,
      request_body_sha256: createHash("sha256").update(rawBody).digest("hex"),
    })
  ).toString("base64url");
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: testPrivateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return { "plaid-verification": `${header}.${payload}.${signature}` };
}

async function callVerifiedWebhook(body: any) {
  const { mod, prisma } = await loadSyncTransactions({});
  const rawBody = JSON.stringify(body);
  const res = await mod.handleWebhook({
    body,
    rawBody,
    headers: signedPlaidHeaders(rawBody),
  });
  return { res, prisma };
}

describe("createLinkToken", () => {
  test("includes configured webhook URL for existing-account link tokens", async () => {
    process.env.PLAID_WEBHOOK_URL = "https://example.com/v1/plaid/webhook";
    const { mod, plaid } = await loadSyncTransactions({});

    const res = await mod.createLinkToken({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });

    expect(res.statusCode).toBe(200);
    expect(plaid.linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook: "https://example.com/v1/plaid/webhook",
        transactions: { days_requested: 730 },
      })
    );
  });

  test("uses Plaid update mode for reconnect link tokens", async () => {
    const { mod, plaid } = await loadSyncTransactions({});

    const res = await mod.createLinkToken({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      mode: "update",
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ ok: true, link_token: "link-token", mode: "update" });
    expect(plaid.linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "access-token-redacted",
      })
    );
    expect(plaid.linkTokenCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        products: expect.anything(),
        transactions: expect.anything(),
      })
    );
  });

  test("includes configured webhook URL for business/new-account link tokens", async () => {
    process.env.PLAID_WEBHOOK_URL = "https://example.com/v1/plaid/webhook";
    const { mod, plaid } = await loadSyncTransactions({});

    const res = await mod.createLinkTokenBusiness({ businessId: "biz-1", userId: "user-1" });

    expect(res.statusCode).toBe(200);
    expect(plaid.linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook: "https://example.com/v1/plaid/webhook",
        transactions: { days_requested: 730 },
      })
    );
  });
});

describe("syncTransactions", () => {
  test("exchange without a date derives from latest bank transaction and suppresses opening adjustment", async () => {
    const latestPosted = new Date("2026-04-27T00:00:00.000Z");
    const { mod, prisma } = await loadSyncTransactions({
      prisma: {
        bankTransaction: {
          findFirst: vi.fn(async () => ({ posted_date: latestPosted })),
          deleteMany: vi.fn(async () => ({ count: 0 })),
          create: vi.fn(async () => ({})),
          updateMany: vi.fn(async () => ({ count: 1 })),
          count: vi.fn(async () => 0),
          aggregate: vi.fn(async () => ({ _sum: { amount_cents: 0n } })),
        },
        bankConnection: {
          findFirst: vi.fn(async () => ({ ...baseConn })),
          upsert: vi.fn(async () => ({})),
          updateMany: vi.fn(async () => ({ count: 1 })),
        },
      },
    });

    const res = await mod.exchangePublicToken({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      publicToken: "public-token",
      plaidAccountId: "plaid-acct-1",
      institution: { name: "Bank", institution_id: "ins_1" },
      mask: "1234",
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ ok: true, connected: true, effectiveStartDate: "2026-04-27" });
    expect(prisma.bankConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          effective_start_date: latestPosted,
          opening_policy: "MANUAL",
          opening_adjustment_created_at: expect.any(Date),
        }),
        update: expect.objectContaining({
          effective_start_date: latestPosted,
          opening_policy: "MANUAL",
          opening_adjustment_created_at: expect.any(Date),
        }),
      })
    );
  });

  test("exchange verifies the selected Plaid account belongs to the exchanged Item before storing a token", async () => {
    const { mod, plaid, prisma } = await loadSyncTransactions({
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [{ account_id: "different-plaid-acct", mask: "9999" }],
          },
        })),
      },
    });

    const res = await mod.exchangePublicToken({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      publicToken: "public-token",
      plaidAccountId: "plaid-acct-1",
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      code: "PLAID_ACCOUNT_SELECTION_MISMATCH",
    });
    expect(plaid.itemPublicTokenExchange).toHaveBeenCalledWith({ public_token: "public-token" });
    expect(plaid.accountsGet).toHaveBeenCalledWith({ access_token: "access-token-new" });
    expect(plaid.itemRemove).toHaveBeenCalledWith({ access_token: "access-token-new" });
    expect(prisma.bankConnection.upsert).not.toHaveBeenCalled();
  });

  test("new Plaid-created accounts can opt into Plaid-derived opening adjustment", async () => {
    const { mod, prisma } = await loadSyncTransactions({});

    const res = await mod.exchangePublicToken({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      publicToken: "public-token",
      plaidAccountId: "plaid-acct-1",
      effectiveStartDate: "2026-01-01",
      allowOpeningAdjustment: true,
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.bankConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          opening_policy: "AUTO",
          opening_adjustment_created_at: null,
        }),
        update: expect.objectContaining({
          opening_policy: "AUTO",
          opening_adjustment_created_at: null,
        }),
      })
    );
  });

  test("exchange can create additional one-to-one accounts from the same Plaid item", async () => {
    const { mod, plaid, prisma } = await loadSyncTransactions({
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [
              { account_id: "plaid-acct-1", mask: "1234", type: "depository", subtype: "checking" },
              { account_id: "plaid-acct-2", mask: "5678", type: "depository", subtype: "savings" },
            ],
          },
        })),
      },
    });

    const res = await mod.exchangePublicToken({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      publicToken: "public-token",
      plaidAccountId: "plaid-acct-1",
      effectiveStartDate: "2026-01-01",
      additionalAccounts: [
        {
          plaidAccountId: "plaid-acct-2",
          name: "Savings",
          type: "SAVINGS",
          mask: "5678",
          effectiveStartDate: "2026-01-01",
        },
      ],
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.additionalAccounts).toHaveLength(1);
    expect(body.additionalAccounts[0]).toMatchObject({
      plaidAccountId: "plaid-acct-2",
      name: "Savings",
      type: "SAVINGS",
      last4: "5678",
    });
    expect(plaid.itemPublicTokenExchange).toHaveBeenCalledTimes(1);
    expect(plaid.accountsGet).toHaveBeenCalledTimes(1);
    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          business_id: "biz-1",
          name: "Savings",
          type: "SAVINGS",
          opening_balance_cents: 0n,
          institution_name: null,
          last4: "5678",
        }),
      }),
    );
    expect(prisma.bankConnection.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          business_id: "biz-1",
          plaid_item_id: "item-new",
          plaid_account_id: "plaid-acct-2",
          access_token_ciphertext: "ciphertext",
          opening_policy: "AUTO",
          opening_adjustment_created_at: null,
        }),
      }),
    );
  });

  test("only upserts transactions for the mapped Plaid account and safely scopes removals", async () => {
    const matchingAdded = makeTransaction({ transaction_id: "txn-added-mapped" });
    const otherAdded = makeTransaction({ transaction_id: "txn-added-other", account_id: "plaid-acct-2" });
    const matchingModified = makeTransaction({ transaction_id: "txn-modified-mapped", amount: 5 });

    const { syncTransactions, plaid, prisma } = await loadSyncTransactions({
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

    expect((plaid.transactionsSync as any).mock.calls[0][0]).toMatchObject({
      cursor: undefined,
      options: { account_id: "plaid-acct-1" },
    });

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
      sync_cursor: "account:plaid-acct-1:cursor-next",
      has_new_transactions: false,
      status: "CONNECTED",
      error_code: null,
      error_message: null,
    });
  });

  test("resets legacy item cursor and saves account-scoped cursor", async () => {
    const { syncTransactions, plaid, prisma } = await loadSyncTransactions({
      conn: { sync_cursor: "legacy-item-cursor" },
      plaid: {
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [makeTransaction({ transaction_id: "txn-after-reset" })],
            modified: [],
            removed: [],
            next_cursor: "account-cursor-next",
            has_more: false,
          },
        })),
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.cursorResetFromLegacyScope).toBe(true);

    expect((plaid.transactionsSync as any).mock.calls[0][0]).toMatchObject({
      cursor: undefined,
      options: { account_id: "plaid-acct-1" },
    });

    const connectionUpdateCalls = (prisma.bankConnection.updateMany as any).mock.calls as any[][];
    const finalConnectionUpdate = connectionUpdateCalls.at(-1)![0];
    expect(finalConnectionUpdate.data.sync_cursor).toBe("account:plaid-acct-1:account-cursor-next");
  });

  test("restarts full sync pagination when Plaid mutates during pagination", async () => {
    let callN = 0;
    const { syncTransactions, plaid } = await loadSyncTransactions({
      conn: { sync_cursor: "account:plaid-acct-1:cursor-start" },
      plaid: {
        transactionsSync: vi.fn(async () => {
          callN += 1;
          if (callN === 1) {
            return {
              data: {
                added: [makeTransaction({ transaction_id: "txn-page-1" })],
                modified: [],
                removed: [],
                next_cursor: "cursor-page-2",
                has_more: true,
              },
            };
          }
          if (callN === 2) {
            const error: any = new Error("mutation during pagination");
            error.response = {
              data: {
                error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
                error_message: "Transactions changed during pagination",
              },
            };
            throw error;
          }
          return {
            data: {
              added: [makeTransaction({ transaction_id: `txn-restarted-${callN}` })],
              modified: [],
              removed: [],
              next_cursor: "cursor-final",
              has_more: false,
            },
          };
        }),
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.drainRestartCount).toBe(1);

    const calls = (plaid.transactionsSync as any).mock.calls.map((call: any[]) => call[0]);
    expect(calls[0]).toMatchObject({ cursor: "cursor-start", options: { account_id: "plaid-acct-1" } });
    expect(calls[1]).toMatchObject({ cursor: "cursor-page-2", options: { account_id: "plaid-acct-1" } });
    expect(calls[2]).toMatchObject({ cursor: "cursor-start", options: { account_id: "plaid-acct-1" } });
  });

  test("does not fail transaction sync when Plaid balance lookup returns NO_ACCOUNTS", async () => {
    const { syncTransactions, prisma } = await loadSyncTransactions({
      plaid: {
        accountsBalanceGet: vi.fn(async () => {
          const error: any = new Error("No accounts available for balance");
          error.response = {
            data: {
              error_code: "NO_ACCOUNTS",
              error_message: "No accounts available",
            },
          };
          throw error;
        }),
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [makeTransaction({ transaction_id: "txn-without-balance" })],
            modified: [],
            removed: [],
            next_cursor: "cursor-after-no-accounts",
            has_more: false,
          },
        })),
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1", requestRefresh: true });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      newCount: 1,
      balanceLookupSucceeded: false,
      balanceErrorCode: "NO_ACCOUNTS",
    });

    const createCalls = (prisma.bankTransaction.create as any).mock.calls as any[][];
    expect(createCalls.map((call) => call[0].data.plaid_transaction_id)).toEqual(["txn-without-balance"]);

    const connectionUpdateCalls = (prisma.bankConnection.updateMany as any).mock.calls as any[][];
    const finalConnectionUpdate = connectionUpdateCalls.at(-1)![0];
    expect(finalConnectionUpdate.data).toMatchObject({
      sync_cursor: "account:plaid-acct-1:cursor-after-no-accounts",
      has_new_transactions: false,
      status: "CONNECTED",
    });
    expect(finalConnectionUpdate.data).not.toHaveProperty("last_known_balance_cents");
    expect(finalConnectionUpdate.data).not.toHaveProperty("last_known_balance_at");
  });

  test("falls back to item-level transaction sync when account-scoped sync returns NO_ACCOUNTS", async () => {
    let callN = 0;
    const { syncTransactions, plaid, prisma } = await loadSyncTransactions({
      plaid: {
        transactionsSync: vi.fn(async () => {
          callN += 1;
          if (callN === 1) {
            const error: any = new Error("No accounts available");
            error.response = {
              data: {
                error_code: "NO_ACCOUNTS",
                error_message: "No accounts available",
              },
            };
            throw error;
          }

          return {
            data: {
              added: [
                makeTransaction({ transaction_id: "txn-fallback-mapped" }),
                makeTransaction({ transaction_id: "txn-fallback-other", account_id: "plaid-acct-2" }),
              ],
              modified: [],
              removed: [],
              next_cursor: "item-cursor-next",
              has_more: false,
            },
          };
        }),
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      newCount: 1,
      cursorScope: "item",
      accountScopedFallback: true,
      accountScopedFallbackCode: "NO_ACCOUNTS",
    });

    const calls = (plaid.transactionsSync as any).mock.calls.map((call: any[]) => call[0]);
    expect(calls[0]).toMatchObject({ cursor: undefined, options: { account_id: "plaid-acct-1" } });
    expect(calls[1]).toMatchObject({ cursor: undefined });
    expect(calls[1]).not.toHaveProperty("options");

    const createCalls = (prisma.bankTransaction.create as any).mock.calls as any[][];
    expect(createCalls.map((call) => call[0].data.plaid_transaction_id)).toEqual(["txn-fallback-mapped"]);

    const connectionUpdateCalls = (prisma.bankConnection.updateMany as any).mock.calls as any[][];
    const finalConnectionUpdate = connectionUpdateCalls.at(-1)![0];
    expect(finalConnectionUpdate.data.sync_cursor).toBe("item:item-cursor-next");
  });

  test("marks missing Plaid account as reconnect-required when item-level sync also returns NO_ACCOUNTS", async () => {
    const { syncTransactions, prisma } = await loadSyncTransactions({
      plaid: {
        transactionsSync: vi.fn(async () => {
          const error: any = new Error("No accounts available");
          error.response = {
            data: {
              error_code: "NO_ACCOUNTS",
              error_message: "No accounts available",
            },
          };
          throw error;
        }),
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1", requestRefresh: true });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(502);
    expect(body).toEqual({
      ok: false,
      error: "Plaid sync failed",
      errorCode: "NO_ACCOUNTS",
      status: "PLAID_ACCOUNT_MISSING",
      message: "The selected bank account is no longer available from Plaid. Reconnect the bank feed and choose the account again.",
      reconnectRequired: true,
    });

    const connectionUpdateCalls = (prisma.bankConnection.updateMany as any).mock.calls as any[][];
    const failureUpdate = connectionUpdateCalls.at(-1)![0];
    expect(failureUpdate.data).toMatchObject({
      status: "PLAID_ACCOUNT_MISSING",
      error_code: "NO_ACCOUNTS",
    });
    expect(failureUpdate.data).not.toHaveProperty("has_new_transactions");
  });

  test("persists sanitized Plaid failure details without clearing has_new_transactions or storing secrets", async () => {
    const { syncTransactions, prisma } = await loadSyncTransactions({
      plaid: {
        transactionsSync: vi.fn(async () => {
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
    expect(body).toEqual({
      ok: false,
      error: "Plaid sync failed",
      errorCode: "INVALID_ACCESS_TOKEN",
      status: "ENV_MISMATCH_RECONNECT_REQUIRED",
      message: "This bank connection needs to be reconnected before transactions can sync.",
      reconnectRequired: true,
    });

    const connectionUpdateCalls = (prisma.bankConnection.updateMany as any).mock.calls as any[][];
    const failureUpdate = connectionUpdateCalls.at(-1)![0];
    expect(failureUpdate.data).toMatchObject({
      status: "ENV_MISMATCH_RECONNECT_REQUIRED",
      error_code: "INVALID_ACCESS_TOKEN",
    });
    expect(failureUpdate.data).not.toHaveProperty("has_new_transactions");
    expect(failureUpdate.data.error_message).toContain("access_token [redacted]");
    expect(failureUpdate.data.error_message).not.toContain("access-sandbox-secret123");
    expect(failureUpdate.data.error_message).not.toContain("topsecret");
  });

  test("manual sync generic failure keeps feed connected and retryable", async () => {
    const { syncTransactions, prisma } = await loadSyncTransactions({
      plaid: {
        transactionsSync: vi.fn(async () => {
          const error: any = new Error("bank sync is temporarily unavailable");
          error.response = {
            data: {
              error_code: "INSTITUTION_ERROR",
              error_message: "The institution is temporarily unavailable",
            },
          };
          throw error;
        }),
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1", requestRefresh: true });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      error: "Plaid sync failed",
      errorCode: "INSTITUTION_ERROR",
      status: "SYNC_ERROR",
      reconnectRequired: false,
    });

    const connectionUpdateCalls = (prisma.bankConnection.updateMany as any).mock.calls as any[][];
    const failureUpdate = connectionUpdateCalls.at(-1)![0];
    expect(failureUpdate.data).toMatchObject({
      status: "SYNC_ERROR",
      error_code: "INSTITUTION_ERROR",
      has_new_transactions: true,
    });
  });

  test("defers generic transaction sync failure after reconnect without requiring another reconnect", async () => {
    const { syncTransactions, prisma } = await loadSyncTransactions({
      plaid: {
        transactionsSync: vi.fn(async () => {
          const error: any = new Error("transactions are not ready yet");
          error.response = {
            data: {
              error_code: "PRODUCT_NOT_READY",
              error_message: "Transactions are still being prepared",
            },
          };
          throw error;
        }),
      },
    });

    const res = await syncTransactions({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      afterReconnect: true,
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      pendingSync: true,
      newCount: 0,
      message: "Bank reconnected. Transactions are still being prepared by the bank and will sync shortly.",
    });

    const connectionUpdateCalls = (prisma.bankConnection.updateMany as any).mock.calls as any[][];
    const pendingUpdate = connectionUpdateCalls.at(-1)![0];
    expect(pendingUpdate.data).toMatchObject({
      status: "PENDING_SYNC",
      error_code: "PRODUCT_NOT_READY",
      has_new_transactions: true,
    });
  });

  test("status treats generic sync errors as connected instead of reconnect-required", async () => {
    const { mod } = await loadSyncTransactions({
      conn: {
        status: "ERROR",
        error_code: "PLAID_SYNC_FAILED",
        error_message: "Bank sync could not finish",
        plaid_mask: "1234",
      },
    });

    const res = await mod.getStatus({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      connected: true,
      needsAttention: false,
      errorMessage: null,
      status: "ERROR",
      plaidAccountLive: true,
    });
  });

  test("status actively marks the connection when the stored Plaid account is missing", async () => {
    const { mod, prisma } = await loadSyncTransactions({
      conn: {
        status: "CONNECTED",
        plaid_mask: "1234",
      },
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [{ account_id: "other-plaid-acct", mask: "9999" }],
          },
        })),
      },
    });

    const res = await mod.getStatus({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      connected: false,
      status: "PLAID_ACCOUNT_MISSING",
      needsAttention: true,
      errorMessage: "Reconnect required — Selected Plaid account unavailable",
      plaidAccountLive: false,
      plaidHealthErrorCode: "PLAID_ACCOUNT_MISSING",
    });

    const connectionUpdateCalls = (prisma.bankConnection.updateMany as any).mock.calls as any[][];
    const healthUpdate = connectionUpdateCalls.at(-1)![0];
    expect(healthUpdate.data).toMatchObject({
      status: "PLAID_ACCOUNT_MISSING",
      error_code: "PLAID_ACCOUNT_MISSING",
    });
  });
});

describe("handleWebhook", () => {
  test("TRANSACTIONS webhook marks matching item as having new transactions", async () => {
    const { res, prisma } = await callVerifiedWebhook({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "item-1",
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.bankConnection.updateMany).toHaveBeenCalledWith({
      where: { plaid_item_id: "item-1" },
      data: expect.objectContaining({ has_new_transactions: true }),
    });
  });

  test("ITEM ERROR webhook marks reconnect-required and stores sanitized error fields", async () => {
    const { res, prisma } = await callVerifiedWebhook({
      webhook_type: "ITEM",
      webhook_code: "ERROR",
      item_id: "item-1",
      error: {
        error_code: "ITEM_LOGIN_REQUIRED",
        error_message: "access_token access-sandbox-secret123 requires secret topsecret",
      },
    });

    expect(res.statusCode).toBe(200);
    const update = (prisma.bankConnection.updateMany as any).mock.calls[0][0];
    expect(update.where).toEqual({ plaid_item_id: "item-1" });
    expect(update.data).toMatchObject({
      status: "REAUTH_REQUIRED",
      error_code: "ITEM_LOGIN_REQUIRED",
    });
    expect(update.data).not.toHaveProperty("has_new_transactions");
    expect(update.data.error_message).toContain("access_token [redacted]");
    expect(update.data.error_message).not.toContain("access-sandbox-secret123");
    expect(update.data.error_message).not.toContain("topsecret");
  });

  test("USER_PERMISSION_REVOKED marks reconnect-required without clearing transaction flags", async () => {
    const { res, prisma } = await callVerifiedWebhook({
      webhook_type: "ITEM",
      webhook_code: "USER_PERMISSION_REVOKED",
      item_id: "item-1",
    });

    expect(res.statusCode).toBe(200);
    const update = (prisma.bankConnection.updateMany as any).mock.calls[0][0];
    expect(update.data).toMatchObject({
      status: "REAUTH_REQUIRED",
      error_code: "USER_PERMISSION_REVOKED",
    });
    expect(update.data).not.toHaveProperty("has_new_transactions");
  });

  test("PENDING_EXPIRATION marks reconnect-required before the item expires", async () => {
    const { res, prisma } = await callVerifiedWebhook({
      webhook_type: "ITEM",
      webhook_code: "PENDING_EXPIRATION",
      item_id: "item-1",
    });

    expect(res.statusCode).toBe(200);
    const update = (prisma.bankConnection.updateMany as any).mock.calls[0][0];
    expect(update.data).toMatchObject({
      status: "REAUTH_REQUIRED",
      error_code: "PENDING_EXPIRATION",
    });
    expect(update.data).not.toHaveProperty("has_new_transactions");
  });

  test("unknown valid webhook is ignored without mutating bank connections", async () => {
    const { res, prisma } = await callVerifiedWebhook({
      webhook_type: "ASSETS",
      webhook_code: "PRODUCT_READY",
      item_id: "item-1",
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ ok: true, ignored: true });
    expect(prisma.bankConnection.updateMany).not.toHaveBeenCalled();
  });
});
