import { getClaims } from "./lib/plaidService";
import { getPrisma } from "./lib/db";
import { syncTransactions } from "./lib/plaidService";

function json(statusCode: number, body: any) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export async function handler(event: any) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = String(event?.pathParameters?.businessId ?? "").trim();
  const accountId = String(event?.pathParameters?.accountId ?? "").trim();
  if (!businessId || !accountId) return json(400, { ok: false, error: "Missing ids" });

  let body: any = {};
  try { body = event?.body ? JSON.parse(event.body) : {}; } catch { return json(400, { ok: false, error: "Invalid JSON" }); }

  const effectiveStartDate = String(body?.effectiveStartDate ?? "").trim();
  const confirm = !!body?.confirmPrune;

  if (!effectiveStartDate) return json(400, { ok: false, error: "Missing effectiveStartDate" });

  const prisma = await getPrisma();
  const mem = await prisma.userBusinessRole.findFirst({ where: { business_id: businessId, user_id: sub }, select: { role: true } });
  if (!mem) return json(403, { ok: false, error: "Forbidden" });

  const [matchesCount, bankTxCount] = await prisma.$transaction([
    prisma.bankMatch.count({ where: { business_id: businessId, account_id: accountId } }),
    prisma.bankTransaction.count({ where: { business_id: businessId, account_id: accountId, is_removed: false } }),
  ]);

  if ((matchesCount > 0 || bankTxCount > 0) && !confirm) {
    return json(409, {
      ok: false,
      error: "Changing opening date may prune history and affect matches. Confirm required.",
      matchesCount,
      bankTxCount,
    });
  }

  const start = new Date(`${effectiveStartDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return json(400, { ok: false, error: "Invalid effectiveStartDate" });

  // Update connection start date + prune Plaid txns older than it (only Plaid txns)
  await prisma.$transaction([
    prisma.bankConnection.updateMany({
      where: { business_id: businessId, account_id: accountId },
      data: {
        effective_start_date: start,
        sync_cursor: null,
        has_new_transactions: false,
        opening_adjustment_created_at: null,
        updated_at: new Date(),
      } as any,
    }),
    prisma.bankTransaction.deleteMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        posted_date: { lt: start },
        plaid_transaction_id: { not: null },
        OR: [{ source: "PLAID" }, { source: null }],
      },
    }),
  ]);

  // Re-sync (retained window) – opening application will be prompted via normal connect flow,
  // or user can explicitly Apply Plaid suggested later.
  const sync = await syncTransactions({ businessId, accountId, userId: sub } as any);
  return json(200, { ok: true, changed: true, sync });
}
