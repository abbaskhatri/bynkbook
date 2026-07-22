import { afterEach, describe, expect, test, vi } from "vitest";

function sqsEvent(records: Array<{ id: string; body: any }>) {
  return {
    Records: records.map((record) => ({ messageId: record.id, body: JSON.stringify(record.body) })),
  } as any;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Plaid sync worker", () => {
  test("continues a capped cursor until the account is completely drained", async () => {
    const syncTransactions = vi
      .fn()
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ ok: true, drainIncomplete: true, hasMore: true }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ ok: true, drainIncomplete: false, hasMore: false }) });
    vi.doMock("./lib/plaidService", () => ({ syncTransactions }));

    const { handler } = await import("./plaidSyncWorker");
    const result = await handler(sqsEvent([{ id: "m-1", body: { businessId: "biz-1", accountId: "acct-1" } }]));

    expect(result.batchItemFailures).toEqual([]);
    expect(syncTransactions).toHaveBeenCalledTimes(2);
    expect(syncTransactions).toHaveBeenCalledWith(expect.objectContaining({
      businessId: "biz-1",
      accountId: "acct-1",
      system: true,
      balanceMode: "cached",
    }));
  });

  test("honors an explicit queue balance mode", async () => {
    const syncTransactions = vi.fn().mockResolvedValue({
      statusCode: 200,
      body: JSON.stringify({ ok: true, hasMore: false }),
    });
    vi.doMock("./lib/plaidService", () => ({ syncTransactions }));

    const { handler } = await import("./plaidSyncWorker");
    await handler(sqsEvent([{ id: "m-skip", body: {
      businessId: "biz-1",
      accountId: "acct-1",
      balanceMode: "skip",
    } }]));

    expect(syncTransactions).toHaveBeenCalledWith(expect.objectContaining({ balanceMode: "skip" }));
  });

  test("returns only failed records for SQS partial retry", async () => {
    const syncTransactions = vi
      .fn()
      .mockResolvedValueOnce({ statusCode: 502, body: JSON.stringify({ ok: false, error: "Plaid unavailable" }) })
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ ok: true, hasMore: false }) });
    vi.doMock("./lib/plaidService", () => ({ syncTransactions }));

    const { handler } = await import("./plaidSyncWorker");
    const result = await handler(sqsEvent([
      { id: "m-fail", body: { businessId: "biz-1", accountId: "acct-1" } },
      { id: "m-ok", body: { businessId: "biz-1", accountId: "acct-2" } },
    ]));

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "m-fail" }]);
  });

  test("acknowledges a terminal reconnect-required result after it is recorded", async () => {
    const syncTransactions = vi.fn().mockResolvedValue({
      statusCode: 502,
      body: JSON.stringify({
        ok: false,
        error: "Plaid sync failed",
        errorCode: "INVALID_ACCESS_TOKEN",
        status: "ENV_MISMATCH_RECONNECT_REQUIRED",
        reconnectRequired: true,
      }),
    });
    vi.doMock("./lib/plaidService", () => ({ syncTransactions }));

    const { handler } = await import("./plaidSyncWorker");
    const result = await handler(sqsEvent([{ id: "m-reconnect", body: {
      businessId: "biz-1",
      accountId: "acct-1",
    } }]));

    expect(result.batchItemFailures).toEqual([]);
    expect(syncTransactions).toHaveBeenCalledTimes(1);
  });

  test("retries a queue message when another caller owns the account sync lease", async () => {
    const syncTransactions = vi.fn().mockResolvedValue({
      statusCode: 202,
      body: JSON.stringify({ ok: true, syncInProgress: true }),
    });
    vi.doMock("./lib/plaidService", () => ({ syncTransactions }));

    const { handler } = await import("./plaidSyncWorker");
    const result = await handler(sqsEvent([{ id: "m-lease", body: { businessId: "biz-1", accountId: "acct-1" } }]));

    expect(result.batchItemFailures).toEqual([{ itemIdentifier: "m-lease" }]);
  });
});
