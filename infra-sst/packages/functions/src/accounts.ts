import { getPrisma } from "./lib/db";
import { parseDateOnlyToUtcDate, serializeDateOnly } from "./lib/dateOnly";
import { randomUUID } from "node:crypto";
import { removeBankConnectionWithItemLifecycle } from "./lib/plaidService";
import { authorizeWrite } from "./lib/authz";
import { isCashAccountType } from "./lib/accountCapabilities";

const ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "CREDIT_CARD", "CASH", "OTHER"] as const;

function normalizeCurrencyCode(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!normalized) return null;
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function normalizeLast4(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return /^\d{4}$/.test(normalized) ? normalized : null;
}

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

async function findAccountInBusiness(prisma: any, businessId: string, accountId: string, select: any = { id: true }) {
  return prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select,
  });
}

async function requireAccountPolicy(
  prisma: any,
  args: { businessId: string; accountId?: string; userId: string; role: string; endpoint: string },
) {
  const az = await authorizeWrite(prisma, {
    businessId: args.businessId,
    scopeAccountId: args.accountId || null,
    actorUserId: args.userId,
    actorRole: args.role,
    actionKey: "bank_connections.manage",
    requiredLevel: "FULL",
    endpointForLog: args.endpoint,
  });
  return az.allowed;
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
    const connections = await prisma.bankConnection.findMany({
      where: { business_id: businessId },
      select: {
        account_id: true,
        status: true,
        institution_name: true,
        plaid_mask: true,
        last_sync_at: true,
        has_new_transactions: true,
        error_code: true,
        error_message: true,
        updated_at: true,
      },
    });
    const connectionByAccountId = new Map(connections.map((conn: any) => [conn.account_id, conn]));

    return json(200, {
      ok: true,
      accounts: rows.map((a: any) => {
        const conn: any = connectionByAccountId.get(a.id) ?? null;
        const statusNorm = String(conn?.status ?? "").trim().toUpperCase();
        const connected =
          !!conn &&
          (statusNorm === "CONNECTED" || statusNorm === "PENDING_SYNC" || statusNorm === "SYNC_ERROR" || statusNorm === "ERROR");

        return {
          id: a.id,
          business_id: a.business_id,
          name: a.name,
          type: a.type,
          currency_code: a.currency_code ?? null,
          institution_name: isCashAccountType(a.type) ? null : a.institution_name ?? null,
          last4: isCashAccountType(a.type) ? null : a.last4 ?? null,
          opening_balance_cents: a.opening_balance_cents?.toString?.() ?? String(a.opening_balance_cents),
          opening_balance_date: serializeDateOnly(a.opening_balance_date),
          archived_at: a.archived_at ? a.archived_at.toISOString() : null,
          created_at: a.created_at?.toISOString?.() ?? a.created_at,
          updated_at: a.updated_at?.toISOString?.() ?? a.updated_at,
          plaid_connection: conn
            ? {
              connected,
              status: conn.status ?? null,
              institution_name: conn.institution_name ?? null,
              last4: conn.plaid_mask ?? null,
              last_sync_at: conn.last_sync_at ? conn.last_sync_at.toISOString() : null,
              has_new_transactions: !!conn.has_new_transactions,
              error_code: conn.error_code ?? null,
              error_message: conn.error_message ?? null,
              updated_at: conn.updated_at ? conn.updated_at.toISOString() : null,
            }
            : null,
        };
      }),
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
    if (!await requireAccountPolicy(prisma, { businessId, accountId, userId: sub, role, endpoint: "PATCH /accounts/{accountId}" })) {
      return json(403, { ok: false, error: "Policy denied", code: "POLICY_DENIED" });
    }

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const existing = await findAccountInBusiness(prisma, businessId, accountId, { id: true, type: true });
    if (!existing) return json(404, { ok: false, error: "Account not found" });

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

    if ("currency_code" in body) {
      const currencyCode = normalizeCurrencyCode(body.currency_code);
      if (body.currency_code && !currencyCode) {
        return json(400, { ok: false, error: "currency_code must be a three-letter ISO code" });
      }
      patch.currency_code = currencyCode;
    }

    if ("institution_name" in body) {
      patch.institution_name = String(body.institution_name ?? "").trim() || null;
    }

    if ("last4" in body) {
      const last4 = normalizeLast4(body.last4);
      if (body.last4 && !last4) return json(400, { ok: false, error: "last4 must contain exactly four digits" });
      patch.last4 = last4;
    }

    const resultingType = String(patch.type ?? existing.type ?? "").toUpperCase();
    if (isCashAccountType(resultingType)) {
      if (!isCashAccountType(existing.type)) {
        const connectionCount = await prisma.bankConnection.count({
          where: { business_id: businessId, account_id: accountId },
        });
        if (connectionCount > 0) {
          return json(409, {
            ok: false,
            code: "CASH_ACCOUNT_CONNECTED_BANK",
            error: "Disconnect the bank connection before changing this account to Cash.",
          });
        }
      }
      patch.institution_name = null;
      patch.last4 = null;
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
        const d = parseDateOnlyToUtcDate(body.opening_balance_date);
        if (!d) return json(400, { ok: false, error: "opening_balance_date must be a valid YYYY-MM-DD date" });
        patch.opening_balance_date = d;
      }
    }

    if (Object.keys(patch).length === 0) return json(400, { ok: false, error: "No fields to update" });

    const updateResult = await prisma.account.updateMany({
      where: { id: accountId, business_id: businessId },
      data: patch,
    });

    if ((updateResult?.count ?? 0) === 0) {
      return json(404, { ok: false, error: "Account not found" });
    }

    const updated = await findAccountInBusiness(prisma, businessId, accountId, {
      id: true,
      business_id: true,
      name: true,
      type: true,
      currency_code: true,
      institution_name: true,
      last4: true,
      opening_balance_cents: true,
      opening_balance_date: true,
      archived_at: true,
      created_at: true,
      updated_at: true,
    });

    if (!updated) return json(404, { ok: false, error: "Account not found" });

    return json(200, {
      ok: true,
      account: {
        id: updated.id,
        business_id: updated.business_id,
        name: updated.name,
        type: updated.type,
        currency_code: updated.currency_code ?? null,
        institution_name: updated.institution_name ?? null,
        last4: updated.last4 ?? null,
        opening_balance_cents: updated.opening_balance_cents?.toString?.() ?? String(updated.opening_balance_cents),
        opening_balance_date: serializeDateOnly(updated.opening_balance_date),
        archived_at: updated.archived_at ? updated.archived_at.toISOString() : null,
        created_at: updated.created_at?.toISOString?.() ?? updated.created_at,
        updated_at: updated.updated_at?.toISOString?.() ?? updated.updated_at,
      },
    });
  }

  // POST /v1/businesses/{businessId}/accounts/{accountId}/archive
  // Rule: archiving auto-disconnects Plaid (removes bank_connection mapping).
  if (method === "POST" && (event?.requestContext?.http?.path ?? "").toString().endsWith("/archive")) {
    if (!accountId) return json(400, { ok: false, error: "Missing accountId" });
    if (!canManageAccounts(role)) return json(403, { ok: false, error: "Forbidden (requires OWNER/ADMIN)" });
    if (!await requireAccountPolicy(prisma, { businessId, accountId, userId: sub, role, endpoint: "POST /accounts/{accountId}/archive" })) {
      return json(403, { ok: false, error: "Policy denied", code: "POLICY_DENIED" });
    }

    const existing = await findAccountInBusiness(prisma, businessId, accountId);
    if (!existing) return json(404, { ok: false, error: "Account not found" });

    try {
      await removeBankConnectionWithItemLifecycle(prisma, businessId, accountId);
    } catch (error: any) {
      return json(502, {
        ok: false,
        error: "Plaid could not confirm the disconnect; the account was not archived",
        detail: String(error?.response?.data?.error_message ?? error?.message ?? "Plaid disconnect failed"),
      });
    }

    const now = new Date();
    const updateResult = await prisma.account.updateMany({
      where: { id: accountId, business_id: businessId },
      data: { archived_at: now },
    });

    if ((updateResult?.count ?? 0) === 0) {
      return json(404, { ok: false, error: "Account not found" });
    }

    return json(200, { ok: true, account: { id: accountId, archived_at: now.toISOString() } });
  }

  // POST /v1/businesses/{businessId}/accounts/{accountId}/unarchive
  if (method === "POST" && (event?.requestContext?.http?.path ?? "").toString().endsWith("/unarchive")) {
    if (!accountId) return json(400, { ok: false, error: "Missing accountId" });
    if (!canManageAccounts(role)) return json(403, { ok: false, error: "Forbidden (requires OWNER/ADMIN)" });
    if (!await requireAccountPolicy(prisma, { businessId, accountId, userId: sub, role, endpoint: "POST /accounts/{accountId}/unarchive" })) {
      return json(403, { ok: false, error: "Policy denied", code: "POLICY_DENIED" });
    }

    const existing = await findAccountInBusiness(prisma, businessId, accountId);
    if (!existing) return json(404, { ok: false, error: "Account not found" });

    const updateResult = await prisma.account.updateMany({
      where: { id: accountId, business_id: businessId },
      data: { archived_at: null },
    });

    if ((updateResult?.count ?? 0) === 0) {
      return json(404, { ok: false, error: "Account not found" });
    }

    return json(200, {
      ok: true,
      account: {
        id: accountId,
        archived_at: null,
      },
    });
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
    if (!await requireAccountPolicy(prisma, { businessId, accountId, userId: sub, role, endpoint: "DELETE /accounts/{accountId}" })) {
      return json(403, { ok: false, error: "Policy denied", code: "POLICY_DENIED" });
    }

    const existing = await findAccountInBusiness(prisma, businessId, accountId);
    if (!existing) return json(404, { ok: false, error: "Account not found" });

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

    const deleteResult = await prisma.account.deleteMany({ where: { id: accountId, business_id: businessId } });
    if ((deleteResult?.count ?? 0) === 0) {
      return json(404, { ok: false, error: "Account not found" });
    }

    return json(200, { ok: true, deleted: true });
  }

  // POST /v1/businesses/{businessId}/accounts
  if (method === "POST") {
    if (!canManageAccounts(role)) return json(403, { ok: false, error: "Forbidden (requires OWNER/ADMIN)" });
    if (!await requireAccountPolicy(prisma, { businessId, userId: sub, role, endpoint: "POST /accounts" })) {
      return json(403, { ok: false, error: "Policy denied", code: "POLICY_DENIED" });
    }

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const name = (body?.name ?? "").toString().trim();
    const type = (body?.type ?? "").toString().trim().toUpperCase();
    const currency_code = normalizeCurrencyCode(body?.currency_code);
    const institution_name = isCashAccountType(type) ? null : String(body?.institution_name ?? "").trim() || null;
    const last4 = isCashAccountType(type) ? null : normalizeLast4(body?.last4);
    const opening_balance_cents_raw = body?.opening_balance_cents ?? 0;
    const opening_balance_date_raw = (body?.opening_balance_date ?? "").toString().trim();

    if (name.length < 2) return json(400, { ok: false, error: "Account name is required (min 2 chars)" });
    if (!ACCOUNT_TYPES.includes(type as any)) return json(400, { ok: false, error: "Invalid account type" });
    if (body?.currency_code && !currency_code) {
      return json(400, { ok: false, error: "currency_code must be a three-letter ISO code" });
    }
    if (!isCashAccountType(type) && body?.last4 && !last4) {
      return json(400, { ok: false, error: "last4 must contain exactly four digits" });
    }
    if (!opening_balance_date_raw) return json(400, { ok: false, error: "opening_balance_date is required (YYYY-MM-DD)" });

    const openingBalanceNumber = Number(opening_balance_cents_raw);
    if (!Number.isFinite(openingBalanceNumber)) {
      return json(400, { ok: false, error: "opening_balance_cents must be a number" });
    }

    const openingDate = parseDateOnlyToUtcDate(opening_balance_date_raw);
    if (!openingDate) {
      return json(400, { ok: false, error: "opening_balance_date must be a valid YYYY-MM-DD date" });
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
        currency_code: currency_code,
        institution_name: institution_name,
        last4: last4,
      },
    });

    return json(201, {
      ok: true,
      account: {
        id: created.id,
        business_id: created.business_id,
        name: created.name,
        type: created.type,
        currency_code: created.currency_code ?? null,
        institution_name: created.institution_name ?? null,
        last4: created.last4 ?? null,
        opening_balance_cents: created.opening_balance_cents.toString(),
        opening_balance_date: serializeDateOnly(created.opening_balance_date),
      },
    });
  }

  return json(404, { ok: false, error: "Not Found", method });
}
