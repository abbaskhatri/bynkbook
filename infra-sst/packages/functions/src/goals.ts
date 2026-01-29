import { getPrisma } from "./lib/db";
import { authorizeWrite } from "./lib/authz";
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

function getPath(event: any) {
  return String(event?.requestContext?.http?.path ?? "");
}

async function getMyRole(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

// Phase 6A: deny-by-default write permissions
function canWrite(role: string | null) {
  const r = (role ?? "").toString().trim().toUpperCase();
  return r === "OWNER" || r === "ADMIN" || r === "BOOKKEEPER" || r === "ACCOUNTANT";
}

function requireMonth(v: any) {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(s)) return null;
  return s;
}

function monthStartYmd(month: string) {
  return `${month}-01`;
}

function nextMonth(month: string) {
  const [yy, mm] = month.split("-").map((x) => Number(x));
  if (!yy || !mm) return null;
  const d = new Date(Date.UTC(yy, mm - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function toUtcStart(ymd: string) {
  return new Date(`${ymd}T00:00:00Z`);
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method ?? "GET";
  const path = getPath(event);

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "", goalId = "" } = pp(event);
  const biz = String(businessId ?? "").trim();
  const gid = String(goalId ?? "").trim();
  if (!biz) return json(400, { ok: false, error: "Missing businessId" });

  const prisma = await getPrisma();
  const role = await getMyRole(prisma, biz, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  // Routes:
  // GET  /v1/businesses/{businessId}/goals
  // POST /v1/businesses/{businessId}/goals
  // PATCH /v1/businesses/{businessId}/goals/{goalId}

  if (method === "GET" && path === `/v1/businesses/${biz}/goals`) {
    const rows = await prisma.goal.findMany({
      where: { business_id: biz },
      orderBy: [{ updated_at: "desc" }],
      select: {
        id: true,
        name: true,
        category_id: true,
        month_start: true,
        month_end: true,
        target_cents: true,
        status: true,
        created_at: true,
        updated_at: true,
      },
    });

    const catIds = Array.from(new Set(rows.map((r: any) => String(r.category_id))));
    const cats = catIds.length
      ? await prisma.category.findMany({
          where: { business_id: biz, id: { in: catIds } },
          select: { id: true, name: true },
        })
      : [];

    const catNameById = new Map<string, string>(cats.map((c: any) => [String(c.id), String(c.name)]));

    // Compute progress = EXPENSE actual abs within [month_start .. month_end] (month-bounded v1)
    const out: any[] = [];
    for (const g of rows as any[]) {
      const startMonth = String(g.month_start);
      const endMonthInclusive = g.month_end ? String(g.month_end) : null;

      const start = toUtcStart(monthStartYmd(startMonth));
      const endExclusive = (() => {
        const last = endMonthInclusive ?? startMonth;
        const nm = nextMonth(last);
        if (!nm) return null;
        return toUtcStart(monthStartYmd(nm));
      })();

      if (!endExclusive) {
        out.push({
          ...g,
          category_name: catNameById.get(String(g.category_id)) ?? "Category",
          progress_cents: "0",
        });
        continue;
      }

      const agg = await prisma.entry.aggregate({
        where: {
          business_id: biz,
          deleted_at: null,
          type: "EXPENSE",
          category_id: String(g.category_id),
          date: { gte: start, lt: endExclusive },
        },
        _sum: { amount_cents: true },
      });

      const sum = (agg?._sum?.amount_cents ?? 0n) as bigint; // negative
      const abs = sum < 0n ? -sum : sum;

      out.push({
        id: String(g.id),
        name: String(g.name),
        category_id: String(g.category_id),
        category_name: catNameById.get(String(g.category_id)) ?? "Category",
        month_start: startMonth,
        month_end: endMonthInclusive,
        target_cents: (g.target_cents ?? 0n).toString(),
        status: String(g.status),
        progress_cents: abs.toString(), // positive abs
        created_at: String(g.created_at),
        updated_at: String(g.updated_at),
      });
    }

    return json(200, { ok: true, rows: out });
  }

  if (method === "POST" && path === `/v1/businesses/${biz}/goals`) {
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    const az = await authorizeWrite(prisma, {
      businessId: biz,
      scopeAccountId: null,
      actorUserId: sub,
      actorRole: role,
      actionKey: "goals.write",
      requiredLevel: "FULL",
      endpointForLog: "POST /v1/businesses/{businessId}/goals",
    });

    if (!az.allowed) {
      return json(403, {
        ok: false,
        error: "Policy denied",
        code: "POLICY_DENIED",
        actionKey: "goals.write",
        requiredLevel: az.requiredLevel,
        policyValue: az.policyValue,
        policyKey: az.policyKey,
      });
    }

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const name = String(body?.name ?? "").trim();
    const category_id = String(body?.category_id ?? "").trim();
    const month_start = requireMonth(body?.month_start);
    const month_end = body?.month_end == null || String(body?.month_end).trim() === "" ? null : requireMonth(body?.month_end);
    const status = String(body?.status ?? "ACTIVE").trim().toUpperCase();
    const targetNum = Number(body?.target_cents);

    if (!name) return json(400, { ok: false, error: "name is required" });
    if (!category_id) return json(400, { ok: false, error: "category_id is required" });
    if (!month_start) return json(400, { ok: false, error: "month_start is required (YYYY-MM)" });
    if (month_end === null && body?.month_end) return json(400, { ok: false, error: "month_end must be YYYY-MM" });
    if (!Number.isFinite(targetNum)) return json(400, { ok: false, error: "target_cents must be a number" });

    const target_cents = BigInt(Math.max(0, Math.trunc(targetNum)));

    if (!(status === "ACTIVE" || status === "PAUSED" || status === "ARCHIVED")) {
      return json(400, { ok: false, error: "status must be ACTIVE|PAUSED|ARCHIVED" });
    }

    const cat = await prisma.category.findFirst({
      where: { business_id: biz, id: category_id, archived_at: null },
      select: { id: true },
    });
    if (!cat) return json(400, { ok: false, error: "Invalid category_id" });

    const created = await prisma.goal.create({
      data: {
        business_id: biz,
        name,
        category_id,
        month_start,
        month_end,
        target_cents,
        status,
        created_by_user_id: sub,
        created_at: new Date(),
        updated_at: new Date(),
      },
      select: { id: true },
    });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      scopeAccountId: null,
      eventType: "GOAL_CREATED",
      payloadJson: { goal_id: String(created.id) },
    });

    return json(201, { ok: true, goal_id: String(created.id) });
  }

  if (method === "PATCH" && gid && path === `/v1/businesses/${biz}/goals/${gid}`) {
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    const az = await authorizeWrite(prisma, {
      businessId: biz,
      scopeAccountId: null,
      actorUserId: sub,
      actorRole: role,
      actionKey: "goals.write",
      requiredLevel: "FULL",
      endpointForLog: "PATCH /v1/businesses/{businessId}/goals/{goalId}",
    });

    if (!az.allowed) {
      return json(403, {
        ok: false,
        error: "Policy denied",
        code: "POLICY_DENIED",
        actionKey: "goals.write",
        requiredLevel: az.requiredLevel,
        policyValue: az.policyValue,
        policyKey: az.policyKey,
      });
    }

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const patch: any = {};
    if (body?.name != null) {
      const name = String(body.name ?? "").trim();
      if (!name) return json(400, { ok: false, error: "name cannot be empty" });
      patch.name = name;
    }

    if (body?.status != null) {
      const status = String(body.status ?? "").trim().toUpperCase();
      if (!(status === "ACTIVE" || status === "PAUSED" || status === "ARCHIVED")) {
        return json(400, { ok: false, error: "status must be ACTIVE|PAUSED|ARCHIVED" });
      }
      patch.status = status;
    }

    if (body?.target_cents != null) {
      const targetNum = Number(body.target_cents);
      if (!Number.isFinite(targetNum)) return json(400, { ok: false, error: "target_cents must be a number" });
      patch.target_cents = BigInt(Math.max(0, Math.trunc(targetNum)));
    }

    if (body?.category_id != null) {
      const category_id = String(body.category_id ?? "").trim();
      if (!category_id) return json(400, { ok: false, error: "category_id cannot be empty" });
      const cat = await prisma.category.findFirst({
        where: { business_id: biz, id: category_id, archived_at: null },
        select: { id: true },
      });
      if (!cat) return json(400, { ok: false, error: "Invalid category_id" });
      patch.category_id = category_id;
    }

    if (body?.month_start != null) {
      const ms = requireMonth(body.month_start);
      if (!ms) return json(400, { ok: false, error: "month_start must be YYYY-MM" });
      patch.month_start = ms;
    }

    if (body?.month_end !== undefined) {
      if (body.month_end == null || String(body.month_end).trim() === "") patch.month_end = null;
      else {
        const me = requireMonth(body.month_end);
        if (!me) return json(400, { ok: false, error: "month_end must be YYYY-MM" });
        patch.month_end = me;
      }
    }

    patch.updated_at = new Date();

    const updated = await prisma.goal.updateMany({
      where: { id: gid, business_id: biz },
      data: patch,
    });

    if (updated.count === 0) return json(404, { ok: false, error: "Goal not found" });

    await logActivity(prisma, {
      businessId: biz,
      actorUserId: sub,
      scopeAccountId: null,
      eventType: "GOAL_UPDATED",
      payloadJson: { goal_id: gid },
    });

    return json(200, { ok: true, goal_id: gid });
  }

  return json(404, { ok: false, error: "Not Found" });
}
