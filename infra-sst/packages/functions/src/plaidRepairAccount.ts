import { getClaims, repairPlaidAccountMapping } from "./lib/plaidService";

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
    return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: "Invalid JSON body" }) };
  }

  const plaidAccountId = (body?.plaidAccountId ?? "").toString().trim();
  if (!plaidAccountId) return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: "Missing plaidAccountId" }) };

  return repairPlaidAccountMapping({
    businessId,
    accountId,
    userId: sub,
    plaidAccountId,
    sourceAccountId: (body?.sourceAccountId ?? "").toString().trim() || undefined,
    institution: body?.institution ?? undefined,
    mask: (body?.mask ?? "").toString().trim() || undefined,
    additionalAccounts: Array.isArray(body?.additionalAccounts) ? body.additionalAccounts : undefined,
  });
}
