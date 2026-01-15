import { getPrisma } from "./lib/db";
import { randomUUID } from "node:crypto";

const ENTRY_TYPES = ["EXPENSE", "INCOME", "TRANSFER", "ADJUSTMENT"] as const;
const ENTRY_STATUS = ["EXPECTED", "CLEARED"] as const;

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function pp(event: any) {
  return event?.pathParameters ?? {};
}

function qs(event: any) {
  return event?.queryStringParameters ?? {};
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

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path;

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "", accountId = "", entryId = "" } = pp(event);
  const biz = businessId.toString().trim();
  const acct = accountId.toString().trim();
  const ent = entryId.toString().trim();

  if (!biz || !acct) return json(400, { ok: false, error: "Missing businessId/accountId" });

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, biz, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  const acctOk = await requireAccountInBusiness(prisma, biz, acct);
  if (!acctOk) return json(404, { ok: false, error: "Account not found in this business" });

  // GET /entries
  if (method === "GET" && path?.includes(`/v1/businesses/${biz}/accounts/${acct}/entries`)) {
    const q = qs(event);
    const includeDeleted = q.include_deleted === "true";
    const limitRaw = q.limit ?? "200";
    const limit = Math.max(1, Math.min(500, Number(limitRaw) || 200));

    const rows = await prisma.entry.findMany({
      where: {
        business_id: biz,
        account_id: acct,
        ...(includeDeleted ? {} : { deleted_at: null }),
      },
      orderBy: [{ date: "desc" }, { created_at: "desc" }],
      take: limit,
    });

    return json(200, {
      ok: true,
      entries: rows.map((e: any) => ({
        id: e.id,
        business_id: e.business_id,
        account_id: e.account_id,
        date: e.date.toISOString().slice(0, 10),
        payee: e.payee,
        memo: e.memo,
        amount_cents: e.amount_cents.toString(),
        type: e.type,
        method: e.method,
        status: e.status,
        deleted_at: e.deleted_at ? e.deleted_at.toISOString() : null,
        created_at: e.created_at.toISOString(),
        updated_at: e.updated_at.toISOString(),
      })),
    });
  }

  // POST /entries (create)
  if (method === "POST" && path?.endsWith("/entries")) {
    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const date = (body?.date ?? "").toString().trim(); // YYYY-MM-DD
    const payee = body?.payee ?? null;
    const memo = body?.memo ?? null;
    const type = (body?.type ?? "").toString().trim();
    const methodField = body?.method ?? null;
    const status = (body?.status ?? "EXPECTED").toString().trim();
    const amountRaw = body?.amount_cents;

    if (!date) return json(400, { ok: false, error: "date is required (YYYY-MM-DD)" });
    if (!ENTRY_TYPES.includes(type as any)) return json(400, { ok: false, error: "Invalid type" });
    if (!ENTRY_STATUS.includes(status as any)) return json(400, { ok: false, error: "Invalid status" });

    const amount = BigInt(Math.trunc(Number(amountRaw)));
    if (!Number.isFinite(Number(amountRaw))) return json(400, { ok: false, error: "amount_cents must be a number" });

    const entryUuid = randomUUID();
    const created = await prisma.entry.create({
      data: {
        id: entryUuid,
        business_id: biz,
        account_id: acct,
        date: new Date(date + "T00:00:00Z"),
        payee,
        memo,
        amount_cents: amount,
        type,
        method: methodField,
        status,
        deleted_at: null,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    return json(201, {
      ok: true,
      entry: {
        id: created.id,
        business_id: created.business_id,
        account_id: created.account_id,
        date,
        amount_cents: created.amount_cents.toString(),
        type: created.type,
        status: created.status,
      },
    });
  }

  // DELETE /entries/{entryId} (soft delete)
  if (method === "DELETE" && ent) {
    await prisma.entry.updateMany({
      where: {
        id: ent,
        business_id: biz,
        account_id: acct,
        deleted_at: null,
      },
      data: {
        deleted_at: new Date(),
        updated_at: new Date(),
      },
    });

    return json(200, { ok: true, deleted: true, entry_id: ent });
  }

  // POST /entries/{entryId}/restore
  if (method === "POST" && ent && path?.endsWith("/restore")) {
    await prisma.entry.updateMany({
      where: {
        id: ent,
        business_id: biz,
        account_id: acct,
      },
      data: {
        deleted_at: null,
        updated_at: new Date(),
      },
    });

    return json(200, { ok: true, restored: true, entry_id: ent });
  }

  // POST /entries/{entryId}/mark-adjustment (Phase 4D v1)
  if (method === "POST" && ent && path?.endsWith("/mark-adjustment")) {
    // Phase 6A: enforce write permission (deny-by-default)
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const reason = (body?.reason ?? "").toString().trim();
    if (!reason) return json(400, { ok: false, error: "reason is required" });

    const updated = await prisma.entry.updateMany({
      where: {
        id: ent,
        business_id: biz,
        account_id: acct,
        deleted_at: null,
      },
      data: {
        is_adjustment: true,
        adjusted_at: new Date(),
        adjusted_by_user_id: sub,
        adjustment_reason: reason,
        updated_at: new Date(),
      },
    });

    if (updated.count === 0) return json(404, { ok: false, error: "Entry not found" });

    return json(200, { ok: true, entry_id: ent, isAdjustment: true });
  }

  return json(404, { ok: false, error: "Not Found", method, path });
}

