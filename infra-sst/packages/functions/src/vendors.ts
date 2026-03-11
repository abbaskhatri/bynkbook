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
        default_category_id: true,
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

    const defaultCategoryRaw = body?.default_category_id ?? body?.defaultCategoryId ?? null;
    const default_category_id = defaultCategoryRaw ? String(defaultCategoryRaw).trim() : null;

    if (!name) return json(400, { ok: false, error: "name is required" });

    if (default_category_id) {
      const hit = await prisma.category.findFirst({
        where: { id: default_category_id, business_id: biz, archived_at: null },
        select: { id: true },
      });
      if (!hit) return json(400, { ok: false, error: "Invalid default category" });
    }

    const created = await prisma.vendor.create({
      data: {
        business_id: biz,
        name,
        notes: notes && notes.length ? notes : null,
        default_category_id,
      },
      select: {
        id: true,
        business_id: true,
        name: true,
        notes: true,
        default_category_id: true,
        created_at: true,
        updated_at: true,
      },
    });

    return json(200, { ok: true, vendor: created });
  }

  // DETAIL
  if (method === "GET" && vendorId && path === `/v1/businesses/${biz}/vendors/${vendorId}`) {
    const vid = String(vendorId).trim();
    const vendor = await prisma.vendor.findFirst({
      where: { id: vid, business_id: biz },
      select: {
        id: true,
        business_id: true,
        name: true,
        notes: true,
        default_category_id: true,
        created_at: true,
        updated_at: true,
      },
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
    if (body.default_category_id !== undefined || body.defaultCategoryId !== undefined) {
      const raw = body.default_category_id ?? body.defaultCategoryId;

      if (raw === null || raw === "") {
        data.default_category_id = null;
      } else {
        const catId = String(raw).trim();
        if (!catId) {
          data.default_category_id = null;
        } else {
          const hit = await prisma.category.findFirst({
            where: { id: catId, business_id: biz, archived_at: null },
            select: { id: true },
          });
          if (!hit) return json(400, { ok: false, error: "Invalid default category" });
          data.default_category_id = catId;
        }
      }
    }

    const updated = await prisma.vendor.updateMany({
      where: { id: vid, business_id: biz },
      data,
    });

    if ((updated?.count ?? 0) === 0) return json(404, { ok: false, error: "Vendor not found" });

    const vendor = await prisma.vendor.findFirst({
      where: { id: vid, business_id: biz },
      select: {
        id: true,
        business_id: true,
        name: true,
        notes: true,
        default_category_id: true,
        created_at: true,
        updated_at: true,
      },
    });

    return json(200, { ok: true, vendor });
  }

  // DELETE
  if (method === "DELETE" && vendorId && path === `/v1/businesses/${biz}/vendors/${vendorId}`) {
    if (!canWrite(myRole)) return json(403, { ok: false, error: "Insufficient permissions" });

    const vid = String(vendorId).trim();

    const existing = await prisma.vendor.findFirst({
      where: { id: vid, business_id: biz },
      select: { id: true, name: true },
    });
    if (!existing) return json(404, { ok: false, error: "Vendor not found" });

    const [billCount, entryCount, uploadCount] = await Promise.all([
      prisma.bill.count({
        where: { business_id: biz, vendor_id: vid },
      }),
      prisma.entry.count({
        where: { business_id: biz, vendor_id: vid, deleted_at: null },
      }),
      prisma.upload.count({
        where: {
          business_id: biz,
          deleted_at: null,
          meta: { path: ["vendor_id"], equals: vid },
        },
      }),
    ]);

    if (billCount > 0 || entryCount > 0 || uploadCount > 0) {
      return json(409, {
        ok: false,
        code: "VENDOR_DELETE_BLOCKED",
        error: "Vendor cannot be deleted while linked records still exist.",
        details: {
          bill_count: billCount,
          entry_count: entryCount,
          upload_count: uploadCount,
        },
      });
    }

    await prisma.vendor.deleteMany({
      where: { id: vid, business_id: biz },
    });

    return json(200, { ok: true, deleted: true, vendor_id: vid });
  }

  return json(404, { ok: false, error: "Not found" });
}
