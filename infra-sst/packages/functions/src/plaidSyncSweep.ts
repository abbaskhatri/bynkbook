import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

import { getPrisma } from "./lib/db";

const sqs = new SQSClient({});

export const PLAID_CATCHUP_AFTER_MS = 2 * 60 * 60_000;
export const PLAID_CATCHUP_THROTTLE_MS = 10 * 60_000;
export const PLAID_CATCHUP_BATCH_SIZE = 250;

type PlaidSyncCandidate = {
  id: string;
  business_id: string;
  account_id: string;
  plaid_item_id: string;
  updated_at: Date;
};

export async function enqueuePlaidSyncCatchup(params: {
  prisma: any;
  enqueue: (message: Record<string, string>) => Promise<void>;
  now?: Date;
  limit?: number;
}) {
  const now = params.now ?? new Date();
  const staleBefore = new Date(now.getTime() - PLAID_CATCHUP_AFTER_MS);
  const throttleBefore = new Date(now.getTime() - PLAID_CATCHUP_THROTTLE_MS);
  const candidates: PlaidSyncCandidate[] = await params.prisma.bankConnection.findMany({
    where: {
      account: { archived_at: null, type: { not: "CASH" } },
      status: {
        notIn: [
          "DISCONNECTED",
          "INACTIVE",
          "EXPIRED",
          "ERROR",
          "NEEDS_ATTENTION",
          "REAUTH_REQUIRED",
          "LOGIN_REQUIRED",
          "ITEM_LOGIN_REQUIRED",
          "ENV_MISMATCH_RECONNECT_REQUIRED",
          "PLAID_ACCOUNT_MISSING",
        ],
      },
      updated_at: { lt: throttleBefore },
      AND: [
        {
          OR: [
            { sync_lock_token: null },
            { sync_lock_expires_at: null },
            { sync_lock_expires_at: { lt: now } },
          ],
        },
        {
          OR: [
            { has_new_transactions: true },
            { last_sync_at: null },
            { last_sync_at: { lt: staleBefore } },
            { status: { in: ["PENDING_SYNC", "SYNC_ERROR", "SYNCING"] } },
          ],
        },
      ],
    },
    select: {
      id: true,
      business_id: true,
      account_id: true,
      plaid_item_id: true,
      updated_at: true,
    },
    orderBy: [{ has_new_transactions: "desc" }, { last_sync_at: "asc" }, { updated_at: "asc" }],
    take: Math.max(1, Math.min(1000, params.limit ?? PLAID_CATCHUP_BATCH_SIZE)),
  });

  let queued = 0;
  let skipped = 0;
  const errors: unknown[] = [];
  for (const candidate of candidates) {
    const reserved = await params.prisma.bankConnection.updateMany({
      where: {
        id: candidate.id,
        business_id: candidate.business_id,
        account_id: candidate.account_id,
        updated_at: { lt: throttleBefore },
        OR: [
          { sync_lock_token: null },
          { sync_lock_expires_at: null },
          { sync_lock_expires_at: { lt: now } },
        ],
      },
      data: { updated_at: now },
    });
    if (Number(reserved?.count ?? 0) !== 1) {
      skipped += 1;
      continue;
    }

    try {
      await params.enqueue({
        businessId: candidate.business_id,
        accountId: candidate.account_id,
        itemId: candidate.plaid_item_id,
        source: "scheduled-catchup",
        balanceMode: "cached",
      });
      queued += 1;
    } catch (error) {
      errors.push(error);
      // Release only our own reservation so the next invocation can retry
      // immediately without overwriting a newer concurrent state change.
      await params.prisma.bankConnection.updateMany({
        where: { id: candidate.id, updated_at: now },
        data: { updated_at: candidate.updated_at },
      }).catch(() => undefined);
    }
  }

  if (errors.length > 0) throw errors[0];
  return { scanned: candidates.length, queued, skipped };
}

export async function handler() {
  const queueUrl = String(process.env.PLAID_SYNC_QUEUE_URL ?? "").trim();
  if (!queueUrl) throw new Error("Missing PLAID_SYNC_QUEUE_URL");
  const prisma = await getPrisma();
  const result = await enqueuePlaidSyncCatchup({
    prisma,
    enqueue: async (message) => {
      await sqs.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
      }));
    },
  });
  console.log("Plaid scheduled catch-up sweep complete", result);
  return result;
}
