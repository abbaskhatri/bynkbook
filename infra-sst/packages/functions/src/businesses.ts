import { getPrisma } from "./lib/db";
import { randomUUID } from "node:crypto";

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
  const method = (event?.requestContext?.http?.method ?? "").toString().toUpperCase();
  const path = (event?.requestContext?.http?.path ?? "").toString();
  const businessId = (event?.pathParameters?.businessId ?? "").toString().trim();

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

        address: r.business.address,
        phone: r.business.phone,
        logo_url: r.business.logo_url,
        industry: r.business.industry,
        currency: r.business.currency,
        timezone: r.business.timezone,
        fiscal_year_start_month: r.business.fiscal_year_start_month,
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

    const address = body?.address != null ? String(body.address) : null;
    const phone = body?.phone != null ? String(body.phone) : null;
    const logo_url = body?.logo_url != null ? String(body.logo_url) : null;
    const industry = body?.industry != null ? String(body.industry) : null;

    const currency = body?.currency != null ? String(body.currency).toUpperCase() : "USD";
    const timezone = body?.timezone != null ? String(body.timezone) : "America/Chicago";
    const fiscal_year_start_month =
      body?.fiscal_year_start_month != null ? Number(body.fiscal_year_start_month) : 1;

    if (currency && !/^[A-Z]{3}$/.test(currency)) return json(400, { ok: false, error: "Invalid currency (expected 3-letter code)" });
    if (!Number.isFinite(fiscal_year_start_month) || fiscal_year_start_month < 1 || fiscal_year_start_month > 12) {
      return json(400, { ok: false, error: "Invalid fiscal_year_start_month (1-12)" });
    }

    const businessId = randomUUID();
    const roleId = randomUUID();

    // Transaction: create business + owner membership
    await prisma.$transaction([
      prisma.business.create({
        data: {
          id: businessId,
          name,
          owner_user_id: sub,

          address,
          phone,
          logo_url,
          industry,
          currency,
          timezone,
          fiscal_year_start_month,
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

    return json(201, {
      ok: true,
      business: {
        id: businessId,
        name,
        role: "OWNER",
        address,
        phone,
        logo_url,
        industry,
        currency,
        timezone,
        fiscal_year_start_month,
      },
    });
  }

  // GET /v1/businesses/{businessId}
  if (method === "GET" && businessId && path.includes("/v1/businesses/")) {
    const row = await prisma.userBusinessRole.findFirst({
      where: { user_id: sub, business_id: businessId },
      include: { business: true },
    });
    if (!row) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

    return json(200, {
      ok: true,
      business: {
        id: row.business.id,
        name: row.business.name,
        role: row.role,
        created_at: row.business.created_at,

        address: row.business.address,
        phone: row.business.phone,
        logo_url: row.business.logo_url,
        industry: row.business.industry,
        currency: row.business.currency,
        timezone: row.business.timezone,
        fiscal_year_start_month: row.business.fiscal_year_start_month,
      },
    });
  }

  // PATCH /v1/businesses/{businessId} (OWNER/ADMIN only)
  if (method === "PATCH" && businessId && path.includes("/v1/businesses/")) {
    const membership = await prisma.userBusinessRole.findFirst({
      where: { user_id: sub, business_id: businessId },
      select: { role: true },
    });
    const role = String(membership?.role ?? "").toUpperCase();
    if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });
    if (!(role === "OWNER" || role === "ADMIN")) return json(403, { ok: false, error: "Forbidden (requires OWNER/ADMIN)" });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const patch: any = {};
    if ("address" in body) patch.address = body.address == null ? null : String(body.address);
    if ("phone" in body) patch.phone = body.phone == null ? null : String(body.phone);
    if ("logo_url" in body) patch.logo_url = body.logo_url == null ? null : String(body.logo_url);
    if ("industry" in body) patch.industry = body.industry == null ? null : String(body.industry);
    if ("currency" in body) {
      const v = body.currency == null ? null : String(body.currency).toUpperCase();
      if (v && !/^[A-Z]{3}$/.test(v)) return json(400, { ok: false, error: "Invalid currency (expected 3-letter code)" });
      patch.currency = v ?? "USD";
    }
    if ("timezone" in body) patch.timezone = body.timezone == null ? null : String(body.timezone);
    if ("fiscal_year_start_month" in body) {
      const n = Number(body.fiscal_year_start_month);
      if (!Number.isFinite(n) || n < 1 || n > 12) return json(400, { ok: false, error: "Invalid fiscal_year_start_month (1-12)" });
      patch.fiscal_year_start_month = n;
    }

    if (Object.keys(patch).length === 0) return json(400, { ok: false, error: "No fields to update" });

    const updated = await prisma.business.update({
      where: { id: businessId },
      data: patch,
    });

    return json(200, {
      ok: true,
      business: {
        id: updated.id,
        name: updated.name,
        address: updated.address,
        phone: updated.phone,
        logo_url: updated.logo_url,
        industry: updated.industry,
        currency: updated.currency,
        timezone: updated.timezone,
        fiscal_year_start_month: updated.fiscal_year_start_month,
      },
    });
  }

  return json(404, { ok: false, error: "Not Found", method, path });
}
