import { getClaims, requirePlaidCapability } from "./lib/plaidService";
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
  const start = new Date(`${effectiveStartDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return json(400, { ok: false, error: "Invalid effectiveStartDate" });

  const prisma = await getPrisma();
  const role = await requirePlaidCapability(prisma, businessId, sub, "MANAGE");
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const [legacyActiveMatchesCount, activeMatchGroupsCount, bankTxCount] = await prisma.$transaction([
    prisma.bankMatch.count({ where: { business_id: businessId, account_id: accountId, voided_at: null } }),
    prisma.matchGroup.count({ where: { business_id: businessId, account_id: accountId, status: "ACTIVE", voided_at: null } }),
    prisma.bankTransaction.count({
      where: {
        business_id: businessId,
        account_id: accountId,
        posted_date: { lt: start },
        is_removed: false,
        plaid_transaction_id: { not: null },
        OR: [{ source: "PLAID" }, { source: null }],
      },
    }),
  ]);

  // Never prune around an active reconciliation. The previous implementation
  // checked only legacy BankMatch rows and could orphan MatchGroupBank links.
  if (legacyActiveMatchesCount > 0 || activeMatchGroupsCount > 0) {
    return json(409, {
      ok: false,
      error: "Revert active matches before changing the opening date.",
      legacyActiveMatchesCount,
      activeMatchGroupsCount,
      bankTxCount,
    });
  }

  if (bankTxCount > 0 && !confirm) {
    return json(409, {
      ok: false,
      error: "Changing the opening date will hide older Plaid history. Confirm required.",
      legacyActiveMatchesCount,
      activeMatchGroupsCount,
      bankTxCount,
    });
  }

  const now = new Date();
  // Preserve the immutable bank audit trail. Older Plaid rows are soft-removed
  // instead of hard-deleted, so historical IDs and any voided match history
  // remain inspectable and cannot become orphaned.
  const [, pruned] = await prisma.$transaction([
    prisma.bankConnection.updateMany({
      where: { business_id: businessId, account_id: accountId },
      data: {
        effective_start_date: start,
        sync_cursor: null,
        has_new_transactions: false,
        opening_adjustment_created_at: null,
        updated_at: now,
      } as any,
    }),
    prisma.bankTransaction.updateMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        posted_date: { lt: start },
        plaid_transaction_id: { not: null },
        OR: [{ source: "PLAID" }, { source: null }],
      },
      data: { is_removed: true, removed_at: now, updated_at: now },
    }),
  ]);

  // Re-sync (retained window) – opening application will be prompted via normal connect flow,
  // or user can explicitly Apply Plaid suggested later.
  const sync = await syncTransactions({ businessId, accountId, userId: sub } as any);
  return json(200, { ok: true, changed: true, prunedCount: Number(pruned?.count ?? 0), sync });
}
