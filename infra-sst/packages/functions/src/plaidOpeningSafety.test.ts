import { afterEach, describe, expect, test, vi } from "vitest";

function event(body: Record<string, any>) {
  return {
    pathParameters: { businessId: "biz-1", accountId: "acct-1" },
    body: JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub: "user-1" } } } },
  };
}

function transactionMock(ops: any) {
  if (Array.isArray(ops)) return Promise.all(ops);
  return ops({});
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Plaid opening safety", () => {
  test("apply-opening ignores the client amount and recomputes a signed credit-card opening", async () => {
    const prisma: any = {
      userBusinessRole: { findFirst: vi.fn(async () => ({ role: "OWNER" })) },
      bankConnection: {
        findFirst: vi.fn(async () => ({
          plaid_account_id: "plaid-acct-1",
          access_token_ciphertext: "ciphertext",
          last_known_balance_cents: null,
          last_known_balance_at: null,
        })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      account: {
        findFirst: vi.fn(async () => ({ type: "CREDIT_CARD" })),
        update: vi.fn(async () => ({})),
      },
      bankTransaction: {
        aggregate: vi.fn(async () => ({ _sum: { amount_cents: -2000n } })),
      },
      entry: {
        findMany: vi.fn(async () => []),
        updateMany: vi.fn(async () => ({ count: 0 })),
        create: vi.fn(async () => ({})),
        update: vi.fn(async () => ({})),
      },
      $transaction: vi.fn(transactionMock),
    };
    const plaid = {
      accountsBalanceGet: vi.fn(async () => ({
        data: { accounts: [{ account_id: "plaid-acct-1", balances: { current: 100 } }] },
      })),
    };

    vi.doMock("./lib/db", () => ({ getPrisma: vi.fn(async () => prisma) }));
    vi.doMock("./lib/plaidCrypto", () => ({ decryptAccessToken: vi.fn(async () => "access-token") }));
    vi.doMock("./lib/plaidClient", () => ({ getPlaidClient: vi.fn(async () => plaid) }));
    vi.doMock("./lib/plaidService", () => ({
      getClaims: (input: any) => input.requestContext.authorizer.jwt.claims,
      requirePlaidCapability: vi.fn(async () => "OWNER"),
      removeBankConnectionWithItemLifecycle: vi.fn(),
      normalizePlaidCurrentBalanceCents: (current: unknown, type: unknown) => {
        const cents = BigInt(Math.round(Number(current) * 100));
        return String(type) === "CREDIT_CARD" ? -cents : cents;
      },
    }));

    const { handler } = await import("./plaidApplyOpening");
    const response = await handler(event({
      choice: "APPLY_PLAID",
      effectiveStartDate: "2026-01-01",
      suggestedOpeningCents: "999999999",
    }));

    expect(response.statusCode).toBe(200);
    expect(prisma.entry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ amount_cents: -8000n, type: "EXPENSE" }),
    }));
    expect(prisma.account.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ opening_balance_cents: -8000n }),
    }));
  });

  test("apply-opening rejects an unknown choice instead of falling through to apply", async () => {
    vi.doMock("./lib/db", () => ({ getPrisma: vi.fn() }));
    vi.doMock("./lib/plaidCrypto", () => ({ decryptAccessToken: vi.fn() }));
    vi.doMock("./lib/plaidClient", () => ({ getPlaidClient: vi.fn() }));
    vi.doMock("./lib/plaidService", () => ({
      getClaims: (input: any) => input.requestContext.authorizer.jwt.claims,
      requirePlaidCapability: vi.fn(async () => "OWNER"),
      removeBankConnectionWithItemLifecycle: vi.fn(),
      normalizePlaidCurrentBalanceCents: vi.fn(),
    }));

    const { handler } = await import("./plaidApplyOpening");
    const response = await handler(event({ choice: "SURPRISE", effectiveStartDate: "2026-01-01" }));
    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toBe("Invalid choice");
  });
});

describe("Plaid opening-date pruning safety", () => {
  async function loadChangeHandler(prisma: any) {
    const syncTransactions = vi.fn(async () => ({ statusCode: 200, body: "{}" }));
    vi.doMock("./lib/db", () => ({ getPrisma: vi.fn(async () => prisma) }));
    vi.doMock("./lib/plaidService", () => ({
      getClaims: (input: any) => input.requestContext.authorizer.jwt.claims,
      requirePlaidCapability: vi.fn(async () => "OWNER"),
      syncTransactions,
    }));
    const mod = await import("./plaidChangeOpeningDate");
    return { handler: mod.handler, syncTransactions };
  }

  test("refuses to prune while a current MatchGroup is active", async () => {
    const prisma: any = {
      userBusinessRole: { findFirst: vi.fn(async () => ({ role: "OWNER" })) },
      bankMatch: { count: vi.fn(async () => 0) },
      matchGroup: { count: vi.fn(async () => 1) },
      bankTransaction: { count: vi.fn(async () => 2), updateMany: vi.fn() },
      bankConnection: { updateMany: vi.fn() },
      $transaction: vi.fn(transactionMock),
    };
    const { handler, syncTransactions } = await loadChangeHandler(prisma);
    const response = await handler(event({ effectiveStartDate: "2026-06-01", confirmPrune: true }));

    expect(response.statusCode).toBe(409);
    expect(prisma.bankTransaction.updateMany).not.toHaveBeenCalled();
    expect(syncTransactions).not.toHaveBeenCalled();
  });

  test("soft-removes confirmed old Plaid rows instead of deleting audit history", async () => {
    const prisma: any = {
      userBusinessRole: { findFirst: vi.fn(async () => ({ role: "OWNER" })) },
      bankMatch: { count: vi.fn(async () => 0) },
      matchGroup: { count: vi.fn(async () => 0) },
      bankTransaction: {
        count: vi.fn(async () => 2),
        updateMany: vi.fn(async () => ({ count: 2 })),
        deleteMany: vi.fn(),
      },
      bankConnection: { updateMany: vi.fn(async () => ({ count: 1 })) },
      $transaction: vi.fn(transactionMock),
    };
    const { handler, syncTransactions } = await loadChangeHandler(prisma);
    const response = await handler(event({ effectiveStartDate: "2026-06-01", confirmPrune: true }));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).prunedCount).toBe(2);
    expect(prisma.bankTransaction.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ is_removed: true }),
    }));
    expect(prisma.bankTransaction.deleteMany).not.toHaveBeenCalled();
    expect(syncTransactions).toHaveBeenCalledOnce();
  });
});
