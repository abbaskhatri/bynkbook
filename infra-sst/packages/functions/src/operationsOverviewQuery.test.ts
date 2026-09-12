import { expect, test, vi } from "vitest";
import { getOverview } from "./operationsOverview";
test("uses full learning aggregates and the latest bounded forecast history", async () => {
  const prisma = {
    account: { findMany: vi.fn(async () => []) },
    bankTransaction: { groupBy: vi.fn(async () => []) },
    bankConnection: { findMany: vi.fn(async () => []) },
    entryIssue: { count: vi.fn(async () => 0) },
    entry: { count: vi.fn(async () => 0), findMany: vi.fn(async () => Array.from({ length: 5001 }, () => ({ account_id: "unused" }))) },
    categoryMemory: {
      aggregate: vi.fn(async () => ({ _count: { _all: 60_000 }, _sum: { accept_count: 120_000, override_count: 30_000 } })),
      count: vi.fn(async () => 40_000),
    },
    $queryRaw: vi.fn(async () => []),
  };
  const result = await getOverview(prisma, "business", 13);
  expect(result.categorization).toMatchObject({ learned_merchant_rules: 60_000, safe_reuse_rules: 40_000, acceptance_rate: 80, sample_complete: true });
  expect(result.forecast.history_complete).toBe(false);
  expect(prisma.entry.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5001, orderBy: [{ date: "desc" }, { id: "desc" }], where: expect.objectContaining({ business_id: "business", date: { gte: expect.any(Date), lte: expect.any(Date) } }) }));
});
