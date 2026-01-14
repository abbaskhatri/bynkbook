import { handleWebhook } from "./lib/plaidService";

export async function handler(event: any) {
  let body: any = {};
  try {
    body = event?.body ? JSON.parse(event.body) : {};
  } catch {
    return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ ok: false, error: "Invalid JSON body" }) };
  }

  return handleWebhook(body);
}
