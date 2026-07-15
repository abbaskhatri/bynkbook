const TRANSACTION_ADVISORY_LOCK_SQL = `
  SELECT pg_advisory_xact_lock(
    hashtextextended($1::text, 0::bigint)
  )::text AS lock_result
`;

export async function acquireTransactionAdvisoryLock(tx: any, key: string) {
  const lockKey = String(key ?? "").trim();
  if (!lockKey) throw new Error("Missing transaction advisory lock key");
  if (typeof tx?.$queryRawUnsafe !== "function") {
    throw new Error("Transaction client does not support advisory locks");
  }

  // PostgreSQL returns `void` from pg_advisory_xact_lock. Prisma cannot
  // deserialize that type, so return its text representation while preserving
  // the blocking, transaction-scoped lock behavior.
  await tx.$queryRawUnsafe(TRANSACTION_ADVISORY_LOCK_SQL, lockKey);
}
