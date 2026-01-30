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
  return { businessId: p.businessId, categoryId: p.categoryId };
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

function canWrite(role: string | null) {
  return role === "OWNER" || role === "ADMIN" || role === "BOOKKEEPER" || role === "ACCOUNTANT";
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path ?? event?.rawPath ?? "";

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "", categoryId = "" } = pp(event);
  const biz = businessId.toString().trim();
  if (!biz) return json(400, { ok: false, error: "Missing businessId" });

  const prisma = await getPrisma();
  const role = await requireRole(prisma, sub, biz);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  // GET /v1/businesses/{businessId}/categories
  if (method === "GET" && path === `/v1/businesses/${biz}/categories`) {
    const qs = event?.queryStringParameters ?? {};
    const includeArchived = String(qs.includeArchived ?? "false").toLowerCase() === "true";

    const rows = await prisma.category.findMany({
      where: {
        business_id: biz,
        ...(includeArchived ? {} : { archived_at: null }),
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        archived_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    return json(200, { ok: true, rows });
  }

  // POST /v1/businesses/{businessId}/categories
  if (method === "POST" && path === `/v1/businesses/${biz}/categories`) {
    if (!canWrite(role)) return json(403, { ok: false, error: "Forbidden" });

    const body = event?.body ? JSON.parse(event.body) : {};
    const nameRaw = String(body?.name ?? "").trim();
    const name = nameRaw.replace(/\s+/g, " ");
    if (!name) return json(400, { ok: false, error: "Missing name" });
    if (name.length > 64) return json(400, { ok: false, error: "Name too long" });

    // Code-first uniqueness: strict normalization + case-insensitive de-dupe
    const existing = await prisma.category.findFirst({
      where: {
        business_id: biz,
        archived_at: null,
        name: { equals: name, mode: "insensitive" },
      },
      select: { id: true, name: true, archived_at: true, created_at: true, updated_at: true },
    });
    if (existing) {
      return json(200, { ok: true, row: existing, existed: true });
    }

    try {
      const created = await prisma.category.create({
        data: { business_id: biz, name },
        select: { id: true, name: true, archived_at: true, created_at: true, updated_at: true },
      });
      return json(200, { ok: true, row: created });
    } catch (e: any) {
      // Race-safe: if it already exists (case-insensitive), return the existing row
      const hit = await prisma.category.findFirst({
        where: {
          business_id: biz,
          archived_at: null,
          name: { equals: name, mode: "insensitive" },
        },
        select: { id: true, name: true, archived_at: true, created_at: true, updated_at: true },
      });
      if (hit) return json(200, { ok: true, row: hit, existed: true });

      return json(400, { ok: false, error: "Category already exists or invalid", detail: String(e?.message ?? e) });
    }
  }

  // PATCH /v1/businesses/{businessId}/categories/{categoryId}
  if (method === "PATCH" && path === `/v1/businesses/${biz}/categories/${categoryId}`) {
    if (!canWrite(role)) return json(403, { ok: false, error: "Forbidden" });

    const id = categoryId.toString().trim();
    if (!id) return json(400, { ok: false, error: "Missing categoryId" });

    const body = event?.body ? JSON.parse(event.body) : {};
    const data: any = {};

    if (body?.name !== undefined) {
      const nameRaw = String(body.name ?? "").trim();
      const name = nameRaw.replace(/\s+/g, " ");
      if (!name) return json(400, { ok: false, error: "Missing name" });
      if (name.length > 64) return json(400, { ok: false, error: "Name too long" });
      data.name = name;
    }

    if (body?.archived !== undefined) {
      const archived = !!body.archived;
      data.archived_at = archived ? new Date() : null;
    }

    try {
      // enforce business scope
      const existing = await prisma.category.findFirst({
        where: { id, business_id: biz },
        select: { id: true },
      });
      if (!existing) return json(404, { ok: false, error: "Not found" });

      const updated = await prisma.category.update({
        where: { id },
        data,
        select: { id: true, name: true, archived_at: true, created_at: true, updated_at: true },
      });
      return json(200, { ok: true, row: updated });
    } catch (e: any) {
      return json(400, { ok: false, error: "Update failed", detail: String(e?.message ?? e) });
    }
  }

  return json(404, { ok: false, error: "Not found" });
}
