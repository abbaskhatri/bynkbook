import { getPrisma } from "./lib/db";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function parseLimit(q: any) {
  const n = Number(q?.limit ?? 50);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.trunc(n)));
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method ?? "GET";
  if (method !== "GET") return json(405, { ok: false, error: "Method not allowed" });

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = String(event?.pathParameters?.businessId ?? "").trim();
  if (!businessId) return json(400, { ok: false, error: "Missing businessId" });

  const prisma = await getPrisma();

  // Membership required (read-only)
  const mem = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: sub },
    select: { role: true },
  });
  if (!mem) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  const q = event?.queryStringParameters ?? {};
  const limit = parseLimit(q);

  const eventType = (q?.event_type ?? q?.eventType ?? "").toString().trim().toUpperCase();
  const actorUserId = (q?.actor_user_id ?? q?.actorUserId ?? "").toString().trim();
  const accountId = (q?.account_id ?? q?.accountId ?? "").toString().trim();
  const before = (q?.before ?? "").toString().trim();

  const where: any = { business_id: businessId };
  if (eventType) where.event_type = eventType;
  if (actorUserId) where.actor_user_id = actorUserId;
  if (accountId) where.scope_account_id = accountId;

  if (before) {
    const d = new Date(before);
    if (!Number.isNaN(d.getTime())) {
      where.created_at = { lt: d };
    }
  }

  const items = await prisma.activityLog.findMany({
    where,
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      created_at: true,
      event_type: true,
      actor_user_id: true,
      business_id: true,
      scope_account_id: true,
      payload_json: true,
    },
  });

  return json(200, { ok: true, items });
}
