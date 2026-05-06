import { getPrisma } from "./lib/db";

const ATTENTION_ISSUE_TYPES = ["DUPLICATE", "STALE_CHECK"] as const;

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

function toCount(rows: any[]): number {
  const raw = rows?.[0]?.count ?? rows?.[0]?.issue_count ?? rows?.[0]?.uncategorized_count ?? 0;
  if (typeof raw === "bigint") return Number(raw);
  return Number(raw ?? 0) || 0;
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

async function countActionableIssues(prisma: any, businessId: string, accountId: string) {
  const rows: any[] = await prisma.$queryRaw`
    WITH active_issue_rows AS (
      SELECT
        i.id,
        i.issue_type,
        COALESCE(i.group_key, '') AS group_key
      FROM entry_issues i
      INNER JOIN entry e
        ON e.id = i.entry_id
       AND e.business_id = i.business_id
       AND e.account_id = i.account_id
      WHERE i.business_id = ${businessId}::uuid
        AND i.account_id = ${accountId}::uuid
        AND i.status = 'OPEN'
        AND i.issue_type = ANY(${[...ATTENTION_ISSUE_TYPES]}::text[])
        AND e.deleted_at IS NULL
    ),
    actionable AS (
      SELECT
        id,
        issue_type,
        COUNT(*) OVER (PARTITION BY group_key) AS duplicate_group_count
      FROM active_issue_rows
    )
    SELECT COUNT(*)::int AS issue_count
    FROM actionable
    WHERE issue_type <> 'DUPLICATE'
       OR duplicate_group_count >= 2
  `;

  return toCount(rows);
}

async function countUncategorizedEntries(prisma: any, businessId: string, accountId: string) {
  const count = await prisma.entry.count({
    where: {
      business_id: businessId,
      account_id: accountId,
      category_id: null,
      deleted_at: null,
      NOT: [
        { status: "VOIDED" },
        { type: "OPENING" },
      ],
    },
  });
  return Number(count) || 0;
}

export async function handler(event: any) {
  try {
    const method = event?.requestContext?.http?.method;
    if (method !== "GET") return json(405, { ok: false, error: "Method not allowed" });

    const claims = getClaims(event);
    const sub = claims.sub as string | undefined;
    if (!sub) return json(401, { ok: false, error: "Unauthorized" });

    const { businessId = "", accountId = "" } = pp(event);
    const biz = businessId.toString().trim();
    const acct = accountId.toString().trim();
    if (!biz || !acct) return json(400, { ok: false, error: "Missing businessId/accountId" });

    const prisma = await getPrisma();

    const role = await requireRole(prisma, sub, biz);
    if (!role) return json(403, { ok: false, error: "Forbidden" });

    const okAcct = await requireAccountInBusiness(prisma, biz, acct);
    if (!okAcct) return json(404, { ok: false, error: "Account not found" });

    const [issueCount, uncategorizedCount] = await Promise.all([
      countActionableIssues(prisma, biz, acct),
      countUncategorizedEntries(prisma, biz, acct),
    ]);

    return json(200, {
      ok: true,
      issue_count: issueCount,
      uncategorized_count: uncategorizedCount,
    });
  } catch (err: any) {
    return json(500, {
      ok: false,
      error: "INTERNAL",
      message: String(err?.message ?? err),
      name: String(err?.name ?? "Error"),
      code: err?.code ?? undefined,
    });
  }
}
