import { getClaims } from "./lib/plaidService";
import { getPrisma } from "./lib/db";
import { decryptAccessToken } from "./lib/plaidCrypto";
import { getPlaidClient } from "./lib/plaidClient";

function json(statusCode: number, body: any) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function isOpeningLike(payee: any) {
  const x = String(payee ?? "").trim().toLowerCase();
  return x === "opening balance" || x === "opening balance (estimated)" || x.startsWith("opening balance");
}

export async function handler(event: any) {
  try {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = String(event?.pathParameters?.businessId ?? "").trim();
  const accountId = String(event?.pathParameters?.accountId ?? "").trim();
  if (!businessId || !accountId) return json(400, { ok: false, error: "Missing ids" });

  let body: any = {};
  try { body = event?.body ? JSON.parse(event.body) : {}; } catch { return json(400, { ok: false, error: "Invalid JSON" }); }

  const effectiveStartDate = String(body?.effectiveStartDate ?? "").trim(); // YYYY-MM-DD
  if (!effectiveStartDate) return json(400, { ok: false, error: "Missing effectiveStartDate" });

  const prisma = await getPrisma();
  const mem = await prisma.userBusinessRole.findFirst({ where: { business_id: businessId, user_id: sub }, select: { role: true } });
  if (!mem) return json(403, { ok: false, error: "Forbidden" });

  const conn = await prisma.bankConnection.findFirst({ where: { business_id: businessId, account_id: accountId } });
  if (!conn) return json(400, { ok: false, error: "No bank connection" });

  // Conflict signals
  const [entriesCount, matchesCount, bankTxCount] = await prisma.$transaction([
    prisma.entry.count({ where: { business_id: businessId, account_id: accountId, deleted_at: null } }),
    prisma.bankMatch.count({ where: { business_id: businessId, account_id: accountId } }),
    prisma.bankTransaction.count({ where: { business_id: businessId, account_id: accountId, is_removed: false } }),
  ]);

  const entries = await prisma.entry.findMany({
    where: { business_id: businessId, account_id: accountId, deleted_at: null },
    select: { id: true, payee: true, amount_cents: true, created_at: true },
    orderBy: { created_at: "asc" as any },
  });

  const openingEntries = entries.filter((e) => isOpeningLike(e.payee));
  const nonOpeningEntries = entries.filter((e) => !isOpeningLike(e.payee));

  // Balance (can be unavailable)
  const plaid = await getPlaidClient();
  const accessToken = await decryptAccessToken(conn.access_token_ciphertext);
  const balRes = await plaid.accountsBalanceGet({ access_token: accessToken });
  const acct = balRes.data.accounts.find((a) => a.account_id === conn.plaid_account_id);

  const current = acct?.balances?.current ?? null;
  const isoCurrency = acct?.balances?.iso_currency_code ?? acct?.balances?.unofficial_currency_code ?? null;

  if (current == null) {
    return json(200, {
      ok: true,
      balanceAvailable: false,
      currency: isoCurrency,
      conflict: {
        hasRealEntries: nonOpeningEntries.length > 0,
        hasMatchesOrClearing: matchesCount > 0,
        hasExistingBankTxns: bankTxCount > 0,
        openingEntriesCount: openingEntries.length,
      },
    });
  }

  const currentBalanceCents = BigInt(Math.round(Number(current) * 100));

  // Sum posted txns in retained window (non-pending, not removed, >= effectiveStartDate)
  const start = new Date(`${effectiveStartDate}T00:00:00Z`);
  const sumAgg = await prisma.bankTransaction.aggregate({
    where: {
      business_id: businessId,
      account_id: accountId,
      is_removed: false,
      is_pending: false,
      posted_date: { gte: start },
    },
    _sum: { amount_cents: true as any },
  });
  const sumCents = BigInt((sumAgg as any)._sum?.amount_cents ?? 0);
  const suggestedOpeningCents = currentBalanceCents - sumCents;

  // If user already has a manual non-zero opening OR any real entries, it’s conflict
  const existingManualOpeningNonZero = openingEntries.some((e) => BigInt(e.amount_cents ?? 0) !== 0n);

  return json(200, {
    ok: true,
    balanceAvailable: true,
    currency: isoCurrency,
    effectiveStartDate,
    currentBalanceCents: currentBalanceCents.toString(),
    sumPostedTxnsCents: sumCents.toString(),
    suggestedOpeningCents: suggestedOpeningCents.toString(),
    conflict: {
      hasRealEntries: nonOpeningEntries.length > 0,
      hasManualOpeningNonZero: existingManualOpeningNonZero,
      hasMatchesOrClearing: matchesCount > 0,
      hasExistingBankTxns: bankTxCount > 0,
      openingEntriesCount: openingEntries.length,
    },
  });
  } catch (e: any) {
    // Return the most useful message available (Plaid SDK often nests details)
    const msg =
      String(e?.response?.data?.error_message ?? "") ||
      String(e?.response?.data?.error_code ?? "") ||
      String(e?.message ?? "Preview failed");

const detail = e?.response?.data ?? null;
const errMsg = String(detail?.error_message ?? msg);

// Special-case: wrong Plaid environment (dev sandbox vs prod token)
if (errMsg.includes("wrong Plaid environment")) {
  return json(200, {
    ok: true,
    balanceAvailable: false,
    envMismatch: true,
    error: errMsg,
    detail,
  });
}

return json(500, { ok: false, error: errMsg, detail });
  }
}