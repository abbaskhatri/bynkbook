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
  const path = (event?.rawPath ?? event?.requestContext?.http?.path ?? "").toString();
  const isBatch = path.endsWith("/matches/batch");

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
  // POST /matches OR /matches/batch
  // -------------------------------------------------------
  if (method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  // Phase 6A: enforce write permission (deny-by-default)
  if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

  const az = await authorizeWrite(prisma, {
    businessId: businessId,
    scopeAccountId: accountId,
    actorUserId: sub,
    actorRole: role,
    actionKey: isBatch ? "reconcile.match.batch" : "reconcile.match.create",
    requiredLevel: "FULL",
    endpointForLog: isBatch
      ? "POST /v1/businesses/{businessId}/accounts/{accountId}/matches/batch"
      : "POST /v1/businesses/{businessId}/accounts/{accountId}/matches",
  });

  if (!az.allowed) {
    return json(403, {
      ok: false,
      error: "Policy denied",
      code: "POLICY_DENIED",
      actionKey: isBatch ? "reconcile.match.batch" : "reconcile.match.create",
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

  async function createOneMatch(tx: any, args: {
    bankTransactionId: string;
    entryId: string;
    matchType: "FULL" | "PARTIAL";
    matchedAmountCents: any;
  }) {
    const bankTransactionId = (args.bankTransactionId ?? "").toString().trim();
    const entryId = (args.entryId ?? "").toString().trim();
    const matchType = (args.matchType ?? "").toString().trim().toUpperCase();
    const matchedAmountRaw = args.matchedAmountCents;

    if (!bankTransactionId) throw new Error("Missing bankTransactionId");
    if (!entryId) throw new Error("Missing entryId");
    if (matchType !== "FULL" && matchType !== "PARTIAL") throw new Error("Invalid matchType");

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
      throw new Error("Invalid matchedAmountCents");
    }

    if (matchedAmountCents === 0n) throw new Error("matchedAmountCents cannot be 0");

    const entry = await tx.entry.findFirst({
      where: { id: entryId, business_id: businessId, account_id: accountId, deleted_at: null },
      select: { id: true, amount_cents: true, is_adjustment: true },
    });
    if (!entry) throw new Error("Entry not found");
    if (entry.is_adjustment) throw new Error("Cannot match an adjustment entry");

    const existing = await tx.bankMatch.findFirst({
      where: { business_id: businessId, account_id: accountId, entry_id: entryId, voided_at: null },
      select: { id: true },
    });
    if (existing) throw new Error("Entry already matched (v1 constraint)");

    const bankTxn = await tx.bankTransaction.findFirst({
      where: { id: bankTransactionId, business_id: businessId, account_id: accountId, is_removed: false },
      select: { id: true, amount_cents: true },
    });
    if (!bankTxn) throw new Error("Bank transaction not found");

    const active = await tx.bankMatch.findMany({
      where: { business_id: businessId, account_id: accountId, bank_transaction_id: bankTransactionId, voided_at: null },
      select: { matched_amount_cents: true },
    });
    const matchedAbs = active.reduce((acc: bigint, m: any) => acc + absBig(BigInt(m.matched_amount_cents)), 0n);

    const bankAbs = absBig(BigInt(bankTxn.amount_cents));
    const bankRemainingAbs = bankAbs - matchedAbs;
    if (bankRemainingAbs <= 0n) throw new Error("Bank transaction has no remaining amount");

    const entryAbs = absBig(BigInt(entry.amount_cents));
    const matchAbs = absBig(matchedAmountCents);

    const bankSign = BigInt(bankTxn.amount_cents) < 0n ? -1 : 1;
    const entrySign = BigInt(entry.amount_cents) < 0n ? -1 : 1;
    const matchSign = matchedAmountCents < 0n ? -1 : 1;
    if (bankSign !== entrySign || bankSign !== matchSign) {
      throw new Error("Sign mismatch between bank txn, entry, and matched amount");
    }

    if (matchAbs > bankRemainingAbs) throw new Error("Matched amount exceeds bank remaining");
    if (matchAbs > entryAbs) throw new Error("Matched amount exceeds entry amount (v1)");

    if (matchType === "FULL" && matchAbs !== entryAbs) throw new Error("FULL match must equal full entry amount in v1");
    if (matchType === "PARTIAL" && matchAbs >= entryAbs) throw new Error("PARTIAL match must be less than full entry amount");

    const created = await tx.bankMatch.create({
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

    await logActivity(tx, {
      businessId: businessId,
      actorUserId: String(sub),
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
    } as any);

    return created;
  }

  // -------------------------
  // Batch endpoint (best-effort; NO single transaction)
  // -------------------------
  if (isBatch) {
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return json(400, { ok: false, error: "Missing items" });

    const results: any[] = [];
    let okN = 0;
    let failN = 0;

    for (const it of items) {
      const client_id = (it?.client_id ?? it?.clientId ?? "").toString().trim();
      if (!client_id) {
        failN += 1;
        results.push({ client_id: "", ok: false, error: "Missing client_id" });
        continue;
      }

      try {
        // Each item has its own small transaction (best-effort)
        const match = await prisma.$transaction(async (tx: any) => {
          return createOneMatch(tx, {
            bankTransactionId: it?.bankTransactionId,
            entryId: it?.entryId,
            matchType: it?.matchType,
            matchedAmountCents: it?.matchedAmountCents,
          });
        });

        okN += 1;
        results.push({ client_id, ok: true, match_id: match.id });
      } catch (e: any) {
        failN += 1;
        results.push({ client_id, ok: false, error: e?.message ?? "Apply failed" });
      }
    }

    return json(200, { ok: true, results, summary: { ok: okN, failed: failN, total: okN + failN } });
  }

  // -------------------------
  // Single create match
  // -------------------------
  const bankTransactionId = (body?.bankTransactionId ?? "").toString().trim();
  const entryId = (body?.entryId ?? "").toString().trim();
  const matchType = (body?.matchType ?? "").toString().trim().toUpperCase();
  const matchedAmountRaw = body?.matchedAmountCents;

  try {
    const created = await prisma.$transaction(async (tx: any) => {
      return createOneMatch(tx, {
        bankTransactionId,
        entryId,
        matchType: matchType as any,
        matchedAmountCents: matchedAmountRaw,
      });
    });

    return json(201, { ok: true, match: created });
  } catch (e: any) {
    return json(400, { ok: false, error: e?.message ?? "Match failed" });
  }
}
