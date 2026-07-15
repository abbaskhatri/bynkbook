import { describe, expect, test, vi } from "vitest";

import { acquireTransactionAdvisoryLock } from "./advisoryLock";

describe("acquireTransactionAdvisoryLock", () => {
  test("casts PostgreSQL void to a Prisma-supported type and binds the lock key", async () => {
    const queryRawUnsafe = vi.fn(async (..._args: any[]) => [{ lock_result: "" }]);

    await acquireTransactionAdvisoryLock(
      { $queryRawUnsafe: queryRawUnsafe },
      "match-bank:business:account:transaction",
    );

    expect(queryRawUnsafe).toHaveBeenCalledOnce();
    const [sql, key] = queryRawUnsafe.mock.calls[0] as [string, string];
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("hashtextextended($1::text, 0::bigint)");
    expect(sql).toContain("::text AS lock_result");
    expect(sql).not.toContain(String(key));
    expect(key).toBe("match-bank:business:account:transaction");
  });

  test("fails closed when the transaction client cannot acquire a lock", async () => {
    await expect(
      acquireTransactionAdvisoryLock({}, "match-entry:business:account:entry"),
    ).rejects.toThrow("Transaction client does not support advisory locks");
  });

  test("rejects an empty lock key", async () => {
    await expect(
      acquireTransactionAdvisoryLock({ $queryRawUnsafe: vi.fn() }, "  "),
    ).rejects.toThrow("Missing transaction advisory lock key");
  });
});
