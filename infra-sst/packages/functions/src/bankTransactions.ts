import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import { authorizeWrite } from "./lib/authz";
import { assertNotClosedPeriod } from "./lib/closedPeriods";

// Reuse the same auth-claims helper pattern used elsewhere
function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  };
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

async function requireAccountInBusiness(prisma: any, businessId: string, accountId: string) {
  const acct = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { id: true },
  });
  return !!acct;
}

// Phase 6A: deny-by-default write permissions
function canWrite(role: string | null) {
  const r = (role ?? "").toString().trim().toUpperCase();
  return r === "OWNER" || r === "ADMIN" || r === "BOOKKEEPER" || r === "ACCOUNTANT";
}

function parseLimit(q: any) {
  const raw = (q?.limit ?? "").toString().trim();

  const n = raw ? Number(raw) : 200;
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.min(Math.max(Math.floor(n), 1), 500);
}

function parseDateParam(s?: string | null): Date | null {
  if (!s) return null;
  const t = s.toString().trim();
  if (!t) return null;
  // Expect YYYY-MM-DD
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function absBig(n: bigint) {
  return n < 0n ? -n : n;
}

function isoToYmd(iso: any): string {
  try {
    return new Date(String(iso)).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

/**
 * GET /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions?from=&to=&limit=
 * - scoped by businessId + accountId
 * - excludes is_removed=true
 * - ordered by posted_date desc
 */
export async function handler(event: any) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = (event?.pathParameters?.businessId ?? "").toString().trim();
  const accountId = (event?.pathParameters?.accountId ?? "").toString().trim();
  if (!businessId) return json(400, { ok: false, error: "Missing businessId" });
  if (!accountId) return json(400, { ok: false, error: "Missing accountId" });

    const prisma = await getPrisma();

  const role = await requireMembership(prisma, businessId, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  // Phase 4D+ v1: bank txn POST actions
  const method = event?.requestContext?.http?.method;
  const rawPath = (event?.requestContext?.http?.path ?? "").toString();
  const bankTransactionId = (event?.pathParameters?.bankTransactionId ?? "").toString().trim();

  const isUnmatch = method === "POST" && bankTransactionId && rawPath.endsWith("/unmatch");
  const isCreateEntry = method === "POST" && bankTransactionId && rawPath.endsWith("/create-entry");

  if (isUnmatch) {
    // Phase 6A: enforce write permission (deny-by-default)
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    const az = await authorizeWrite(prisma, {
      businessId: businessId,
      scopeAccountId: accountId,
      actorUserId: sub,
      actorRole: role,
      actionKey: "reconcile.match.void",
      requiredLevel: "FULL",
      endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/{bankTransactionId}/unmatch",
    });

    if (!az.allowed) {
      return json(403, {
        ok: false,
        error: "Policy denied",
        code: "POLICY_DENIED",
        actionKey: "reconcile.match.void",
        requiredLevel: az.requiredLevel,
        policyValue: az.policyValue,
        policyKey: az.policyKey,
      });
    }

    // Void all active matches for this bank txn in this scope
    const now = new Date();

    const updated = await prisma.bankMatch.updateMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        bank_transaction_id: bankTransactionId,
        voided_at: null,
      },
      data: {
        voided_at: now,
        voided_by_user_id: sub,
      },
    });

    await logActivity(prisma, {
      businessId: businessId,
      actorUserId: sub,
      scopeAccountId: accountId,
      eventType: "RECONCILE_MATCH_VOIDED",
      payloadJson: { account_id: accountId, bank_transaction_id: bankTransactionId, voided_count: updated.count },
    });

    return json(200, { ok: true, voidedCount: updated.count });
  }

  // -------------------------------------------------------
  // POST /bank-transactions/{bankTransactionId}/create-entry
  // - Creates a ledger entry derived from the bank txn
  // - Optional FULL auto-match when safe (atomic in one DB tx)
  // -------------------------------------------------------
  if (isCreateEntry) {
    // Phase 6A: enforce write permission (deny-by-default)
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    const az = await authorizeWrite(prisma, {
      businessId: businessId,
      scopeAccountId: accountId,
      actorUserId: sub,
      actorRole: role,
      actionKey: "reconcile.entry.create",
      requiredLevel: "FULL",
      endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/{bankTransactionId}/create-entry",
    });

    if (!az.allowed) {
      return json(403, {
        ok: false,
        error: "Policy denied",
        code: "POLICY_DENIED",
        actionKey: "reconcile.entry.create",
        requiredLevel: az.requiredLevel,
        policyValue: az.policyValue,
        policyKey: az.policyKey,
      });
    }

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const autoMatch = body?.autoMatch === true;

    // Optional overrides (used by confirmation dialog)
    const rawMemo = body?.memo ? String(body.memo) : "";
    const memoOverride = rawMemo.trim() ? rawMemo.trim().slice(0, 400) : "";

    const rawMethod = body?.method ? String(body.method) : "";
    const methodOverride = rawMethod.trim().toUpperCase();

    const rawCategoryId = body?.category_id ? String(body.category_id) : "";
    const categoryIdOverride = rawCategoryId.trim() ? rawCategoryId.trim() : "";

    // Load bank transaction (scope: business + account + not removed)
    const bankTxn = await prisma.bankTransaction.findFirst({
      where: {
        business_id: businessId,
        account_id: accountId,
        id: bankTransactionId,
        is_removed: false,
      },
      select: {
        id: true,
        posted_date: true,
        name: true,
        amount_cents: true,
      },
    });

    if (!bankTxn) return json(404, { ok: false, error: "Bank transaction not found" });

    const bankAmt = BigInt(bankTxn.amount_cents);
    const bankAbs = absBig(bankAmt);

    // Compute remainingAbs from active matches
    const active = await prisma.bankMatch.findMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        bank_transaction_id: bankTransactionId,
        voided_at: null,
      },
      select: { matched_amount_cents: true },
    });

    let matchedAbs = 0n;
    for (const m of active) matchedAbs += absBig(BigInt(m.matched_amount_cents));

    const remainingAbs = bankAbs - matchedAbs;
    if (remainingAbs <= 0n) {
      return json(409, { ok: false, code: "ALREADY_MATCHED", error: "Bank transaction is already fully matched." });
    }

    // Enforce closed period by bank posted_date
    const ymd = isoToYmd(bankTxn.posted_date);
    const cp = await assertNotClosedPeriod({ prisma, businessId: businessId, dateInput: ymd });
    if (!cp.ok) return cp.response;

    const sign = bankAmt < 0n ? -1n : 1n;

    // Ledger sign discipline (LOCKED):
    // amount > 0 => INCOME +abs
    // amount < 0 => EXPENSE -abs
    const entryType = sign > 0n ? "INCOME" : "EXPENSE";
    const entryAmountCents = sign > 0n ? remainingAbs : -remainingAbs;

    const defaultMemo = `Bank txn: ${(bankTxn.name ?? "").toString().trim() || "—"} • ${bankTransactionId}`;
    const memo = memoOverride || defaultMemo;

    const allowedMethods = new Set([
      "CASH",
      "CARD",
      "ACH",
      "WIRE",
      "CHECK",
      "DIRECT_DEPOSIT",
      "ZELLE",
      "TRANSFER",
      "OTHER",
    ]);

    const methodFinal = allowedMethods.has(methodOverride) ? methodOverride : "OTHER";
    const categoryIdFinal = categoryIdOverride || null;

    const now = new Date();
    const entryId = crypto?.randomUUID ? crypto.randomUUID() : require("node:crypto").randomUUID();

    // Atomic: create entry + (optional) create FULL match
    const result = await prisma.$transaction(async (tx: any) => {
      const createdEntry = await tx.entry.create({
        data: {
          id: entryId,
          business_id: businessId,
          account_id: accountId,
          date: new Date(`${ymd}T00:00:00Z`),
          payee: (bankTxn.name ?? "").toString().trim() || "Bank transaction",
          memo,
          amount_cents: entryAmountCents,
          type: entryType,
          method: methodFinal,
          status: "EXPECTED",
          category_id: categoryIdFinal,
          deleted_at: null,
          created_at: now,
          updated_at: now,
        },
        select: { id: true },
      });

      let createdMatch: any = null;

      if (autoMatch) {
        // v1 safety:
        // - only FULL when remainingAbs == abs(entry) (true here)
        // - one entry has max one active match (new entry => safe)
        // - sign must align
        const matchAmt = entryAmountCents; // signed, aligns with bank sign by construction

        createdMatch = await tx.bankMatch.create({
          data: {
            business_id: businessId,
            account_id: accountId,
            bank_transaction_id: bankTransactionId,
            entry_id: createdEntry.id,
            match_type: "FULL",
            matched_amount_cents: matchAmt,
            created_by_user_id: sub,
          },
          select: { id: true },
        });
      }

      return { createdEntryId: createdEntry.id, createdMatchId: createdMatch?.id ?? null };
    });

    await logActivity(prisma, {
      businessId: businessId,
      actorUserId: sub,
      scopeAccountId: accountId,
      // Use an existing ActivityEventType (enum-safe). Payload disambiguates the action.
      eventType: "RECONCILE_MATCH_CREATED",
      payloadJson: {
        action: "BANK_TXN_CREATE_ENTRY",
        account_id: accountId,
        bank_transaction_id: bankTransactionId,
        entry_id: result.createdEntryId,
        auto_matched: !!result.createdMatchId,
        match_id: result.createdMatchId,
        remaining_abs_cents: remainingAbs.toString(),
      },
    });

    return json(201, {
      ok: true,
      entryId: result.createdEntryId,
      autoMatched: !!result.createdMatchId,
      matchId: result.createdMatchId,
    });
  }

  const q = event?.queryStringParameters ?? {};
  const limit = parseLimit(q);
  const from = parseDateParam(q?.from ?? null);
  const to = parseDateParam(q?.to ?? null);

  const where: any = {
    business_id: businessId,
    account_id: accountId,
    is_removed: false,
  };
  if (from || to) {
    where.posted_date = {};
    if (from) where.posted_date.gte = from;
    if (to) where.posted_date.lte = to;
  }

  const rows = await prisma.bankTransaction.findMany({
    where,
    orderBy: [{ posted_date: "desc" }, { created_at: "desc" }],
    take: limit,
    select: {
      id: true,
      posted_date: true,
      name: true,
      amount_cents: true,
      is_pending: true,
      iso_currency_code: true,
      source: true,
      source_parser: true,
      source_upload_id: true,
      import_hash: true,
      created_at: true,
    },
  });

  return json(200, { ok: true, items: rows });
}
