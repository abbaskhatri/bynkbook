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
  return handleWebhook({
    body,
    rawBody,
    headers: event?.headers ?? {},
    enqueueSync: queueUrl
      ? async (target) => {
          await sqs.send(new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: JSON.stringify(target),
          }));
        }
      : undefined,
  });
}
