import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import { randomUUID } from "node:crypto";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_key, value) => {
      if (typeof value === "bigint") return value.toString();

      if (
        value &&
        typeof value === "object" &&
        typeof (value as any).toJSON !== "function" &&
        value.constructor &&
        value.constructor.name === "Decimal"
      ) {
        return value.toString();
      }

      return value;
    }),
  };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

async function requireOwner(prisma: any, businessId: string, sub: string) {
  const membership = await prisma.userBusinessRole.findFirst({
    where: { user_id: sub, business_id: businessId },
    select: { role: true },
  });
  const role = String(membership?.role ?? "").toUpperCase();
  if (!role) return { ok: false as const, status: 403, error: "Forbidden (not a member of this business)" };
  if (role !== "OWNER") return { ok: false as const, status: 403, error: "Forbidden (requires OWNER)" };

  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, owner_user_id: true, name: true },
  });
  if (!biz) return { ok: false as const, status: 404, error: "Business not found" };
  if (String(biz.owner_user_id) !== String(sub)) {
    return { ok: false as const, status: 403, error: "Forbidden (only business owner can access this operation)" };
  }

  return { ok: true as const, business: biz };
}

async function safeQuery<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    console.error(`[businesses.backup] ${label} failed`, err?.message ?? err);
    return fallback;
  }
}

export async function handler(event: any) {
  const method = (event?.requestContext?.http?.method ?? "").toString().toUpperCase();
  const path = (event?.requestContext?.http?.path ?? "").toString();
  const businessId = (event?.pathParameters?.businessId ?? "").toString().trim();

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;

  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const prisma = await getPrisma();

  // GET /v1/businesses/{businessId}/usage  (minimal counts; membership required)
  if (method === "GET" && businessId && path?.endsWith(`/v1/businesses/${businessId}/usage`)) {
    const mem = await prisma.userBusinessRole.findFirst({
      where: { business_id: businessId, user_id: sub },
      select: { role: true },
    });
    if (!mem) return json(403, { ok: false, error: "Forbidden (not a member of this business)" });

    const [entries_count, accounts_count, members_count] = await Promise.all([
      prisma.entry.count({ where: { business_id: businessId, deleted_at: null } }),
      prisma.account.count({ where: { business_id: businessId, archived_at: null } }),
      prisma.userBusinessRole.count({ where: { business_id: businessId } }),
    ]);

    return json(200, {
      ok: true,
      usage: { entries_count, accounts_count, members_count },
    });
  }

  // GET /v1/businesses/{businessId}/backup (OWNER only)
  if (method === "GET" && businessId && path?.endsWith(`/v1/businesses/${businessId}/backup`)) {
    const authz = await requireOwner(prisma, businessId, sub);
    if (!authz.ok) return json(authz.status, { ok: false, error: authz.error });

    const p: any = prisma;

    const [
      business,
      members,
      rolePolicies,
      preferences,
      accounts,
      categories,
      entries,
      entryIssues,
      uploads,
      bankConnections,
      bankTransactions,
      bankMatches,
      matchGroups,
      matchGroupEntries,
      matchGroupBanks,
      closedPeriods,
      reconcileSnapshots,
      vendors,
      bills,
      billPaymentApplications,
      transfers,
      budgets,
      goals,
      activityLogs,
    ] = await Promise.all([
      safeQuery("business", () => p.business.findUnique({ where: { id: businessId } }), null),
      safeQuery(
        "members",
        () =>
          p.userBusinessRole.findMany({
            where: { business_id: businessId },
            orderBy: { created_at: "asc" },
          }),
        []
      ),
      safeQuery(
        "rolePolicies",
        () =>
          typeof p.rolePolicy?.findMany === "function"
            ? p.rolePolicy.findMany({
                where: { business_id: businessId },
                orderBy: { role: "asc" },
              })
            : Promise.resolve([]),
        []
      ),
      safeQuery(
        "preferences",
        () =>
          typeof p.bookkeepingPreference?.findUnique === "function"
            ? p.bookkeepingPreference.findUnique({
                where: { business_id: businessId },
              })
            : Promise.resolve(null),
        null
      ),
      safeQuery(
        "accounts",
        () =>
          p.account.findMany({
            where: { business_id: businessId },
            orderBy: [{ archived_at: "asc" }, { name: "asc" }],
          }),
        []
      ),
      safeQuery(
        "categories",
        () =>
          p.category.findMany({
            where: { business_id: businessId },
            orderBy: [{ archived_at: "asc" }, { name: "asc" }],
          }),
        []
      ),
      safeQuery(
        "entries",
        () =>
          p.entry.findMany({
            where: { business_id: businessId },
            orderBy: [{ date: "asc" }, { created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "entryIssues",
        () =>
          p.entryIssue.findMany({
            where: { business_id: businessId },
            orderBy: [{ created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "uploads",
        () =>
          p.upload.findMany({
            where: { business_id: businessId },
            orderBy: [{ created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "bankConnections",
        () =>
          p.bankConnection.findMany({
            where: { business_id: businessId },
            orderBy: [{ created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "bankTransactions",
        () =>
          p.bankTransaction.findMany({
            where: { business_id: businessId },
            orderBy: [{ date: "asc" }, { created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "bankMatches",
        () =>
          p.bankMatch.findMany({
            where: { business_id: businessId },
            orderBy: [{ created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "matchGroups",
        () =>
          p.matchGroup.findMany({
            where: { business_id: businessId },
            orderBy: [{ created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "matchGroupEntries",
        () =>
          p.matchGroupEntry.findMany({
            where: { business_id: businessId },
            orderBy: [{ created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "matchGroupBanks",
        () =>
          p.matchGroupBank.findMany({
            where: { business_id: businessId },
            orderBy: [{ created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "closedPeriods",
        () =>
          p.closedPeriod.findMany({
            where: { business_id: businessId },
            orderBy: [{ month: "asc" }],
          }),
        []
      ),
      safeQuery(
        "reconcileSnapshots",
        () =>
          p.reconcileSnapshot.findMany({
            where: { business_id: businessId },
            orderBy: [{ created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "vendors",
        () =>
          p.vendor.findMany({
            where: { business_id: businessId },
            orderBy: [{ archived_at: "asc" }, { name: "asc" }],
          }),
        []
      ),
      safeQuery(
        "bills",
        () =>
          p.bill.findMany({
            where: { business_id: businessId },
            orderBy: [{ invoice_date: "asc" }, { created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "billPaymentApplications",
        () =>
          p.billPaymentApplication.findMany({
            where: { business_id: businessId },
            orderBy: [{ created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "transfers",
        () =>
          p.transfer.findMany({
            where: { business_id: businessId },
            orderBy: [{ created_at: "asc" }],
          }),
        []
      ),
      safeQuery(
        "budgets",
        () =>
          typeof p.budget?.findMany === "function"
            ? p.budget.findMany({ where: { business_id: businessId } })
            : Promise.resolve([]),
        []
      ),
      safeQuery(
        "goals",
        () =>
          typeof p.goal?.findMany === "function"
            ? p.goal.findMany({
                where: { business_id: businessId },
                orderBy: [{ created_at: "asc" }],
              })
            : Promise.resolve([]),
        []
      ),
      safeQuery(
        "activityLogs",
        () =>
          p.activityLog.findMany({
            where: { business_id: businessId },
            orderBy: [{ created_at: "asc" }],
          }),
        []
      ),
    ]);

    return json(200, {
      ok: true,
      backup: {
        kind: "bynkbook_full_backup",
        version: 1,
        generated_at: new Date().toISOString(),
        business_id: businessId,
        business_name: authz.business.name,
        exported_by_user_id: sub,
        data: {
          business,
          members,
          role_policies: rolePolicies,
          bookkeeping_preferences: preferences,
          accounts,
          categories,
          entries,
          entry_issues: entryIssues,
          uploads,
          bank_connections: bankConnections,
          bank_transactions: bankTransactions,
          bank_matches: bankMatches,
          match_groups: matchGroups,
          match_group_entries: matchGroupEntries,
          match_group_banks: matchGroupBanks,
          closed_periods: closedPeriods,
          reconcile_snapshots: reconcileSnapshots,
          vendors,
          bills,
          bill_payment_applications: billPaymentApplications,
          transfers,
          budgets,
          goals,
          activity_logs: activityLogs,
        },
      },
    });
  }

  // POST /v1/businesses/{businessId}/reset (OWNER only)
  if (method === "POST" && businessId && path?.endsWith(`/v1/businesses/${businessId}/reset`)) {
    const authz = await requireOwner(prisma, businessId, sub);
    if (!authz.ok) return json(authz.status, { ok: false, error: authz.error });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const confirm = String(body?.confirm ?? "").trim().toUpperCase();
    if (confirm !== "RESET") {
      return json(400, { ok: false, error: 'Confirmation text must be "RESET"' });
    }

    const summary = await prisma.$transaction(async (tx: any) => {
      const [
        billPaymentApplications,
        bills,
        vendors,
        closedPeriods,
        reconcileSnapshots,
        matchGroupEntries,
        matchGroupBanks,
        matchGroups,
        bankMatches,
        bankTransactions,
        uploads,
        entryIssues,
        entries,
        transfers,
        bankConnections,
        budgets,
        goals,
        activityLogs,
      ] = await Promise.all([
        tx.billPaymentApplication.deleteMany({ where: { business_id: businessId } }),
        tx.bill.deleteMany({ where: { business_id: businessId } }),
        tx.vendor.deleteMany({ where: { business_id: businessId } }),
        tx.closedPeriod.deleteMany({ where: { business_id: businessId } }),
        tx.reconcileSnapshot.deleteMany({ where: { business_id: businessId } }),
        tx.matchGroupEntry.deleteMany({ where: { business_id: businessId } }),
        tx.matchGroupBank.deleteMany({ where: { business_id: businessId } }),
        tx.matchGroup.deleteMany({ where: { business_id: businessId } }),
        tx.bankMatch.deleteMany({ where: { business_id: businessId } }),
        tx.bankTransaction.deleteMany({ where: { business_id: businessId } }),
        tx.upload.deleteMany({ where: { business_id: businessId } }),
        tx.entryIssue.deleteMany({ where: { business_id: businessId } }),
        tx.entry.deleteMany({ where: { business_id: businessId } }),
        tx.transfer.deleteMany({ where: { business_id: businessId } }),
        tx.bankConnection.deleteMany({ where: { business_id: businessId } }),
        tx.budget.deleteMany({ where: { business_id: businessId } }),
        tx.goal.deleteMany({ where: { business_id: businessId } }),
        tx.activityLog.deleteMany({ where: { business_id: businessId } }),
      ]);

      await logActivity(tx, {
        businessId,
        actorUserId: sub,
        eventType: "BUSINESS_RESET",
        payloadJson: {
          business_name: authz.business.name,
          cleared: {
            bill_payment_applications: billPaymentApplications.count,
            bills: bills.count,
            vendors: vendors.count,
            closed_periods: closedPeriods.count,
            reconcile_snapshots: reconcileSnapshots.count,
            match_group_entries: matchGroupEntries.count,
            match_group_banks: matchGroupBanks.count,
            match_groups: matchGroups.count,
            bank_matches: bankMatches.count,
            bank_transactions: bankTransactions.count,
            uploads: uploads.count,
            entry_issues: entryIssues.count,
            entries: entries.count,
            transfers: transfers.count,
            bank_connections: bankConnections.count,
            budgets: budgets.count,
            goals: goals.count,
            prior_activity_logs: activityLogs.count,
          },
          preserved: ["business", "members", "accounts", "categories", "preferences", "role_policies", "invites"],
        },
      });

      return {
        bill_payment_applications: billPaymentApplications.count,
        bills: bills.count,
        vendors: vendors.count,
        closed_periods: closedPeriods.count,
        reconcile_snapshots: reconcileSnapshots.count,
        match_group_entries: matchGroupEntries.count,
        match_group_banks: matchGroupBanks.count,
        match_groups: matchGroups.count,
        bank_matches: bankMatches.count,
        bank_transactions: bankTransactions.count,
        uploads: uploads.count,
        entry_issues: entryIssues.count,
        entries: entries.count,
        transfers: transfers.count,
        bank_connections: bankConnections.count,
        budgets: budgets.count,
        goals: goals.count,
        prior_activity_logs: activityLogs.count,
      };
    });

    return json(200, {
      ok: true,
      reset: {
        business_id: businessId,
        business_name: authz.business.name,
        preserved: ["business", "members", "accounts", "categories", "preferences", "role_policies", "invites"],
        cleared: summary,
      },
    });
  }

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
        logo_upload_id: (r.business as any).logo_upload_id ?? null,
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

    // Prefill default categories (safe for existing data; no gating; no duplicates)
    // Uses @@unique([business_id, name]) + skipDuplicates.
    const DEFAULT_CATEGORIES = [
      "Advertising",
      "Bank Fees",
      "Fuel",
      "Insurance",
      "Loan Payment",
      "Maintenance",
      "Misc",
      "Marketing",
      "Office Supplies",
      "Payroll",
      "Purchase",
      "Rent",
      "Sale",
      "Service Charges",
      "Supplies",
      "Tax",
      "Travel",
      "Utilities",
      "Interest",
    ];

    try {
      await prisma.category.createMany({
        data: DEFAULT_CATEGORIES.map((n) => ({ business_id: businessId, name: n })),
        skipDuplicates: true,
      });
    } catch {
      // Best-effort: do not block business creation if seeding fails for any reason.
    }

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
        logo_upload_id: (row.business as any).logo_upload_id ?? null,
        industry: row.business.industry,
        currency: row.business.currency,
        timezone: row.business.timezone,
        fiscal_year_start_month: row.business.fiscal_year_start_month,
      },
    });
  }

  // DELETE /v1/businesses/{businessId} (OWNER only)
  if (method === "DELETE" && businessId && path.includes("/v1/businesses/")) {
    const authz = await requireOwner(prisma, businessId, sub);
    if (!authz.ok) return json(authz.status, { ok: false, error: authz.error });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const confirm = String(body?.confirm ?? "").trim().toUpperCase();
    if (confirm !== "DELETE") {
      return json(400, { ok: false, error: 'Confirmation text must be "DELETE"' });
    }

    await logActivity(prisma, {
      businessId,
      actorUserId: sub,
      eventType: "BUSINESS_DELETE",
      payloadJson: {
        business_name: authz.business.name,
      },
    });

    await prisma.business.delete({ where: { id: businessId } });
    return json(200, { ok: true });
  }
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
    if ("logo_upload_id" in body) patch.logo_upload_id = body.logo_upload_id == null ? null : String(body.logo_upload_id);
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
        logo_upload_id: (updated as any).logo_upload_id ?? null,
        industry: updated.industry,
        currency: updated.currency,
        timezone: updated.timezone,
        fiscal_year_start_month: updated.fiscal_year_start_month,
      },
    });
  }

  return json(404, { ok: false, error: "Not Found", method, path });
}
