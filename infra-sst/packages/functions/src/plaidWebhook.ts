import { handleWebhook } from "./lib/plaidService";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({});

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

  const queueUrl = String(process.env.PLAID_SYNC_QUEUE_URL ?? "").trim();
  let enqueuedConnections = 0;
  const response = await handleWebhook({
    body,
    rawBody,
    headers: event?.headers ?? {},
    enqueueSync: queueUrl
      ? async (target) => {
          await sqs.send(new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(target),
          }));
          enqueuedConnections += 1;
        }
      : undefined,
  });

  // Keep webhook telemetry useful without recording Item IDs, account IDs,
  // request bodies, or credentials.
  console.info("Plaid webhook handled", {
    webhookType: String(body?.webhook_type ?? "").trim().toUpperCase().slice(0, 80),
    webhookCode: String(body?.webhook_code ?? "").trim().toUpperCase().slice(0, 80),
    environment: String(body?.environment ?? "").trim().toLowerCase().slice(0, 20),
    statusCode: Number(response?.statusCode ?? 500),
    enqueuedConnections,
  });
  return response;
}
