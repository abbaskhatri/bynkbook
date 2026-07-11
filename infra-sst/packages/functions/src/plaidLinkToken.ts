import { createLinkToken, getClaims } from "./lib/plaidService";

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

  return createLinkToken({
    businessId,
    accountId,
    userId: sub,
    mode: body?.mode === "update" || body?.reconnect === true ? "update" : "connect",
    sourceAccountId: (body?.sourceAccountId ?? "").toString().trim() || undefined,
    listOptions: body?.listOptions === true,
  });
}
