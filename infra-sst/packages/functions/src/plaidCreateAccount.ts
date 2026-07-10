import { getPrisma } from "./lib/db";
import { exchangePublicToken, syncTransactions, getClaims } from "./lib/plaidService";

function json(statusCode: number, body: any) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export async function handler(event: any) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = (event?.pathParameters?.businessId ?? "").toString().trim();
  if (!businessId) return json(400, { ok: false, error: "Missing businessId" });

  let body: any = {};
  try {
    body = event?.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  const publicToken = (body?.public_token ?? "").toString().trim();
  const plaidAccountId = (body?.plaidAccountId ?? "").toString().trim();
  const effectiveStartDate = (body?.effectiveStartDate ?? "").toString().trim(); // YYYY-MM-DD
  const endDate = (body?.endDate ?? "").toString().trim(); // optional
  const institution = body?.institution ?? undefined;
  const mask = (body?.mask ?? "").toString().trim() || undefined;
  const additionalAccounts = Array.isArray(body?.additionalAccounts) ? body.additionalAccounts : [];

  const name = (body?.name ?? "").toString().trim();
  const type = (body?.type ?? "").toString().trim(); // CHECKING/SAVINGS/CREDIT_CARD/CASH/OTHER

  if (!publicToken) return json(400, { ok: false, error: "Missing public_token" });
  if (!plaidAccountId) return json(400, { ok: false, error: "Missing plaidAccountId" });
  if (!effectiveStartDate) return json(400, { ok: false, error: "Missing effectiveStartDate" });
  if (!name) return json(400, { ok: false, error: "Missing name" });
  if (!type) return json(400, { ok: false, error: "Missing type" });

  const prisma = await getPrisma();

  // Ensure membership (reuse existing table)
  const mem = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: sub },
    select: { role: true },
  });
  if (!mem) return json(403, { ok: false, error: "Forbidden" });

  const startIso = new Date(`${effectiveStartDate}T00:00:00Z`);
  if (Number.isNaN(startIso.getTime())) return json(400, { ok: false, error: "Invalid effectiveStartDate (YYYY-MM-DD required)" });

  // Create the account AFTER user review
  const accountId = (await import("node:crypto")).randomUUID();

  await prisma.account.create({
    data: {
      id: accountId,
      business_id: businessId,
      name,
      type,
      opening_balance_cents: 0n,
      opening_balance_date: startIso,
    },
  });

  // Connect plaid + store mapping (includes mask)
  const ex = await exchangePublicToken({
    businessId,
    accountId,
    userId: sub,
    publicToken,
    effectiveStartDate,
    endDate,
    institution,
    plaidAccountId,
    mask,
    allowOpeningAdjustment: true,
    connectionMode: "NEW_ACCOUNT",
    additionalAccounts,
  } as any);

  if ((ex as any)?.statusCode && (ex as any).statusCode >= 400) {
    // rollback account if exchange failed
    await prisma.account.delete({ where: { id: accountId } }).catch(() => {});
    return ex as any;
  }

  const exBody = (() => {
    try {
      return JSON.parse((ex as any)?.body ?? "{}");
    } catch {
      return {};
    }
  })();

  // Sync transactions + compute opening balance from chosen effectiveStartDate
  const sync = await syncTransactions({ businessId, accountId, userId: sub } as any);
  const additionalSyncs = [];
  for (const created of Array.isArray(exBody?.additionalAccounts) ? exBody.additionalAccounts : []) {
    try {
      const extraSync = await syncTransactions({ businessId, accountId: created.accountId, userId: sub } as any);
      additionalSyncs.push({ accountId: created.accountId, ok: true, sync: extraSync });
    } catch (error: any) {
      additionalSyncs.push({ accountId: created.accountId, ok: false, error: error?.message ?? "Sync failed" });
    }
  }

  return json(200, {
    ok: true,
    accountId,
    synced: true,
    exchange: true,
    sync,
    additionalAccounts: exBody?.additionalAccounts ?? [],
    additionalSyncs,
  });
}
