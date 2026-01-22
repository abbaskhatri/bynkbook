import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import { authorizeWrite } from "./lib/authz";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
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

function absBig(n: bigint) {
  return n < 0n ? -n : n;
}

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

  const method = event?.requestContext?.http?.method ?? "GET";

  // -------------------------------------------------------
  // GET /matches  (list active matches; optional filters)
  // -------------------------------------------------------
  if (method === "GET") {
    const q = event?.queryStringParameters ?? {};
    const bankTransactionId = (q?.bankTransactionId ?? "").toString().trim();
    const entryId = (q?.entryId ?? "").toString().trim();

    const where: any = {
      business_id: businessId,
      account_id: accountId,
      voided_at: null,
    };
    if (bankTransactionId) where.bank_transaction_id = bankTransactionId;
    if (entryId) where.entry_id = entryId;

    const items = await prisma.bankMatch.findMany({
      where,
      orderBy: [{ created_at: "desc" }],
      select: {
        id: true,
        bank_transaction_id: true,
        entry_id: true,
        match_type: true,
        matched_amount_cents: true,
        created_at: true,
        created_by_user_id: true,
      },
    });

    return json(200, { ok: true, items });
  }

  // -------------------------------------------------------
  // POST /matches (create match)
  // -------------------------------------------------------
  if (method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  // Phase 6A: enforce write permission (deny-by-default)
  if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

  const az = await authorizeWrite(prisma, {
    businessId: businessId,
    scopeAccountId: accountId,
    actorUserId: sub,
    actorRole: role,
    actionKey: "reconcile.match.create",
    requiredLevel: "FULL",
    endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/matches",
  });

  if (!az.allowed) {
    return json(403, {
      ok: false,
      error: "Policy denied",
      code: "POLICY_DENIED",
      actionKey: "reconcile.match.create",
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

  const bankTransactionId = (body?.bankTransactionId ?? "").toString().trim();
  const entryId = (body?.entryId ?? "").toString().trim();
  const matchType = (body?.matchType ?? "").toString().trim().toUpperCase();
  const matchedAmountRaw = body?.matchedAmountCents;

  if (!bankTransactionId) return json(400, { ok: false, error: "Missing bankTransactionId" });
  if (!entryId) return json(400, { ok: false, error: "Missing entryId" });
  if (matchType !== "FULL" && matchType !== "PARTIAL") {
    return json(400, { ok: false, error: "Invalid matchType" });
  }

  let matchedAmountCents: bigint;
  try {
    matchedAmountCents =
      typeof matchedAmountRaw === "bigint"
        ? matchedAmountRaw
        : typeof matchedAmountRaw === "number"
        ? BigInt(Math.trunc(matchedAmountRaw))
        : typeof matchedAmountRaw === "string"
        ? BigInt(matchedAmountRaw)
        : 0n;
  } catch {
    return json(400, { ok: false, error: "Invalid matchedAmountCents" });
  }

  if (matchedAmountCents === 0n) return json(400, { ok: false, error: "matchedAmountCents cannot be 0" });

  // Load entry (must be in scope)
  const entry = await prisma.entry.findFirst({
    where: { id: entryId, business_id: businessId, account_id: accountId, deleted_at: null },
    select: { id: true, amount_cents: true, is_adjustment: true },
  });
  if (!entry) return json(404, { ok: false, error: "Entry not found" });
  if (entry.is_adjustment) return json(400, { ok: false, error: "Cannot match an adjustment entry" });

  // v1 constraint: entry can have at most one active match
  const existing = await prisma.bankMatch.findFirst({
    where: { business_id: businessId, account_id: accountId, entry_id: entryId, voided_at: null },
    select: { id: true },
  });
  if (existing) return json(400, { ok: false, error: "Entry already matched (v1 constraint)" });

  // Load bank txn (must be in scope)
  const bankTxn = await prisma.bankTransaction.findFirst({
    where: { id: bankTransactionId, business_id: businessId, account_id: accountId, is_removed: false },
    select: { id: true, amount_cents: true },
  });
  if (!bankTxn) return json(404, { ok: false, error: "Bank transaction not found" });

  // Abs-based remaining for bank txn (sum active matches)
  const active = await prisma.bankMatch.findMany({
    where: { business_id: businessId, account_id: accountId, bank_transaction_id: bankTransactionId, voided_at: null },
    select: { matched_amount_cents: true },
  });
  const matchedAbs = active.reduce((acc: bigint, m: any) => acc + absBig(BigInt(m.matched_amount_cents)), 0n);

  const bankAbs = absBig(BigInt(bankTxn.amount_cents));
  const bankRemainingAbs = bankAbs - matchedAbs;
  if (bankRemainingAbs <= 0n) return json(400, { ok: false, error: "Bank transaction has no remaining amount" });

  const entryAbs = absBig(BigInt(entry.amount_cents));
  const matchAbs = absBig(matchedAmountCents);

  // Sign discipline: matched amount sign must equal bank txn sign and entry sign
  const bankSign = BigInt(bankTxn.amount_cents) < 0n ? -1 : 1;
  const entrySign = BigInt(entry.amount_cents) < 0n ? -1 : 1;
  const matchSign = matchedAmountCents < 0n ? -1 : 1;
  if (bankSign !== entrySign || bankSign !== matchSign) {
    return json(400, { ok: false, error: "Sign mismatch between bank txn, entry, and matched amount" });
  }

  // Bounds (abs-based)
  if (matchAbs > bankRemainingAbs) return json(400, { ok: false, error: "Matched amount exceeds bank remaining" });
  if (matchAbs > entryAbs) return json(400, { ok: false, error: "Matched amount exceeds entry amount (v1)" });

  if (matchType === "FULL" && matchAbs !== entryAbs) {
    return json(400, { ok: false, error: "FULL match must equal full entry amount in v1" });
  }
  if (matchType === "PARTIAL" && matchAbs >= entryAbs) {
    return json(400, { ok: false, error: "PARTIAL match must be less than full entry amount" });
  }

  const created = await prisma.bankMatch.create({
    data: {
      business_id: businessId,
      account_id: accountId,
      bank_transaction_id: bankTransactionId,
      entry_id: entryId,
      match_type: matchType,
      matched_amount_cents: matchedAmountCents,
      created_by_user_id: sub,
    },
  });

  await logActivity(prisma, {
    businessId: businessId,
    actorUserId: sub,
    scopeAccountId: accountId,
    eventType: "RECONCILE_MATCH_CREATED",
    payloadJson: {
      account_id: accountId,
      match_id: created.id,
      bank_transaction_id: bankTransactionId,
      entry_id: entryId,
      match_type: matchType,
      matched_amount_cents: matchedAmountCents,
    },
  });

  return json(201, { ok: true, match: created });
}
