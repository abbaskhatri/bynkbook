import { getPrisma } from "./lib/db";
import { actionableUncategorizedEntryWhere } from "./lib/uncategorizedEntries";

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
  const raw =
    rows?.[0]?.count ??
    rows?.[0]?.issue_count ??
    rows?.[0]?.uncategorized_count ??
    rows?.[0]?.bank_unmatched_count ??
    0;
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
    where: actionableUncategorizedEntryWhere({ businessId, accountId }),
  });
  return Number(count) || 0;
}

async function countBankUnmatchedTransactions(prisma: any, businessId: string, accountId: string) {
  const rows: any[] = await prisma.$queryRaw`
    SELECT COUNT(*)::int AS bank_unmatched_count
    FROM bank_transaction bt
    WHERE bt.business_id = ${businessId}::uuid
      AND bt.account_id = ${accountId}::uuid
      AND bt.is_removed = false
      AND NOT EXISTS (
        SELECT 1
        FROM match_group_bank mgb
        INNER JOIN match_group mg
          ON mg.id = mgb.match_group_id
         AND mg.business_id = mgb.business_id
         AND mg.account_id = mgb.account_id
        WHERE mgb.business_id = bt.business_id
          AND mgb.account_id = bt.account_id
          AND mgb.bank_transaction_id = bt.id
          AND mg.status = 'ACTIVE'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM bank_match bm
        WHERE bm.business_id = bt.business_id
          AND bm.account_id = bt.account_id
          AND bm.bank_transaction_id = bt.id
          AND bm.voided_at IS NULL
      )
  `;

  return toCount(rows);
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

    const [issueCount, uncategorizedCount, bankUnmatchedCount] = await Promise.all([
      countActionableIssues(prisma, biz, acct),
      countUncategorizedEntries(prisma, biz, acct),
      countBankUnmatchedTransactions(prisma, biz, acct).catch(() => null),
    ]);

    return json(200, {
      ok: true,
      issue_count: issueCount,
      uncategorized_count: uncategorizedCount,
      bank_unmatched_count: bankUnmatchedCount,
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
