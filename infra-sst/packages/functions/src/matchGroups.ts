import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import { authorizeWrite } from "./lib/authz";
import { assertNotClosedPeriodForEntryIds, normalizeToYmd, ymdToMonth } from "./lib/closedPeriods";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

async function requireAccountInBusiness(prisma: any, businessId: string, accountId: string) {
  const acct = await prisma.account.findFirst({
    where: { id: accountId, business_id: businessId },
    select: { id: true },
  });
  return !!acct;
}

// deny-by-default write permissions
function canWrite(role: string | null) {
  const r = (role ?? "").toString().trim().toUpperCase();
  return r === "OWNER" || r === "ADMIN" || r === "BOOKKEEPER" || r === "ACCOUNTANT";
}

function absBig(n: bigint) {
  return n < 0n ? -n : n;
}

function directionFromSignedCents(amountCents: bigint): "INFLOW" | "OUTFLOW" {
  return amountCents < 0n ? "OUTFLOW" : "INFLOW";
}

function normalizeDir(x: any): "INFLOW" | "OUTFLOW" | null {
  const s = (x ?? "").toString().trim().toUpperCase();
  if (s === "INFLOW") return "INFLOW";
  if (s === "OUTFLOW") return "OUTFLOW";
  return null;
}

function entryDateYmd(entry: any): string | null {
  return normalizeToYmd(entry?.date);
}

function entrySummary(entry: any, matchedBankId: string | null, closedMonths: Set<string>, groupIsActive: boolean) {
  const sourceBankTransactionId = String(entry?.sourceBankTransactionId ?? entry?.source_bank_transaction_id ?? "").trim();
  const ymd = entryDateYmd(entry);
  const month = ymd ? ymdToMonth(ymd) : "";
  const closedPeriodBlocked = !!month && closedMonths.has(month);

  const preserveReasons: string[] = [];
  if (entry?.deleted_at) preserveReasons.push("already_deleted");
  if (!sourceBankTransactionId) preserveReasons.push("missing_source_bank_transaction_id");
  if (matchedBankId && sourceBankTransactionId && sourceBankTransactionId !== matchedBankId) {
    preserveReasons.push("source_bank_transaction_id_mismatch");
  }
  if (entry?.sourceUploadId || entry?.source_upload_id) preserveReasons.push("source_upload_entry");
  if (entry?.transfer_id) preserveReasons.push("transfer_entry");
  if (entry?.is_adjustment) preserveReasons.push("adjustment_entry");

  const type = String(entry?.type ?? "").trim().toUpperCase();
  if (type !== "EXPENSE" && type !== "INCOME") preserveReasons.push("non_income_expense_type");

  const status = String(entry?.status ?? "").trim().toUpperCase();
  if (status !== "EXPECTED") preserveReasons.push("status_not_expected");

  const entryKind = String(entry?.entry_kind ?? "GENERAL").trim().toUpperCase();
  if (entryKind !== "GENERAL") preserveReasons.push("non_general_entry_kind");

  const isGeneratedFromBank =
    !!sourceBankTransactionId &&
    !!matchedBankId &&
    sourceBankTransactionId === matchedBankId;

  const safeToSoftDelete = isGeneratedFromBank && preserveReasons.length === 0;
  const willSoftDelete = safeToSoftDelete && !closedPeriodBlocked;
  const closedPeriodBlocksAction = closedPeriodBlocked && (safeToSoftDelete || groupIsActive);

  return {
    id: entry.id,
    date: ymd,
    payee: entry.payee ?? null,
    memo: entry.memo ?? null,
    amount_cents: entry.amount_cents,
    type: entry.type ?? null,
    status: entry.status ?? null,
    entry_kind: entry.entry_kind ?? null,
    source_bank_transaction_id: sourceBankTransactionId || null,
    deleted_at: entry.deleted_at ?? null,
    is_generated_from_bank: isGeneratedFromBank,
    safe_to_soft_delete: safeToSoftDelete,
    will_soft_delete: willSoftDelete,
    will_preserve: !willSoftDelete,
    preserve_reasons: willSoftDelete ? [] : preserveReasons.length ? preserveReasons : ["not_selected_for_soft_delete"],
    closed_period_blocked: closedPeriodBlocked,
    closed_period_blocks_action: closedPeriodBlocksAction,
  };
}

async function findRevertMatchGroup(prisma: any, args: {
  businessId: string;
  accountId: string;
  matchGroupId?: string | null;
  bankTransactionId?: string | null;
  entryId?: string | null;
}) {
  const matchGroupId = String(args.matchGroupId ?? "").trim();
  if (matchGroupId) {
    return prisma.matchGroup.findFirst({
      where: { id: matchGroupId, business_id: args.businessId, account_id: args.accountId },
      select: {
        id: true,
        direction: true,
        status: true,
        created_at: true,
        created_by_user_id: true,
        voided_at: true,
        voided_by_user_id: true,
        void_reason: true,
      },
    });
  }

  const candidateGroupIds = new Set<string>();
  const bankTransactionId = String(args.bankTransactionId ?? "").trim();
  if (bankTransactionId) {
    const bankLinks = await prisma.matchGroupBank.findMany({
      where: {
        business_id: args.businessId,
        account_id: args.accountId,
        bank_transaction_id: bankTransactionId,
      },
      select: { match_group_id: true },
    });
    for (const link of bankLinks) {
      const id = String(link?.match_group_id ?? "").trim();
      if (id) candidateGroupIds.add(id);
    }
  }

  const entryId = String(args.entryId ?? "").trim();
  if (entryId) {
    const entryLinks = await prisma.matchGroupEntry.findMany({
      where: {
        business_id: args.businessId,
        account_id: args.accountId,
        entry_id: entryId,
      },
      select: { match_group_id: true },
    });
    for (const link of entryLinks) {
      const id = String(link?.match_group_id ?? "").trim();
      if (id) candidateGroupIds.add(id);
    }
  }

  const ids = Array.from(candidateGroupIds);
  if (!ids.length) return null;

  const active = await prisma.matchGroup.findFirst({
    where: { id: { in: ids }, business_id: args.businessId, account_id: args.accountId, status: "ACTIVE" },
    orderBy: [{ created_at: "desc" }],
    select: {
      id: true,
      direction: true,
      status: true,
      created_at: true,
      created_by_user_id: true,
      voided_at: true,
      voided_by_user_id: true,
      void_reason: true,
    },
  });
  if (active) return active;

  return prisma.matchGroup.findFirst({
    where: { id: { in: ids }, business_id: args.businessId, account_id: args.accountId },
    orderBy: [{ voided_at: "desc" }, { created_at: "desc" }],
    select: {
      id: true,
      direction: true,
      status: true,
      created_at: true,
      created_by_user_id: true,
      voided_at: true,
      voided_by_user_id: true,
      void_reason: true,
    },
  });
}

async function buildRevertPreview(prisma: any, args: {
  businessId: string;
  accountId: string;
  matchGroupId?: string | null;
  bankTransactionId?: string | null;
  entryId?: string | null;
}) {
  const group = await findRevertMatchGroup(prisma, args);
  if (!group) {
    return {
      ok: false,
      statusCode: 404,
      body: { ok: false, code: "MATCH_GROUP_NOT_FOUND", error: "Match group not found" },
    };
  }

  const [bankLinks, entryLinks] = await Promise.all([
    prisma.matchGroupBank.findMany({
      where: { business_id: args.businessId, account_id: args.accountId, match_group_id: group.id },
      select: { match_group_id: true, bank_transaction_id: true, matched_amount_cents: true },
    }),
    prisma.matchGroupEntry.findMany({
      where: { business_id: args.businessId, account_id: args.accountId, match_group_id: group.id },
      select: { match_group_id: true, entry_id: true, matched_amount_cents: true },
    }),
  ]);

  const bankIds = bankLinks.map((b: any) => String(b?.bank_transaction_id ?? "").trim()).filter(Boolean);
  const entryIds = entryLinks.map((e: any) => String(e?.entry_id ?? "").trim()).filter(Boolean);

  const [bankRows, entryRows] = await Promise.all([
    bankIds.length
      ? prisma.bankTransaction.findMany({
          where: {
            business_id: args.businessId,
            account_id: args.accountId,
            id: { in: bankIds },
          },
          select: {
            id: true,
            posted_date: true,
            name: true,
            amount_cents: true,
            is_removed: true,
            source: true,
          },
        })
      : [],
    entryIds.length
      ? prisma.entry.findMany({
          where: {
            business_id: args.businessId,
            account_id: args.accountId,
            id: { in: entryIds },
          },
          select: {
            id: true,
            date: true,
            payee: true,
            memo: true,
            amount_cents: true,
            type: true,
            status: true,
            entry_kind: true,
            deleted_at: true,
            is_adjustment: true,
            transfer_id: true,
            sourceUploadId: true,
            sourceBankTransactionId: true,
          } as any,
        })
      : [],
  ]);

  const months = new Set<string>();
  for (const entry of entryRows) {
    const ymd = entryDateYmd(entry);
    if (ymd) months.add(ymdToMonth(ymd));
  }

  const closedPeriodRows = months.size
    ? await prisma.closedPeriod.findMany({
        where: { business_id: args.businessId, month: { in: Array.from(months) } },
        select: { month: true },
      })
    : [];
  const closedMonths = new Set<string>(closedPeriodRows.map((row: any) => String(row?.month ?? "").trim()).filter(Boolean));

  const matchedBankIdByEntryId = new Map<string, string | null>();
  const primaryBankId = bankIds.length === 1 ? bankIds[0] : null;
  for (const entry of entryRows) {
    const sourceBankTransactionId = String(entry?.sourceBankTransactionId ?? "").trim();
    matchedBankIdByEntryId.set(
      String(entry.id),
      sourceBankTransactionId && bankIds.includes(sourceBankTransactionId) ? sourceBankTransactionId : primaryBankId
    );
  }

  const groupIsActive = String(group?.status ?? "").toUpperCase() === "ACTIVE";
  const entries = entryRows.map((entry: any) =>
    entrySummary(entry, matchedBankIdByEntryId.get(String(entry.id)) ?? null, closedMonths, groupIsActive)
  );

  const generatedToSoftDelete = entries.filter((entry: any) => entry.will_soft_delete);
  const generatedBlockedByClosedPeriod = entries.filter((entry: any) => entry.safe_to_soft_delete && entry.closed_period_blocked);
  const groupVoidBlockedByClosedPeriod = groupIsActive
    ? entries.filter((entry: any) => entry.closed_period_blocked)
    : [];
  const closedPeriodBlockedEntries = Array.from(
    new Map(
      [...generatedBlockedByClosedPeriod, ...groupVoidBlockedByClosedPeriod].map((entry: any) => [String(entry.id), entry])
    ).values()
  );

  const blockReasons: string[] = [];
  if (!bankIds.length) blockReasons.push("match_group_has_no_bank_transaction");
  if (!entryIds.length) blockReasons.push("match_group_has_no_ledger_entry");
  if (closedPeriodBlockedEntries.length) blockReasons.push("closed_period");

  const actions: any[] = [];
  if (groupIsActive) {
    actions.push({ type: "VOID_MATCH_GROUP", match_group_id: group.id });
    actions.push({ type: "BANK_TRANSACTION_RETURNS_TO_UNMATCHED", bank_transaction_ids: bankIds });
  } else {
    actions.push({ type: "MATCH_GROUP_ALREADY_VOIDED", match_group_id: group.id });
  }

  for (const entry of generatedToSoftDelete) {
    actions.push({ type: "SOFT_DELETE_GENERATED_ENTRY", entry_id: entry.id });
  }
  for (const entry of entries.filter((e: any) => !e.will_soft_delete)) {
    actions.push({ type: "PRESERVE_LEDGER_ENTRY", entry_id: entry.id, reasons: entry.preserve_reasons });
  }

  const body = {
    ok: true,
    match_group: {
      id: group.id,
      direction: group.direction,
      status: group.status,
      created_at: group.created_at,
      created_by_user_id: group.created_by_user_id,
      voided_at: group.voided_at ?? null,
      voided_by_user_id: group.voided_by_user_id ?? null,
      void_reason: group.void_reason ?? null,
      is_active: groupIsActive,
    },
    bank_transaction: bankRows[0]
      ? {
          id: bankRows[0].id,
          posted_date: bankRows[0].posted_date,
          name: bankRows[0].name,
          amount_cents: bankRows[0].amount_cents,
          is_removed: bankRows[0].is_removed,
          source: bankRows[0].source ?? null,
        }
      : null,
    bank_transactions: bankRows.map((bank: any) => ({
      id: bank.id,
      posted_date: bank.posted_date,
      name: bank.name,
      amount_cents: bank.amount_cents,
      is_removed: bank.is_removed,
      source: bank.source ?? null,
    })),
    ledger_entries: entries,
    generated_entries_to_soft_delete: generatedToSoftDelete,
    manual_entries_preserved: entries.filter((entry: any) => !entry.will_soft_delete),
    closed_period_blocked: closedPeriodBlockedEntries.length > 0,
    closed_period_blocked_entry_ids: closedPeriodBlockedEntries.map((entry: any) => entry.id),
    blocked: blockReasons.length > 0,
    block_reasons: blockReasons,
    requires_confirmation: generatedToSoftDelete.length > 0,
    already_reverted:
      !groupIsActive &&
      generatedToSoftDelete.length === 0 &&
      entries.every((entry: any) => entry.deleted_at || !entry.safe_to_soft_delete),
    actions,
  };

  return { ok: true, statusCode: 200, body };
}

async function enforceWrite(prisma: any, args: {
  businessId: string;
  accountId: string;
  sub: string;
  role: string;
  actionKey: string;
  endpointForLog: string;
}) {
  if (!canWrite(args.role)) return { ok: false as const, resp: json(403, { ok: false, error: "Insufficient permissions" }) };

  const az = await authorizeWrite(prisma, {
    businessId: args.businessId,
    scopeAccountId: args.accountId,
    actorUserId: args.sub,
    actorRole: args.role,
    actionKey: args.actionKey,
    requiredLevel: "FULL",
    endpointForLog: args.endpointForLog,
  });

  if (!az.allowed) {
    return {
      ok: false as const,
      resp: json(403, {
        ok: false,
        error: "Policy denied",
        code: "POLICY_DENIED",
        actionKey: args.actionKey,
        requiredLevel: az.requiredLevel,
        policyValue: az.policyValue,
        policyKey: az.policyKey,
      }),
    };
  }

  return { ok: true as const, resp: null as any };
}

async function createGroupTx(tx: any, args: {
  businessId: string;
  accountId: string;
  sub: string;
  direction?: any;
  bankTransactionIds: string[];
  entryIds: string[];
}) {
  const businessId = args.businessId;
  const accountId = args.accountId;

  const bankIds = (args.bankTransactionIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);
  const entryIds = (args.entryIds ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);

  if (!bankIds.length) throw new Error("Missing bankTransactionIds");
  if (!entryIds.length) throw new Error("Missing entryIds");

  // Load bank txns (scoped)
  const banks = await tx.bankTransaction.findMany({
    where: {
      business_id: businessId,
      account_id: accountId,
      id: { in: bankIds },
      is_removed: false,
    },
    select: { id: true, amount_cents: true, posted_date: true },
  });
  if (banks.length !== bankIds.length) throw new Error("One or more bank transactions not found");

  // Load entries (scoped)
  const entries = await tx.entry.findMany({
    where: {
      business_id: businessId,
      account_id: accountId,
      id: { in: entryIds },
      deleted_at: null,
    },
    select: { id: true, amount_cents: true, is_adjustment: true },
  });
  if (entries.length !== entryIds.length) throw new Error("One or more entries not found");
  if (entries.some((e: any) => !!e.is_adjustment)) throw new Error("Cannot match adjustment entries");

  // Derive direction from first item (extra safety). If provided, must match.
  const derivedDir = directionFromSignedCents(BigInt(banks[0].amount_cents));
  const providedDir = normalizeDir(args.direction);
  if (providedDir && providedDir !== derivedDir) throw new Error("Provided direction does not match derived direction");
  const dir: "INFLOW" | "OUTFLOW" = providedDir ?? derivedDir;

  // Direction consistency: all banks + all entries must match group direction
  for (const b of banks) {
    const bdir = directionFromSignedCents(BigInt(b.amount_cents));
    if (bdir !== dir) throw new Error("Bank transaction direction mismatch");
  }
  for (const e of entries) {
    const edir = directionFromSignedCents(BigInt(e.amount_cents));
    if (edir !== dir) throw new Error("Entry direction mismatch");
  }

  // FULL MATCH ONLY + positive matched cents
  const bankRows = banks.map((b: any) => {
    const abs = absBig(BigInt(b.amount_cents));
    if (abs <= 0n) throw new Error("Bank transaction amount cannot be 0");
    return { bank_transaction_id: b.id, matched_amount_cents: abs };
  });

  const entryRows = entries.map((e: any) => {
    const abs = absBig(BigInt(e.amount_cents));
    if (abs <= 0n) throw new Error("Entry amount cannot be 0");
    return { entry_id: e.id, matched_amount_cents: abs };
  });

  const bankSum = bankRows.reduce((acc: bigint, r: any) => acc + BigInt(r.matched_amount_cents), 0n);
  const entrySum = entryRows.reduce((acc: bigint, r: any) => acc + BigInt(r.matched_amount_cents), 0n);

  // Balanced invariant (unsigned)
  if (bankSum !== entrySum) throw new Error("Group not balanced (bank sum must equal entry sum)");

  // Enforce one ACTIVE group per bank txn / entry (deterministic state)
  const existingBank = await tx.matchGroupBank.findFirst({
    where: {
      business_id: businessId,
      account_id: accountId,
      bank_transaction_id: { in: bankIds },
      matchGroup: { status: "ACTIVE", voided_at: null },
    },
    select: { id: true },
  });
  if (existingBank) throw new Error("One or more bank transactions already matched");

  const existingEntry = await tx.matchGroupEntry.findFirst({
    where: {
      business_id: businessId,
      account_id: accountId,
      entry_id: { in: entryIds },
      matchGroup: { status: "ACTIVE", voided_at: null },
    },
    select: { id: true },
  });
  if (existingEntry) throw new Error("One or more entries already matched");

  // Create group + children
  const group = await tx.matchGroup.create({
    data: {
      business_id: businessId,
      account_id: accountId,
      direction: dir,
      status: "ACTIVE",
      created_by_user_id: args.sub,
    },
    select: { id: true, direction: true, status: true, created_at: true },
  });

  await tx.matchGroupBank.createMany({
    data: bankRows.map((r: any) => ({
      match_group_id: group.id,
      business_id: businessId,
      account_id: accountId,
      bank_transaction_id: r.bank_transaction_id,
      matched_amount_cents: r.matched_amount_cents,
    })),
  });

  await tx.matchGroupEntry.createMany({
    data: entryRows.map((r: any) => ({
      match_group_id: group.id,
      business_id: businessId,
      account_id: accountId,
      entry_id: r.entry_id,
      matched_amount_cents: r.matched_amount_cents,
    })),
  });

  await logActivity(tx, {
    businessId,
    actorUserId: String(args.sub),
    scopeAccountId: accountId,
    eventType: "RECONCILE_MATCH_GROUP_CREATED",
    payloadJson: {
      match_group_id: group.id,
      direction: dir,
      bank_transaction_ids: bankIds,
      entry_ids: entryIds,
      bank_sum_cents: bankSum,
      entry_sum_cents: entrySum,
    },
  } as any);

  return group;
}

export async function handler(event: any) {
  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const businessId = (event?.pathParameters?.businessId ?? "").toString().trim();
  const accountId = (event?.pathParameters?.accountId ?? "").toString().trim();
  if (!businessId) return json(400, { ok: false, error: "Missing businessId" });
  if (!accountId) return json(400, { ok: false, error: "Missing accountId" });

  const prisma = await getPrisma();

  const role = await requireMembership(prisma, businessId, sub);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, businessId, accountId);
  if (!okAcct) return json(404, { ok: false, error: "Account not found in business" });

  const method = event?.requestContext?.http?.method ?? "GET";
  const path = (event?.rawPath ?? event?.requestContext?.http?.path ?? "").toString();

  const isBatch = path.endsWith("/match-groups/batch");
  const isVoid = path.includes("/match-groups/") && path.endsWith("/void");
  const isRevertPreview = method === "GET" && path.endsWith("/match-groups/revert-preview");
  const isRevertConfirm = method === "POST" && path.endsWith("/match-groups/revert");

  // -------------------------
  // GET revert preview
  // -------------------------
  if (isRevertPreview) {
    const q = event?.queryStringParameters ?? {};
    const preview = await buildRevertPreview(prisma, {
      businessId,
      accountId,
      matchGroupId: q?.matchGroupId ?? q?.match_group_id ?? null,
      bankTransactionId: q?.bankTransactionId ?? q?.bank_transaction_id ?? null,
      entryId: q?.entryId ?? q?.entry_id ?? null,
    });
    return json(preview.statusCode, preview.body);
  }

  // -------------------------
  // POST generated-entry revert
  // -------------------------
  if (isRevertConfirm) {
    const w = await enforceWrite(prisma, {
      businessId,
      accountId,
      sub,
      role,
      actionKey: "reconcile.matchGroup.revertGenerated",
      endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/match-groups/revert",
    });
    if (!w.ok) return w.resp;

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const preview = await buildRevertPreview(prisma, {
      businessId,
      accountId,
      matchGroupId: body?.matchGroupId ?? body?.match_group_id ?? null,
      bankTransactionId: body?.bankTransactionId ?? body?.bank_transaction_id ?? null,
      entryId: body?.entryId ?? body?.entry_id ?? null,
    });
    if (!preview.ok) return json(preview.statusCode, preview.body);

    const previewBody: any = preview.body;
    if (previewBody.blocked) {
      return json(409, {
        ok: false,
        code: previewBody.closed_period_blocked ? "CLOSED_PERIOD" : "REVERT_BLOCKED",
        error: previewBody.closed_period_blocked
          ? "This period is closed. Reopen period to modify."
          : "Revert is blocked.",
        preview: previewBody,
      });
    }

    const generatedToDelete = Array.isArray(previewBody.generated_entries_to_soft_delete)
      ? previewBody.generated_entries_to_soft_delete
      : [];
    const confirmSoftDelete = body?.confirmSoftDelete === true || body?.confirm_soft_delete === true;
    if (generatedToDelete.length > 0 && !confirmSoftDelete) {
      return json(400, {
        ok: false,
        code: "CONFIRMATION_REQUIRED",
        error: "Generated ledger entries will be soft-deleted. Confirm to continue.",
        preview: previewBody,
      });
    }

    const now = new Date();
    const matchGroupId = String(previewBody.match_group?.id ?? "").trim();
    const groupWasActive = previewBody.match_group?.is_active === true;
    const softDeleteEntries = generatedToDelete.map((entry: any) => ({
      id: String(entry.id),
      sourceBankTransactionId: String(entry.source_bank_transaction_id ?? ""),
    }));

    const result = await prisma.$transaction(async (tx: any) => {
      let voidedCount = 0;
      if (groupWasActive) {
        const voided = await tx.matchGroup.updateMany({
          where: {
            id: matchGroupId,
            business_id: businessId,
            account_id: accountId,
            status: "ACTIVE",
          },
          data: {
            status: "VOIDED",
            voided_at: now,
            voided_by_user_id: sub,
            void_reason: "Generated entry revert",
          },
        });
        voidedCount = Number(voided?.count ?? 0);
      }

      const softDeletedEntryIds: string[] = [];
      for (const entry of softDeleteEntries) {
        const updated = await tx.entry.updateMany({
          where: {
            id: entry.id,
            business_id: businessId,
            account_id: accountId,
            deleted_at: null,
            sourceBankTransactionId: entry.sourceBankTransactionId,
          } as any,
          data: {
            deleted_at: now,
            updated_at: now,
          },
        });
        if (Number(updated?.count ?? 0) > 0) softDeletedEntryIds.push(entry.id);
      }

      await logActivity(tx, {
        businessId,
        actorUserId: String(sub),
        scopeAccountId: accountId,
        eventType: "RECONCILE_GENERATED_ENTRY_REVERTED",
        payloadJson: {
          match_group_id: matchGroupId,
          bank_transaction_ids: (previewBody.bank_transactions ?? []).map((bank: any) => String(bank.id)),
          soft_deleted_entry_ids: softDeletedEntryIds,
          preserved_entry_ids: (previewBody.manual_entries_preserved ?? []).map((entry: any) => String(entry.id)),
          group_was_active: groupWasActive,
          voided_count: voidedCount,
        },
      });

      return { voidedCount, softDeletedEntryIds };
    });

    const after = await buildRevertPreview(prisma, {
      businessId,
      accountId,
      matchGroupId,
    });

    return json(200, {
      ok: true,
      match_group_id: matchGroupId,
      voided: result.voidedCount > 0,
      voided_count: result.voidedCount,
      soft_deleted_entry_ids: result.softDeletedEntryIds,
      already_reverted:
        !groupWasActive &&
        result.softDeletedEntryIds.length === 0 &&
        previewBody.already_reverted === true,
      preview: after.ok ? after.body : previewBody,
    });
  }

  // -------------------------
  // GET /match-groups (list active/all)
  // -------------------------
  if (method === "GET") {
    const q = event?.queryStringParameters ?? {};
    const status = (q?.status ?? "active").toString().trim().toUpperCase();
    const wantAll = status === "ALL";

      const groups = await prisma.matchGroup.findMany({
        where: {
          business_id: businessId,
          account_id: accountId,
          ...(wantAll ? {} : { status: "ACTIVE" }),
        },
        orderBy: [{ created_at: "desc" }],
        select: {
          id: true,
          direction: true,
          status: true,
          created_at: true,
          created_by_user_id: true,
          voided_at: true,
          voided_by_user_id: true,
          void_reason: true,
        },
      });

    const groupIds = groups.map((g: any) => g.id);
    const banks = groupIds.length
      ? await prisma.matchGroupBank.findMany({
          where: { business_id: businessId, account_id: accountId, match_group_id: { in: groupIds } },
          select: { match_group_id: true, bank_transaction_id: true, matched_amount_cents: true },
        })
      : [];

    const entries = groupIds.length
      ? await prisma.matchGroupEntry.findMany({
          where: { business_id: businessId, account_id: accountId, match_group_id: { in: groupIds } },
          select: { match_group_id: true, entry_id: true, matched_amount_cents: true },
        })
      : [];

    const banksByGroup = new Map<string, any[]>();
    for (const b of banks) {
      const arr = banksByGroup.get(b.match_group_id) ?? [];
      arr.push(b);
      banksByGroup.set(b.match_group_id, arr);
    }

    const entriesByGroup = new Map<string, any[]>();
    for (const e of entries) {
      const arr = entriesByGroup.get(e.match_group_id) ?? [];
      arr.push(e);
      entriesByGroup.set(e.match_group_id, arr);
    }

    const items = groups.map((g: any) => ({
      ...g,
      banks: banksByGroup.get(g.id) ?? [],
      entries: entriesByGroup.get(g.id) ?? [],
    }));

    return json(200, { ok: true, items });
  }

  // -------------------------
  // POST void
  // -------------------------
  if (method === "POST" && isVoid) {
    const w = await enforceWrite(prisma, {
      businessId,
      accountId,
      sub,
      role,
      actionKey: "reconcile.matchGroup.void",
      endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/match-groups/{matchGroupId}/void",
    });
    if (!w.ok) return w.resp;

    const matchGroupId = (event?.pathParameters?.matchGroupId ?? "").toString().trim();
    if (!matchGroupId) return json(400, { ok: false, error: "Missing matchGroupId" });

    let body: any = {};
    try {
      body = event?.body ? JSON.parse(event.body) : {};
    } catch {
      body = {};
    }
    const reason = (body?.reason ?? "").toString().trim();

    // Closed period enforcement: void affects entry matching state -> block if ANY involved entry.date is closed
    const mgEntries = await prisma.matchGroupEntry.findMany({
      where: { business_id: businessId, account_id: accountId, match_group_id: matchGroupId },
      select: { entry_id: true },
    });
    const entryIdsForVoid = mgEntries.map((r: any) => String(r.entry_id ?? "").trim()).filter(Boolean);
    const cp = await assertNotClosedPeriodForEntryIds({ prisma, businessId, entryIds: entryIdsForVoid });
    if (!cp.ok) return cp.response;

    const updated = await prisma.$transaction(async (tx: any) => {
      const g = await tx.matchGroup.findFirst({
        where: { id: matchGroupId, business_id: businessId, account_id: accountId },
        select: { id: true, status: true },
      });
      if (!g) throw new Error("Match group not found");
      if (g.status !== "ACTIVE") throw new Error("Match group already voided");

      const u = await tx.matchGroup.update({
        where: { id: matchGroupId },
        data: {
          status: "VOIDED",
          voided_at: new Date(),
          voided_by_user_id: sub,
          void_reason: reason || null,
        },
        select: { id: true, status: true, voided_at: true },
      });

      await logActivity(tx, {
        businessId,
        actorUserId: String(sub),
        scopeAccountId: accountId,
        eventType: "RECONCILE_MATCH_GROUP_VOIDED",
        payloadJson: { match_group_id: matchGroupId, reason: reason || null },
      } as any);

      return u;
    });

    return json(200, { ok: true, match_group: updated });
  }

  // -------------------------
  // POST create / batch create
  // -------------------------
  if (method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  const w = await enforceWrite(prisma, {
    businessId,
    accountId,
    sub,
    role,
    actionKey: isBatch ? "reconcile.matchGroup.batchCreate" : "reconcile.matchGroup.create",
    endpointForLog: isBatch
      ? "POST /v1/businesses/{businessId}/accounts/{accountId}/match-groups/batch"
      : "POST /v1/businesses/{businessId}/accounts/{accountId}/match-groups",
  });
  if (!w.ok) return w.resp;

  let body: any = {};
  try {
    body = event?.body ? JSON.parse(event.body) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  if (isBatch) {
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return json(400, { ok: false, error: "Missing items" });

    // Closed period enforcement: batch must fail as a whole if ANY involved entry.date is closed
    const allEntryIds: string[] = [];
    for (const it of items) {
      const ids = Array.isArray(it?.entryIds) ? it.entryIds : Array.isArray(it?.entry_ids) ? it.entry_ids : [];
      for (const id of ids) {
        const s = String(id ?? "").trim();
        if (s) allEntryIds.push(s);
      }
    }
    const cp = await assertNotClosedPeriodForEntryIds({ prisma, businessId, entryIds: allEntryIds });
    if (!cp.ok) return cp.response;

    const results: any[] = [];
    let okN = 0;
    let failN = 0;

    for (const it of items) {
      const client_id = String(it?.client_id ?? it?.clientId ?? "").trim();
      if (!client_id) {
        failN += 1;
        results.push({ client_id: "", ok: false, error: "Missing client_id" });
        continue;
      }

      try {
        const g = await prisma.$transaction(async (tx: any) => {
          return createGroupTx(tx, {
            businessId,
            accountId,
            sub,
            direction: it?.direction,
            bankTransactionIds: it?.bankTransactionIds ?? it?.bank_transaction_ids ?? [],
            entryIds: it?.entryIds ?? it?.entry_ids ?? [],
          });
        });

        okN += 1;
        results.push({ client_id, ok: true, match_group_id: g.id });
      } catch (e: any) {
        failN += 1;
        results.push({ client_id, ok: false, error: e?.message ?? "Create failed" });
      }
    }

    return json(200, { ok: true, results, summary: { ok: okN, failed: failN, total: okN + failN } });
  }

  // Single create
  const entryIdsIn = body?.entryIds ?? body?.entry_ids ?? [];
  const cp = await assertNotClosedPeriodForEntryIds({ prisma, businessId, entryIds: entryIdsIn });
  if (!cp.ok) return cp.response;

  try {
    const g = await prisma.$transaction(async (tx: any) => {
      return createGroupTx(tx, {
        businessId,
        accountId,
        sub,
        direction: body?.direction,
        bankTransactionIds: body?.bankTransactionIds ?? body?.bank_transaction_ids ?? [],
        entryIds: body?.entryIds ?? body?.entry_ids ?? [],
      });
    });
    return json(201, { ok: true, match_group_id: g.id });
  } catch (e: any) {
    return json(400, { ok: false, error: e?.message ?? "Create failed" });
  }
}
