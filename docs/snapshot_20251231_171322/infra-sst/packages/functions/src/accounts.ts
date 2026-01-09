import { getPrisma } from "./lib/db";
import { randomUUID } from "node:crypto";

const ACCOUNT_TYPES = ["CHECKING", "SAVINGS", "CREDIT_CARD", "CASH", "OTHER"] as const;

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

function getBusinessId(event: any) {
  return (event?.pathParameters?.businessId ?? "").toString().trim();
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path;

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = getBusinessId(event);
  if (!businessId) return json(400, { ok: false, error: "Missing businessId" });

  const prisma = await getPrisma();
  const role = await requireMembership(prisma, businessId, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

  // GET /v1/businesses/{businessId}/accounts
  if (method === "GET" && path?.includes(`/v1/businesses/${businessId}/accounts`)) {
    const rows = await prisma.account.findMany({
      where: { business_id: businessId },
      orderBy: { created_at: "desc" },
    });

    return json(200, {
      ok: true,
      accounts: rows.map((a: any) => ({
        id: a.id,
        business_id: a.business_id,
        name: a.name,
        type: a.type,
        opening_balance_cents: a.opening_balance_cents?.toString?.() ?? String(a.opening_balance_cents),
        opening_balance_date: a.opening_balance_date?.toISOString?.() ?? a.opening_balance_date,
        archived_at: a.archived_at ? a.archived_at.toISOString() : null,
        created_at: a.created_at?.toISOString?.() ?? a.created_at,
        updated_at: a.updated_at?.toISOString?.() ?? a.updated_at,
      })),
    });
  }

  // POST /v1/businesses/{businessId}/accounts
  if (method === "POST" && path?.includes(`/v1/businesses/${businessId}/accounts`)) {
    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const name = (body?.name ?? "").toString().trim();
    const type = (body?.type ?? "").toString().trim();
    const opening_balance_cents_raw = body?.opening_balance_cents ?? 0;
    const opening_balance_date_raw = (body?.opening_balance_date ?? "").toString().trim();

    if (name.length < 2) return json(400, { ok: false, error: "Account name is required (min 2 chars)" });
    if (!ACCOUNT_TYPES.includes(type as any)) return json(400, { ok: false, error: "Invalid account type" });
    if (!opening_balance_date_raw) return json(400, { ok: false, error: "opening_balance_date is required (ISO string)" });

    const openingBalanceNumber = Number(opening_balance_cents_raw);
    if (!Number.isFinite(openingBalanceNumber)) {
      return json(400, { ok: false, error: "opening_balance_cents must be a number" });
    }

    const openingDate = new Date(opening_balance_date_raw);
    if (Number.isNaN(openingDate.getTime())) {
      return json(400, { ok: false, error: "opening_balance_date must be a valid ISO date/time" });
    }

    const accountId = randomUUID();

    const created = await prisma.account.create({
      data: {
        id: accountId,
        business_id: businessId,
        name,
        type,
        opening_balance_cents: BigInt(Math.trunc(openingBalanceNumber)),
        opening_balance_date: openingDate,
      },
    });

    return json(201, {
      ok: true,
      account: {
        id: created.id,
        business_id: created.business_id,
        name: created.name,
        type: created.type,
        opening_balance_cents: created.opening_balance_cents.toString(),
        opening_balance_date: created.opening_balance_date.toISOString(),
      },
    });
  }

  return json(404, { ok: false, error: "Not Found", method, path });
}
