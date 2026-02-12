import { createLinkTokenBusiness, getClaims } from "./lib/plaidService";

export async function handler(event: any) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return { statusCode: 401, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: "Unauthorized" }) };

  const businessId = (event?.pathParameters?.businessId ?? "").toString().trim();
  if (!businessId) return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: "Missing businessId" }) };

  // Create a link token without requiring an existing account.
  // We'll create the account only after user review.
  return createLinkTokenBusiness({ businessId, userId: sub } as any);
}
