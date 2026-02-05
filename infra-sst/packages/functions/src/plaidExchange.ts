import { exchangePublicToken, getClaims } from "./lib/plaidService";

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

  const publicToken = (body?.public_token ?? "").toString().trim();
  const effectiveStartDate = (body?.effectiveStartDate ?? "").toString().trim(); // YYYY-MM-DD
  const endDate = (body?.endDate ?? "").toString().trim(); // optional YYYY-MM-DD (end defaults to today)
  const plaidAccountId = (body?.plaidAccountId ?? "").toString().trim();
  const institution = body?.institution ?? undefined;

  if (!publicToken) return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: "Missing public_token" }) };
  if (!effectiveStartDate) return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: "Missing effectiveStartDate" }) };
  if (!plaidAccountId) return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: "Missing plaidAccountId" }) };

  return exchangePublicToken({
    businessId,
    accountId,
    userId: sub,
    publicToken,
    effectiveStartDate,
    endDate, // service may ignore until implemented
    institution,
    plaidAccountId,
  } as any);
}
