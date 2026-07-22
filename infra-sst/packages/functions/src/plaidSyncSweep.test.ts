import { describe, expect, test, vi } from "vitest";

import {
  enqueuePlaidSyncCatchup,
  PLAID_CATCHUP_AFTER_MS,
  PLAID_CATCHUP_THROTTLE_MS,
} from "./plaidSyncSweep";

describe("Plaid scheduled sync catch-up", () => {
  test("queues eligible connections with cached balance mode", async () => {
    const now = new Date("2026-07-22T16:00:00.000Z");
    const candidate = {
      id: "connection-1",
      business_id: "business-1",
      account_id: "account-1",
      plaid_item_id: "item-1",
      updated_at: new Date("2026-07-22T12:00:00.000Z"),
    };
    const prisma = {
      bankConnection: {
        findMany: vi.fn(async () => [candidate]),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    };
    const enqueue = vi.fn(async () => undefined);

    const result = await enqueuePlaidSyncCatchup({ prisma, enqueue, now });

    expect(result).toEqual({ scanned: 1, queued: 1, skipped: 0 });
    expect(prisma.bankConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        updated_at: { lt: new Date(now.getTime() - PLAID_CATCHUP_THROTTLE_MS) },
        AND: expect.arrayContaining([
          expect.objectContaining({
            OR: expect.arrayContaining([{ last_sync_at: { lt: new Date(now.getTime() - PLAID_CATCHUP_AFTER_MS) } }]),
          }),
        ]),
      }),
    }));
    expect(enqueue).toHaveBeenCalledWith({
      businessId: "business-1",
      accountId: "account-1",
      itemId: "item-1",
      source: "scheduled-catchup",
      balanceMode: "cached",
    });
  });

  test("does not queue a connection whose reservation lost a race", async () => {
    const candidate = {
      id: "connection-1",
      business_id: "business-1",
      account_id: "account-1",
      plaid_item_id: "item-1",
      updated_at: new Date("2026-07-22T12:00:00.000Z"),
    };
    const prisma = {
      bankConnection: {
        findMany: vi.fn(async () => [candidate]),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const enqueue = vi.fn(async () => undefined);

    await expect(enqueuePlaidSyncCatchup({ prisma, enqueue })).resolves.toEqual({
      scanned: 1,
      queued: 0,
      skipped: 1,
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("releases its reservation when queue delivery fails", async () => {
    const updatedAt = new Date("2026-07-22T12:00:00.000Z");
    const now = new Date("2026-07-22T16:00:00.000Z");
    const prisma = {
      bankConnection: {
        findMany: vi.fn(async () => [{
          id: "connection-1",
          business_id: "business-1",
          account_id: "account-1",
          plaid_item_id: "item-1",
          updated_at: updatedAt,
        }]),
        updateMany: vi.fn()
          .mockResolvedValueOnce({ count: 1 })
          .mockResolvedValueOnce({ count: 1 }),
      },
    };

    await expect(enqueuePlaidSyncCatchup({
      prisma,
      now,
      enqueue: vi.fn(async () => { throw new Error("SQS unavailable"); }),
    })).rejects.toThrow("SQS unavailable");
    expect(prisma.bankConnection.updateMany).toHaveBeenLastCalledWith({
      where: { id: "connection-1", updated_at: now },
      data: { updated_at: updatedAt },
    });
  });
});
