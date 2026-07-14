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

function bankConnectionUpdateCalls(prisma: any) {
  return ((prisma.bankConnection.updateMany as any).mock.calls as any[][]).map((call) => call[0]);
}

function latestBankConnectionUpdate(prisma: any, predicate: (args: any) => boolean) {
  const found = bankConnectionUpdateCalls(prisma).filter(predicate).at(-1);
  expect(found).toBeTruthy();
  return found;
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
    itemGet: vi.fn(async () => ({
      data: {
        item: {
          products: ["transactions", "transactions_refresh"],
          billed_products: ["transactions"],
          webhook: null,
        },
        status: {
          transactions: {
            last_successful_update: "2026-07-14T14:30:00Z",
            last_failed_update: null,
          },
        },
      },
    })),
    itemRemove: vi.fn(async () => ({ data: {} })),
    itemWebhookUpdate: vi.fn(async () => ({ data: { item: { item_id: "item-1" } } })),
    transactionsRefresh: vi.fn(async () => ({ data: { request_id: "refresh-request" } })),
    transactionsGet: vi.fn(async () => ({ data: { transactions: [], total_transactions: 0 } })),
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

  const defaultPrisma = {
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
    matchGroupBank: {
      findMany: vi.fn(async () => []),
    },
    bankMatch: {
      findMany: vi.fn(async () => []),
    },
    bankTransaction: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 0),
      aggregate: vi.fn(async () => ({ _sum: { amount_cents: 0n } })),
    },
    entry: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      updateMany: vi.fn(async () => ({ count: 0 })),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  };
  const prisma = {
    ...defaultPrisma,
    ...options.prisma,
    userBusinessRole: { ...defaultPrisma.userBusinessRole, ...(options.prisma?.userBusinessRole ?? {}) },
    account: { ...defaultPrisma.account, ...(options.prisma?.account ?? {}) },
    bankConnection: { ...defaultPrisma.bankConnection, ...(options.prisma?.bankConnection ?? {}) },
    matchGroupBank: { ...defaultPrisma.matchGroupBank, ...(options.prisma?.matchGroupBank ?? {}) },
    bankMatch: { ...defaultPrisma.bankMatch, ...(options.prisma?.bankMatch ?? {}) },
    bankTransaction: { ...defaultPrisma.bankTransaction, ...(options.prisma?.bankTransaction ?? {}) },
    entry: { ...defaultPrisma.entry, ...(options.prisma?.entry ?? {}) },
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
  delete process.env.PLAID_LINK_CUSTOMIZATION_NAME;
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
  test("does not create a bank link token for a cash account", async () => {
    const { mod, plaid } = await loadSyncTransactions({
      prisma: {
        account: { findFirst: vi.fn(async () => ({ id: "acct-1", type: "CASH" })) },
      },
    });

    const res = await mod.createLinkToken({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("CASH_ACCOUNT_BANKING_NOT_APPLICABLE");
    expect(plaid.linkTokenCreate).not.toHaveBeenCalled();
  });

  test("denies bank-connection management to a member role", async () => {
    const { mod, plaid } = await loadSyncTransactions({
      prisma: {
        userBusinessRole: { findFirst: vi.fn(async () => ({ role: "MEMBER" })) },
      },
    });

    const res = await mod.createLinkToken({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    expect(res.statusCode).toBe(403);
    expect(plaid.linkTokenCreate).not.toHaveBeenCalled();
  });

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
        link_customization_name: "default",
        update: { account_selection_enabled: true },
      })
    );
    expect(plaid.linkTokenCreate).toHaveBeenCalledWith(
      expect.not.objectContaining({
        products: expect.anything(),
        transactions: expect.anything(),
      })
    );
  });

  test("reconnect uses a healthy same-institution sibling Item when the target Item is empty", async () => {
    const healthySibling = {
      ...baseConn,
      account_id: "acct-healthy-sibling",
      plaid_item_id: "item-shared-live",
      plaid_account_id: "plaid-sibling-live",
      access_token_ciphertext: "ciphertext-shared",
      institution_id: "ins_1",
      institution_name: "Bank of America",
      plaid_mask: "1751",
      plaid_type: "depository",
      plaid_subtype: "checking",
      status: "CONNECTED",
      account: { id: "acct-healthy-sibling", name: "Frisco" },
    };
    let accountsGetCalls = 0;
    const { mod, plaid } = await loadSyncTransactions({
      conn: {
        institution_id: "ins_1",
        institution_name: "Bank of America",
        plaid_mask: "0358",
        status: "PLAID_ACCOUNT_MISSING",
      },
      plaid: {
        accountsGet: vi.fn(async () => {
          accountsGetCalls += 1;
          return accountsGetCalls === 1
            ? { data: { accounts: [] } }
            : { data: { accounts: [{ account_id: "plaid-sibling-live", mask: "1751" }] } };
        }),
      },
      prisma: {
        account: {
          findFirst: vi.fn(async () => ({
            id: "acct-1",
            name: "Dallas",
            type: "CHECKING",
            currency_code: "USD",
          })),
        },
        bankConnection: {
          findMany: vi.fn(async () => [healthySibling]),
        },
      },
    });

    const res = await mod.createLinkToken({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      mode: "update",
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      mode: "update",
      usingSharedItem: true,
      repairSourceAccountId: "acct-healthy-sibling",
      institutionName: "Bank of America",
      targetPlaidMask: "0358",
      targetAccountName: "Dallas",
      requiredPreservedAccounts: [{
        accountId: "acct-healthy-sibling",
        plaidAccountId: "plaid-sibling-live",
        mask: "1751",
        name: "Frisco",
      }],
      relatedInstitutionAccounts: expect.arrayContaining([{
        accountId: "acct-healthy-sibling",
        plaidAccountId: "plaid-sibling-live",
        mask: "1751",
        plaidType: "depository",
        plaidSubtype: "checking",
        name: "Frisco",
      }]),
    });
    expect(plaid.accountsGet).toHaveBeenCalledTimes(2);
    expect(plaid.linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "access-token-redacted",
        update: { account_selection_enabled: true },
      }),
    );
  });

  test("connect lists reusable live Items so another ledger can use the same bank login", async () => {
    const { mod, prisma } = await loadSyncTransactions({
      prisma: {
        account: {
          findFirst: vi.fn(async () => ({
            id: "acct-1",
            name: "Dallas",
            type: "CHECKING",
            currency_code: "USD",
            institution_name: null,
            last4: null,
          })),
        },
        bankConnection: {
          findMany: vi.fn(async () => [
            {
              account_id: "acct-frisco",
              plaid_item_id: "item-bank-of-america",
              institution_name: "Bank of America",
              plaid_mask: "1751",
              account: { id: "acct-frisco", name: "Frisco" },
            },
            {
              account_id: "acct-dallas-existing",
              plaid_item_id: "item-bank-of-america",
              institution_name: "Bank of America",
              plaid_mask: "0358",
              account: { id: "acct-dallas-existing", name: "Dallas existing" },
            },
          ]),
        },
      },
    });

    const res = await mod.createLinkToken({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      mode: "connect",
      listOptions: true,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      mode: "connect",
      options: [{
        sourceAccountId: "acct-frisco",
        institutionName: "Bank of America",
        accountName: "Frisco",
        last4: "1751",
      }],
    });
    expect(prisma.bankConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { business_id: "biz-1", status: "CONNECTED" } }),
    );
  });

  test("connect can open update mode on an explicitly selected existing bank login", async () => {
    const sourceConnection = {
      ...baseConn,
      account_id: "acct-frisco",
      plaid_item_id: "item-bank-of-america",
      plaid_account_id: "plaid-frisco",
      institution_name: "Bank of America",
      institution_id: "ins_1",
      plaid_mask: "1751",
      plaid_type: "depository",
      plaid_subtype: "checking",
      account: { id: "acct-frisco", name: "Frisco" },
    };
    const { mod, plaid } = await loadSyncTransactions({
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: { accounts: [{ account_id: "plaid-frisco", mask: "1751" }] },
        })),
      },
      prisma: {
        account: {
          findFirst: vi.fn(async () => ({
            id: "acct-1",
            name: "Dallas",
            type: "CHECKING",
            currency_code: "USD",
            institution_name: null,
            last4: "0358",
          })),
        },
        bankConnection: {
          findFirst: vi.fn(async () => sourceConnection),
          findMany: vi.fn(async () => [sourceConnection]),
        },
      },
    });

    const res = await mod.createLinkToken({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      mode: "connect",
      sourceAccountId: "acct-frisco",
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      mode: "update",
      attachToExistingItem: true,
      usingSharedItem: true,
      repairSourceAccountId: "acct-frisco",
      targetPlaidMask: "0358",
      requiredPreservedAccounts: [{
        accountId: "acct-frisco",
        plaidAccountId: "plaid-frisco",
        mask: "1751",
        name: "Frisco",
      }],
      relatedInstitutionAccounts: [{
        accountId: "acct-frisco",
        plaidAccountId: "plaid-frisco",
        mask: "1751",
        plaidType: "depository",
        plaidSubtype: "checking",
        name: "Frisco",
      }],
    });
    expect(plaid.linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "access-token-redacted",
        link_customization_name: "default",
        update: { account_selection_enabled: true },
      }),
    );
  });

  test("binds new Link tokens to the configured published customization", async () => {
    process.env.PLAID_LINK_CUSTOMIZATION_NAME = "bynkbook_production_us";
    const { mod, plaid } = await loadSyncTransactions({});

    const res = await mod.createLinkTokenBusiness({ businessId: "biz-1", userId: "user-1" });

    expect(res.statusCode).toBe(200);
    expect(plaid.linkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ link_customization_name: "bynkbook_production_us" }),
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

describe("Plaid balance semantics", () => {
  test("normalizes credit-card amount owed to a negative accounting balance", async () => {
    const { mod } = await loadSyncTransactions({});
    expect(mod.normalizePlaidCurrentBalanceCents(125.67, "CREDIT_CARD")).toBe(-12567n);
    expect(mod.normalizePlaidCurrentBalanceCents(125.67, "CHECKING")).toBe(12567n);
  });
});

describe("Plaid disconnect lifecycle", () => {
  test("removes the Plaid Item before deleting the final local mapping", async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      bankConnection: {
        findFirst: vi.fn(async () => ({ ...baseConn })),
        count: vi.fn(async () => 1),
        deleteMany,
      },
      $queryRawUnsafe: vi.fn(async () => []),
    };
    const { mod, plaid } = await loadSyncTransactions({
      prisma: { $transaction: vi.fn(async (callback: any) => callback(tx)) },
    });

    const response = await mod.disconnectBankConnection({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ itemRemoved: true, remainingItemConnections: 0 });
    expect(plaid.itemRemove).toHaveBeenCalledWith({ access_token: "access-token-redacted" });
    expect(deleteMany).toHaveBeenCalledOnce();
  });

  test("preserves the final local mapping when Plaid revocation fails", async () => {
    const deleteMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      bankConnection: {
        findFirst: vi.fn(async () => ({ ...baseConn })),
        count: vi.fn(async () => 1),
        deleteMany,
      },
      $queryRawUnsafe: vi.fn(async () => []),
    };
    const { mod } = await loadSyncTransactions({
      plaid: { itemRemove: vi.fn(async () => { throw new Error("institution unavailable"); }) },
      prisma: { $transaction: vi.fn(async (callback: any) => callback(tx)) },
    });

    const response = await mod.disconnectBankConnection({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
    });

    expect(response.statusCode).toBe(502);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

describe("syncTransactions", () => {
  test("migrates a stale Plaid Item webhook before draining transactions", async () => {
    process.env.PLAID_WEBHOOK_URL = "https://example.com/v1/plaid/webhook";
    const { syncTransactions, plaid } = await loadSyncTransactions({
      plaid: {
        itemGet: vi.fn(async () => ({
          data: { item: { webhook: "https://old.example.com/v1/plaid/webhook" } },
        })),
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      webhookConfigured: true,
      webhookUpdated: true,
      webhookErrorCode: null,
    });
    expect(plaid.itemWebhookUpdate).toHaveBeenCalledWith({
      access_token: "access-token-redacted",
      webhook: "https://example.com/v1/plaid/webhook",
    });
  });

  test("does not rewrite a Plaid Item webhook that already matches production", async () => {
    process.env.PLAID_WEBHOOK_URL = "https://example.com/v1/plaid/webhook";
    const { syncTransactions, plaid } = await loadSyncTransactions({
      plaid: {
        itemGet: vi.fn(async () => ({
          data: { item: { webhook: "https://example.com/v1/plaid/webhook" } },
        })),
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      webhookConfigured: true,
      webhookUpdated: false,
      webhookErrorCode: null,
    });
    expect(plaid.itemWebhookUpdate).not.toHaveBeenCalled();
  });

  test("continues transaction sync when Plaid temporarily rejects webhook repair", async () => {
    process.env.PLAID_WEBHOOK_URL = "https://example.com/v1/plaid/webhook";
    const { syncTransactions, plaid } = await loadSyncTransactions({
      plaid: {
        itemGet: vi.fn(async () => {
          throw Object.assign(new Error("Plaid unavailable"), {
            response: { data: { error_code: "API_ERROR", error_message: "Temporary failure" } },
          });
        }),
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      webhookConfigured: true,
      webhookUpdated: false,
      webhookErrorCode: "API_ERROR",
    });
    expect(plaid.transactionsSync).toHaveBeenCalled();
  });

  test("does not sync bank transactions into a cash account", async () => {
    const { syncTransactions, plaid, prisma } = await loadSyncTransactions({
      prisma: {
        account: { findFirst: vi.fn(async () => ({ id: "acct-1", type: "CASH" })) },
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(409);
    expect(body.code).toBe("CASH_ACCOUNT_BANKING_NOT_APPLICABLE");
    expect(prisma.bankConnection.findFirst).not.toHaveBeenCalled();
    expect(plaid.transactionsSync).not.toHaveBeenCalled();
  });

  test("returns a coalesced success while another drain owns the account lease", async () => {
    const { syncTransactions, plaid } = await loadSyncTransactions({
      prisma: {
        bankConnection: { updateMany: vi.fn(async () => ({ count: 0 })) },
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, syncInProgress: true });
    expect(plaid.transactionsSync).not.toHaveBeenCalled();
  });

  test("preserves the update flag and resumable cursor when the page cap is reached", async () => {
    let page = 0;
    const { syncTransactions, plaid, prisma } = await loadSyncTransactions({
      plaid: {
        transactionsSync: vi.fn(async () => {
          page += 1;
          return {
            data: {
              added: [],
              modified: [],
              removed: [],
              next_cursor: `cursor-${page}`,
              has_more: true,
            },
          };
        }),
      },
    });

    const response = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({ capped: true, hasMore: true, drainIncomplete: true, pages: 20 });
    expect(plaid.transactionsSync).toHaveBeenCalledTimes(20);
    const cappedUpdate = latestBankConnectionUpdate(
      prisma,
      (args) => args?.data?.has_new_transactions === true && "sync_cursor" in (args?.data ?? {}),
    );
    expect(cappedUpdate).toMatchObject({
      where: { business_id: "biz-1", account_id: "acct-1" },
      data: expect.objectContaining({ has_new_transactions: true }),
    });
  });

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

  test("existing-account exchange ignores a provided opening date when bank transactions already exist", async () => {
    const latestPosted = new Date("2026-06-15T00:00:00.000Z");
    const { mod, prisma } = await loadSyncTransactions({
      prisma: {
        bankTransaction: {
          findFirst: vi.fn(async () => ({ posted_date: latestPosted })),
        },
      },
    });

    const res = await mod.exchangePublicToken({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      publicToken: "public-token",
      plaidAccountId: "plaid-acct-1",
      effectiveStartDate: "2026-04-01",
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.effectiveStartDate).toBe("2026-06-15");
    expect(prisma.bankConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ effective_start_date: latestPosted }),
        update: expect.objectContaining({ effective_start_date: latestPosted }),
      })
    );
  });

  test("existing-account exchange with no bank transactions derives from ledger and opening context", async () => {
    const opening = new Date("2026-04-01T00:00:00.000Z");
    const earliestLedger = new Date("2026-04-10T00:00:00.000Z");
    const { mod, prisma } = await loadSyncTransactions({
      prisma: {
        account: {
          findFirst: vi.fn(async () => ({ id: "acct-1", opening_balance_date: opening })),
        },
        entry: {
          findFirst: vi.fn(async () => ({ date: earliestLedger })),
        },
      },
    });

    const res = await mod.exchangePublicToken({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      publicToken: "public-token",
      plaidAccountId: "plaid-acct-1",
      effectiveStartDate: "2026-07-01",
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.effectiveStartDate).toBe("2026-04-01");
    expect(prisma.bankConnection.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ effective_start_date: opening }),
        update: expect.objectContaining({ effective_start_date: opening }),
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

  test("exchange rejects a Plaid account whose accounting type conflicts with the local account", async () => {
    const { mod, plaid, prisma } = await loadSyncTransactions({
      prisma: {
        account: { findFirst: vi.fn(async () => ({ id: "acct-1", type: "CHECKING", currency_code: "USD" })) },
      },
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [{
              account_id: "plaid-acct-1",
              mask: "1234",
              type: "credit",
              subtype: "credit card",
              balances: { iso_currency_code: "USD" },
            }],
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

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("PLAID_ACCOUNT_IDENTITY_MISMATCH");
    expect(plaid.itemRemove).toHaveBeenCalledWith({ access_token: "access-token-new" });
    expect(prisma.bankConnection.upsert).not.toHaveBeenCalled();
  });

  test("exchange rejects a primary Plaid account already mapped to another ledger account", async () => {
    const { mod, plaid, prisma } = await loadSyncTransactions({
      prisma: {
        bankConnection: {
          findMany: vi.fn(async () => [
            { account_id: "acct-2", plaid_account_id: "plaid-acct-1" },
          ]),
        },
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

    expect(res.statusCode).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      code: "PLAID_ACCOUNT_ALREADY_CONNECTED",
    });
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

  test("exchange reuses an existing sibling ledger when the bank shares it on the new Item", async () => {
    const existingSibling = {
      account_id: "acct-existing-sibling",
      plaid_item_id: "item-old-sibling",
      plaid_account_id: "plaid-acct-old-sibling",
      plaid_mask: "1751",
      plaid_type: "depository",
      plaid_subtype: "checking",
      plaid_currency_code: "USD",
      institution_id: "ins_1",
      institution_name: "Bank of America",
      effective_start_date: new Date("2026-01-01T00:00:00Z"),
      account: {
        id: "acct-existing-sibling",
        name: "Frisco",
        type: "CHECKING",
        currency_code: "USD",
      },
    };
    const { mod, prisma } = await loadSyncTransactions({
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [
              {
                account_id: "plaid-acct-1",
                mask: "0358",
                type: "depository",
                subtype: "checking",
                balances: { iso_currency_code: "USD" },
              },
              {
                account_id: "plaid-acct-new-sibling",
                mask: "1751",
                type: "depository",
                subtype: "checking",
                balances: { iso_currency_code: "USD" },
              },
            ],
          },
        })),
      },
      prisma: {
        account: {
          findFirst: vi.fn(async () => ({ id: "acct-1", type: "CHECKING", currency_code: "USD" })),
        },
        bankConnection: {
          findMany: vi.fn(async (args: any) =>
            args?.where?.account_id?.not === "acct-1" ? [existingSibling] : []
          ),
        },
      },
    });

    const res = await mod.exchangePublicToken({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      publicToken: "public-token",
      plaidAccountId: "plaid-acct-1",
      effectiveStartDate: "2026-01-01",
      institution: { name: "Bank of America", institution_id: "ins_1" },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.repairedExistingAccounts).toEqual([
      expect.objectContaining({
        accountId: "acct-existing-sibling",
        accountName: "Frisco",
        plaidAccountId: "plaid-acct-new-sibling",
        last4: "1751",
      }),
    ]);
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(prisma.bankConnection.updateMany).toHaveBeenCalledWith({
      where: {
        business_id: "biz-1",
        account_id: "acct-existing-sibling",
        plaid_account_id: "plaid-acct-old-sibling",
      },
      data: expect.objectContaining({
        plaid_item_id: "item-new",
        plaid_account_id: "plaid-acct-new-sibling",
        access_token_ciphertext: "ciphertext",
        status: "CONNECTED",
        error_code: null,
        error_message: null,
        sync_cursor: null,
      }),
    });
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

  test("stores pending transactions returned by Plaid and reports the active pending count", async () => {
    const pending = makeTransaction({
      transaction_id: "txn-pending",
      pending: true,
      date: "2026-07-13",
      authorized_date: "2026-07-13",
      name: "Pending card purchase",
    });
    const { syncTransactions, prisma } = await loadSyncTransactions({
      plaid: {
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [pending],
            modified: [],
            removed: [],
            next_cursor: "cursor-next",
            has_more: false,
          },
        })),
      },
      prisma: {
        bankTransaction: {
          count: vi.fn(async (args: any) => args?.where?.is_pending === true ? 1 : 0),
        },
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ newCount: 1, pendingCount: 1 });
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        plaid_transaction_id: "txn-pending",
        plaid_account_id: "plaid-acct-1",
        is_pending: true,
      }),
    });
  });

  test("upgrades a pending row in place when Plaid posts it so its ledger-entry linkage survives", async () => {
    const posted = makeTransaction({
      transaction_id: "txn-posted",
      pending_transaction_id: "txn-pending",
      pending: false,
      date: "2026-07-10",
      authorized_date: "2026-07-09",
      amount: 13.45,
      name: "Coffee Shop - final",
    });
    const pendingRow = {
      id: "bank-durable-pending",
      plaid_transaction_id: "txn-pending",
      posted_date: new Date("2026-07-09T00:00:00Z"),
      amount_cents: -1234n,
      name: "Coffee Shop - pending",
      is_removed: false,
    };
    const { syncTransactions, prisma } = await loadSyncTransactions({
      conn: { sync_cursor: "account-v2:plaid-acct-1:cursor-start" },
      plaid: {
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [posted],
            modified: [],
            removed: [{ transaction_id: "txn-pending" }],
            next_cursor: "cursor-next",
            has_more: false,
          },
        })),
      },
      prisma: {
        bankTransaction: {
          findMany: vi.fn(async (args: any) =>
            args?.where?.plaid_transaction_id?.in?.includes("txn-pending") ? [pendingRow] : [],
          ),
          updateMany: vi.fn(async () => ({ count: 1 })),
        },
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ newCount: 0, upgradedCount: 1 });
    expect(prisma.bankTransaction.create).not.toHaveBeenCalled();
    expect(prisma.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: {
        business_id: "biz-1",
        account_id: "acct-1",
        plaid_transaction_id: "txn-pending",
        plaid_account_id: "plaid-acct-1",
      },
      data: expect.objectContaining({
        plaid_transaction_id: "txn-posted",
        is_pending: false,
        amount_cents: -1345n,
        name: "Coffee Shop - final",
        is_removed: false,
      }),
    });
    const pendingRemoval = ((prisma.bankTransaction.updateMany as any).mock.calls as any[][]).find(
      (call) => call[0]?.where?.plaid_transaction_id === "txn-pending" && call[0]?.data?.is_removed === true,
    );
    expect(pendingRemoval).toBeUndefined();
  });

  test("rekeys exact transaction payloads replayed under a new Plaid account identity", async () => {
    const replayed = makeTransaction({
      transaction_id: "txn-new-item-id",
      account_id: "plaid-acct-new",
      name: 'Zelle payment for "Payroll"; Conf# exact123',
      amount: 487.54,
      date: "2026-07-09",
    });
    const legacyRaw = {
      ...replayed,
      transaction_id: "txn-old-item-id",
      account_id: "plaid-acct-old",
    };
    const legacyRow = {
      id: "bank-durable-row",
      plaid_transaction_id: "txn-old-item-id",
      plaid_account_id: "plaid-acct-old",
      is_removed: false,
      raw: legacyRaw,
      created_at: new Date("2026-07-10T20:12:07Z"),
      updated_at: new Date("2026-07-10T20:12:07Z"),
    };

    const { syncTransactions, prisma } = await loadSyncTransactions({
      conn: {
        plaid_account_id: "plaid-acct-new",
        effective_start_date: new Date("2026-07-09T00:00:00Z"),
        sync_cursor: null,
      },
      plaid: {
        accountsBalanceGet: vi.fn(async () => ({
          data: { accounts: [{ account_id: "plaid-acct-new", balances: { current: 100 } }] },
        })),
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [replayed],
            modified: [],
            removed: [],
            next_cursor: "cursor-next",
            has_more: false,
          },
        })),
      },
      prisma: {
        bankTransaction: {
          findMany: vi.fn(async (args: any) =>
            args?.where?.plaid_account_id?.not === "plaid-acct-new" ? [legacyRow] : [],
          ),
        },
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ newCount: 0, accountReplayMergedCount: 1 });
    expect(prisma.bankTransaction.create).not.toHaveBeenCalled();
    expect(prisma.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: {
        id: "bank-durable-row",
        business_id: "biz-1",
        account_id: "acct-1",
        plaid_transaction_id: "txn-old-item-id",
        plaid_account_id: "plaid-acct-old",
      },
      data: expect.objectContaining({
        plaid_transaction_id: "txn-new-item-id",
        plaid_account_id: "plaid-acct-new",
        is_removed: false,
        raw: replayed,
      }),
    });
  });

  test("keeps exact replayed rows removed after a Plaid identity rollover", async () => {
    const replayed = makeTransaction({
      transaction_id: "txn-new-item-id",
      account_id: "plaid-acct-new",
    });
    const legacyRow = {
      id: "bank-cleaned-row",
      plaid_transaction_id: "txn-old-item-id",
      plaid_account_id: "plaid-acct-old",
      is_removed: true,
      raw: { ...replayed, transaction_id: "txn-old-item-id", account_id: "plaid-acct-old" },
      created_at: new Date("2026-07-10T20:12:07Z"),
      updated_at: new Date("2026-07-10T20:57:07Z"),
    };
    const { syncTransactions, prisma } = await loadSyncTransactions({
      conn: { plaid_account_id: "plaid-acct-new", sync_cursor: null },
      plaid: {
        accountsBalanceGet: vi.fn(async () => ({
          data: { accounts: [{ account_id: "plaid-acct-new", balances: { current: 100 } }] },
        })),
        transactionsSync: vi.fn(async () => ({
          data: { added: [replayed], modified: [], removed: [], next_cursor: "cursor-next", has_more: false },
        })),
      },
      prisma: {
        bankTransaction: {
          findMany: vi.fn(async (args: any) =>
            args?.where?.plaid_account_id?.not === "plaid-acct-new" ? [legacyRow] : [],
          ),
        },
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ newCount: 0, skippedRemovedCount: 1, accountReplayMergedCount: 0 });
    const replayUpdate = ((prisma.bankTransaction.updateMany as any).mock.calls as any[][]).find(
      (call) => call[0]?.where?.id === "bank-cleaned-row",
    );
    expect(replayUpdate).toBeDefined();
    expect(replayUpdate![0].data).not.toHaveProperty("is_removed");
    expect(prisma.bankTransaction.create).not.toHaveBeenCalled();
  });

  test("keeps remove-and-add transactions as distinct source facts instead of guessing identity", async () => {
    const replacement = makeTransaction({
      transaction_id: "txn-new-id",
      date: "2026-07-09",
      amount: 573.36,
      name: 'Zelle payment to Abigail Flo Emp for "Payroll"; Conf# cbhs5l8ja',
    });
    const oldRow = {
      id: "bank-durable-1",
      plaid_transaction_id: "txn-old-id",
      posted_date: new Date("2026-07-09T00:00:00Z"),
      amount_cents: -57336n,
      name: 'Zelle payment to Abigail Flo Emp for "Payroll"; Conf# cbhs5l8ja',
      is_removed: false,
    };

    const { syncTransactions, prisma } = await loadSyncTransactions({
      conn: { sync_cursor: "account-v2:plaid-acct-1:cursor-start" },
      plaid: {
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [replacement],
            modified: [],
            removed: [{ transaction_id: "txn-old-id" }],
            next_cursor: "cursor-next",
            has_more: false,
          },
        })),
      },
      prisma: {
        bankTransaction: {
          findMany: vi.fn(async () => [oldRow]),
          updateMany: vi.fn(async () => ({ count: 1 })),
        },
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      newCount: 1,
      upgradedCount: 0,
      replacementUpgradeCount: 0,
    });
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ plaid_transaction_id: "txn-new-id" }),
    }));
    const removalCall = ((prisma.bankTransaction.updateMany as any).mock.calls as any[][]).find(
      (call) => call[0]?.where?.plaid_transaction_id === "txn-old-id" && call[0]?.data?.is_removed === true,
    );
    expect(removalCall).toBeDefined();
  });

  test("protects and restores actively matched bank history from Plaid removal events", async () => {
    const oldRow = {
      id: "bank-matched-1",
      plaid_transaction_id: "txn-old-id",
      posted_date: new Date("2026-07-09T00:00:00Z"),
      amount_cents: -57336n,
      name: "Payroll",
      is_removed: true,
    };
    const { syncTransactions, prisma } = await loadSyncTransactions({
      conn: { sync_cursor: "account-v2:plaid-acct-1:cursor-start" },
      plaid: {
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [],
            modified: [],
            removed: [{ transaction_id: "txn-old-id" }],
            next_cursor: "cursor-next",
            has_more: false,
          },
        })),
      },
      prisma: {
        bankTransaction: {
          findMany: vi.fn(async () => [oldRow]),
          updateMany: vi.fn(async () => ({ count: 1 })),
        },
        matchGroupBank: {
          findMany: vi.fn(async () => [{ bank_transaction_id: "bank-matched-1" }]),
        },
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      protectedMatchedRemovalCount: 1,
      restoredMatchedHistoryCount: 1,
    });
    const destructiveRemoval = ((prisma.bankTransaction.updateMany as any).mock.calls as any[][]).find(
      (call) => call[0]?.where?.plaid_transaction_id === "txn-old-id" && call[0]?.data?.is_removed === true,
    );
    expect(destructiveRemoval).toBeUndefined();
    expect(prisma.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: {
        id: "bank-matched-1",
        business_id: "biz-1",
        account_id: "acct-1",
      },
      data: expect.objectContaining({
        source_removed_at: expect.any(Date),
        source_removal_code: "PLAID_REMOVED",
      }),
    });
    expect(prisma.bankTransaction.updateMany).toHaveBeenCalledWith({
      where: {
        business_id: "biz-1",
        account_id: "acct-1",
        id: { in: ["bank-matched-1"] },
        is_removed: true,
      },
      data: expect.objectContaining({ is_removed: false, removed_at: null }),
    });
  });

  test("imports unseen Plaid history even when newer uploaded bank history already exists", async () => {
    const existingHistoryThrough = new Date("2026-04-30T00:00:00Z");
    const oldOverlap = makeTransaction({ transaction_id: "txn-old-overlap", date: "2026-04-01" });
    const sameDayOverlap = makeTransaction({ transaction_id: "txn-same-day-overlap", date: "2026-04-30" });
    const newAfterHistory = makeTransaction({ transaction_id: "txn-new-after-history", date: "2026-05-01" });

    const { syncTransactions, prisma } = await loadSyncTransactions({
      conn: { effective_start_date: new Date("2026-04-01T00:00:00Z"), sync_cursor: null },
      plaid: {
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [oldOverlap, sameDayOverlap, newAfterHistory],
            modified: [],
            removed: [],
            next_cursor: "cursor-next",
            has_more: false,
          },
        })),
      },
      prisma: {
        bankTransaction: {
          findFirst: vi.fn(async (args: any) => {
            if (args?.orderBy) return { posted_date: existingHistoryThrough };
            return null;
          }),
        },
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.newCount).toBe(3);
    expect(body.skippedHistoricalCount).toBe(0);
    expect(body.historicalCutoffDate).toBeNull();

    const createCalls = (prisma.bankTransaction.create as any).mock.calls as any[][];
    expect(createCalls.map((call) => call[0].data.plaid_transaction_id)).toEqual([
      "txn-old-overlap",
      "txn-same-day-overlap",
      "txn-new-after-history",
    ]);
  });

  test("does not prune existing Plaid history before the reconnect effective date", async () => {
    const start = new Date("2026-04-30T00:00:00Z");
    const { syncTransactions, prisma } = await loadSyncTransactions({
      conn: { effective_start_date: start, sync_cursor: null },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1", afterReconnect: true });
    expect(res.statusCode).toBe(200);

    const pruneCall = ((prisma.bankTransaction.updateMany as any).mock.calls as any[][]).find(
      (call) => call[0]?.data?.is_removed === true
    );
    expect(pruneCall).toBeUndefined();
  });

  test("does not resurrect soft-removed Plaid overlap rows during a reconnect full drain", async () => {
    const existingHistoryThrough = new Date("2026-04-30T00:00:00Z");
    const cleanedOverlap = makeTransaction({ transaction_id: "txn-cleaned-overlap", date: "2026-04-01" });
    const newAfterHistory = makeTransaction({ transaction_id: "txn-new-after-history", date: "2026-05-01" });

    const { syncTransactions, prisma } = await loadSyncTransactions({
      conn: { effective_start_date: new Date("2026-04-01T00:00:00Z"), sync_cursor: null },
      plaid: {
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [cleanedOverlap, newAfterHistory],
            modified: [],
            removed: [],
            next_cursor: "cursor-next",
            has_more: false,
          },
        })),
      },
      prisma: {
        bankTransaction: {
          findFirst: vi.fn(async (args: any) => {
            if (args?.where?.plaid_transaction_id === "txn-cleaned-overlap") {
              return { id: "removed-cleaned-row", is_removed: true };
            }
            if (args?.orderBy) return { posted_date: existingHistoryThrough };
            return null;
          }),
        },
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1", afterReconnect: true });
    const body = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(body.newCount).toBe(1);
    expect(body.skippedHistoricalCount).toBe(0);
    expect(body.skippedRemovedCount).toBe(1);

    const createCalls = (prisma.bankTransaction.create as any).mock.calls as any[][];
    expect(createCalls.map((call) => call[0].data.plaid_transaction_id)).toEqual(["txn-new-after-history"]);
    const resurrectCall = ((prisma.bankTransaction.updateMany as any).mock.calls as any[][]).find(
      (call) => call[0]?.where?.plaid_transaction_id === "txn-cleaned-overlap"
    );
    expect(resurrectCall).toBeUndefined();
  });

  test("does not resurrect soft-removed Plaid rows during incremental duplicate updates", async () => {
    const { syncTransactions, prisma } = await loadSyncTransactions({
      conn: { sync_cursor: "account-v2:plaid-acct-1:cursor-start" },
      plaid: {
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [],
            modified: [makeTransaction({ transaction_id: "txn-cleaned-overlap", date: "2026-05-02" })],
            removed: [],
            next_cursor: "cursor-next",
            has_more: false,
          },
        })),
      },
      prisma: {
        bankTransaction: {
          create: vi.fn(async () => {
            throw new Error("duplicate");
          }),
          findFirst: vi.fn(async (args: any) => {
            if (args?.where?.plaid_transaction_id === "txn-cleaned-overlap") {
              return { id: "removed-cleaned-row", is_removed: true };
            }
            return null;
          }),
        },
      },
    });

    const res = await syncTransactions({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.duplicateCount).toBe(0);
    expect(body.skippedRemovedCount).toBe(1);

    const resurrectCall = ((prisma.bankTransaction.updateMany as any).mock.calls as any[][]).find(
      (call) => call[0]?.where?.plaid_transaction_id === "txn-cleaned-overlap"
    );
    expect(resurrectCall).toBeUndefined();
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

    const finalConnectionUpdate = latestBankConnectionUpdate(prisma, (args) => "sync_cursor" in (args?.data ?? {}));
    expect(finalConnectionUpdate.data).toMatchObject({
      sync_cursor: "account-v2:plaid-acct-1:cursor-next",
      has_new_transactions: false,
      status: "CONNECTED",
      error_code: null,
      error_message: null,
    });
  });

  test("resets the legacy incorrectly scoped account cursor and saves a v2 account cursor", async () => {
    const { syncTransactions, plaid, prisma } = await loadSyncTransactions({
      conn: { sync_cursor: "account:plaid-acct-1:legacy-item-cursor" },
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

    const finalConnectionUpdate = latestBankConnectionUpdate(prisma, (args) => "sync_cursor" in (args?.data ?? {}));
    expect(finalConnectionUpdate.data.sync_cursor).toBe("account-v2:plaid-acct-1:account-cursor-next");
  });

  test("restarts full sync pagination when Plaid mutates during pagination", async () => {
    let callN = 0;
    const { syncTransactions, plaid } = await loadSyncTransactions({
      conn: { sync_cursor: "account-v2:plaid-acct-1:cursor-start" },
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

    const finalConnectionUpdate = latestBankConnectionUpdate(prisma, (args) => "sync_cursor" in (args?.data ?? {}));
    expect(finalConnectionUpdate.data).toMatchObject({
      sync_cursor: "account-v2:plaid-acct-1:cursor-after-no-accounts",
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

    const finalConnectionUpdate = latestBankConnectionUpdate(prisma, (args) => "sync_cursor" in (args?.data ?? {}));
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

    const failureUpdate = latestBankConnectionUpdate(prisma, (args) => args?.data?.status === "PLAID_ACCOUNT_MISSING");
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

    const failureUpdate = latestBankConnectionUpdate(prisma, (args) => args?.data?.status === "ENV_MISMATCH_RECONNECT_REQUIRED");
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
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
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

    const failureUpdate = latestBankConnectionUpdate(prisma, (args) => args?.data?.status === "SYNC_ERROR");
    expect(failureUpdate.data).toMatchObject({
      status: "SYNC_ERROR",
      error_code: "INSTITUTION_ERROR",
    });
    expect(failureUpdate.data).not.toHaveProperty("has_new_transactions");
    expect(body.updatesPending).toBe(true);
    expect(consoleError.mock.calls[0]?.[1]).not.toHaveProperty("plaidAccountId");
  });

  test("a retryable repeated check after a recent successful sync stays successful", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { syncTransactions, prisma } = await loadSyncTransactions({
      conn: {
        status: "CONNECTED",
        has_new_transactions: false,
        last_sync_at: new Date(Date.now() - 10_000),
      },
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

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      syncDeferred: true,
      newCount: 0,
      message: "A bank sync completed moments ago. Plaid did not finish this repeated check, so no transaction changes were applied.",
    });
    expect(bankConnectionUpdateCalls(prisma).filter((args) => args?.data?.status || args?.data?.error_code)).toEqual([]);
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

    const pendingUpdate = latestBankConnectionUpdate(prisma, (args) => args?.data?.status === "PENDING_SYNC");
    expect(pendingUpdate.data).toMatchObject({
      status: "PENDING_SYNC",
      error_code: "PRODUCT_NOT_READY",
      has_new_transactions: true,
    });
  });

  test("reports bank connection status as not applicable for a cash account", async () => {
    const { mod, plaid, prisma } = await loadSyncTransactions({
      prisma: {
        account: { findFirst: vi.fn(async () => ({ id: "acct-1", type: "CASH" })) },
      },
    });

    const res = await mod.getStatus({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({ connected: false, status: "NOT_APPLICABLE", bankingApplicable: false });
    expect(prisma.bankConnection.findFirst).not.toHaveBeenCalled();
    expect(plaid.accountsGet).not.toHaveBeenCalled();
  });

  test("reports provider freshness when on-demand Transactions Refresh is not enabled", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { syncTransactions } = await loadSyncTransactions({
      plaid: {
        transactionsRefresh: vi.fn(async () => {
          const error: any = new Error("client is not authorized to access Transactions Refresh");
          error.response = {
            data: {
              error_code: "INVALID_PRODUCT",
              error_message: "client is not authorized to access Transactions Refresh",
            },
          };
          throw error;
        }),
        itemGet: vi.fn(async () => ({
          data: {
            item: {
              products: ["transactions"],
              billed_products: ["transactions"],
            },
            status: {
              transactions: {
                last_successful_update: "2026-07-14T12:15:30Z",
                last_failed_update: "2026-07-14T12:10:00Z",
              },
            },
          },
        })),
      },
    });

    const response = await syncTransactions({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      requestRefresh: true,
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      newCount: 0,
      refreshRequested: true,
      refreshSucceeded: false,
      refreshUnavailable: true,
      refreshErrorCode: "INVALID_PRODUCT",
      plaidLastSuccessfulUpdateAt: "2026-07-14T12:15:30.000Z",
      plaidLastFailedUpdateAt: "2026-07-14T12:10:00.000Z",
      transactionsRefreshProductActive: false,
    });
    expect(consoleWarn).toHaveBeenCalledWith(
      "Plaid on-demand transaction refresh unavailable",
      expect.objectContaining({ errorCode: "INVALID_PRODUCT" }),
    );
  });

  test("repairs a missing recent transaction from an account snapshot when the cursor is empty", async () => {
    const transactionDate = new Date().toISOString().slice(0, 10);
    const missingTransaction = makeTransaction({
      transaction_id: "txn-missed-by-cursor",
      date: transactionDate,
      amount: 78.91,
      name: "Recent posted purchase",
    });
    const { syncTransactions, plaid, prisma } = await loadSyncTransactions({
      plaid: {
        transactionsRefresh: vi.fn(async () => {
          const error: any = new Error("client is not authorized to access Transactions Refresh");
          error.response = { data: { error_code: "INVALID_PRODUCT", error_message: error.message } };
          throw error;
        }),
        transactionsGet: vi.fn(async () => ({
          data: { transactions: [missingTransaction], total_transactions: 1 },
        })),
      },
    });

    const response = await syncTransactions({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      requestRefresh: true,
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      newCount: 1,
      totalSeen: 0,
      snapshotAuditRequested: true,
      snapshotAuditSucceeded: true,
      snapshotAuditSeen: 1,
      snapshotAuditTotalAvailable: 1,
      snapshotAuditNewestDate: transactionDate,
      snapshotAuditRecoveredCount: 1,
    });
    expect(plaid.transactionsGet).toHaveBeenCalledWith(expect.objectContaining({
      start_date: expect.any(String),
      end_date: transactionDate,
      options: expect.objectContaining({ account_ids: ["plaid-acct-1"] }),
    }));
    expect(prisma.bankTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        plaid_transaction_id: "txn-missed-by-cursor",
        plaid_account_id: "plaid-acct-1",
      }),
    }));
  });

  test("repairs a snapshot-only transaction even when the cursor returns another update", async () => {
    const transactionDate = new Date().toISOString().slice(0, 10);
    const cursorTransaction = makeTransaction({ transaction_id: "txn-from-cursor", date: transactionDate });
    const snapshotOnlyTransaction = makeTransaction({ transaction_id: "txn-snapshot-only", date: transactionDate, amount: 44.12 });
    const { syncTransactions, prisma } = await loadSyncTransactions({
      plaid: {
        transactionsSync: vi.fn(async () => ({
          data: {
            added: [cursorTransaction],
            modified: [],
            removed: [],
            next_cursor: "cursor-with-update",
            has_more: false,
          },
        })),
        transactionsGet: vi.fn(async () => ({
          data: {
            transactions: [cursorTransaction, snapshotOnlyTransaction],
            total_transactions: 2,
          },
        })),
      },
    });

    const response = await syncTransactions({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      requestRefresh: true,
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      newCount: 2,
      totalSeen: 1,
      snapshotAuditSeen: 2,
      snapshotAuditRecoveredCount: 1,
    });
    expect((prisma.bankTransaction.create as any).mock.calls.map((call: any[]) => call[0].data.plaid_transaction_id)).toEqual([
      "txn-from-cursor",
      "txn-snapshot-only",
    ]);
  });

  test("does not duplicate an existing transaction returned by the recent snapshot", async () => {
    const transactionDate = new Date().toISOString().slice(0, 10);
    const existingTransaction = makeTransaction({
      transaction_id: "txn-already-retained",
      date: transactionDate,
    });
    const create = vi.fn(async () => {
      throw new Error("unique constraint");
    });
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const { syncTransactions, prisma } = await loadSyncTransactions({
      plaid: {
        transactionsGet: vi.fn(async () => ({
          data: { transactions: [existingTransaction], total_transactions: 1 },
        })),
      },
      prisma: {
        bankTransaction: {
          findFirst: vi.fn(async (args: any) =>
            args?.where?.plaid_transaction_id === "txn-already-retained"
              ? { id: "bank-row-1", is_removed: false }
              : null,
          ),
          create,
          updateMany,
        },
      },
    });

    const response = await syncTransactions({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      requestRefresh: true,
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      newCount: 0,
      duplicateCount: 1,
      snapshotAuditSeen: 1,
      snapshotAuditRecoveredCount: 0,
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        account_id: "acct-1",
        plaid_transaction_id: "txn-already-retained",
        plaid_account_id: "plaid-acct-1",
      }),
    }));
    expect(prisma.bankTransaction.updateMany).toHaveBeenCalledTimes(1);
  });

  test("keeps a successful cursor sync when the recent snapshot audit is unavailable", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { syncTransactions } = await loadSyncTransactions({
      plaid: {
        transactionsGet: vi.fn(async () => {
          const error: any = new Error("snapshot temporarily unavailable");
          error.response = {
            data: {
              error_code: "INSTITUTION_DOWN",
              error_message: "snapshot temporarily unavailable",
            },
          };
          throw error;
        }),
      },
    });

    const response = await syncTransactions({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      requestRefresh: true,
    });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      newCount: 0,
      snapshotAuditRequested: true,
      snapshotAuditSucceeded: false,
      snapshotAuditErrorCode: "INSTITUTION_DOWN",
      snapshotAuditErrorMessage: "snapshot temporarily unavailable",
    });
    expect(consoleWarn).toHaveBeenCalledWith(
      "Plaid recent transaction snapshot audit skipped",
      expect.objectContaining({ errorCode: "INSTITUTION_DOWN" }),
    );
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
      plaidLastSuccessfulUpdateAt: "2026-07-14T14:30:00.000Z",
      transactionsRefreshProductActive: true,
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
            accounts: [
              { account_id: "other-plaid-acct", mask: "9999" },
              { account_id: "another-plaid-acct", mask: "8888" },
            ],
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

  test("status never silently remaps a missing stored Plaid account to the only live account", async () => {
    const { mod, prisma } = await loadSyncTransactions({
      conn: {
        status: "PLAID_ACCOUNT_MISSING",
        plaid_mask: "1234",
      },
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [{ account_id: "replacement-plaid-acct", mask: "7777" }],
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
      plaidAccountLive: false,
      last4: "1234",
    });

    const healthUpdate = (prisma.bankConnection.updateMany as any).mock.calls[0][0];
    expect(healthUpdate.data).toMatchObject({
      status: "PLAID_ACCOUNT_MISSING",
      error_code: "PLAID_ACCOUNT_MISSING",
    });
    expect(healthUpdate.data).not.toHaveProperty("plaid_account_id");
  });

  test("status clears a stale reconnect flag when the exact mapped Plaid account is live", async () => {
    const { mod, prisma } = await loadSyncTransactions({
      conn: {
        status: "REAUTH_REQUIRED",
        error_code: "ITEM_LOGIN_REQUIRED",
        error_message: "Login required",
        plaid_mask: "1234",
      },
    });

    const res = await mod.getStatus({ businessId: "biz-1", accountId: "acct-1", userId: "user-1" });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      connected: true,
      status: "CONNECTED",
      needsAttention: false,
      plaidAccountLive: true,
    });
    expect(prisma.bankConnection.updateMany).toHaveBeenCalledWith({
      where: { business_id: "biz-1", account_id: "acct-1" },
      data: expect.objectContaining({
        status: "CONNECTED",
        error_code: null,
        error_message: null,
      }),
    });
  });

  test("repairPlaidAccountMapping verifies and updates the selected live Plaid account", async () => {
    const { mod, prisma } = await loadSyncTransactions({
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [{ account_id: "replacement-plaid-acct", mask: "7777" }],
          },
        })),
      },
    });

    const res = await mod.repairPlaidAccountMapping({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      plaidAccountId: "replacement-plaid-acct",
      institution: { name: "Bank of America", institution_id: "ins_1" },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      connected: true,
      plaidAccountId: "replacement-plaid-acct",
      last4: "7777",
    });
    expect(prisma.bankConnection.updateMany).toHaveBeenCalledWith({
      where: { business_id: "biz-1", account_id: "acct-1" },
      data: expect.objectContaining({
        plaid_account_id: "replacement-plaid-acct",
        plaid_mask: "7777",
        institution_name: "Bank of America",
        status: "CONNECTED",
        error_code: null,
        error_message: null,
        sync_cursor: null,
        has_new_transactions: true,
      }),
    });
  });

  test("repair consolidates an exact sibling ledger from a separate Item", async () => {
    const existingSibling = {
      account_id: "acct-existing-sibling",
      plaid_item_id: "item-old-sibling",
      plaid_account_id: "plaid-acct-old-sibling",
      plaid_mask: "1751",
      plaid_type: "depository",
      plaid_subtype: "checking",
      plaid_currency_code: "USD",
      institution_id: "ins_1",
      institution_name: "Bank of America",
      effective_start_date: new Date("2026-01-01T00:00:00Z"),
      account: {
        id: "acct-existing-sibling",
        name: "Frisco",
        type: "CHECKING",
        currency_code: "USD",
      },
    };
    const { mod, prisma } = await loadSyncTransactions({
      conn: {
        institution_id: "ins_1",
        institution_name: "Bank of America",
        plaid_mask: "3290",
        plaid_type: "depository",
        plaid_subtype: "checking",
        plaid_currency_code: "USD",
      },
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [
              {
                account_id: "plaid-acct-1",
                mask: "3290",
                type: "depository",
                subtype: "checking",
                balances: { iso_currency_code: "USD" },
              },
              {
                account_id: "plaid-acct-new-sibling",
                mask: "1751",
                type: "depository",
                subtype: "checking",
                balances: { iso_currency_code: "USD" },
              },
            ],
          },
        })),
      },
      prisma: {
        account: {
          findFirst: vi.fn(async () => ({ id: "acct-1", type: "CHECKING", currency_code: "USD" })),
        },
        bankConnection: {
          findMany: vi.fn(async (args: any) =>
            args?.where?.account_id?.not === "acct-1" ? [existingSibling] : []
          ),
        },
      },
    });

    const res = await mod.repairPlaidAccountMapping({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      plaidAccountId: "plaid-acct-1",
      institution: { name: "Bank of America", institution_id: "ins_1" },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.repairedExistingAccounts).toEqual([
      expect.objectContaining({
        accountId: "acct-existing-sibling",
        accountName: "Frisco",
        plaidAccountId: "plaid-acct-new-sibling",
        last4: "1751",
      }),
    ]);
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(prisma.bankConnection.updateMany).toHaveBeenCalledWith({
      where: {
        business_id: "biz-1",
        account_id: "acct-existing-sibling",
        plaid_account_id: "plaid-acct-old-sibling",
      },
      data: expect.objectContaining({
        plaid_item_id: "item-1",
        plaid_account_id: "plaid-acct-new-sibling",
        access_token_ciphertext: "ciphertext",
        status: "CONNECTED",
        error_code: null,
        error_message: null,
        sync_cursor: null,
      }),
    });
  });

  test("repair maps a sequentially selected target onto the healthy sibling Item", async () => {
    const targetConnection = {
      ...baseConn,
      institution_id: "ins_1",
      institution_name: "Bank of America",
      plaid_mask: "0358",
      plaid_type: "depository",
      plaid_subtype: "checking",
      plaid_currency_code: "USD",
      status: "PLAID_ACCOUNT_MISSING",
    };
    const sourceConnection = {
      ...baseConn,
      account_id: "acct-healthy-sibling",
      plaid_item_id: "item-shared-live",
      plaid_account_id: "plaid-sibling-live",
      access_token_ciphertext: "ciphertext-shared",
      institution_id: "ins_1",
      institution_name: "Bank of America",
      plaid_mask: "1751",
      plaid_type: "depository",
      plaid_subtype: "checking",
      plaid_currency_code: "USD",
      status: "CONNECTED",
      account: {
        id: "acct-healthy-sibling",
        name: "Frisco",
        type: "CHECKING",
        currency_code: "USD",
      },
    };
    const { mod, prisma } = await loadSyncTransactions({
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [
              {
                account_id: "plaid-sibling-live",
                mask: "1751",
                type: "depository",
                subtype: "checking",
                balances: { iso_currency_code: "USD" },
              },
              {
                account_id: "plaid-target-on-shared-item",
                mask: "0358",
                type: "depository",
                subtype: "checking",
                balances: { iso_currency_code: "USD" },
              },
            ],
          },
        })),
      },
      prisma: {
        account: {
          findFirst: vi.fn(async () => ({ id: "acct-1", type: "CHECKING", currency_code: "USD" })),
        },
        bankConnection: {
          findFirst: vi.fn(async (args: any) =>
            args?.where?.account_id === "acct-healthy-sibling" ? sourceConnection : targetConnection
          ),
          findMany: vi.fn(async (args: any) =>
            args?.where?.account_id?.not === "acct-1" ? [sourceConnection] : []
          ),
        },
      },
    });

    const res = await mod.repairPlaidAccountMapping({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      sourceAccountId: "acct-healthy-sibling",
      plaidAccountId: "plaid-target-on-shared-item",
      institution: { name: "Bank of America", institution_id: "ins_1" },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.bankConnection.updateMany).toHaveBeenCalledWith({
      where: { business_id: "biz-1", account_id: "acct-1" },
      data: expect.objectContaining({
        plaid_item_id: "item-shared-live",
        plaid_account_id: "plaid-target-on-shared-item",
        access_token_ciphertext: "ciphertext-shared",
        plaid_mask: "0358",
        status: "CONNECTED",
        error_code: null,
        error_message: null,
        sync_cursor: null,
      }),
    });
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  test("repair attaches an unconnected ledger to an existing shared Item without creating a duplicate ledger", async () => {
    const sourceConnection = {
      ...baseConn,
      account_id: "acct-frisco",
      plaid_item_id: "item-bank-of-america",
      plaid_account_id: "plaid-frisco",
      access_token_ciphertext: "ciphertext-shared",
      institution_id: "ins_1",
      institution_name: "Bank of America",
      plaid_mask: "1751",
      plaid_type: "depository",
      plaid_subtype: "checking",
      plaid_currency_code: "USD",
      account: {
        id: "acct-frisco",
        name: "Frisco",
        type: "CHECKING",
        currency_code: "USD",
      },
    };
    const { mod, prisma } = await loadSyncTransactions({
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [
              {
                account_id: "plaid-frisco",
                mask: "1751",
                type: "depository",
                subtype: "checking",
                balances: { iso_currency_code: "USD" },
              },
              {
                account_id: "plaid-dallas",
                mask: "0358",
                type: "depository",
                subtype: "checking",
                balances: { iso_currency_code: "USD" },
              },
            ],
          },
        })),
      },
      prisma: {
        account: {
          findFirst: vi.fn(async () => ({
            id: "acct-1",
            type: "CHECKING",
            currency_code: "USD",
            last4: "0358",
          })),
        },
        bankConnection: {
          findFirst: vi.fn(async (args: any) =>
            args?.where?.account_id === "acct-frisco" ? sourceConnection : null
          ),
          findMany: vi.fn(async (args: any) =>
            args?.where?.account_id?.not === "acct-1" ? [sourceConnection] : []
          ),
        },
      },
    });

    const res = await mod.repairPlaidAccountMapping({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      sourceAccountId: "acct-frisco",
      plaidAccountId: "plaid-dallas",
      institution: { name: "Bank of America", institution_id: "ins_1" },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(prisma.bankConnection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        business_id: "biz-1",
        account_id: "acct-1",
        plaid_item_id: "item-bank-of-america",
        plaid_account_id: "plaid-dallas",
        access_token_ciphertext: "ciphertext-shared",
        plaid_mask: "0358",
        status: "CONNECTED",
        opening_policy: "MANUAL",
      }),
    });
  });

  test("repairPlaidAccountMapping refuses a different account mask instead of mixing ledger history", async () => {
    const { mod, prisma } = await loadSyncTransactions({
      conn: { plaid_mask: "1234" },
      prisma: {
        account: { findFirst: vi.fn(async () => ({ id: "acct-1", type: "CHECKING", currency_code: "USD" })) },
      },
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [{
              account_id: "replacement-plaid-acct",
              mask: "7777",
              type: "depository",
              subtype: "checking",
              balances: { iso_currency_code: "USD" },
            }],
          },
        })),
      },
    });

    const res = await mod.repairPlaidAccountMapping({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      plaidAccountId: "replacement-plaid-acct",
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("PLAID_ACCOUNT_IDENTITY_MISMATCH");
    expect(prisma.bankConnection.updateMany).not.toHaveBeenCalled();
  });

  test("repairPlaidAccountMapping restores live sibling mappings on the same Item without remapping them", async () => {
    const { mod, prisma } = await loadSyncTransactions({
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [
              { account_id: "plaid-acct-1", mask: "1234" },
              { account_id: "plaid-acct-2", mask: "5678" },
              { account_id: "plaid-acct-3", mask: "9012" },
            ],
          },
        })),
      },
      prisma: {
        bankConnection: {
          updateMany: vi.fn(async (args: any) => ({
            count: args?.where?.plaid_item_id === "item-1" ? 3 : 1,
          })),
        },
      },
    });

    const res = await mod.repairPlaidAccountMapping({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      plaidAccountId: "plaid-acct-1",
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      connected: true,
      restoredConnectionCount: 3,
    });

    const siblingRestore = (prisma.bankConnection.updateMany as any).mock.calls[1][0];
    expect(siblingRestore).toEqual({
      where: {
        business_id: "biz-1",
        plaid_item_id: "item-1",
        plaid_account_id: { in: ["plaid-acct-1", "plaid-acct-2", "plaid-acct-3"] },
      },
      data: expect.objectContaining({
        status: "CONNECTED",
        error_code: null,
        error_message: null,
        has_new_transactions: true,
      }),
    });
    expect(siblingRestore.data).not.toHaveProperty("plaid_account_id");
    expect(siblingRestore.data).not.toHaveProperty("sync_cursor");
  });

  test("repairPlaidAccountMapping atomically creates newly shared sibling accounts", async () => {
    const { mod, prisma } = await loadSyncTransactions({
      plaid: {
        accountsGet: vi.fn(async () => ({
          data: {
            accounts: [
              { account_id: "plaid-acct-1", mask: "1234", type: "depository", subtype: "checking" },
              { account_id: "plaid-acct-new", mask: "2468", type: "depository", subtype: "savings" },
            ],
          },
        })),
      },
    });

    const res = await mod.repairPlaidAccountMapping({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      plaidAccountId: "plaid-acct-1",
      additionalAccounts: [{
        plaidAccountId: "plaid-acct-new",
        name: "Bank Savings 2468",
        effectiveStartDate: "2026-01-01",
      }],
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.additionalAccounts).toHaveLength(1);
    expect(body.additionalAccounts[0]).toMatchObject({
      plaidAccountId: "plaid-acct-new",
      name: "Bank Savings 2468",
      type: "SAVINGS",
      last4: "2468",
    });
    expect(prisma.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "Bank Savings 2468", type: "SAVINGS", last4: "2468" }),
    });
    expect(prisma.bankConnection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        plaid_item_id: "item-1",
        plaid_account_id: "plaid-acct-new",
        access_token_ciphertext: "ciphertext",
        has_new_transactions: true,
      }),
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("handleWebhook", () => {
  test("queues every mapped account after a verified transaction webhook", async () => {
    const enqueueSync = vi.fn(async () => undefined);
    const { mod } = await loadSyncTransactions({
      prisma: {
        bankConnection: {
          findMany: vi.fn(async () => [
            { business_id: "biz-1", account_id: "acct-1" },
            { business_id: "biz-1", account_id: "acct-2" },
          ]),
        },
      },
    });
    const body = { item_id: "item-1", webhook_type: "TRANSACTIONS", webhook_code: "SYNC_UPDATES_AVAILABLE" };
    const rawBody = JSON.stringify(body);
    const response = await mod.handleWebhook({
      body,
      rawBody,
      headers: signedPlaidHeaders(rawBody),
      enqueueSync,
    });

    expect(response.statusCode).toBe(200);
    expect(enqueueSync).toHaveBeenCalledTimes(2);
    expect(enqueueSync).toHaveBeenNthCalledWith(1, { businessId: "biz-1", accountId: "acct-1", itemId: "item-1" });
    expect(enqueueSync).toHaveBeenNthCalledWith(2, { businessId: "biz-1", accountId: "acct-2", itemId: "item-1" });
  });

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

  test("non-sync transaction webhooks do not create false update availability", async () => {
    const enqueueSync = vi.fn(async () => undefined);
    const { mod, prisma } = await loadSyncTransactions({});
    const body = {
      item_id: "item-1",
      webhook_type: "TRANSACTIONS",
      webhook_code: "RECURRING_TRANSACTIONS_UPDATE",
    };
    const rawBody = JSON.stringify(body);
    const res = await mod.handleWebhook({ body, rawBody, headers: signedPlaidHeaders(rawBody), enqueueSync });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ignored: true });
    expect(prisma.bankConnection.updateMany).not.toHaveBeenCalled();
    expect(enqueueSync).not.toHaveBeenCalled();
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

  test("PENDING_DISCONNECT proactively marks US and Canada Items for update mode", async () => {
    const { res, prisma } = await callVerifiedWebhook({
      webhook_type: "ITEM",
      webhook_code: "PENDING_DISCONNECT",
      item_id: "item-1",
    });

    expect(res.statusCode).toBe(200);
    const update = (prisma.bankConnection.updateMany as any).mock.calls[0][0];
    expect(update.data).toMatchObject({ status: "REAUTH_REQUIRED", error_code: "PENDING_DISCONNECT" });
  });

  test("LOGIN_REPAIRED clears stale reconnect state without changing transaction flags", async () => {
    const { res, prisma } = await callVerifiedWebhook({
      webhook_type: "ITEM",
      webhook_code: "LOGIN_REPAIRED",
      item_id: "item-1",
    });

    expect(res.statusCode).toBe(200);
    const update = (prisma.bankConnection.updateMany as any).mock.calls[0][0];
    expect(update.data).toMatchObject({ status: "CONNECTED", error_code: null, error_message: null });
    expect(update.data).not.toHaveProperty("has_new_transactions");
  });

  test("NEW_ACCOUNTS_AVAILABLE records account discovery without claiming transaction updates", async () => {
    const { res, prisma } = await callVerifiedWebhook({
      webhook_type: "ITEM",
      webhook_code: "NEW_ACCOUNTS_AVAILABLE",
      item_id: "item-1",
    });

    expect(res.statusCode).toBe(200);
    const update = (prisma.bankConnection.updateMany as any).mock.calls[0][0];
    expect(update.data).toMatchObject({ new_accounts_available: true });
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
