import { getPrisma } from "./lib/db";

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

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path;

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;

  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const prisma = await getPrisma();

  // GET /v1/businesses
  if (method === "GET" && path?.endsWith("/v1/businesses")) {
    const rows = await prisma.userBusinessRole.findMany({
      where: { user_id: sub },
      include: { business: true },
      orderBy: { created_at: "desc" },
    });

    return json(200, {
      ok: true,
      businesses: rows.map((r) => ({
        id: r.business.id,
        name: r.business.name,
        role: r.role,
        created_at: r.business.created_at,
      })),
    });
  }

  // POST /v1/businesses
  if (method === "POST" && path?.endsWith("/v1/businesses")) {
    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const name = (body?.name ?? "").toString().trim();
    if (name.length < 2) return json(400, { ok: false, error: "Business name is required (min 2 chars)" });

    const businessId = crypto.randomUUID();
    const roleId = crypto.randomUUID();

    // Transaction: create business + owner membership
    await prisma.$transaction([
      prisma.business.create({
        data: {
          id: businessId,
          name,
          owner_user_id: sub,
        },
      }),
      prisma.userBusinessRole.create({
        data: {
          id: roleId,
          business_id: businessId,
          user_id: sub,
          role: "OWNER",
        },
      }),
    ]);

    return json(201, { ok: true, business: { id: businessId, name, role: "OWNER" } });
  }

  return json(404, { ok: false, error: "Not Found", method, path });
}
