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

    // Production-grade: request up to 24 months instead of Plaid's default (~90 days)
    transactions: { days_requested: 730 },
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
  endDate?: string; // optional YYYY-MM-DD (end defaults to today)
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

      // Critical: do NOT delete CSV-imported history.
      // Only delete Plaid-sourced rows (source="PLAID" or null legacy Plaid rows) that have plaid_transaction_id.
      plaid_transaction_id: { not: null },
      OR: [{ source: "PLAID" }, { source: null }],
    },
  });

  let cursor = conn.sync_cursor ?? null;
  let hasMore = true;

  // Drain safety (production hardening)
  const MAX_PAGES = 20;          // safety cap
  const MAX_TOTAL = 5000;        // safety cap
  const RETRY_MAX = 3;
  const BACKOFF_BASE_MS = 350;

  let pageN = 0;
  let totalSeen = 0;

  let newCount = 0;
  let duplicateCount = 0;

  // pendingCount will be computed from DB at end (accurate), not guessed during loop
  let pendingCount = 0;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function syncPage() {
    for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
      try {
        return await plaid.transactionsSync({
          access_token: accessToken,
          cursor: cursor ?? undefined,
          count: 500,
        });
      } catch (e: any) {
        const msg = String(e?.message ?? "");
        // light backoff for transient errors / rate limiting
        const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt);
        if (attempt < RETRY_MAX - 1) await sleep(backoff);
        else throw new Error(`Plaid transactions/sync failed: ${msg}`);
      }
    }
    throw new Error("Plaid transactions/sync failed");
  }

  while (hasMore) {
    if (pageN >= MAX_PAGES) break;
    if (totalSeen >= MAX_TOTAL) break;

    const r = await syncPage();
    pageN += 1;

    const data = r.data;
    cursor = data.next_cursor;
    hasMore = data.has_more;

    // Count seen for safety caps
    const pageSeen = (data.added?.length ?? 0) + (data.modified?.length ?? 0) + (data.removed?.length ?? 0);
    totalSeen += pageSeen;
    if (totalSeen >= MAX_TOTAL) hasMore = false;

    // Upsert added + modified
    const upserts = [...data.added, ...data.modified];
    for (const t of upserts) {
      // Retention: do not retain anything older than effectiveStartDate
      const posted = t.date ? new Date(`${t.date}T00:00:00Z`) : null;
      if (!posted) continue;
      if (posted < conn.effective_start_date) continue;

      // Plaid: amount is positive for outflows (debits). Our BankTransaction uses negative for outflows.
      const cents = -BigInt(Math.round(Number(t.amount) * 100));
      const isPending = !!t.pending;

      // Pending → posted upgrade:
      // If Plaid provides pending_transaction_id, update that existing row to become this posted txn.
      if (!isPending && t.pending_transaction_id) {
        const pendingId = String(t.pending_transaction_id);
        if (pendingId) {
          await prisma.bankTransaction.updateMany({
            where: {
              business_id: businessId,
              account_id: accountId,
              plaid_transaction_id: pendingId,
            },
            data: {
              plaid_transaction_id: t.transaction_id,
              posted_date: posted,
              authorized_date: t.authorized_date ? new Date(`${t.authorized_date}T00:00:00Z`) : null,
              amount_cents: cents,
              name: (t.name ?? t.merchant_name ?? "Transaction").toString(),
              is_pending: false,
              iso_currency_code: t.iso_currency_code ?? null,
              is_removed: false,
              removed_at: null,
              source: "PLAID",
              plaid_account_id: conn.plaid_account_id,
              raw: t as any,
              updated_at: new Date(),
            },
          });
        }
      }

      try {
        await prisma.bankTransaction.create({
          data: {
            business_id: businessId,
            account_id: accountId,
            plaid_transaction_id: t.transaction_id,
            plaid_account_id: conn.plaid_account_id,
            source: "PLAID",
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
        await prisma.bankTransaction.updateMany({
          where: {
            business_id: businessId,
            account_id: accountId,
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
            source: "PLAID",
            plaid_account_id: conn.plaid_account_id,
            raw: t as any,
            updated_at: new Date(),
          },
        });
      }
    }

    // Apply removed
    for (const removed of data.removed) {
      await prisma.bankTransaction.updateMany({
        where: {
          business_id: businessId,
          account_id: accountId,
          plaid_transaction_id: removed.transaction_id,
        },
        data: { is_removed: true, removed_at: new Date(), updated_at: new Date() },
      });
    }
  }

  const now = new Date();

  // Accurate pending count after sync (not guesswork)
  pendingCount = await prisma.bankTransaction.count({
    where: {
      business_id: businessId,
      account_id: accountId,
      is_removed: false,
      is_pending: true,
      posted_date: { gte: conn.effective_start_date },
    },
  });

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

    // Professional rule:
    // - If the account already has user-entered entries, DO NOT create a synthetic opening.
    // - If the only entry is an auto-created zero "Opening Balance", UPDATE it instead of creating a second one.
    const existing = await prisma.entry.findMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        deleted_at: null,
      },
      select: { id: true, payee: true, amount_cents: true },
      orderBy: { created_at: "asc" as any },
      take: 20,
    });

    const lower = (s: any) => String(s ?? "").trim().toLowerCase();
    const isOpeningLike = (p: any) => {
      const x = lower(p);
      return x === "opening balance" || x === "opening balance (estimated)" || x.startsWith("opening balance");
    };

    const hasNonOpeningEntries = existing.some((e) => !isOpeningLike(e.payee));
    const zeroOpening = existing.find((e) => isOpeningLike(e.payee) && BigInt(e.amount_cents ?? 0) === 0n);

    if (!hasNonOpeningEntries) {
      if (zeroOpening) {
        // Replace the placeholder opening with the Plaid-estimated opening (no duplicates)
        await prisma.entry.update({
          where: { id: zeroOpening.id },
          data: {
            payee: "Opening balance (estimated)",
            memo: "Estimated from current balance and synced transactions (Plaid).",
            amount_cents: signed,
            type: entryType,
            method: null,
            category_id: null,
            vendor_id: null,
            status: "EXPECTED",
            date: conn.effective_start_date,
            updated_at: now,
          } as any,
        });
      } else if (existing.length === 0) {
        // Truly empty account => create the estimated opening once
        await prisma.entry.create({
          data: {
            id: (await import("node:crypto")).randomUUID(),
            business_id: businessId,
            account_id: accountId,
            date: conn.effective_start_date,
            payee: "Opening balance (estimated)",
            memo: "Estimated from current balance and synced transactions (Plaid).",
            amount_cents: signed,
            type: entryType,
            method: null,
            category_id: null,
            vendor_id: null,
            status: "EXPECTED",
          },
        });
      }
    }

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

    // Progress metadata (useful for UI)
    pages: pageN,
    totalSeen,
    capped: pageN >= MAX_PAGES || totalSeen >= MAX_TOTAL,
    hasMore: hasMore,
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
