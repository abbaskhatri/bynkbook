import { getPrisma } from "./lib/db";
import { assertNotClosedPeriod } from "./lib/closedPeriods";

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

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path;

  // This function is only for: DELETE .../entries/{entryId}/hard
  if (method !== "DELETE") {
    return json(404, { ok: false, error: "Not Found", method, path });
  }

  try {
    const claims = getClaims(event);
    const sub = (claims.sub as string | undefined) ?? "";
    if (!sub) return json(401, { ok: false, error: "Unauthorized" });

    const { businessId = "", accountId = "", entryId = "" } = pp(event);
    const biz = businessId.toString().trim();
    const acct = accountId.toString().trim();
    const ent = entryId.toString().trim();

    if (!biz || !acct || !ent) {
      return json(400, { ok: false, error: "Missing businessId/accountId/entryId" });
    }

    const prisma = await getPrisma();

    const role = await requireMembership(prisma, biz, sub);
    if (!role) return json(403, { ok: false, error: "Forbidden" });

    const acctOk = await requireAccountInBusiness(prisma, biz, acct);
    if (!acctOk) return json(404, { ok: false, error: "Account not found in this business" });

    // Safety: only allow hard delete after soft delete.
    const existing = await prisma.entry.findFirst({
      where: {
        id: ent,
        business_id: biz,
        account_id: acct,
        deleted_at: { not: null },
      },
      select: { date: true },
    });

    if (!existing) {
      return json(409, {
        ok: false,
        error: "Entry must be in Deleted before permanent delete (soft delete first).",
      });
    }

    // Stage 2A: closed period enforcement (409 CLOSED_PERIOD)
    const cp = await assertNotClosedPeriod({ prisma, businessId: biz, dateInput: existing.date });
    if (!cp.ok) return cp.response;

    const res = await prisma.entry.deleteMany({
      where: {
        id: ent,
        business_id: biz,
        account_id: acct,
        deleted_at: { not: null },
      },
    });

    if (!res?.count) {
      // Either not found or not soft-deleted yet
      return json(409, {
        ok: false,
        error: "Entry must be in Deleted before permanent delete (soft delete first).",
      });
    }

    return json(200, { ok: true, hard_deleted: true, entry_id: ent });
  } catch (err: any) {
    console.error("entryHardDelete error:", err);
    return json(500, { ok: false, error: "Internal Server Error" });
  }
}
