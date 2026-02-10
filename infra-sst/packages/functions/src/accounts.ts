import { getPrisma } from "./lib/db";
import { randomUUID } from "node:crypto";

const ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "CREDIT_CARD", "CASH", "OTHER"] as const;

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

function getBusinessId(event: any) {
  return (event?.pathParameters?.businessId ?? "").toString().trim();
}

function getAccountId(event: any) {
  return (event?.pathParameters?.accountId ?? "").toString().trim();
}

function canManageAccounts(role: string) {
  const r = String(role ?? "").toUpperCase();
  return r === "OWNER" || r === "ADMIN";
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

export async function handler(event: any) {
  const method = (event?.requestContext?.http?.method ?? "").toString().toUpperCase();

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = getBusinessId(event);
  if (!businessId) return json(400, { ok: false, error: "Missing businessId" });

  const accountId = getAccountId(event);

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  // GET /v1/businesses/{businessId}/accounts
  if (method === "GET") {
    const rows = await prisma.account.findMany({
      where: { business_id: businessId },
      orderBy: { created_at: "desc" },
    });

    return json(200, {
      ok: true,
      accounts: rows.map((a: any) => ({
        id: a.id,
        business_id: a.business_id,
        name: a.name,
        type: a.type,
        opening_balance_cents: a.opening_balance_cents?.toString?.() ?? String(a.opening_balance_cents),
        opening_balance_date: a.opening_balance_date?.toISOString?.() ?? a.opening_balance_date,
        archived_at: a.archived_at ? a.archived_at.toISOString() : null,
        created_at: a.created_at?.toISOString?.() ?? a.created_at,
        updated_at: a.updated_at?.toISOString?.() ?? a.updated_at,
      })),
    });
  }

  // PATCH /v1/businesses/{businessId}/accounts/{accountId}
  // - name/type always editable by write roles
  // - opening fields editable ONLY if no related rows exist (same guardrail as delete eligibility)
  if (method === "PATCH") {
    if (!accountId) return json(400, { ok: false, error: "Missing accountId" });

    const r = String(role ?? "").toUpperCase();
    const canWrite = r === "OWNER" || r === "ADMIN" || r === "BOOKKEEPER" || r === "ACCOUNTANT";
    if (!canWrite) return json(403, { ok: false, error: "Forbidden (requires write role)" });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const patch: any = {};

    if ("name" in body) {
      const name = (body?.name ?? "").toString().trim();
      if (name.length < 2) return json(400, { ok: false, error: "Account name is required (min 2 chars)" });
      patch.name = name;
    }

    if ("type" in body) {
      const type = (body?.type ?? "").toString().trim().toUpperCase();
      if (!ACCOUNT_TYPES.includes(type as any)) return json(400, { ok: false, error: "Invalid account type" });
      patch.type = type;
    }

    const wantsOpening = "opening_balance_cents" in body || "opening_balance_date" in body;
    if (wantsOpening) {
      const counts = await prisma.$transaction([
        prisma.entry.count({ where: { business_id: businessId, account_id: accountId } }),
        prisma.bankTransaction.count({ where: { business_id: businessId, account_id: accountId } }),
        prisma.bankMatch.count({ where: { business_id: businessId, account_id: accountId } }),
        prisma.bankConnection.count({ where: { business_id: businessId, account_id: accountId } }),
        prisma.upload.count({ where: { business_id: businessId, account_id: accountId } }),
        prisma.reconcileSnapshot.count({ where: { business_id: businessId, account_id: accountId } }),
        prisma.transfer.count({
          where: { business_id: businessId, OR: [{ from_account_id: accountId }, { to_account_id: accountId }] },
        }),
      ]);

      const total =
        (counts[0] ?? 0) +
        (counts[1] ?? 0) +
        (counts[2] ?? 0) +
        (counts[3] ?? 0) +
        (counts[4] ?? 0) +
        (counts[5] ?? 0) +
        (counts[6] ?? 0);

      if (total > 0) {
        return json(409, { ok: false, error: "Opening fields can only be edited before any related data exists.", related_total: total });
      }

      if ("opening_balance_cents" in body) {
        const n = Number(body.opening_balance_cents);
        if (!Number.isFinite(n)) return json(400, { ok: false, error: "opening_balance_cents must be a number" });
        patch.opening_balance_cents = BigInt(Math.trunc(n));
      }

      if ("opening_balance_date" in body) {
        const d = new Date(String(body.opening_balance_date));
        if (Number.isNaN(d.getTime())) return json(400, { ok: false, error: "opening_balance_date must be a valid ISO date/time" });
        patch.opening_balance_date = d;
      }
    }

    if (Object.keys(patch).length === 0) return json(400, { ok: false, error: "No fields to update" });

    const updated = await prisma.account.update({
      where: { id: accountId },
      data: patch,
      select: {
        id: true,
        business_id: true,
        name: true,
        type: true,
        opening_balance_cents: true,
        opening_balance_date: true,
        archived_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    return json(200, {
      ok: true,
      account: {
        id: updated.id,
        business_id: updated.business_id,
        name: updated.name,
        type: updated.type,
        opening_balance_cents: updated.opening_balance_cents?.toString?.() ?? String(updated.opening_balance_cents),
        opening_balance_date: updated.opening_balance_date?.toISOString?.() ?? updated.opening_balance_date,
        archived_at: updated.archived_at ? updated.archived_at.toISOString() : null,
        created_at: updated.created_at?.toISOString?.() ?? updated.created_at,
        updated_at: updated.updated_at?.toISOString?.() ?? updated.updated_at,
      },
    });
  }

  // POST /v1/businesses/{businessId}/accounts/{accountId}/archive
  if (method === "POST" && (event?.requestContext?.http?.path ?? "").toString().endsWith("/archive")) {
    if (!accountId) return json(400, { ok: false, error: "Missing accountId" });
    if (!canManageAccounts(role)) return json(403, { ok: false, error: "Forbidden (requires OWNER/ADMIN)" });

    const updated = await prisma.account.update({
      where: { id: accountId },
      data: { archived_at: new Date() },
    });

    return json(200, { ok: true, account: { id: updated.id, archived_at: updated.archived_at?.toISOString() ?? null } });
  }

  // POST /v1/businesses/{businessId}/accounts/{accountId}/unarchive
  if (method === "POST" && (event?.requestContext?.http?.path ?? "").toString().endsWith("/unarchive")) {
    if (!accountId) return json(400, { ok: false, error: "Missing accountId" });
    if (!canManageAccounts(role)) return json(403, { ok: false, error: "Forbidden (requires OWNER/ADMIN)" });

    const updated = await prisma.account.update({
      where: { id: accountId },
      data: { archived_at: null },
    });

    return json(200, { ok: true, account: { id: updated.id, archived_at: null } });
  }

  // GET /v1/businesses/{businessId}/accounts/{accountId}/delete-eligibility
  if (method === "GET" && (event?.requestContext?.http?.path ?? "").toString().endsWith("/delete-eligibility")) {
    if (!accountId) return json(400, { ok: false, error: "Missing accountId" });

    // delete eligibility is viewable by any member (so UI can hide delete)
    const counts = await prisma.$transaction([
      prisma.entry.count({ where: { business_id: businessId, account_id: accountId } }),
      prisma.bankTransaction.count({ where: { business_id: businessId, account_id: accountId } }),
      prisma.bankMatch.count({ where: { business_id: businessId, account_id: accountId } }),
      prisma.bankConnection.count({ where: { business_id: businessId, account_id: accountId } }),
      prisma.upload.count({ where: { business_id: businessId, account_id: accountId } }),
      prisma.reconcileSnapshot.count({ where: { business_id: businessId, account_id: accountId } }),
      prisma.transfer.count({
        where: { business_id: businessId, OR: [{ from_account_id: accountId }, { to_account_id: accountId }] },
      }),
    ]);

    const total =
      (counts[0] ?? 0) +
      (counts[1] ?? 0) +
      (counts[2] ?? 0) +
      (counts[3] ?? 0) +
      (counts[4] ?? 0) +
      (counts[5] ?? 0) +
      (counts[6] ?? 0);

    return json(200, { ok: true, eligible: total === 0, related_total: total });
  }

  // DELETE /v1/businesses/{businessId}/accounts/{accountId} (guarded)
  if (method === "DELETE") {
    if (!accountId) return json(400, { ok: false, error: "Missing accountId" });
    if (!canManageAccounts(role)) return json(403, { ok: false, error: "Forbidden (requires OWNER/ADMIN)" });

    const eligRes = await (async () => {
      const counts = await prisma.$transaction([
        prisma.entry.count({ where: { business_id: businessId, account_id: accountId } }),
        prisma.bankTransaction.count({ where: { business_id: businessId, account_id: accountId } }),
        prisma.bankMatch.count({ where: { business_id: businessId, account_id: accountId } }),
        prisma.bankConnection.count({ where: { business_id: businessId, account_id: accountId } }),
        prisma.upload.count({ where: { business_id: businessId, account_id: accountId } }),
        prisma.reconcileSnapshot.count({ where: { business_id: businessId, account_id: accountId } }),
        prisma.transfer.count({
          where: { business_id: businessId, OR: [{ from_account_id: accountId }, { to_account_id: accountId }] },
        }),
      ]);
      const total =
        (counts[0] ?? 0) +
        (counts[1] ?? 0) +
        (counts[2] ?? 0) +
        (counts[3] ?? 0) +
        (counts[4] ?? 0) +
        (counts[5] ?? 0) +
        (counts[6] ?? 0);
      return { eligible: total === 0, total };
    })();

    if (!eligRes.eligible) {
      return json(409, { ok: false, error: "Account has related rows; archive instead", related_total: eligRes.total });
    }

    await prisma.account.delete({ where: { id: accountId } });
    return json(200, { ok: true, deleted: true });
  }

  // POST /v1/businesses/{businessId}/accounts
  if (method === "POST") {
    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const name = (body?.name ?? "").toString().trim();
    const type = (body?.type ?? "").toString().trim();
    const opening_balance_cents_raw = body?.opening_balance_cents ?? 0;
    const opening_balance_date_raw = (body?.opening_balance_date ?? "").toString().trim();

    if (name.length < 2) return json(400, { ok: false, error: "Account name is required (min 2 chars)" });
    if (!ACCOUNT_TYPES.includes(type as any)) return json(400, { ok: false, error: "Invalid account type" });
    if (!opening_balance_date_raw) return json(400, { ok: false, error: "opening_balance_date is required (ISO string)" });

    const openingBalanceNumber = Number(opening_balance_cents_raw);
    if (!Number.isFinite(openingBalanceNumber)) {
      return json(400, { ok: false, error: "opening_balance_cents must be a number" });
    }

    const openingDate = new Date(opening_balance_date_raw);
    if (Number.isNaN(openingDate.getTime())) {
      return json(400, { ok: false, error: "opening_balance_date must be a valid ISO date/time" });
    }

    const accountId = randomUUID();

    const created = await prisma.account.create({
      data: {
        id: accountId,
        business_id: businessId,
        name,
        type,
        opening_balance_cents: BigInt(Math.trunc(openingBalanceNumber)),
        opening_balance_date: openingDate,
      },
    });

    return json(201, {
      ok: true,
      account: {
        id: created.id,
        business_id: created.business_id,
        name: created.name,
        type: created.type,
        opening_balance_cents: created.opening_balance_cents.toString(),
        opening_balance_date: created.opening_balance_date.toISOString(),
      },
    });
  }

  return json(404, { ok: false, error: "Not Found", method });
}
