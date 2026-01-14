import { getPrisma } from "./lib/db";

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

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  if (method !== "GET") return json(405, { ok: false, error: "Method not allowed" });

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "", accountId = "" } = pp(event);
  const biz = businessId.toString().trim();
  const acct = accountId.toString().trim();
  if (!biz || !acct) return json(400, { ok: false, error: "Missing businessId/accountId" });

  const qs = event?.queryStringParameters ?? {};
  const status = (qs.status || "OPEN").toString().toUpperCase();
  const allowed = new Set(["OPEN", "RESOLVED", "ALL"]);
  if (!allowed.has(status)) return json(400, { ok: false, error: "Invalid status" });

  const prisma = await getPrisma();

  const role = await requireRole(prisma, sub, biz);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, biz, acct);
  if (!okAcct) return json(404, { ok: false, error: "Account not found" });

  const where: any = { business_id: biz, account_id: acct };
  if (status !== "ALL") where.status = status;

  // Deleted entries must never appear as issues.
  // Filter out issues whose entry has been soft-deleted.
  const deleted = await prisma.entry.findMany({
    where: { business_id: biz, account_id: acct, deleted_at: { not: null } },
    select: { id: true },
  });
  const deletedIds = deleted.map((d: any) => d.id);
  if (deletedIds.length) where.entry_id = { notIn: deletedIds };

  let rows = await prisma.entryIssue.findMany({
    where,
    orderBy: [{ detected_at: "desc" }],
    select: {
      id: true,
      entry_id: true,
      issue_type: true,
      status: true,
      severity: true,
      group_key: true,
      details: true,
      detected_at: true,
      resolved_at: true,
      created_at: true,
      updated_at: true,
    },
  });

  // If a DUPLICATE group no longer has >= 2 active entries (e.g., one was soft-deleted),
  // do not show a duplicate issue for the remaining entry.
  const dupCounts = new Map<string, number>();
  for (const r of rows) {
    if (r.issue_type !== "DUPLICATE") continue;
    const k = String(r.group_key || "");
    dupCounts.set(k, (dupCounts.get(k) || 0) + 1);
  }
  rows = rows.filter((r) => {
    if (r.issue_type !== "DUPLICATE") return true;
    const k = String(r.group_key || "");
    return (dupCounts.get(k) || 0) >= 2;
  });

  return json(200, { ok: true, status, issues: rows });
}
