import { randomUUID } from "crypto";
import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import { authorizeWrite } from "./lib/authz";
import { assertNotClosedPeriod } from "./lib/closedPeriods";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function pp(event: any) {
  const p = event?.pathParameters ?? {};
  return {
    businessId: p.businessId,
    accountId: p.accountId,
    transferId: p.transferId,
  };
}

function getClaims(event: any) {
  const claims =
    event?.requestContext?.authorizer?.jwt?.claims ??
    event?.requestContext?.authorizer?.claims ??
    {};
  return claims as any;
}

async function requireRole(prisma: any, userId: string, businessId: string) {
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

function canWrite(role: string | null) {
  return role === "OWNER" || role === "ADMIN" || role === "BOOKKEEPER" || role === "ACCOUNTANT";
}

function parseYmd(dateStr: any) {
  const s = String(dateStr ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  // Keep consistent with existing Entry @db.Date usage in the codebase
  return new Date(s + "T00:00:00.000Z");
}

function parseBigIntAbs(val: any) {
  if (val === undefined || val === null) return null;
  try {
    const n = BigInt(val);
    return n < 0n ? -n : n;
  } catch {
    return null;
  }
}

async function loadTransferLegs(prisma: any, businessId: string, transferId: string) {
  const transfer = await prisma.transfer.findFirst({
    where: { id: transferId, business_id: businessId },
    select: { id: true, business_id: true, from_account_id: true, to_account_id: true },
  });
  if (!transfer) return { ok: false as const, error: "Transfer not found" };

  const legs = await prisma.entry.findMany({
    where: { business_id: businessId, transfer_id: transferId },
    select: { id: true, account_id: true, amount_cents: true, date: true, deleted_at: true },
  });

  return { ok: true as const, transfer, legs };
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path;

  // Force CloudWatch log group creation + give us traceability
  console.log("transfers invoked", {
    method,
    path,
    requestId: event?.requestContext?.requestId,
    businessId: event?.pathParameters?.businessId,
    accountId: event?.pathParameters?.accountId,
  });

  try {
    const claims = getClaims(event);
    const sub = (claims.sub as string | undefined) ?? "";
    if (!sub) return json(401, { ok: false, error: "Unauthorized" });

    const { businessId = "", accountId = "", transferId = "" } = pp(event);
    const biz = businessId.toString().trim();
    const acct = accountId.toString().trim();
    const tid = transferId?.toString?.().trim?.() ?? "";

    if (!biz || !acct) return json(400, { ok: false, error: "Missing businessId/accountId" });

    const prisma = await getPrisma();

    const role = await requireRole(prisma, sub, biz);
    if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    const acctOk = await requireAccountInBusiness(prisma, biz, acct);
    if (!acctOk) return json(404, { ok: false, error: "Account not found in this business" });

    // POST /.../transfers
    if (method === "POST" && path?.endsWith("/transfers")) {
      let body: any = {};
      try {
        body = event?.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }

      const toAccountId = String(body?.to_account_id ?? "").trim();
      if (!toAccountId) return json(400, { ok: false, error: "to_account_id is required" });
      if (toAccountId === acct) return json(400, { ok: false, error: "to_account_id must be different from from account" });

      const toOk = await requireAccountInBusiness(prisma, biz, toAccountId);
      if (!toOk) return json(400, { ok: false, error: "Invalid to_account_id" });

      const date = parseYmd(body?.date);
      if (!date) return json(400, { ok: false, error: "date must be YYYY-MM-DD" });

      // Closed period is business-wide: block any transfer in a closed month (409 CLOSED_PERIOD)
      const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: date });
      if (!cp.ok) return cp.response;

      const amtAbs = parseBigIntAbs(body?.amount_cents);
      if (amtAbs === null) return json(400, { ok: false, error: "amount_cents must be an integer" });
      if (amtAbs === 0n) return json(400, { ok: false, error: "amount_cents must be non-zero" });

      const payee = body?.payee ?? null;
      const memo = body?.memo ?? null;
      const methodField = body?.method ?? null;
      const status = String(body?.status ?? "EXPECTED").trim();

      const az = await authorizeWrite(prisma, {
        businessId: biz,
        scopeAccountId: acct,
        actorUserId: sub,
        actorRole: role,
        actionKey: "ledger.transfer.write",
        requiredLevel: "FULL",
        endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/transfers",
      });
      if (!az.allowed) {
        return json(403, {
          ok: false,
          error: "Policy denied",
          code: "POLICY_DENIED",
          actionKey: "ledger.transfer.write",
          requiredLevel: az.requiredLevel,
          policyValue: az.policyValue,
          policyKey: az.policyKey,
        });
      }

      const created = await prisma.$transaction(async (tx: any) => {
        const transfer = await tx.transfer.create({
          data: {
            business_id: biz,
            from_account_id: acct,
            to_account_id: toAccountId,
            created_at: new Date(),
            updated_at: new Date(),
          },
          select: { id: true },
        });

        const fromLeg = await tx.entry.create({
          data: {
            id: randomUUID(),
            business_id: biz,
            account_id: acct,
            date,
            payee,
            memo,
            amount_cents: -amtAbs,
            type: "TRANSFER",
            method: methodField,
            status,
            transfer_id: transfer.id,
            deleted_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
          select: { id: true },
        });

        const toLeg = await tx.entry.create({
          data: {
            id: randomUUID(),
            business_id: biz,
            account_id: toAccountId,
            date,
            payee,
            memo,
            amount_cents: amtAbs,
            type: "TRANSFER",
            method: methodField,
            status,
            transfer_id: transfer.id,
            deleted_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
          select: { id: true },
        });

        return { transfer_id: transfer.id, from_entry_id: fromLeg.id, to_entry_id: toLeg.id };
      });

      await logActivity(prisma, {
        businessId: biz,
        scopeAccountId: acct,
        actorUserId: sub,
        eventType: "LEDGER_TRANSFER_CREATE",
        payloadJson: { account_id: acct, transfer_id: created.transfer_id },
      });

      return json(200, { ok: true, ...created });
    }

    // PUT/PATCH /.../transfers/{transferId}
    if ((method === "PUT" || method === "PATCH") && tid && path?.includes(`/transfers/${tid}`)) {
      let body: any = {};
      try {
        body = event?.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }

      const loaded = await loadTransferLegs(prisma, biz, tid);
      if (!loaded.ok) return json(404, { ok: false, error: loaded.error });

      const { transfer, legs } = loaded;

      const isInvolved = transfer.from_account_id === acct || transfer.to_account_id === acct;
      if (!isInvolved) return json(403, { ok: false, error: "Forbidden (account not part of this transfer)" });

      const fromLeg = legs.find((l: any) => l.account_id === transfer.from_account_id);
      const toLeg = legs.find((l: any) => l.account_id === transfer.to_account_id);
      if (!fromLeg || !toLeg) return json(409, { ok: false, error: "Transfer legs missing" });

      const nextDate = body?.date !== undefined ? parseYmd(body.date) : fromLeg.date;
      if (!nextDate) return json(400, { ok: false, error: "date must be YYYY-MM-DD" });

      const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: nextDate });
      if (!cp.ok) return cp.response;

      const nextToAccountId = body?.to_account_id !== undefined ? String(body.to_account_id ?? "").trim() : transfer.to_account_id;
      if (!nextToAccountId) return json(400, { ok: false, error: "to_account_id is required" });
      if (nextToAccountId === transfer.from_account_id) return json(400, { ok: false, error: "to_account_id must be different from from account" });

      const toOk = await requireAccountInBusiness(prisma, biz, nextToAccountId);
      if (!toOk) return json(400, { ok: false, error: "Invalid to_account_id" });

      const amtAbs =
        body?.amount_cents !== undefined
          ? parseBigIntAbs(body.amount_cents)
          : (fromLeg.amount_cents < 0n ? -fromLeg.amount_cents : fromLeg.amount_cents);

      if (amtAbs === null) return json(400, { ok: false, error: "amount_cents must be an integer" });
      if (amtAbs === 0n) return json(400, { ok: false, error: "amount_cents must be non-zero" });

      const payee = body?.payee !== undefined ? (body.payee ?? null) : undefined;
      const memo = body?.memo !== undefined ? (body.memo ?? null) : undefined;
      const methodField = body?.method !== undefined ? (body.method ?? null) : undefined;
      const status = body?.status !== undefined ? String(body.status ?? "EXPECTED").trim() : undefined;

      await prisma.$transaction(async (tx: any) => {
        if (nextToAccountId !== transfer.to_account_id) {
          await tx.transfer.updateMany({
            where: { id: tid, business_id: biz },
            data: { to_account_id: nextToAccountId, updated_at: new Date() },
          });
        } else {
          await tx.transfer.updateMany({
            where: { id: tid, business_id: biz },
            data: { updated_at: new Date() },
          });
        }

        await tx.entry.updateMany({
          where: { id: fromLeg.id, business_id: biz, transfer_id: tid },
          data: {
            date: nextDate,
            amount_cents: -amtAbs,
            ...(payee !== undefined ? { payee } : {}),
            ...(memo !== undefined ? { memo } : {}),
            ...(methodField !== undefined ? { method: methodField } : {}),
            ...(status !== undefined ? { status } : {}),
            updated_at: new Date(),
          },
        });

        await tx.entry.updateMany({
          where: { id: toLeg.id, business_id: biz, transfer_id: tid },
          data: {
            account_id: nextToAccountId,
            date: nextDate,
            amount_cents: amtAbs,
            ...(payee !== undefined ? { payee } : {}),
            ...(memo !== undefined ? { memo } : {}),
            ...(methodField !== undefined ? { method: methodField } : {}),
            ...(status !== undefined ? { status } : {}),
            updated_at: new Date(),
          },
        });
      });

      await logActivity(prisma, {
        businessId: biz,
        scopeAccountId: acct,
        actorUserId: sub,
        eventType: "LEDGER_TRANSFER_UPDATE",
        payloadJson: { account_id: acct, transfer_id: tid },
      });

      return json(200, { ok: true, transfer_id: tid, updated: true });
    }

    // DELETE /.../transfers/{transferId} (soft delete both legs)
    if (method === "DELETE" && tid && path?.includes(`/transfers/${tid}`)) {
      const loaded = await loadTransferLegs(prisma, biz, tid);
      if (!loaded.ok) return json(404, { ok: false, error: loaded.error });
      const { transfer, legs } = loaded;

      const isInvolved = transfer.from_account_id === acct || transfer.to_account_id === acct;
      if (!isInvolved) return json(403, { ok: false, error: "Forbidden (account not part of this transfer)" });

      const dateForCheck = legs?.[0]?.date;
      const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: dateForCheck });
      if (!cp.ok) return cp.response;

      await prisma.$transaction(async (tx: any) => {
        await tx.entry.updateMany({
          where: { business_id: biz, transfer_id: tid, deleted_at: null },
          data: { deleted_at: new Date(), updated_at: new Date() },
        });
      });

      await logActivity(prisma, {
        businessId: biz,
        scopeAccountId: acct,
        actorUserId: sub,
        eventType: "LEDGER_TRANSFER_DELETE",
        payloadJson: { account_id: acct, transfer_id: tid },
      });

      return json(200, { ok: true, transfer_id: tid, deleted: true });
    }

    // POST /.../transfers/{transferId}/restore
    if (method === "POST" && tid && path?.endsWith(`/transfers/${tid}/restore`)) {
      const loaded = await loadTransferLegs(prisma, biz, tid);
      if (!loaded.ok) return json(404, { ok: false, error: loaded.error });
      const { transfer, legs } = loaded;

      const isInvolved = transfer.from_account_id === acct || transfer.to_account_id === acct;
      if (!isInvolved) return json(403, { ok: false, error: "Forbidden (account not part of this transfer)" });

      const dateForCheck = legs?.[0]?.date;
      const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: dateForCheck });
      if (!cp.ok) return cp.response;

      await prisma.$transaction(async (tx: any) => {
        await tx.entry.updateMany({
          where: { business_id: biz, transfer_id: tid, deleted_at: { not: null } },
          data: { deleted_at: null, updated_at: new Date() },
        });
      });

      await logActivity(prisma, {
        businessId: biz,
        scopeAccountId: acct,
        actorUserId: sub,
        eventType: "LEDGER_TRANSFER_RESTORE",
        payloadJson: { account_id: acct, transfer_id: tid },
      });

      return json(200, { ok: true, transfer_id: tid, restored: true });
    }

    return json(404, { ok: false, error: "Not Found", method, path });
  } catch (err: any) {
    // Log full error so CloudWatch captures it
    console.error("transfers error:", err?.message ?? err, err?.stack ?? "");

    // Return safe detail to debug in dev (no secrets)
    return json(500, {
      ok: false,
      error: "Internal Server Error",
      detail: String(err?.message ?? err),
    });
  }
}
