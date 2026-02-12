import { getClaims } from "./lib/plaidService";
import { getPrisma } from "./lib/db";

function json(statusCode: number, body: any) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function isOpeningLike(payee: any) {
  const x = String(payee ?? "").trim().toLowerCase();
  return x === "opening balance" || x === "opening balance (estimated)" || x.startsWith("opening balance");
}

export async function handler(event: any) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = String(event?.pathParameters?.businessId ?? "").trim();
  const accountId = String(event?.pathParameters?.accountId ?? "").trim();
  if (!businessId || !accountId) return json(400, { ok: false, error: "Missing ids" });

  let body: any = {};
  try { body = event?.body ? JSON.parse(event.body) : {}; } catch { return json(400, { ok: false, error: "Invalid JSON" }); }

  const choice = String(body?.choice ?? "").toUpperCase(); // APPLY_PLAID | KEEP_MANUAL | CANCEL
  const effectiveStartDate = String(body?.effectiveStartDate ?? "").trim(); // YYYY-MM-DD
  const suggestedOpeningCentsRaw = body?.suggestedOpeningCents;

  if (!choice) return json(400, { ok: false, error: "Missing choice" });
  if (!effectiveStartDate) return json(400, { ok: false, error: "Missing effectiveStartDate" });

  const prisma = await getPrisma();
  const mem = await prisma.userBusinessRole.findFirst({ where: { business_id: businessId, user_id: sub }, select: { role: true } });
  if (!mem) return json(403, { ok: false, error: "Forbidden" });

  const conn = await prisma.bankConnection.findFirst({ where: { business_id: businessId, account_id: accountId } });
  if (!conn) return json(400, { ok: false, error: "No bank connection" });

  // CANCEL means disconnect mapping and exit (no changes to entries)
  if (choice === "CANCEL") {
    await prisma.bankConnection.deleteMany({ where: { business_id: businessId, account_id: accountId } });
    return json(200, { ok: true, cancelled: true });
  }

  const startDate = new Date(`${effectiveStartDate}T00:00:00Z`);
  if (Number.isNaN(startDate.getTime())) return json(400, { ok: false, error: "Invalid effectiveStartDate" });

  // Ensure single canonical opening entry by soft-deleting duplicates (audit-safe)
  const entries = await prisma.entry.findMany({
    where: { business_id: businessId, account_id: accountId, deleted_at: null },
    select: { id: true, payee: true, created_at: true },
    orderBy: { created_at: "asc" as any },
  });

  const opening = entries.filter((e) => isOpeningLike(e.payee));
  const canonical = opening[0] ?? null;
  const duplicates = opening.slice(1);

  if (duplicates.length > 0) {
    await prisma.entry.updateMany({
      where: { id: { in: duplicates.map((d) => d.id) } as any },
      data: { deleted_at: new Date(), memo: "Voided duplicate opening balance entry (system cleanup)." } as any,
    });
  }

  if (choice === "KEEP_MANUAL") {
    // Strict B1:
    // - do NOT create/overwrite opening entry
    // - do NOT touch account.opening_balance_*
    // - store suggestion on connection for reference
    const s = BigInt(Math.trunc(Number(suggestedOpeningCentsRaw ?? 0)));
    await prisma.bankConnection.updateMany({
      where: { business_id: businessId, account_id: accountId },
      data: {
        opening_policy: "MANUAL",
        suggested_opening_cents: s,
        suggested_opening_date: startDate,
        suggested_balance_cents: conn.last_known_balance_cents ?? null,
        suggested_balance_at: conn.last_known_balance_at ?? null,
        effective_start_date: startDate,
        updated_at: new Date(),
      } as any,
    });

    return json(200, { ok: true, keptManual: true });
  }

  // APPLY_PLAID
  const suggested = BigInt(Math.trunc(Number(suggestedOpeningCentsRaw ?? 0)));
  const abs = suggested < 0n ? -suggested : suggested;
  const entryType = suggested >= 0n ? "INCOME" : "EXPENSE";
  const signed = entryType === "INCOME" ? abs : -abs;

  // Create canonical opening if missing
  const openingId = canonical?.id ?? (await import("node:crypto")).randomUUID();

  if (!canonical) {
    await prisma.entry.create({
      data: {
        id: openingId,
        business_id: businessId,
        account_id: accountId,
        date: startDate,
        payee: "Opening balance (estimated)",
        memo: "Estimated from current balance and synced transactions (Plaid).",
        amount_cents: signed,
        type: entryType,
        status: "EXPECTED",
      } as any,
    });
  } else {
    await prisma.entry.update({
      where: { id: openingId },
      data: {
        date: startDate,
        payee: "Opening balance (estimated)",
        memo: "Estimated from current balance and synced transactions (Plaid).",
        amount_cents: signed,
        type: entryType,
        updated_at: new Date(),
      } as any,
    });
  }

  // Update Account opening fields to match (only in APPLY_PLAID)
  await prisma.$transaction([
    prisma.account.update({
      where: { id: accountId },
      data: { opening_balance_cents: abs, opening_balance_date: startDate } as any,
    }),
    prisma.bankConnection.updateMany({
      where: { business_id: businessId, account_id: accountId },
      data: {
        opening_policy: "AUTO",
        opening_adjustment_created_at: new Date(),
        suggested_opening_cents: null,
        suggested_opening_date: null,
        suggested_balance_cents: null,
        suggested_balance_at: null,
        effective_start_date: startDate,
        updated_at: new Date(),
      } as any,
    }),
  ]);

  return json(200, { ok: true, applied: true, openingEntryId: openingId });
}
