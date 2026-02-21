import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import { authorizeWrite } from "./lib/authz";
import { assertNotClosedPeriodForEntryIds } from "./lib/closedPeriods";

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
