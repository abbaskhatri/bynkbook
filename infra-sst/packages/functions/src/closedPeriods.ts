import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";

function json(statusCode: number, body: any) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function pp(event: any) {
  return event?.pathParameters ?? {};
}

function qp(event: any) {
  return event?.queryStringParameters ?? {};
}

function getPath(event: any) {
  return String(event?.requestContext?.http?.path ?? "");
}

function readBody(event: any) {
  try {
    return event?.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
}

function isOwner(role: string | null | undefined) {
  return String(role ?? "").toUpperCase() === "OWNER";
}

function isOwnerOrAdmin(role: string | null | undefined) {
  const r = String(role ?? "").toUpperCase();
  return r === "OWNER" || r === "ADMIN";
}

function isValidMonth(m: string) {
  return /^\d{4}-\d{2}$/.test(m);
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method ?? "GET";
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const prisma = await getPrisma();
  const { businessId = "", month = "" } = pp(event);

  const biz = String(businessId ?? "").trim();
  if (!biz) return json(400, { ok: false, error: "Missing businessId" });

  const roleRow = await prisma.userBusinessRole.findFirst({
    where: { business_id: biz, user_id: sub },
    select: { role: true },
  });
  const myRole = roleRow?.role ?? null;
  if (!myRole) return json(403, { ok: false, error: "Forbidden" });

  const path = getPath(event);

  if (method === "GET" && path.endsWith("/closed-periods/preview")) {
    const q = qp(event);
    const from = String(q.from ?? "").trim();
    const to = String(q.to ?? "").trim();
    const accountIdRaw = String(q.accountId ?? "all").trim();
    const accountId = !accountIdRaw || accountIdRaw.toLowerCase() === "all" ? null : accountIdRaw;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return json(400, { ok: false, error: "from is required (YYYY-MM-DD)" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return json(400, { ok: false, error: "to is required (YYYY-MM-DD)" });

    // Months affected derived from normalized YYYY-MM-DD strings (no Date month math)
    function monthsBetween(a: string, b: string) {
      const ay = parseInt(a.slice(0, 4), 10);
      const am = parseInt(a.slice(5, 7), 10);
      const by = parseInt(b.slice(0, 4), 10);
      const bm = parseInt(b.slice(5, 7), 10);

      const out: string[] = [];
      let y = ay, m = am;
      while (y < by || (y === by && m <= bm)) {
        out.push(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
        m += 1;
        if (m === 13) { m = 1; y += 1; }
      }
      return out;
    }

    const months_affected = monthsBetween(from, to);

    // Stats via SQL to avoid heavy client loops and avoid missing relations
    const whereAcctSql = accountId ? `AND e.account_id = $2::uuid` : "";
    const acctParam = accountId ?? biz; // placeholder when null; not used if whereAcctSql empty

    const totalRows: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT COUNT(*)::int AS n
      FROM "entry" e
      WHERE e.business_id = $1::uuid
        ${whereAcctSql}
        AND e.deleted_at IS NULL
        AND e.date >= $3::date
        AND e.date <= $4::date
      `,
      biz,
      acctParam,
      from,
      to
    );

    const reconciledRows: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT COUNT(DISTINCT e.id)::int AS n
      FROM "entry" e
      JOIN "bank_match" bm
        ON bm.entry_id = e.id
       AND bm.business_id = e.business_id
       ${accountId ? "AND bm.account_id = e.account_id" : ""}
       AND bm.voided_at IS NULL
      WHERE e.business_id = $1::uuid
        ${whereAcctSql}
        AND e.deleted_at IS NULL
        AND e.date >= $3::date
        AND e.date <= $4::date
      `,
      biz,
      acctParam,
      from,
      to
    );

    const issuesRows: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT COUNT(*)::int AS n
      FROM "entry_issues" ei
      JOIN "entry" e
        ON e.id = ei.entry_id
       AND e.business_id = ei.business_id
       AND e.account_id = ei.account_id
      WHERE ei.business_id = $1::uuid
        ${accountId ? "AND ei.account_id = $2::uuid" : ""}
        AND ei.status = 'OPEN'
        AND e.deleted_at IS NULL
        AND e.date >= $3::date
        AND e.date <= $4::date
      `,
      biz,
      acctParam,
      from,
      to
    );

    const entries_total = Number(totalRows?.[0]?.n ?? 0);
    const entries_reconciled = Number(reconciledRows?.[0]?.n ?? 0);
    const issues_open = Number(issuesRows?.[0]?.n ?? 0);
    const entries_unreconciled = Math.max(0, entries_total - entries_reconciled);

    const is_clean = entries_unreconciled === 0 && issues_open === 0;

    return json(200, {
      ok: true,
      from,
      to,
      accountId: accountIdRaw || "all",
      months_affected,
      stats: {
        entries_total,
        entries_reconciled,
        entries_unreconciled,
        issues_open,
        is_clean,
      },
    });
  }

  if (method === "GET") {
    const rows = await prisma.closedPeriod.findMany({
      where: { business_id: biz },
      orderBy: [{ month: "desc" }],
      select: { month: true, closed_at: true, closed_by_user_id: true },
    });
    return json(200, { ok: true, periods: rows });
  }

  if (method === "POST") {
    if (!isOwnerOrAdmin(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const body = readBody(event);
    const m = String(body?.month ?? "").trim();
    if (!isValidMonth(m)) return json(400, { ok: false, error: "month is required (YYYY-MM)" });

    const existing = await prisma.closedPeriod.findFirst({
      where: { business_id: biz, month: m },
      select: { month: true, closed_at: true, closed_by_user_id: true },
    });

    const created = existing
      ? existing
      : await prisma.closedPeriod.create({
          data: { business_id: biz, month: m, closed_by_user_id: sub },
          select: { month: true, closed_at: true, closed_by_user_id: true },
        });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      eventType: "CLOSED_PERIOD_CLOSED",
      payloadJson: { month: m },
      scopeAccountId: null,
    });

    return json(200, { ok: true, period: created });
  }

  if (method === "DELETE") {
    // Reopen: OWNER only (v1 guardrail)
    if (!isOwner(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const m = String(month ?? "").trim();
    if (!isValidMonth(m)) return json(400, { ok: false, error: "month path param is required (YYYY-MM)" });

    await prisma.closedPeriod.deleteMany({ where: { business_id: biz, month: m } });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      eventType: "CLOSED_PERIOD_REOPENED",
      payloadJson: { month: m },
      scopeAccountId: null,
    });

    return json(200, { ok: true });
  }

  return json(405, { ok: false, error: "Method not allowed" });
}
