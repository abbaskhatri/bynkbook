import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncTransactions: vi.fn(async () => ({
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true }),
  })),
}));

vi.mock("./lib/plaidService", () => ({
  getClaims: vi.fn(() => ({ sub: "user-1" })),
  syncTransactions: mocks.syncTransactions,
}));

import { handler } from "./plaidSync";

function event(body: Record<string, unknown>) {
  return {
    requestContext: { authorizer: { jwt: { claims: { sub: "user-1" } } } },
    pathParameters: { businessId: "biz-1", accountId: "acct-1" },
    body: JSON.stringify(body),
  };
}

describe("plaidSync handler cost controls", () => {
  beforeEach(() => {
    mocks.syncTransactions.mockClear();
  });

  test("does not turn the legacy refresh flag into a billed Plaid call", async () => {
    await handler(event({ refresh: true }));

    expect(mocks.syncTransactions).toHaveBeenCalledWith(expect.objectContaining({
      businessId: "biz-1",
      accountId: "acct-1",
      userId: "user-1",
      requestRefresh: false,
    }));
  });

  test("reserves billed refresh for the explicit force-only contract", async () => {
    await handler(event({ forceRefresh: true }));

    expect(mocks.syncTransactions).toHaveBeenCalledWith(expect.objectContaining({
      requestRefresh: true,
    }));
  });
});
