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

const ENTRY_IDS_LIMIT = 200;

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

function sortIssues(rows: any[]) {
  return rows.sort((a, b) => {
    const at = a?.detected_at ? new Date(a.detected_at).getTime() : 0;
    const bt = b?.detected_at ? new Date(b.detected_at).getTime() : 0;
    return bt - at;
  });
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

  const prisma = await getPrisma();

  const role = await requireRole(prisma, sub, biz);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, biz, acct);
  if (!okAcct) return json(404, { ok: false, error: "Account not found" });

  const where: any = { business_id: biz, account_id: acct };
  if (status !== "ALL") where.status = status;

  let rows: any[];

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
      return json(200, { ok: true, status, issues: [] });
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

    rows = await prisma.entryIssue.findMany({
      where,
      orderBy: [{ detected_at: "desc" }],
      select: issueSelect,
    });
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
        category_id: true,
        category: { select: { name: true } },
      },
    })
    : [];

  const entryById = new Map(entries.map((e: any) => [e.id, e]));
  const withEntrySnapshots = rows.map((r) => {
    const e = entryById.get(r.entry_id) ?? null;
    return {
      ...r,
      entry_date: ymd(e?.date),
      entry_payee: e?.payee ?? null,
      entry_memo: e?.memo ?? null,
      entry_amount_cents: cents(e?.amount_cents),
      entry_type: e?.type ?? null,
      entry_method: e?.method ?? null,
      entry_category_id: e?.category_id ?? null,
      entry_category_name: e?.category?.name ?? null,
    };
  });

  return json(200, { ok: true, status, issues: withEntrySnapshots });
}
