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

function ymd(v: any): string | null {
  if (!v) return null;
  if (typeof v === "string") return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  try {
    return new Date(v).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function cents(v: any): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return String(Math.trunc(v));
  if (typeof v === "string") return v;
  try {
    return String(v);
  } catch {
    return null;
  }
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

async function getIssueSummary(prisma: any, businessId: string, accountId: string, status: string) {
  const where: any = { business_id: businessId, account_id: accountId };
  if (status !== "ALL") where.status = status;

  const issueRows = await prisma.entryIssue.findMany({
    where,
    select: { entry_id: true, issue_type: true, group_key: true },
  });
  const entryIds = Array.from(new Set(issueRows.map((row: any) => String(row.entry_id ?? "")).filter(Boolean)));
  const activeEntries = entryIds.length
    ? await prisma.entry.findMany({
        where: {
          business_id: businessId,
          account_id: accountId,
          id: { in: entryIds },
          deleted_at: null,
        },
        select: { id: true },
      })
    : [];
  const activeEntryIds = new Set(activeEntries.map((row: any) => String(row.id)));
  const activeIssues = issueRows.filter((row: any) => activeEntryIds.has(String(row.entry_id)));

  const duplicateRowsByGroup = new Map<string, number>();
  for (const row of activeIssues) {
    if (String(row.issue_type).toUpperCase() !== "DUPLICATE") continue;
    const groupKey = String(row.group_key ?? "").trim();
    if (!groupKey) continue;
    duplicateRowsByGroup.set(groupKey, (duplicateRowsByGroup.get(groupKey) ?? 0) + 1);
  }
  const validDuplicateGroups = new Set(
    Array.from(duplicateRowsByGroup.entries())
      .filter(([, count]) => count >= 2)
      .map(([groupKey]) => groupKey)
  );

  const countsByType: Record<string, number> = {};
  for (const row of activeIssues) {
    const issueType = String(row.issue_type ?? "").toUpperCase();
    if (issueType === "DUPLICATE" && !validDuplicateGroups.has(String(row.group_key ?? "").trim())) continue;
    countsByType[issueType] = (countsByType[issueType] ?? 0) + 1;
  }

  return {
    totalCount: Object.values(countsByType).reduce((sum, count) => sum + count, 0),
    countsByType,
    duplicateGroupCount: validDuplicateGroups.size,
  };
}

const ENTRY_IDS_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const issueSelect = {
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
} as const;

function parseEntryIds(qs: any): string[] | null {
  const raw = qs?.entryIds ?? qs?.entry_ids;
  if (raw === undefined || raw === null) return null;

  const parts = Array.isArray(raw)
    ? raw.flatMap((v) => String(v ?? "").split(","))
    : String(raw).split(",");

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of parts) {
    const id = String(part ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= ENTRY_IDS_LIMIT) break;
  }

  return ids;
}

function parseLimit(qs: any): number {
  const raw = qs?.limit;
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

type IssueCursor = {
  priority: number;
  detectedAt: string;
  id: string;
};

const ISSUE_PRIORITY_TYPES = ["DUPLICATE", "MISSING_CATEGORY", "STALE_CHECK"] as const;

function issuePriority(issueType: any): number {
  const t = String(issueType ?? "").toUpperCase();
  if (t === "DUPLICATE") return 0;
  if (t === "MISSING_CATEGORY") return 1;
  if (t === "STALE_CHECK") return 2;
  return 3;
}

function encodeCursor(row: any): string | null {
  const detectedAt = row?.detected_at ? new Date(row.detected_at).toISOString() : null;
  const id = String(row?.id ?? "").trim();
  if (!detectedAt || !id) return null;
  return Buffer.from(JSON.stringify({ priority: issuePriority(row?.issue_type), detectedAt, id })).toString("base64url");
}

function parseCursor(qs: any): IssueCursor | null {
  const raw = String(qs?.cursor ?? "").trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const priority = Number(parsed?.priority);
    const detectedAt = String(parsed?.detectedAt ?? "").trim();
    const id = String(parsed?.id ?? "").trim();
    const t = Date.parse(detectedAt);
    if (!Number.isInteger(priority) || priority < 0 || priority > 3 || !detectedAt || !id || !Number.isFinite(t)) {
      return null;
    }
    return { priority, detectedAt: new Date(t).toISOString(), id };
  } catch {
    return null;
  }
}

function cursorWhere(cursor: IssueCursor | null) {
  if (!cursor) return {};
  const detectedAt = new Date(cursor.detectedAt);
  return {
    OR: [
      { detected_at: { lt: detectedAt } },
      { detected_at: detectedAt, id: { lt: cursor.id } },
    ],
  };
}

function sortIssues(rows: any[]) {
  return rows.sort((a, b) => {
    const ap = issuePriority(a?.issue_type);
    const bp = issuePriority(b?.issue_type);
    if (ap !== bp) return ap - bp;
    const at = a?.detected_at ? new Date(a.detected_at).getTime() : 0;
    const bt = b?.detected_at ? new Date(b.detected_at).getTime() : 0;
    if (at !== bt) return bt - at;
    return String(b?.id ?? "").localeCompare(String(a?.id ?? ""));
  });
}

function issueTypeWhereForPriority(priority: number) {
  if (priority === 0) return { issue_type: "DUPLICATE" };
  if (priority === 1) return { issue_type: "MISSING_CATEGORY" };
  if (priority === 2) return { issue_type: "STALE_CHECK" };
  return { issue_type: { notIn: [...ISSUE_PRIORITY_TYPES] } };
}

async function findPriorityPageRows(prisma: any, where: any, limit: number, cursor: IssueCursor | null) {
  const collected: any[] = [];

  for (let priority = 0; priority <= 3 && collected.length <= limit; priority += 1) {
    if (cursor && priority < cursor.priority) continue;

    const take = limit + 1 - collected.length;
    if (take <= 0) break;

    const rows = await prisma.entryIssue.findMany({
      where: {
        ...where,
        ...issueTypeWhereForPriority(priority),
        ...(cursor && priority === cursor.priority ? cursorWhere(cursor) : {}),
      },
      orderBy: [{ detected_at: "desc" }, { id: "desc" }],
      take,
      select: issueSelect,
    });

    collected.push(...rows);
  }

  return collected;
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
  const requestedEntryIds = parseEntryIds(qs);
  const limit = parseLimit(qs);
  const cursor = parseCursor(qs);

  const prisma = await getPrisma();

  const role = await requireRole(prisma, sub, biz);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, biz, acct);
  if (!okAcct) return json(404, { ok: false, error: "Account not found" });

  const where: any = { business_id: biz, account_id: acct };
  if (status !== "ALL") where.status = status;

  const summary = requestedEntryIds ? null : await getIssueSummary(prisma, biz, acct, status);

  let rows: any[];
  let hasMore = false;
  let nextCursor: string | null = null;

  if (requestedEntryIds) {
    const activeRequestedEntries = requestedEntryIds.length
      ? await prisma.entry.findMany({
        where: {
          business_id: biz,
          account_id: acct,
          id: { in: requestedEntryIds },
          deleted_at: null,
        },
        select: { id: true },
      })
      : [];

    const scopedEntryIds = activeRequestedEntries.map((e: any) => e.id);
    if (scopedEntryIds.length === 0) {
      return json(200, { ok: true, status, issues: [], hasMore: false, nextCursor: null });
    }

    const initialRows = await prisma.entryIssue.findMany({
      where: { ...where, entry_id: { in: scopedEntryIds } },
      orderBy: [{ detected_at: "desc" }],
      select: issueSelect,
    });

    const rowsById = new Map<string, any>();
    for (const row of initialRows) rowsById.set(String(row.id), row);

    const duplicateGroupKeys = Array.from(
      new Set(
        initialRows
          .filter((r: any) => r.issue_type === "DUPLICATE" && String(r.group_key ?? "").trim())
          .map((r: any) => String(r.group_key))
      )
    );

    if (duplicateGroupKeys.length > 0) {
      const peerRows = await prisma.entryIssue.findMany({
        where: {
          ...where,
          issue_type: "DUPLICATE",
          group_key: { in: duplicateGroupKeys },
        },
        orderBy: [{ detected_at: "desc" }],
        select: issueSelect,
      });

      for (const row of peerRows) rowsById.set(String(row.id), row);
    }

    const candidateEntryIds = Array.from(new Set(Array.from(rowsById.values()).map((r: any) => r.entry_id).filter(Boolean)));
    const activeEntries = candidateEntryIds.length
      ? await prisma.entry.findMany({
        where: {
          business_id: biz,
          account_id: acct,
          id: { in: candidateEntryIds },
          deleted_at: null,
        },
        select: { id: true },
      })
      : [];
    const activeEntryIds = new Set(activeEntries.map((e: any) => String(e.id)));

    rows = sortIssues(Array.from(rowsById.values()).filter((r: any) => activeEntryIds.has(String(r.entry_id))));
  } else {
    // Deleted entries must never appear as issues.
    // Filter out issues whose entry has been soft-deleted.
    const deleted = await prisma.entry.findMany({
      where: { business_id: biz, account_id: acct, deleted_at: { not: null } },
      select: { id: true },
    });
    const deletedIds = deleted.map((d: any) => d.id);
    if (deletedIds.length) where.entry_id = { notIn: deletedIds };

    const seedRows = await findPriorityPageRows(prisma, where, limit, cursor);

    const pageSeedRows = seedRows.slice(0, limit);
    const rowsById = new Map<string, any>();
    for (const row of pageSeedRows) rowsById.set(String(row.id), row);

    const duplicateGroupKeys = Array.from(
      new Set(
        pageSeedRows
          .filter((r: any) => r.issue_type === "DUPLICATE" && String(r.group_key ?? "").trim())
          .map((r: any) => String(r.group_key))
      )
    );

    if (duplicateGroupKeys.length > 0) {
      const peerRows = await prisma.entryIssue.findMany({
        where: {
          ...where,
          issue_type: "DUPLICATE",
          group_key: { in: duplicateGroupKeys },
        },
        orderBy: [{ detected_at: "desc" }, { id: "desc" }],
        select: issueSelect,
      });

      for (const row of peerRows) rowsById.set(String(row.id), row);
    }

    rows = sortIssues(Array.from(rowsById.values()));
    hasMore = seedRows.length > limit;
    nextCursor = hasMore ? encodeCursor(pageSeedRows[pageSeedRows.length - 1]) : null;
  }

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

  const snapshotEntryIds = Array.from(new Set(rows.map((r) => r.entry_id).filter(Boolean)));
  const entries = snapshotEntryIds.length
    ? await prisma.entry.findMany({
      where: {
        business_id: biz,
        account_id: acct,
        id: { in: snapshotEntryIds },
        deleted_at: null,
      },
      select: {
        id: true,
        date: true,
        payee: true,
        memo: true,
        amount_cents: true,
        type: true,
        method: true,
        status: true,
        category_id: true,
        category: { select: { name: true } },
      },
    })
    : [];

  const entryById = new Map(entries.map((e: any) => [e.id, e]));
  const activeMatchedEntryIds = new Set<string>();
  if (snapshotEntryIds.length) {
    const candidateEntryLinks = await prisma.matchGroupEntry.findMany({
      where: {
        business_id: biz,
        account_id: acct,
        entry_id: { in: snapshotEntryIds },
      },
      select: { match_group_id: true, entry_id: true },
    });

    const candidateGroupIds = Array.from(
      new Set(
        candidateEntryLinks
          .map((link: any) => String(link?.match_group_id ?? "").trim())
          .filter(Boolean)
      )
    );

    const activeGroups = candidateGroupIds.length
      ? await prisma.matchGroup.findMany({
        where: {
          id: { in: candidateGroupIds },
          business_id: biz,
          account_id: acct,
          status: "ACTIVE",
          voided_at: null,
        },
        select: { id: true },
      })
      : [];

    const activeGroupIds = new Set(activeGroups.map((group: any) => String(group?.id ?? "").trim()).filter(Boolean));
    for (const link of candidateEntryLinks) {
      const groupId = String(link?.match_group_id ?? "").trim();
      const entryId = String(link?.entry_id ?? "").trim();
      if (entryId && activeGroupIds.has(groupId)) activeMatchedEntryIds.add(entryId);
    }
  }

  const withEntrySnapshots = rows.map((r) => {
    const e = entryById.get(r.entry_id) ?? null;
    const entryId = String(r?.entry_id ?? "").trim();
    return {
      ...r,
      entry_date: ymd(e?.date),
      entry_payee: e?.payee ?? null,
      entry_memo: e?.memo ?? null,
      entry_amount_cents: cents(e?.amount_cents),
      entry_type: e?.type ?? null,
      entry_method: e?.method ?? null,
      entry_status: entryId && activeMatchedEntryIds.has(entryId) ? "MATCHED" : e?.status ?? null,
      entry_category_id: e?.category_id ?? null,
      entry_category_name: e?.category?.name ?? null,
    };
  });

  return json(200, {
    ok: true,
    status,
    issues: withEntrySnapshots,
    hasMore,
    nextCursor,
    ...(summary ? { summary } : {}),
  });
}
