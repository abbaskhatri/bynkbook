import { getPrisma } from "./lib/db";

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

function roleUpper(r: any) {
  return String(r ?? "").toUpperCase();
}

function canWrite(role: string) {
  // Vendor create/update: OWNER/ADMIN/BOOKKEEPER/ACCOUNTANT
  return ["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"].includes(roleUpper(role));
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method ?? "GET";
  const path = getPath(event);

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const prisma = await getPrisma();

  const { businessId = "", vendorId = "" } = pp(event);
  const biz = String(businessId ?? "").trim();
  if (!biz) return json(400, { ok: false, error: "Missing businessId" });

  const myRoleRow = await prisma.userBusinessRole.findFirst({
    where: { business_id: biz, user_id: sub },
    select: { role: true },
  });
  const myRole = myRoleRow?.role ?? null;
  if (!myRole) return json(403, { ok: false, error: "Forbidden" });

  // LIST
  if (method === "GET" && path === `/v1/businesses/${biz}/vendors`) {
    const q = qp(event);
    const search = String(q.q ?? "").trim();
    const sort = String(q.sort ?? "name_asc").trim();

    const where: any = { business_id: biz };
    if (search) {
      where.name = { contains: search, mode: "insensitive" };
    }

    const orderBy =
      sort === "name_desc"
        ? [{ name: "desc" as const }]
        : sort === "updated_desc"
          ? [{ updated_at: "desc" as const }]
          : [{ name: "asc" as const }];

    const vendors = await prisma.vendor.findMany({
      where,
      orderBy,
      take: 500,
      select: {
        id: true,
        business_id: true,
        name: true,
        notes: true,
        created_at: true,
        updated_at: true,
      },
    });

    return json(200, { ok: true, vendors });
  }

  // CREATE
  if (method === "POST" && path === `/v1/businesses/${biz}/vendors`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const body = readBody(event);
    const name = String(body?.name ?? "").trim();
    const notes = body?.notes === undefined ? null : String(body.notes ?? "").trim();

    if (!name) return json(400, { ok: false, error: "name is required" });

    const created = await prisma.vendor.create({
      data: {
        business_id: biz,
        name,
        notes: notes && notes.length ? notes : null,
      },
      select: { id: true, business_id: true, name: true, notes: true, created_at: true, updated_at: true },
    });

    return json(200, { ok: true, vendor: created });
  }

  // DETAIL
  if (method === "GET" && vendorId && path === `/v1/businesses/${biz}/vendors/${vendorId}`) {
    const vid = String(vendorId).trim();
    const vendor = await prisma.vendor.findFirst({
      where: { id: vid, business_id: biz },
      select: { id: true, business_id: true, name: true, notes: true, created_at: true, updated_at: true },
    });
    if (!vendor) return json(404, { ok: false, error: "Vendor not found" });
    return json(200, { ok: true, vendor });
  }

  // UPDATE
  if ((method === "PATCH" || method === "PUT") && vendorId && path === `/v1/businesses/${biz}/vendors/${vendorId}`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const vid = String(vendorId).trim();
    const body = readBody(event);

    const data: any = { updated_at: new Date() };
    if (body.name !== undefined) {
      const nm = String(body.name ?? "").trim();
      if (!nm) return json(400, { ok: false, error: "name cannot be empty" });
      data.name = nm;
    }
    if (body.notes !== undefined) {
      const nt = String(body.notes ?? "").trim();
      data.notes = nt ? nt : null;
    }

    const updated = await prisma.vendor.updateMany({
      where: { id: vid, business_id: biz },
      data,
    });

    if ((updated?.count ?? 0) === 0) return json(404, { ok: false, error: "Vendor not found" });

    const vendor = await prisma.vendor.findFirst({
      where: { id: vid, business_id: biz },
      select: { id: true, business_id: true, name: true, notes: true, created_at: true, updated_at: true },
    });

    return json(200, { ok: true, vendor });
  }

  return json(404, { ok: false, error: "Not found" });
}
