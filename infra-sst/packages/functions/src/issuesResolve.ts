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
    issueId: p.issueId,
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

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path;

  if (method !== "POST") {
    return json(404, { ok: false, error: "Not Found", method, path });
  }

  try {
    const claims = getClaims(event);
    const sub = (claims.sub as string | undefined) ?? "";
    if (!sub) return json(401, { ok: false, error: "Unauthorized" });

    const { businessId = "", accountId = "", issueId = "" } = pp(event);
    const biz = businessId.toString().trim();
    const acct = accountId.toString().trim();
    const issue = issueId.toString().trim();

    if (!biz || !acct || !issue) return json(400, { ok: false, error: "Missing businessId/accountId/issueId" });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const action = String(body?.action ?? "").trim();
    const allowed = ["LEGITIMIZE", "ACK_STALE", "FIX_MISSING_CATEGORY"];
    if (!allowed.includes(action)) {
      return json(400, { ok: false, error: `action must be one of ${allowed.join(", ")}` });
    }

    const prisma = await getPrisma();

    const role = await requireRole(prisma, sub, biz);
    if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    const acctOk = await requireAccountInBusiness(prisma, biz, acct);
    if (!acctOk) return json(404, { ok: false, error: "Account not found in this business" });

    // Validate issue belongs to business+account (lock)
    const row = await prisma.entryIssue.findFirst({
      where: { id: issue, business_id: biz, account_id: acct },
    });
    if (!row) return json(404, { ok: false, error: "Issue not found" });

    // Idempotent resolve (lock): resolving an already-resolved issue returns ok
    if (row.status === "RESOLVED" || row.resolved_at) {
      return json(200, { ok: true, issue_id: issue, already_resolved: true });
    }

    if (action === "ACK_STALE" && row.issue_type !== "STALE_CHECK") {
      return json(400, { ok: false, error: "ACK_STALE is only valid for STALE_CHECK issues" });
    }

    if (action === "FIX_MISSING_CATEGORY") {
      if (row.issue_type !== "MISSING_CATEGORY") {
        return json(400, { ok: false, error: "FIX_MISSING_CATEGORY is only valid for MISSING_CATEGORY issues" });
      }

      const categoryId = String(body?.category_id ?? "").trim();
      if (!categoryId) return json(400, { ok: false, error: "category_id is required for FIX_MISSING_CATEGORY" });

      const cat = await prisma.category.findFirst({
        where: { id: categoryId, business_id: biz, archived_at: null },
        select: { id: true },
      });
      if (!cat) return json(400, { ok: false, error: "Invalid category_id" });

      await prisma.$transaction(async (tx: any) => {
        await tx.entry.updateMany({
          where: { id: row.entry_id, business_id: biz, account_id: acct, deleted_at: null },
          data: { category_id: categoryId, updated_at: new Date() },
        });

        await tx.entryIssue.updateMany({
          where: { id: issue, business_id: biz, account_id: acct },
          data: { status: "RESOLVED", resolved_at: new Date(), updated_at: new Date() },
        });
      });

      return json(200, { ok: true, issue_id: issue, resolved: true, action });
    }

    // LEGITIMIZE or ACK_STALE: resolve issue only (no entry mutation)
    await prisma.entryIssue.updateMany({
      where: { id: issue, business_id: biz, account_id: acct },
      data: { status: "RESOLVED", resolved_at: new Date(), updated_at: new Date() },
    });

    return json(200, { ok: true, issue_id: issue, resolved: true, action });
  } catch (err: any) {
    console.error("issuesResolve error:", err);
    return json(500, { ok: false, error: "Internal Server Error" });
  }
}
