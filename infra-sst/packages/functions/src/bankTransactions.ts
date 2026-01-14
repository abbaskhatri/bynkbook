import { getPrisma } from "./lib/db";

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

  // Phase 4D v1: VOID matches (audit) for a bank transaction
  const method = event?.requestContext?.http?.method;
  const bankTransactionId = (event?.pathParameters?.bankTransactionId ?? "").toString().trim();

  if (method === "POST" && bankTransactionId) {
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

    return json(200, { ok: true, voidedCount: updated.count });
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
