import { syncTransactions, getClaims } from "./lib/plaidService";

export async function handler(event: any) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return { statusCode: 401, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: "Unauthorized" }) };

  const businessId = (event?.pathParameters?.businessId ?? "").toString().trim();
  const accountId = (event?.pathParameters?.accountId ?? "").toString().trim();
  if (!businessId) return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: "Missing businessId" }) };
  if (!accountId) return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: "Missing accountId" }) };

  let body: any = {};
  try {
    body = event?.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  return syncTransactions({
    businessId,
    accountId,
    userId: sub,
    // Ordinary cursor syncs are free and webhook-driven. Keep the billed
    // Transactions Refresh call behind an explicit force-only contract so an
    // older client or repeated Sync click cannot create per-call Plaid fees.
    requestRefresh: body?.forceRefresh === true,
    // Real-time Balance is also a paid, user-present operation. Routine syncs
    // use Plaid's cached balance and preserve its provider freshness timestamp.
    requestBalanceRefresh: body?.forceBalanceRefresh === true,
    afterReconnect: body?.afterReconnect === true,
  });
}
