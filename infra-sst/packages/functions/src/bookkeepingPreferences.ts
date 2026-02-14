import { getPrisma } from "./lib/db";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function getClaims(event: any) {
  const claims =
    event?.requestContext?.authorizer?.jwt?.claims ??
    event?.requestContext?.authorizer?.claims ??
    {};
  return claims as any;
}

function pp(event: any) {
  const p = event?.pathParameters ?? {};
  return { businessId: p.businessId };
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

function clampInt(n: any, min: number, max: number) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  const v = Math.trunc(x);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path ?? event?.rawPath ?? "";

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "" } = pp(event);
  const biz = businessId.toString().trim();
  if (!biz) return json(400, { ok: false, error: "Missing businessId" });

  const prisma = await getPrisma();
  const role = await requireRole(prisma, sub, biz);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  // GET /v1/businesses/{businessId}/bookkeeping/preferences
  if (method === "GET" && path === `/v1/businesses/${biz}/bookkeeping/preferences`) {
    const row = await prisma.bookkeepingPreferences.findUnique({
      where: { business_id: biz },
      select: {
        business_id: true,
        amount_tolerance_cents: true,
        days_tolerance: true,
        duplicate_window_days: true,
        stale_threshold_days: true,
        auto_suggest: true,
        created_at: true,
        updated_at: true,
      },
    });

    // Defaults if none exists yet
    const out = row
      ? {
          ok: true,
          businessId: row.business_id,
          amountToleranceCents: row.amount_tolerance_cents.toString(),
          daysTolerance: row.days_tolerance,
          duplicateWindowDays: row.duplicate_window_days,
          staleThresholdDays: row.stale_threshold_days,
          autoSuggest: row.auto_suggest,
        }
      : {
          ok: true,
          businessId: biz,
          amountToleranceCents: "0",
          daysTolerance: 3,
          duplicateWindowDays: 7,
          staleThresholdDays: 90,
          autoSuggest: true,
        };

    return json(200, out);
  }

  // PUT /v1/businesses/{businessId}/bookkeeping/preferences
  if (method === "PUT" && path === `/v1/businesses/${biz}/bookkeeping/preferences`) {
    if (!canWrite(role)) return json(403, { ok: false, error: "Forbidden" });

    const body = event?.body ? JSON.parse(event.body) : {};

    // amountToleranceCents: string or number -> BigInt
    const atRaw = body?.amountToleranceCents ?? body?.amount_tolerance_cents ?? "0";
    const atStr = String(atRaw).trim();
    if (!/^-?\d+$/.test(atStr)) return json(400, { ok: false, error: "Invalid amountToleranceCents" });
    const amountToleranceCents = BigInt(atStr);
    if (amountToleranceCents < 0n) return json(400, { ok: false, error: "amountToleranceCents must be >= 0" });

    const daysTolerance = clampInt(body?.daysTolerance ?? body?.days_tolerance, 0, 3650);
    const duplicateWindowDays = clampInt(body?.duplicateWindowDays ?? body?.duplicate_window_days, 0, 3650);
    const staleThresholdDays = clampInt(body?.staleThresholdDays ?? body?.stale_threshold_days, 0, 3650);
    const autoSuggest = body?.autoSuggest !== undefined ? !!body.autoSuggest : body?.auto_suggest !== undefined ? !!body.auto_suggest : null;

    if (daysTolerance == null) return json(400, { ok: false, error: "Invalid daysTolerance" });
    if (duplicateWindowDays == null) return json(400, { ok: false, error: "Invalid duplicateWindowDays" });
    if (staleThresholdDays == null) return json(400, { ok: false, error: "Invalid staleThresholdDays" });
    if (autoSuggest == null) return json(400, { ok: false, error: "Invalid autoSuggest" });

    const row = await prisma.bookkeepingPreferences.upsert({
      where: { business_id: biz },
      create: {
        business_id: biz,
        amount_tolerance_cents: amountToleranceCents,
        days_tolerance: daysTolerance,
        duplicate_window_days: duplicateWindowDays,
        stale_threshold_days: staleThresholdDays,
        auto_suggest: autoSuggest,
      },
      update: {
        amount_tolerance_cents: amountToleranceCents,
        days_tolerance: daysTolerance,
        duplicate_window_days: duplicateWindowDays,
        stale_threshold_days: staleThresholdDays,
        auto_suggest: autoSuggest,
        updated_at: new Date(),
      },
      select: {
        business_id: true,
        amount_tolerance_cents: true,
        days_tolerance: true,
        duplicate_window_days: true,
        stale_threshold_days: true,
        auto_suggest: true,
      },
    });

    return json(200, {
      ok: true,
      businessId: row.business_id,
      amountToleranceCents: row.amount_tolerance_cents.toString(),
      daysTolerance: row.days_tolerance,
      duplicateWindowDays: row.duplicate_window_days,
      staleThresholdDays: row.stale_threshold_days,
      autoSuggest: row.auto_suggest,
    });
  }

  return json(404, { ok: false, error: "Not found" });
}
