import type { SQSBatchResponse, SQSEvent } from "aws-lambda";
import { syncTransactions } from "./lib/plaidService";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      const body = JSON.parse(record.body ?? "{}");
      const businessId = String(body?.businessId ?? "").trim();
      const accountId = String(body?.accountId ?? "").trim();
      const balanceMode = body?.balanceMode === "skip" || body?.balanceMode === "realtime"
        ? body.balanceMode
        : "cached";
      if (!businessId || !accountId) throw new Error("Invalid Plaid sync queue message");

      let complete = false;
      for (let pass = 0; pass < 10; pass += 1) {
        const response = await syncTransactions({
          businessId,
          accountId,
          userId: "system:plaid-webhook",
          system: true,
          balanceMode,
        });
        const statusCode = Number(response?.statusCode ?? 500);
        const result = JSON.parse(response?.body ?? "{}");
        if (statusCode >= 400 || result?.ok === false) {
          // The sync service has already persisted the reconnect state. Retrying
          // a permanently invalid Item only creates queue churn and a false DLQ
          // alarm; the next useful action belongs to the user in Plaid Link.
          if (result?.reconnectRequired === true) {
            complete = true;
            break;
          }
          throw new Error(result?.error ?? result?.message ?? `Plaid sync failed with ${statusCode}`);
        }
        if (result?.syncInProgress) {
          throw new Error("Plaid sync lease is currently held; retry this queue message");
        }
        if (!result?.drainIncomplete && !result?.hasMore) {
          complete = true;
          break;
        }
      }
      if (!complete) throw new Error("Plaid sync remained incomplete after continuation limit");
    } catch {
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
