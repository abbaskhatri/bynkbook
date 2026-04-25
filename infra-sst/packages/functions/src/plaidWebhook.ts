import { handleWebhook } from "./lib/plaidService";

export async function handler(event: any) {
  const rawBody = event?.isBase64Encoded
    ? Buffer.from(event?.body ?? "", "base64").toString("utf8")
    : (event?.body ?? "");

  let body: any = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: "Invalid JSON body" }) };
  }

  return handleWebhook({ body, rawBody, headers: event?.headers ?? {} });
}
