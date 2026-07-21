import { randomUUID } from "node:crypto";

import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import { authorizeWrite } from "./lib/authz";
import { assertNotClosedPeriod } from "./lib/closedPeriods";
import { serializeDateOnly } from "./lib/dateOnly";

const TEMPLATE_CODE = "SSLT104";
const WRITE_ROLES = new Set(["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"]);

type AllocationInput = { bill_id: string; applied_amount_cents: bigint };

function json(statusCode: number, body: any) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function claims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function body(event: any) {
  try {
    return event?.body ? JSON.parse(event.body) : {};
  } catch {
    return null;
  }
}

function toBigInt(value: any): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  } catch { }
  return 0n;
}

function isUuid(value: any) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? "").trim());
}

function cleanText(value: any, max = 500) {
  const normalized = String(value ?? "").replace(/\r\n/g, "\n").trim();
  return normalized.slice(0, max);
}

export function normalizeCheckNumber(value: any) {
  const normalized = String(value ?? "").trim();
  return /^\d{1,18}$/.test(normalized) ? normalized : null;
}

export function incrementCheckNumber(value: string) {
  const normalized = normalizeCheckNumber(value);
  if (!normalized) return null;
  const next = (BigInt(normalized) + 1n).toString();
  return next.padStart(normalized.length, "0");
}

export function normalizeAllocations(value: any, paymentAmount: bigint): { ok: true; rows: AllocationInput[] } | { ok: false; error: string } {
  const input = value == null ? [] : value;
  if (!Array.isArray(input)) return { ok: false, error: "bill_allocations must be an array" };
  if (input.length > 100) return { ok: false, error: "Too many bill allocations (max 100)" };

  const rows: AllocationInput[] = [];
  const seen = new Set<string>();
  let total = 0n;
  for (const item of input) {
    const billId = String(item?.bill_id ?? "").trim();
    const amount = toBigInt(item?.applied_amount_cents);
    if (!isUuid(billId)) return { ok: false, error: "Each bill allocation requires a valid bill_id" };
    if (seen.has(billId)) return { ok: false, error: "A bill can only be included once" };
    if (amount <= 0n) return { ok: false, error: "Bill allocation amounts must be positive" };
    seen.add(billId);
    total += amount;
    rows.push({ bill_id: billId, applied_amount_cents: amount });
  }
  if (total > paymentAmount) return { ok: false, error: "Bill allocations cannot exceed the check amount" };
  return { ok: true, rows };
}

async function roleFor(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return String(row?.role ?? "").toUpperCase();
}

async function requireWrite(prisma: any, args: { businessId: string; accountId?: string | null; userId: string; role: string; endpoint: string }) {
  if (!WRITE_ROLES.has(args.role)) return json(403, { ok: false, error: "Insufficient permissions" });
  const allowed = await authorizeWrite(prisma, {
    businessId: args.businessId,
    scopeAccountId: args.accountId ?? null,
    actorUserId: args.userId,
    actorRole: args.role,
    actionKey: "checks.write",
    requiredLevel: "FULL",
    endpointForLog: args.endpoint,
  });
  return allowed.allowed ? null : json(403, { ok: false, error: "Policy denied", code: allowed.code ?? "POLICY_DENIED" });
}

function publicCheck(row: any) {
  const cleared = !!row?.entry && (
    (Array.isArray(row.entry.bankMatches) && row.entry.bankMatches.length > 0) ||
    (Array.isArray(row.entry.matchGroupEntries) && row.entry.matchGroupEntries.length > 0)
  );
  const stored = String(row?.status ?? "DRAFT").toUpperCase();
  const displayStatus = stored === "PRINTED" ? (cleared ? "CLEARED" : "OUTSTANDING") : stored;
  return {
    id: row.id,
    business_id: row.business_id,
    account_id: row.account_id,
    account_name: row.account?.name ?? null,
    entry_id: row.entry_id ?? null,
    vendor_id: row.vendor_id ?? null,
    vendor_name: row.vendor?.name ?? null,
    category_id: row.category_id ?? null,
    category_name: row.category?.name ?? null,
    check_number: row.check_number,
    issued_date: serializeDateOnly(row.issued_date),
    payee_name: row.payee_name,
    payee_address: row.payee_address ?? null,
    amount_cents: String(row.amount_cents ?? 0),
    memo: row.memo ?? null,
    purpose: row.purpose,
    bill_allocations: Array.isArray(row.bill_allocations) ? row.bill_allocations : [],
    template_code: row.template_code,
    status: displayStatus,
    stored_status: stored,
    print_count: Number(row.print_count ?? 0),
    last_printed_at: row.last_printed_at?.toISOString?.() ?? null,
    confirmed_at: row.confirmed_at?.toISOString?.() ?? null,
    voided_at: row.voided_at?.toISOString?.() ?? null,
    void_reason: row.void_reason ?? null,
    created_at: row.created_at?.toISOString?.() ?? row.created_at,
    updated_at: row.updated_at?.toISOString?.() ?? row.updated_at,
  };
}

const checkInclude = {
  account: { select: { name: true } },
  vendor: { select: { name: true } },
  category: { select: { name: true } },
  entry: {
    select: {
      id: true,
      deleted_at: true,
      bankMatches: { where: { voided_at: null }, select: { id: true }, take: 1 },
      matchGroupEntries: { where: { matchGroup: { status: "ACTIVE" } }, select: { id: true }, take: 1 },
    },
  },
} as const;

async function updateBillsAfterApplicationChange(tx: any, businessId: string, billIds: string[]) {
  if (!billIds.length) return;
  const totals = await tx.billPaymentApplication.groupBy({
    by: ["bill_id"],
    where: { business_id: businessId, bill_id: { in: billIds }, is_active: true },
    _sum: { applied_amount_cents: true },
  });
  const applied = new Map<string, bigint>(totals.map((item: any) => [String(item.bill_id), toBigInt(item._sum?.applied_amount_cents)]));
  const bills = await tx.bill.findMany({
    where: { business_id: businessId, id: { in: billIds } },
    select: { id: true, amount_cents: true, voided_at: true },
  });
  for (const bill of bills) {
    const sum = applied.get(String(bill.id)) ?? 0n;
    const amount = toBigInt(bill.amount_cents);
    const status = bill.voided_at ? "VOID" : sum <= 0n ? "OPEN" : sum >= amount ? "PAID" : "PARTIAL";
    await tx.bill.update({ where: { id: bill.id }, data: { status, updated_at: new Date() } });
  }
}

export async function handler(event: any) {
  const method = String(event?.requestContext?.http?.method ?? "GET").toUpperCase();
  const path = String(event?.requestContext?.http?.path ?? "");
  const params = event?.pathParameters ?? {};
  const businessId = String(params.businessId ?? "").trim();
  const accountId = String(params.accountId ?? "").trim();
  const checkId = String(params.checkId ?? "").trim();
  const userId = String(claims(event)?.sub ?? "").trim();
  if (!userId) return json(401, { ok: false, error: "Unauthorized" });
  if (!isUuid(businessId)) return json(400, { ok: false, error: "Missing or invalid businessId" });

  const prisma = await getPrisma();
  const role = await roleFor(prisma, businessId, userId);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  if (method === "GET" && path === `/v1/businesses/${businessId}/checks`) {
    const rows = await prisma.checkPayment.findMany({
      where: { business_id: businessId },
      orderBy: [{ issued_date: "desc" }, { created_at: "desc" }],
      take: 250,
      include: checkInclude,
    });
    const settings = await prisma.checkPrintSetting.findMany({
      where: { business_id: businessId },
      orderBy: { updated_at: "desc" },
    });
    return json(200, {
      ok: true,
      template: { code: TEMPLATE_CODE, label: "Deluxe SSLT104", paper: "Letter", check_position: "TOP" },
      checks: rows.map(publicCheck),
      settings: settings.map((setting: any) => ({
        account_id: setting.account_id,
        template_code: setting.template_code,
        next_check_number: setting.next_check_number,
        offset_x_mils: setting.offset_x_mils,
        offset_y_mils: setting.offset_y_mils,
      })),
    });
  }

  if (method === "PUT" && accountId && path === `/v1/businesses/${businessId}/checks/settings/${accountId}`) {
    if (!isUuid(accountId)) return json(400, { ok: false, error: "Invalid accountId" });
    const denied = await requireWrite(prisma, { businessId, accountId, userId, role, endpoint: "PUT /checks/settings/{accountId}" });
    if (denied) return denied;
    const input = body(event);
    if (!input) return json(400, { ok: false, error: "Invalid JSON body" });
    const nextNumber = normalizeCheckNumber(input.next_check_number);
    if (!nextNumber) return json(400, { ok: false, error: "Enter the next physical check number using digits only" });
    const offsetX = Math.trunc(Number(input.offset_x_mils ?? 0));
    const offsetY = Math.trunc(Number(input.offset_y_mils ?? 0));
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY) || Math.abs(offsetX) > 500 || Math.abs(offsetY) > 500) {
      return json(400, { ok: false, error: "Alignment offsets must be between -500 and 500 thousandths of an inch" });
    }
    const account = await prisma.account.findFirst({
      where: { id: accountId, business_id: businessId, archived_at: null },
      select: { id: true, type: true },
    });
    if (!account) return json(404, { ok: false, error: "Account not found" });
    if (String(account.type).toUpperCase() !== "CHECKING") return json(400, { ok: false, error: "Checks can only be printed from a checking account" });
    const setting = await prisma.checkPrintSetting.upsert({
      where: { business_id_account_id: { business_id: businessId, account_id: accountId } },
      create: {
        business_id: businessId,
        account_id: accountId,
        template_code: TEMPLATE_CODE,
        next_check_number: nextNumber,
        offset_x_mils: offsetX,
        offset_y_mils: offsetY,
        created_by_user_id: userId,
      },
      update: {
        next_check_number: nextNumber,
        offset_x_mils: offsetX,
        offset_y_mils: offsetY,
        updated_at: new Date(),
      },
    });
    await logActivity(prisma, {
      businessId,
      actorUserId: userId,
      scopeAccountId: accountId,
      eventType: "CHECK_SETTINGS_UPDATED",
      payloadJson: { template_code: TEMPLATE_CODE, next_check_number: nextNumber, offset_x_mils: offsetX, offset_y_mils: offsetY },
    });
    return json(200, { ok: true, setting: { ...setting, created_at: undefined, updated_at: undefined } });
  }

  if (method === "POST" && path === `/v1/businesses/${businessId}/checks`) {
    const input = body(event);
    if (!input) return json(400, { ok: false, error: "Invalid JSON body" });
    const draftAccountId = String(input.account_id ?? "").trim();
    if (!isUuid(draftAccountId)) return json(400, { ok: false, error: "Choose a checking account" });
    const denied = await requireWrite(prisma, { businessId, accountId: draftAccountId, userId, role, endpoint: "POST /checks" });
    if (denied) return denied;

    const account = await prisma.account.findFirst({
      where: { id: draftAccountId, business_id: businessId, archived_at: null },
      select: { id: true, type: true },
    });
    if (!account) return json(404, { ok: false, error: "Account not found" });
    if (String(account.type).toUpperCase() !== "CHECKING") return json(400, { ok: false, error: "Checks can only be printed from a checking account" });
    const setting = await prisma.checkPrintSetting.findFirst({ where: { business_id: businessId, account_id: draftAccountId } });
    if (!setting) return json(409, { ok: false, code: "CHECK_SETUP_REQUIRED", error: "Set up Deluxe SSLT104 printing for this account first" });

    const checkNumber = normalizeCheckNumber(input.check_number ?? setting.next_check_number);
    const issuedDate = String(input.issued_date ?? "").trim();
    const payeeName = cleanText(input.payee_name, 200);
    const payeeAddress = cleanText(input.payee_address, 500) || null;
    const memo = cleanText(input.memo, 500) || null;
    const amountCents = toBigInt(input.amount_cents);
    const vendorId = input.vendor_id ? String(input.vendor_id).trim() : null;
    const categoryId = input.category_id ? String(input.category_id).trim() : null;
    if (!checkNumber) return json(400, { ok: false, error: "Enter the number printed on the physical check" });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedDate)) return json(400, { ok: false, error: "Choose a valid check date" });
    if (!payeeName) return json(400, { ok: false, error: "Payee is required" });
    if (amountCents <= 0n) return json(400, { ok: false, error: "Enter a check amount greater than zero" });
    if (vendorId && !isUuid(vendorId)) return json(400, { ok: false, error: "Invalid vendor" });
    if (categoryId && !isUuid(categoryId)) return json(400, { ok: false, error: "Invalid category" });

    const normalized = normalizeAllocations(input.bill_allocations, amountCents);
    if (!normalized.ok) return json(400, { ok: false, error: normalized.error });
    if (normalized.rows.length && !vendorId) return json(400, { ok: false, error: "Select a vendor before applying the check to bills" });

    const vendor = vendorId
      ? await prisma.vendor.findFirst({ where: { id: vendorId, business_id: businessId }, select: { id: true, name: true, address: true } })
      : null;
    if (vendorId && !vendor) return json(404, { ok: false, error: "Vendor not found" });
    if (categoryId) {
      const category = await prisma.category.findFirst({ where: { id: categoryId, business_id: businessId, archived_at: null }, select: { id: true } });
      if (!category) return json(404, { ok: false, error: "Category not found" });
    }

    let allocationSnapshots: any[] = [];
    if (normalized.rows.length) {
      const ids = normalized.rows.map((row) => row.bill_id);
      const bills = await prisma.bill.findMany({
        where: { business_id: businessId, vendor_id: vendorId!, id: { in: ids }, voided_at: null },
        select: { id: true, invoice_date: true, due_date: true, amount_cents: true, memo: true },
      });
      if (bills.length !== ids.length) return json(400, { ok: false, error: "Every selected bill must belong to the chosen vendor" });
      const billById = new Map(bills.map((bill: any) => [String(bill.id), bill]));
      allocationSnapshots = normalized.rows.map((allocation) => {
        const bill: any = billById.get(allocation.bill_id);
        return {
          bill_id: allocation.bill_id,
          invoice_date: serializeDateOnly(bill.invoice_date),
          due_date: serializeDateOnly(bill.due_date),
          memo: bill.memo ?? null,
          bill_amount_cents: String(bill.amount_cents),
          applied_amount_cents: String(allocation.applied_amount_cents),
        };
      });
    }

    try {
      const created = await prisma.$transaction(async (tx: any) => {
        const row = await tx.checkPayment.create({ data: {
          business_id: businessId,
          account_id: draftAccountId,
          vendor_id: vendorId,
          category_id: categoryId,
          check_number: checkNumber,
          issued_date: new Date(`${issuedDate}T00:00:00Z`),
          payee_name: payeeName,
          payee_address: payeeAddress || vendor?.address || null,
          amount_cents: amountCents,
          memo,
          purpose: normalized.rows.length ? "BILL_PAYMENT" : vendorId ? "VENDOR_PAYMENT" : "GENERAL",
          bill_allocations: allocationSnapshots,
          template_code: TEMPLATE_CODE,
          status: "DRAFT",
          created_by_user_id: userId,
        }, include: checkInclude });
        const next = incrementCheckNumber(checkNumber);
        if (next) {
          const currentSetting = await tx.checkPrintSetting.findFirst({ where: { business_id: businessId, account_id: draftAccountId } });
          const stored = normalizeCheckNumber(currentSetting?.next_check_number);
          if (currentSetting && (!stored || BigInt(stored) <= BigInt(checkNumber))) {
            await tx.checkPrintSetting.update({ where: { id: currentSetting.id }, data: { next_check_number: next, updated_at: new Date() } });
          }
        }
        return row;
      });
      await logActivity(prisma, {
        businessId,
        actorUserId: userId,
        scopeAccountId: draftAccountId,
        eventType: "CHECK_DRAFT_CREATED",
        payloadJson: { check_id: created.id, check_number: checkNumber, amount_cents: String(amountCents), vendor_id: vendorId },
      });
      return json(201, { ok: true, check: publicCheck(created) });
    } catch (error: any) {
      if (String(error?.code ?? "") === "P2002") return json(409, { ok: false, error: `Check ${checkNumber} is already recorded for this account` });
      throw error;
    }
  }

  if (method === "POST" && isUuid(checkId) && path === `/v1/businesses/${businessId}/checks/${checkId}/confirm-print`) {
    const existing = await prisma.checkPayment.findFirst({ where: { id: checkId, business_id: businessId }, include: checkInclude });
    if (!existing) return json(404, { ok: false, error: "Check not found" });
    const denied = await requireWrite(prisma, { businessId, accountId: existing.account_id, userId, role, endpoint: "POST /checks/{checkId}/confirm-print" });
    if (denied) return denied;
    if (existing.status === "VOIDED") return json(409, { ok: false, error: "A voided check cannot be printed" });

    if (existing.status === "PRINTED") {
      const updated = await prisma.checkPayment.update({
        where: { id: existing.id },
        data: { print_count: { increment: 1 }, last_printed_at: new Date(), updated_at: new Date() },
        include: checkInclude,
      });
      await logActivity(prisma, {
        businessId,
        actorUserId: userId,
        scopeAccountId: existing.account_id,
        eventType: "CHECK_REPRINTED",
        payloadJson: { check_id: existing.id, check_number: existing.check_number, print_count: updated.print_count },
      });
      return json(200, { ok: true, check: publicCheck(updated) });
    }

    const closed = await assertNotClosedPeriod({ prisma, businessId, dateInput: existing.issued_date });
    if (!closed.ok) return closed.response;

    const result = await prisma.$transaction(async (tx: any) => {
      const current = await tx.checkPayment.findFirst({ where: { id: checkId, business_id: businessId } });
      if (!current || current.status !== "DRAFT") return { ok: false, status: 409, error: "Check is no longer ready to confirm" };

      const snapshots = Array.isArray(current.bill_allocations) ? current.bill_allocations : [];
      const normalized = normalizeAllocations(snapshots, toBigInt(current.amount_cents));
      if (!normalized.ok) return { ok: false, status: 400, error: normalized.error };

      let categoryId = current.category_id ? String(current.category_id) : null;
      if (!categoryId && current.vendor_id) {
        const purchase = await tx.category.findFirst({
          where: { business_id: businessId, name: { equals: "Purchase", mode: "insensitive" }, archived_at: null },
          select: { id: true },
        });
        categoryId = purchase?.id ?? (await tx.category.create({ data: { business_id: businessId, name: "Purchase" }, select: { id: true } })).id;
      }

      if (normalized.rows.length) {
        const ids = normalized.rows.map((row) => row.bill_id);
        const bills = await tx.bill.findMany({
          where: { business_id: businessId, vendor_id: current.vendor_id, id: { in: ids }, voided_at: null },
          select: { id: true, amount_cents: true },
        });
        if (bills.length !== ids.length) return { ok: false, status: 409, error: "One or more selected bills are no longer available" };
        const appliedRows = await tx.billPaymentApplication.groupBy({
          by: ["bill_id"],
          where: { business_id: businessId, bill_id: { in: ids }, is_active: true },
          _sum: { applied_amount_cents: true },
        });
        const applied = new Map<string, bigint>(appliedRows.map((row: any) => [String(row.bill_id), toBigInt(row._sum?.applied_amount_cents)]));
        const requested = new Map<string, bigint>(normalized.rows.map((row) => [row.bill_id, row.applied_amount_cents]));
        for (const bill of bills) {
          if ((applied.get(String(bill.id)) ?? 0n) + (requested.get(String(bill.id)) ?? 0n) > toBigInt(bill.amount_cents)) {
            return { ok: false, status: 409, error: "A selected bill has already been paid or changed. Review the allocation before printing." };
          }
        }
      }

      const entryId = randomUUID();
      await tx.entry.create({
        data: {
          id: entryId,
          business_id: businessId,
          account_id: current.account_id,
          date: current.issued_date,
          payee: current.payee_name,
          memo: current.memo || `Check ${current.check_number}`,
          amount_cents: -toBigInt(current.amount_cents),
          type: "EXPENSE",
          method: "CHECK",
          category_id: categoryId,
          vendor_id: current.vendor_id,
          entry_kind: current.vendor_id ? "VENDOR_PAYMENT" : "GENERAL",
          status: "EXPECTED",
          deleted_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        },
      });

      for (const allocation of normalized.rows) {
        await tx.billPaymentApplication.create({
          data: {
            business_id: businessId,
            account_id: current.account_id,
            entry_id: entryId,
            bill_id: allocation.bill_id,
            applied_amount_cents: allocation.applied_amount_cents,
            applied_at: new Date(),
            created_by_user_id: userId,
            created_at: new Date(),
            is_active: true,
          },
        });
      }
      await updateBillsAfterApplicationChange(tx, businessId, normalized.rows.map((row) => row.bill_id));

      await tx.checkPayment.update({
        where: { id: current.id },
        data: {
          entry_id: entryId,
          category_id: categoryId,
          status: "PRINTED",
          print_count: { increment: 1 },
          last_printed_at: new Date(),
          confirmed_at: new Date(),
          updated_at: new Date(),
        },
      });

      const next = incrementCheckNumber(current.check_number);
      const setting = await tx.checkPrintSetting.findFirst({ where: { business_id: businessId, account_id: current.account_id } });
      if (next && setting) {
        const stored = normalizeCheckNumber(setting.next_check_number);
        if (!stored || BigInt(stored) <= BigInt(current.check_number)) {
          await tx.checkPrintSetting.update({ where: { id: setting.id }, data: { next_check_number: next, updated_at: new Date() } });
        }
      }
      return { ok: true };
    });
    if (!result.ok) return json(result.status ?? 409, { ok: false, error: result.error });
    const updated = await prisma.checkPayment.findFirst({ where: { id: checkId }, include: checkInclude });
    await logActivity(prisma, {
      businessId,
      actorUserId: userId,
      scopeAccountId: existing.account_id,
      eventType: "CHECK_PRINT_CONFIRMED",
      payloadJson: { check_id: existing.id, check_number: existing.check_number, amount_cents: String(existing.amount_cents), entry_id: updated?.entry_id },
    });
    return json(200, { ok: true, check: publicCheck(updated) });
  }

  if (method === "POST" && isUuid(checkId) && path === `/v1/businesses/${businessId}/checks/${checkId}/void`) {
    const input = body(event);
    if (!input) return json(400, { ok: false, error: "Invalid JSON body" });
    const reason = cleanText(input.reason, 300);
    if (reason.length < 3) return json(400, { ok: false, error: "Enter a brief reason for voiding this check" });
    const existing = await prisma.checkPayment.findFirst({ where: { id: checkId, business_id: businessId }, include: checkInclude });
    if (!existing) return json(404, { ok: false, error: "Check not found" });
    const denied = await requireWrite(prisma, { businessId, accountId: existing.account_id, userId, role, endpoint: "POST /checks/{checkId}/void" });
    if (denied) return denied;
    if (existing.status === "VOIDED") return json(200, { ok: true, check: publicCheck(existing) });
    const isCleared = !!existing.entry && (existing.entry.bankMatches.length > 0 || existing.entry.matchGroupEntries.length > 0);
    if (isCleared) return json(409, { ok: false, error: "This check has cleared the bank and cannot be voided" });
    if (existing.entry_id) {
      const closed = await assertNotClosedPeriod({ prisma, businessId, dateInput: existing.issued_date });
      if (!closed.ok) return closed.response;
    }

    await prisma.$transaction(async (tx: any) => {
      const activeApps = existing.entry_id
        ? await tx.billPaymentApplication.findMany({
            where: { business_id: businessId, entry_id: existing.entry_id, is_active: true },
            select: { id: true, bill_id: true },
          })
        : [];
      if (activeApps.length) {
        await tx.billPaymentApplication.updateMany({
          where: { id: { in: activeApps.map((item: any) => item.id) } },
          data: { is_active: false, voided_at: new Date(), voided_by_user_id: userId, void_reason: reason },
        });
        await updateBillsAfterApplicationChange(tx, businessId, Array.from(new Set(activeApps.map((item: any) => String(item.bill_id)))));
      }
      if (existing.entry_id) {
        await tx.entry.updateMany({
          where: { id: existing.entry_id, business_id: businessId, deleted_at: null },
          data: { deleted_at: new Date(), updated_at: new Date() },
        });
      }
      await tx.checkPayment.update({
        where: { id: existing.id },
        data: { status: "VOIDED", voided_at: new Date(), voided_by_user_id: userId, void_reason: reason, updated_at: new Date() },
      });
      const next = incrementCheckNumber(existing.check_number);
      const setting = await tx.checkPrintSetting.findFirst({ where: { business_id: businessId, account_id: existing.account_id } });
      if (next && setting) {
        const stored = normalizeCheckNumber(setting.next_check_number);
        if (!stored || BigInt(stored) <= BigInt(existing.check_number)) {
          await tx.checkPrintSetting.update({ where: { id: setting.id }, data: { next_check_number: next, updated_at: new Date() } });
        }
      }
    });
    const updated = await prisma.checkPayment.findFirst({ where: { id: checkId }, include: checkInclude });
    await logActivity(prisma, {
      businessId,
      actorUserId: userId,
      scopeAccountId: existing.account_id,
      eventType: "CHECK_VOIDED",
      payloadJson: { check_id: existing.id, check_number: existing.check_number, entry_id: existing.entry_id, reason },
    });
    return json(200, { ok: true, check: publicCheck(updated) });
  }

  return json(404, { ok: false, error: "Not Found", method, path });
}
