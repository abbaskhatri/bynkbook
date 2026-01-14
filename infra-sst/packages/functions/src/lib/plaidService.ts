import { getPrisma } from "./db";
import { Products, CountryCode } from "plaid";
import { getPlaidClient } from "./plaidClient";
import { encryptAccessToken, decryptAccessToken } from "./plaidCrypto";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

export async function requireMembership(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

export async function requireAccountInBusiness(prisma: any, businessId: string, accountId: string) {
  const acct = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { id: true },
  });
  return !!acct;
}

/**
 * Create link token (server-side).
 * Phase 4B: transactions product only.
 */
export async function createLinkToken(params: {
  businessId: string;
  accountId: string;
  userId: string;
}) {
  const { businessId, accountId, userId } = params;

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  const plaid = await getPlaidClient();

  const res = await plaid.linkTokenCreate({
    user: { client_user_id: userId },
    client_name: "BynkBook",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  });

  return json(200, { ok: true, link_token: res.data.link_token });
}

/**
 * Exchange public token + store mapping and retention start date.
 * Body must include effectiveStartDate (YYYY-MM-DD).
 */
export async function exchangePublicToken(params: {
  businessId: string;
  accountId: string;
  userId: string;
  publicToken: string;
  effectiveStartDate: string;
  institution?: { name?: string; institution_id?: string };
  plaidAccountId: string;
}) {
  const { businessId, accountId, userId, publicToken, effectiveStartDate, institution, plaidAccountId } = params;

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  const start = new Date(`${effectiveStartDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return json(400, { ok: false, error: "Invalid effectiveStartDate (YYYY-MM-DD required)" });

  const plaid = await getPlaidClient();
  const ex = await plaid.itemPublicTokenExchange({ public_token: publicToken });

  const accessToken = ex.data.access_token;
  const itemId = ex.data.item_id;
  const ciphertext = await encryptAccessToken(accessToken);

  // Upsert one connection per account
  await prisma.bankConnection.upsert({
    where: { business_id_account_id: { business_id: businessId, account_id: accountId } },
    create: {
      business_id: businessId,
      account_id: accountId,
      plaid_item_id: itemId,
      plaid_account_id: plaidAccountId,
      access_token_ciphertext: ciphertext,
      effective_start_date: start,
      institution_name: institution?.name ?? null,
      institution_id: institution?.institution_id ?? null,
      status: "CONNECTED",
      has_new_transactions: false,
    },
    update: {
      plaid_item_id: itemId,
      plaid_account_id: plaidAccountId,
      access_token_ciphertext: ciphertext,
      effective_start_date: start,
      institution_name: institution?.name ?? null,
      institution_id: institution?.institution_id ?? null,
      status: "CONNECTED",
      error_code: null,
      error_message: null,
      has_new_transactions: false,
      updated_at: new Date(),
    },
  });

  return json(200, { ok: true, connected: true });
}

export async function getStatus(params: { businessId: string; accountId: string; userId: string }) {
  const { businessId, accountId, userId } = params;

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  const conn = await prisma.bankConnection.findFirst({
    where: { business_id: businessId, account_id: accountId },
  });

  if (!conn) return json(200, { ok: true, connected: false });

  return json(200, {
    ok: true,
    connected: conn.status === "CONNECTED",
    status: conn.status,
    institutionName: conn.institution_name,
    lastSyncAt: conn.last_sync_at ? conn.last_sync_at.toISOString() : null,
    hasNewTransactions: !!conn.has_new_transactions,
    effectiveStartDate: conn.effective_start_date.toISOString().slice(0, 10),
    lastKnownBalanceCents: conn.last_known_balance_cents?.toString?.() ?? null,
    lastKnownBalanceAt: conn.last_known_balance_at ? conn.last_known_balance_at.toISOString() : null,
    error: conn.error_message ?? null,
  });
}

/**
 * Sync transactions (cursor-based) + retention + balance + webhook flag clearing + opening adjustment entry.
 * Returns: newCount, upgradedCount(=0), duplicateCount, pendingCount, lastSyncAt
 */
export async function syncTransactions(params: { businessId: string; accountId: string; userId: string }) {
  const { businessId, accountId, userId } = params;

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  const conn = await prisma.bankConnection.findFirst({
    where: { business_id: businessId, account_id: accountId },
  });
  if (!conn) return json(400, { ok: false, error: "No bank connection for this account" });

  const plaid = await getPlaidClient();
  const accessToken = await decryptAccessToken(conn.access_token_ciphertext);

  // Fetch current balance (backend-provided; stored for UI)
  // Note: this returns all accounts on the item, we select the mapped one.
  const balRes = await plaid.accountsBalanceGet({ access_token: accessToken });
  const acct = balRes.data.accounts.find((a) => a.account_id === conn.plaid_account_id);
  const currentBalance = acct?.balances?.current ?? null;
  const currentBalanceCents = currentBalance == null ? null : BigInt(Math.round(currentBalance * 100));

  // Initial backfill deletion rule (only delete PLAID-sourced rows older than effectiveStartDate)
  // Because Phase 4B has no CSV parsing, PLAID is the only source inserted here.
  await prisma.bankTransaction.deleteMany({
    where: {
      business_id: businessId,
      account_id: accountId,
      posted_date: { lt: conn.effective_start_date },
    },
  });

  let cursor = conn.sync_cursor ?? null;
  let hasMore = true;

  let newCount = 0;
  let duplicateCount = 0;
  let pendingCount = 0;

  while (hasMore) {
    const r = await plaid.transactionsSync({
      access_token: accessToken,
      cursor: cursor ?? undefined,
      count: 500,
    });

    const data = r.data;
    cursor = data.next_cursor;
    hasMore = data.has_more;

    // Upsert added + modified
    const upserts = [...data.added, ...data.modified];
    for (const t of upserts) {
      // Retention: do not retain anything older than effectiveStartDate
      const posted = t.date ? new Date(`${t.date}T00:00:00Z`) : null;
      if (!posted) continue;
      if (posted < conn.effective_start_date) continue;

      const cents = BigInt(Math.round(Number(t.amount) * 100));

      const isPending = !!t.pending;
      if (isPending) pendingCount += 1;

      try {
        // Create, else update on unique constraint
        await prisma.bankTransaction.create({
          data: {
            business_id: businessId,
            account_id: accountId,
            plaid_transaction_id: t.transaction_id,
            plaid_account_id: conn.plaid_account_id,
            posted_date: posted,
            authorized_date: t.authorized_date ? new Date(`${t.authorized_date}T00:00:00Z`) : null,
            amount_cents: cents,
            name: (t.name ?? t.merchant_name ?? "Transaction").toString(),
            is_pending: isPending,
            iso_currency_code: t.iso_currency_code ?? null,
            is_removed: false,
            raw: t as any,
          },
        });
        newCount += 1;
      } catch {
        duplicateCount += 1;
        // Update existing row (idempotent)
        await prisma.bankTransaction.updateMany({
          where: {
            business_id: businessId,
            plaid_transaction_id: t.transaction_id,
          },
          data: {
            posted_date: posted,
            authorized_date: t.authorized_date ? new Date(`${t.authorized_date}T00:00:00Z`) : null,
            amount_cents: cents,
            name: (t.name ?? t.merchant_name ?? "Transaction").toString(),
            is_pending: isPending,
            iso_currency_code: t.iso_currency_code ?? null,
            is_removed: false,
            removed_at: null,
            raw: t as any,
            updated_at: new Date(),
          },
        });
      }
    }

    // Apply removed
    for (const removed of data.removed) {
      await prisma.bankTransaction.updateMany({
        where: { business_id: businessId, plaid_transaction_id: removed.transaction_id },
        data: { is_removed: true, removed_at: new Date(), updated_at: new Date() },
      });
    }
  }

  const now = new Date();

  // Opening adjustment rule (create exactly once per account on initial connect/backfill)
  // opening_adjustment = current_bank_balance − sum(posted_transactions_in_retained_window)
  if (conn.opening_adjustment_created_at == null && currentBalanceCents != null) {
    const sum = await prisma.bankTransaction.aggregate({
      where: {
        business_id: businessId,
        account_id: accountId,
        is_removed: false,
        is_pending: false,
        posted_date: { gte: conn.effective_start_date },
      },
      _sum: { amount_cents: true as any },
    });

    const sumCents = BigInt((sum as any)._sum?.amount_cents ?? 0);
    const openingAdjustment = currentBalanceCents - sumCents;

    // Create ledger Entry (Phase 3 rule: INCOME/EXPENSE only; enforce sign)
    const abs = openingAdjustment < 0n ? -openingAdjustment : openingAdjustment;
    const entryType = openingAdjustment >= 0n ? "INCOME" : "EXPENSE";
    const signed = entryType === "INCOME" ? abs : -abs;

    await prisma.entry.create({
      data: {
        id: (await import("node:crypto")).randomUUID(),
        business_id: businessId,
        account_id: accountId,
        date: conn.effective_start_date,
        payee: "Opening balance adjustment",
        memo: "Auto-created on initial Plaid backfill (Phase 4B)",
        amount_cents: signed,
        type: entryType,
        method: null,
        category_id: null,
        vendor_id: null,
        status: "EXPECTED",
      },
    });

    await prisma.bankConnection.updateMany({
      where: { business_id: businessId, account_id: accountId },
      data: { opening_adjustment_created_at: now, updated_at: now },
    });
  }

  // Clear webhook flag only if newCount > 0 (your rule)
  const clearNewFlag = newCount > 0;

  await prisma.bankConnection.updateMany({
    where: { business_id: businessId, account_id: accountId },
    data: {
      sync_cursor: cursor,
      last_sync_at: now,
      has_new_transactions: clearNewFlag ? false : conn.has_new_transactions,
      last_known_balance_cents: currentBalanceCents,
      last_known_balance_at: currentBalanceCents == null ? null : now,
      updated_at: now,
    },
  });

  return json(200, {
    ok: true,
    newCount,
    upgradedCount: 0,
    duplicateCount,
    pendingCount,
    lastSyncAt: now.toISOString(),
  });
}

export async function handleWebhook(body: any) {
  const prisma = await getPrisma();

  const itemId = (body?.item_id ?? "").toString();
  const webhookType = (body?.webhook_type ?? "").toString();
  const webhookCode = (body?.webhook_code ?? "").toString();

  if (!itemId) return json(400, { ok: false, error: "Missing item_id" });

  // Only care about TRANSACTIONS updates for Phase 4B
  if (webhookType !== "TRANSACTIONS") return json(200, { ok: true, ignored: true });

  // Set flag on all connections with this item_id (safe)
  await prisma.bankConnection.updateMany({
    where: { plaid_item_id: itemId },
    data: { has_new_transactions: true, updated_at: new Date() },
  });

  return json(200, { ok: true, webhookType, webhookCode });
}
