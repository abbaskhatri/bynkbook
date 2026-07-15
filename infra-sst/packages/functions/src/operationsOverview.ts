import { randomUUID } from "node:crypto";

import { getPrisma } from "./lib/db";
import { actionableUncategorizedEntryWhere } from "./lib/uncategorizedEntries";
import { authorizeWrite } from "./lib/authz";
import { assertNotClosedPeriod } from "./lib/closedPeriods";
import { logActivity } from "./lib/activityLog";
import { acquireTransactionAdvisoryLock } from "./lib/advisoryLock";

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
  };
}

function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function getPath(event: any) {
  return String(event?.requestContext?.http?.path ?? "");
}

function getMethod(event: any) {
  return String(event?.requestContext?.http?.method ?? "GET").toUpperCase();
}

function readBody(event: any) {
  try {
    return event?.body ? JSON.parse(event.body) : {};
  } catch {
    return null;
  }
}

function ymd(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateOnly(value: any) {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function daysBetween(left: any, right: any) {
  const a = new Date(`${dateOnly(left)}T00:00:00Z`).getTime();
  const b = new Date(`${dateOnly(right)}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 999;
  return Math.round(Math.abs(a - b) / 86_400_000);
}

function mondayUtc(value: Date) {
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1);
  return date;
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * 86_400_000);
}

function normalizePayee(value: any) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function toNumber(value: any) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function freshnessState(connection: any, now: Date) {
  if (!connection) return "NOT_CONNECTED";
  const status = String(connection.status ?? "CONNECTED").toUpperCase();
  if (["ERROR", "DISCONNECTED", "ITEM_LOGIN_REQUIRED", "NEEDS_ATTENTION"].includes(status)) return "NEEDS_ATTENTION";
  if (status === "SYNCING" || status === "PENDING_SYNC" || connection.sync_lock_expires_at) return "SYNCING";
  if (!connection.last_sync_at) return "NEVER_SYNCED";
  const ageHours = Math.max(0, (now.getTime() - new Date(connection.last_sync_at).getTime()) / 3_600_000);
  return ageHours > 48 ? "STALE" : "HEALTHY";
}

function transferLanguage(left: any, right: any) {
  const text = `${left?.name ?? ""} ${right?.name ?? ""}`.toLowerCase();
  return /\b(transfer|online banking|internal|payment|xfer|card payment)\b/.test(text);
}

async function requireMembership(prisma: any, businessId: string, userId: string) {
  const row = await prisma.userBusinessRole.findFirst({
    where: { business_id: businessId, user_id: userId },
    select: { role: true },
  });
  return row?.role ?? null;
}

async function loadTransferCandidates(prisma: any, businessId: string) {
  const rows: any[] = await prisma.$queryRaw`
    SELECT
      outbound.id AS outbound_id,
      outbound.account_id AS outbound_account_id,
      outbound.posted_date AS outbound_date,
      outbound.amount_cents AS outbound_amount_cents,
      outbound.name AS outbound_name,
      inbound.id AS inbound_id,
      inbound.account_id AS inbound_account_id,
      inbound.posted_date AS inbound_date,
      inbound.amount_cents AS inbound_amount_cents,
      inbound.name AS inbound_name,
      from_account.name AS from_account_name,
      to_account.name AS to_account_name
    FROM bank_transaction outbound
    INNER JOIN bank_transaction inbound
      ON inbound.business_id = outbound.business_id
     AND inbound.account_id <> outbound.account_id
     AND inbound.amount_cents = ABS(outbound.amount_cents)
     AND ABS(inbound.posted_date - outbound.posted_date) <= 3
    INNER JOIN account from_account
      ON from_account.id = outbound.account_id
     AND from_account.business_id = outbound.business_id
    INNER JOIN account to_account
      ON to_account.id = inbound.account_id
     AND to_account.business_id = inbound.business_id
    WHERE outbound.business_id = ${businessId}::uuid
      AND outbound.amount_cents < 0
      AND inbound.amount_cents > 0
      AND outbound.is_removed = false
      AND inbound.is_removed = false
      AND outbound.is_pending = false
      AND inbound.is_pending = false
      AND from_account.archived_at IS NULL
      AND to_account.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM match_group_bank mgb
        INNER JOIN match_group mg ON mg.id = mgb.match_group_id AND mg.status = 'ACTIVE'
        WHERE mgb.business_id = outbound.business_id AND mgb.bank_transaction_id = outbound.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM match_group_bank mgb
        INNER JOIN match_group mg ON mg.id = mgb.match_group_id AND mg.status = 'ACTIVE'
        WHERE mgb.business_id = inbound.business_id AND mgb.bank_transaction_id = inbound.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM bank_match bm
        WHERE bm.business_id = outbound.business_id AND bm.bank_transaction_id = outbound.id AND bm.voided_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM bank_match bm
        WHERE bm.business_id = inbound.business_id AND bm.bank_transaction_id = inbound.id AND bm.voided_at IS NULL
      )
    ORDER BY GREATEST(outbound.posted_date, inbound.posted_date) DESC
    LIMIT 30
  `;

  return rows.map((row) => {
    const distance = daysBetween(row.outbound_date, row.inbound_date);
    const hasTransferLanguage = transferLanguage(
      { name: row.outbound_name },
      { name: row.inbound_name }
    );
    const confidence = distance <= 1 && hasTransferLanguage ? "HIGH" : distance <= 1 || hasTransferLanguage ? "MEDIUM" : "REVIEW";
    return {
      id: `${row.outbound_id}:${row.inbound_id}`,
      outbound_bank_transaction_id: String(row.outbound_id),
      inbound_bank_transaction_id: String(row.inbound_id),
      from_account_id: String(row.outbound_account_id),
      from_account_name: String(row.from_account_name ?? "Account"),
      to_account_id: String(row.inbound_account_id),
      to_account_name: String(row.to_account_name ?? "Account"),
      outbound_date: dateOnly(row.outbound_date),
      inbound_date: dateOnly(row.inbound_date),
      amount_cents: String(row.inbound_amount_cents),
      outbound_name: String(row.outbound_name ?? ""),
      inbound_name: String(row.inbound_name ?? ""),
      date_distance_days: distance,
      confidence,
      reason: hasTransferLanguage
        ? `Equal and opposite bank activity ${distance === 0 ? "on the same day" : `${distance} day${distance === 1 ? "" : "s"} apart`} with transfer language.`
        : `Equal and opposite bank activity ${distance === 0 ? "on the same day" : `${distance} day${distance === 1 ? "" : "s"} apart`}.`,
    };
  });
}

export function buildForecast(entries: any[], startingCashCents: bigint, weeks = 13) {
  const groups = new Map<string, any[]>();
  for (const entry of entries) {
    const merchant = normalizePayee(entry.payee);
    if (!merchant) continue;
    const key = `${String(entry.type ?? "").toUpperCase()}:${merchant}`;
    const list = groups.get(key) ?? [];
    list.push(entry);
    groups.set(key, list);
  }

  const recurring: any[] = [];
  for (const [key, list] of groups) {
    if (list.length < 3) continue;
    const sorted = [...list].sort((a, b) => dateOnly(a.date).localeCompare(dateOnly(b.date)));
    const gaps: number[] = [];
    for (let index = 1; index < sorted.length; index += 1) {
      gaps.push(daysBetween(sorted[index - 1].date, sorted[index].date));
    }
    const cadenceDays = median(gaps.filter((gap) => gap > 0 && gap <= 62));
    if (cadenceDays < 5 || cadenceDays > 45) continue;
    const deviation = gaps.length
      ? gaps.reduce((sum, gap) => sum + Math.abs(gap - cadenceDays), 0) / gaps.length
      : 99;
    if (deviation > Math.max(7, cadenceDays * 0.35)) continue;

    const amounts = sorted.map((entry) => toNumber(entry.amount_cents));
    recurring.push({
      key,
      payee: String(sorted[sorted.length - 1]?.payee ?? "Recurring activity"),
      type: String(sorted[sorted.length - 1]?.type ?? ""),
      amount_cents: String(Math.round(median(amounts))),
      cadence_days: cadenceDays,
      observations: sorted.length,
      last_date: dateOnly(sorted[sorted.length - 1]?.date),
      confidence: sorted.length >= 5 && deviation <= 3 ? "HIGH" : "MEDIUM",
    });
  }

  const start = mondayUtc(new Date());
  const horizonEnd = addDays(start, weeks * 7);
  const buckets = Array.from({ length: weeks }, (_unused, index) => ({
    week_start: ymd(addDays(start, index * 7)),
    cash_in_cents: 0,
    cash_out_cents: 0,
    net_cents: 0,
    ending_cash_cents: 0,
    events: 0,
  }));

  for (const item of recurring) {
    let next = addDays(new Date(`${item.last_date}T00:00:00Z`), item.cadence_days);
    while (next < start) next = addDays(next, item.cadence_days);
    while (next < horizonEnd) {
      const bucketIndex = Math.floor((next.getTime() - start.getTime()) / (7 * 86_400_000));
      const bucket = buckets[bucketIndex];
      if (bucket) {
        const amount = toNumber(item.amount_cents);
        if (amount >= 0) bucket.cash_in_cents += amount;
        else bucket.cash_out_cents += Math.abs(amount);
        bucket.events += 1;
      }
      next = addDays(next, item.cadence_days);
    }
  }

  let running = toNumber(startingCashCents);
  for (const bucket of buckets) {
    bucket.net_cents = bucket.cash_in_cents - bucket.cash_out_cents;
    running += bucket.net_cents;
    bucket.ending_cash_cents = running;
  }

  return {
    starting_cash_cents: String(startingCashCents),
    weeks: buckets.map((bucket) => ({
      ...bucket,
      cash_in_cents: String(bucket.cash_in_cents),
      cash_out_cents: String(bucket.cash_out_cents),
      net_cents: String(bucket.net_cents),
      ending_cash_cents: String(bucket.ending_cash_cents),
    })),
    recurring: recurring
      .sort((a, b) => Math.abs(toNumber(b.amount_cents)) - Math.abs(toNumber(a.amount_cents)))
      .slice(0, 20),
    methodology: "Projects repeated posted activity from checking, savings, and cash ledgers with 3+ observations and stable 5–45 day cadence. Credit cards, transfers, and one-off activity are excluded.",
  };
}

async function getOverview(prisma: any, businessId: string, weeks: number) {
  const now = new Date();
  const historyStart = addDays(now, -240);
  const [
    accounts,
    connections,
    ledgerBalances,
    bankCounts,
    unmatchedRows,
    issueCount,
    uncategorizedCount,
    categoryMemory,
    recentEntries,
    transferCandidates,
  ] = await Promise.all([
    prisma.account.findMany({
      where: { business_id: businessId, archived_at: null },
      select: { id: true, name: true, type: true, institution_name: true, last4: true },
      orderBy: { name: "asc" },
    }),
    prisma.bankConnection.findMany({
      where: { business_id: businessId },
      select: {
        account_id: true,
        status: true,
        error_code: true,
        error_message: true,
        institution_name: true,
        plaid_mask: true,
        last_sync_at: true,
        last_known_balance_cents: true,
        last_known_balance_at: true,
        has_new_transactions: true,
        new_accounts_available: true,
        sync_lock_expires_at: true,
      },
    }),
    prisma.entry.groupBy({
      by: ["account_id"],
      where: { business_id: businessId, deleted_at: null },
      _sum: { amount_cents: true },
    }),
    prisma.bankTransaction.groupBy({
      by: ["account_id", "is_pending"],
      where: { business_id: businessId, is_removed: false },
      _count: { _all: true },
    }),
    prisma.$queryRaw`
      SELECT bt.account_id, COUNT(*)::int AS count
      FROM bank_transaction bt
      WHERE bt.business_id = ${businessId}::uuid
        AND bt.is_removed = false
        AND bt.is_pending = false
        AND NOT EXISTS (
          SELECT 1 FROM match_group_bank mgb
          INNER JOIN match_group mg ON mg.id = mgb.match_group_id AND mg.status = 'ACTIVE'
          WHERE mgb.business_id = bt.business_id AND mgb.bank_transaction_id = bt.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM bank_match bm
          WHERE bm.business_id = bt.business_id AND bm.bank_transaction_id = bt.id AND bm.voided_at IS NULL
        )
      GROUP BY bt.account_id
    `,
    prisma.entryIssue.count({ where: { business_id: businessId, status: "OPEN" } }),
    prisma.entry.count({
      where: actionableUncategorizedEntryWhere({ businessId, activeAccountsOnly: true }),
    }),
    prisma.categoryMemory.findMany({
      where: { business_id: businessId },
      select: { confidence_score: true, accept_count: true, override_count: true },
      take: 5000,
    }),
    prisma.entry.findMany({
      where: {
        business_id: businessId,
        deleted_at: null,
        type: { in: ["INCOME", "EXPENSE"] },
        status: "CLEARED",
        date: { gte: historyStart },
      },
      select: { account_id: true, date: true, payee: true, amount_cents: true, type: true },
      orderBy: { date: "asc" },
      take: 5000,
    }),
    loadTransferCandidates(prisma, businessId).catch(() => []),
  ]);

  const connectionByAccount = new Map<string, any>(
    (connections as any[]).map((connection: any) => [String(connection.account_id), connection] as [string, any])
  );
  const balanceByAccount = new Map<string, bigint>(
    (ledgerBalances as any[]).map(
      (row: any) => [String(row.account_id), BigInt(row?._sum?.amount_cents ?? 0)] as [string, bigint]
    )
  );
  const countsByAccount = new Map<string, { pending: number; posted: number }>();
  for (const row of bankCounts as any[]) {
    const key = String(row.account_id);
    const current = countsByAccount.get(key) ?? { pending: 0, posted: 0 };
    if (row.is_pending) current.pending += Number(row?._count?._all ?? 0);
    else current.posted += Number(row?._count?._all ?? 0);
    countsByAccount.set(key, current);
  }
  const unmatchedByAccount = new Map((unmatchedRows as any[]).map((row) => [String(row.account_id), Number(row.count ?? 0)]));

  const accountRows: any[] = (accounts as any[]).map((account: any) => {
    const connection = connectionByAccount.get(String(account.id));
    const state = freshnessState(connection, now);
    const lastSyncAt = connection?.last_sync_at ? new Date(connection.last_sync_at) : null;
    const syncAgeHours = lastSyncAt ? Math.max(0, Math.round((now.getTime() - lastSyncAt.getTime()) / 3_600_000)) : null;
    const counts = countsByAccount.get(String(account.id)) ?? { pending: 0, posted: 0 };
    return {
      account_id: String(account.id),
      account_name: String(account.name),
      account_type: String(account.type),
      institution_name: String(connection?.institution_name ?? account.institution_name ?? ""),
      mask: String(connection?.plaid_mask ?? account.last4 ?? ""),
      connected: !!connection,
      connection_status: String(connection?.status ?? "NOT_CONNECTED"),
      health: state,
      error_code: connection?.error_code ?? null,
      error_message: connection?.error_message ?? null,
      last_sync_at: lastSyncAt?.toISOString() ?? null,
      sync_age_hours: syncAgeHours,
      has_new_transactions: Boolean(connection?.has_new_transactions),
      new_accounts_available: Boolean(connection?.new_accounts_available),
      ledger_balance_cents: String(balanceByAccount.get(String(account.id)) ?? 0n),
      bank_balance_cents: connection?.last_known_balance_cents == null ? null : String(connection.last_known_balance_cents),
      bank_balance_at: connection?.last_known_balance_at ? new Date(connection.last_known_balance_at).toISOString() : null,
      pending_count: counts.pending,
      posted_count: counts.posted,
      unmatched_count: unmatchedByAccount.get(String(account.id)) ?? 0,
    };
  });

  const cashAccountIds = new Set(
    (accounts as any[])
      .filter((account: any) => ["CHECKING", "SAVINGS", "CASH"].includes(String(account.type).toUpperCase()))
      .map((account: any) => String(account.id))
  );
  const totalLedgerCash = Array.from(cashAccountIds).reduce<bigint>(
    (sum, accountId) => sum + (balanceByAccount.get(accountId) ?? 0n),
    0n
  );
  const cashEntries = (recentEntries as any[]).filter((entry: any) => cashAccountIds.has(String(entry.account_id)));
  const pendingCount = accountRows.reduce((sum: number, account: any) => sum + Number(account.pending_count ?? 0), 0);
  const unmatchedCount = accountRows.reduce((sum: number, account: any) => sum + Number(account.unmatched_count ?? 0), 0);
  // A deliberately manual ledger is not a broken bank connection and must not
  // block month-end close. Only connected feeds whose own state needs review do.
  const unhealthyCount = accountRows.filter(
    (account) => account.connected && !["HEALTHY", "SYNCING"].includes(account.health)
  ).length;
  const notConnectedCount = accountRows.filter((account) => !account.connected).length;
  const accepted = categoryMemory.reduce((sum: number, row: any) => sum + Number(row.accept_count ?? 0), 0);
  const overridden = categoryMemory.reduce((sum: number, row: any) => sum + Number(row.override_count ?? 0), 0);
  const safeRules = categoryMemory.filter((row: any) => Number(row.confidence_score ?? 0) >= 0.9 && Number(row.accept_count ?? 0) >= 2).length;

  const closeBlockers = {
    open_issues: Number(issueCount),
    uncategorized_entries: Number(uncategorizedCount),
    unmatched_bank_transactions: unmatchedCount,
    pending_bank_transactions: pendingCount,
    unhealthy_bank_connections: unhealthyCount,
  };
  const closeReady = Object.values(closeBlockers).every((count) => count === 0);

  return {
    ok: true,
    generated_at: now.toISOString(),
    bank_health: {
      healthy_count: accountRows.filter((account) => account.health === "HEALTHY").length,
      attention_count: unhealthyCount,
      not_connected_count: notConnectedCount,
      pending_count: pendingCount,
      accounts: accountRows,
    },
    close_readiness: { ready: closeReady, blockers: closeBlockers },
    categorization: {
      uncategorized_count: Number(uncategorizedCount),
      learned_merchant_rules: categoryMemory.length,
      safe_reuse_rules: safeRules,
      accepted_feedback: accepted,
      overridden_feedback: overridden,
      acceptance_rate: accepted + overridden > 0 ? Math.round((accepted / (accepted + overridden)) * 100) : null,
    },
    transfer_candidates: transferCandidates,
    forecast: buildForecast(cashEntries, totalLedgerCash, weeks),
  };
}

async function applyTransferPair(prisma: any, event: any, businessId: string, userId: string, role: string) {
  const body = readBody(event);
  if (!body) return json(400, { ok: false, error: "Invalid JSON body" });
  if (body?.confirmed !== true) {
    return json(400, { ok: false, code: "CONFIRMATION_REQUIRED", error: "Confirm this bank pair before creating the transfer." });
  }

  const outboundId = String(body?.outbound_bank_transaction_id ?? "").trim();
  const inboundId = String(body?.inbound_bank_transaction_id ?? "").trim();
  if (!outboundId || !inboundId || outboundId === inboundId) {
    return json(400, { ok: false, error: "Two different bank transaction IDs are required." });
  }

  const rows = await prisma.bankTransaction.findMany({
    where: { business_id: businessId, id: { in: [outboundId, inboundId] } },
    select: { id: true, account_id: true, posted_date: true, amount_cents: true, name: true, is_pending: true, is_removed: true },
  });
  if (rows.length !== 2) return json(404, { ok: false, error: "Bank transaction pair not found." });
  const outbound = rows.find((row: any) => BigInt(row.amount_cents) < 0n);
  const inbound = rows.find((row: any) => BigInt(row.amount_cents) > 0n);
  if (!outbound || !inbound || String(outbound.account_id) === String(inbound.account_id)) {
    return json(409, { ok: false, code: "NOT_TRANSFER_PAIR", error: "The selected rows are not opposite sides of an inter-account transfer." });
  }
  if (outbound.is_pending || inbound.is_pending || outbound.is_removed || inbound.is_removed) {
    return json(409, { ok: false, code: "BANK_TRANSACTION_NOT_ACTIONABLE", error: "Both bank transactions must be posted and active." });
  }
  if (-BigInt(outbound.amount_cents) !== BigInt(inbound.amount_cents) || daysBetween(outbound.posted_date, inbound.posted_date) > 3) {
    return json(409, { ok: false, code: "NOT_TRANSFER_PAIR", error: "Transfer pairs must have equal and opposite amounts within three days." });
  }

  const authorization = await authorizeWrite(prisma, {
    businessId,
    scopeAccountId: String(outbound.account_id),
    actorUserId: userId,
    actorRole: role,
    actionKey: "ledger.transfer.write",
    requiredLevel: "FULL",
    endpointForLog: "POST /operations/transfer-pairs",
  });
  if (!authorization.allowed) return json(403, { ok: false, code: "POLICY_DENIED", error: "Policy denied" });

  for (const row of [outbound, inbound]) {
    const closed = await assertNotClosedPeriod({ prisma, businessId, dateInput: row.posted_date });
    if (!closed.ok) return closed.response;
  }

  const alreadyMatched: any[] = await prisma.$queryRaw`
    SELECT bt.id
    FROM bank_transaction bt
    WHERE bt.business_id = ${businessId}::uuid
      AND bt.id IN (${outboundId}::uuid, ${inboundId}::uuid)
      AND (
        EXISTS (
          SELECT 1 FROM match_group_bank mgb
          INNER JOIN match_group mg ON mg.id = mgb.match_group_id AND mg.status = 'ACTIVE'
          WHERE mgb.business_id = bt.business_id AND mgb.bank_transaction_id = bt.id
        )
        OR EXISTS (
          SELECT 1 FROM bank_match bm
          WHERE bm.business_id = bt.business_id AND bm.bank_transaction_id = bt.id AND bm.voided_at IS NULL
        )
      )
  `;
  if (alreadyMatched.length) return json(409, { ok: false, code: "ALREADY_MATCHED", error: "One of these bank transactions is already matched." });

  const now = new Date();
  const amount = BigInt(inbound.amount_cents);
  const transferId = randomUUID();
  const outboundEntryId = randomUUID();
  const inboundEntryId = randomUUID();
  const outboundGroupId = randomUUID();
  const inboundGroupId = randomUUID();
  const payee = `Transfer: ${String(outbound.name ?? "Outgoing")} → ${String(inbound.name ?? "Incoming")}`.slice(0, 180);

  try {
    await prisma.$transaction(async (tx: any) => {
      const pairLockKey = `operations-transfer-pair:${[outboundId, inboundId].sort().join(":")}`;
      await acquireTransactionAdvisoryLock(tx, pairLockKey);
      const matchesCreatedWhileWaiting: any[] = await tx.$queryRaw`
        SELECT bt.id
        FROM bank_transaction bt
        WHERE bt.business_id = ${businessId}::uuid
          AND bt.id IN (${outboundId}::uuid, ${inboundId}::uuid)
          AND (
            EXISTS (
              SELECT 1 FROM match_group_bank mgb
              INNER JOIN match_group mg ON mg.id = mgb.match_group_id AND mg.status = 'ACTIVE'
              WHERE mgb.business_id = bt.business_id AND mgb.bank_transaction_id = bt.id
            )
            OR EXISTS (
              SELECT 1 FROM bank_match bm
              WHERE bm.business_id = bt.business_id AND bm.bank_transaction_id = bt.id AND bm.voided_at IS NULL
            )
          )
      `;
      if (matchesCreatedWhileWaiting.length) {
        const error: any = new Error("One of these bank transactions is already matched.");
        error.code = "ALREADY_MATCHED";
        throw error;
      }

      await tx.transfer.create({
      data: {
        id: transferId,
        business_id: businessId,
        from_account_id: outbound.account_id,
        to_account_id: inbound.account_id,
        created_at: now,
        updated_at: now,
      },
      });
      await tx.entry.createMany({
      data: [
        {
          id: outboundEntryId,
          business_id: businessId,
          account_id: outbound.account_id,
          date: outbound.posted_date,
          payee,
          memo: "Confirmed transfer pair created from posted bank transactions.",
          amount_cents: -amount,
          type: "TRANSFER",
          method: "TRANSFER",
          status: "CLEARED",
          transfer_id: transferId,
          sourceBankTransactionId: outbound.id,
          created_at: now,
          updated_at: now,
        },
        {
          id: inboundEntryId,
          business_id: businessId,
          account_id: inbound.account_id,
          date: inbound.posted_date,
          payee,
          memo: "Confirmed transfer pair created from posted bank transactions.",
          amount_cents: amount,
          type: "TRANSFER",
          method: "TRANSFER",
          status: "CLEARED",
          transfer_id: transferId,
          sourceBankTransactionId: inbound.id,
          created_at: now,
          updated_at: now,
        },
      ],
      });

      for (const pair of [
        { groupId: outboundGroupId, bank: outbound, entryId: outboundEntryId, direction: "OUTFLOW" },
        { groupId: inboundGroupId, bank: inbound, entryId: inboundEntryId, direction: "INFLOW" },
      ]) {
        await tx.matchGroup.create({
        data: {
          id: pair.groupId,
          business_id: businessId,
          account_id: pair.bank.account_id,
          direction: pair.direction,
          status: "ACTIVE",
          created_by_user_id: userId,
          created_at: now,
        },
        });
        await tx.matchGroupBank.create({
        data: {
          match_group_id: pair.groupId,
          business_id: businessId,
          account_id: pair.bank.account_id,
          bank_transaction_id: pair.bank.id,
          matched_amount_cents: amount,
        },
        });
        await tx.matchGroupEntry.create({
        data: {
          match_group_id: pair.groupId,
          business_id: businessId,
          account_id: pair.bank.account_id,
          entry_id: pair.entryId,
          matched_amount_cents: amount,
        },
        });
      }
    });
  } catch (error: any) {
    if (error?.code === "ALREADY_MATCHED") {
      return json(409, { ok: false, code: "ALREADY_MATCHED", error: error.message });
    }
    throw error;
  }

  await logActivity(prisma, {
    businessId,
    scopeAccountId: String(outbound.account_id),
    actorUserId: userId,
    eventType: "LEDGER_TRANSFER_PAIR_CREATED",
    payloadJson: {
      transfer_id: transferId,
      outbound_bank_transaction_id: outboundId,
      inbound_bank_transaction_id: inboundId,
    },
  });

  return json(200, {
    ok: true,
    transfer_id: transferId,
    entry_ids: [outboundEntryId, inboundEntryId],
    match_group_ids: [outboundGroupId, inboundGroupId],
  });
}

export async function handler(event: any) {
  try {
    const claims = getClaims(event);
    const userId = String(claims.sub ?? "").trim();
    if (!userId) return json(401, { ok: false, error: "Unauthorized" });

    const businessId = String(event?.pathParameters?.businessId ?? "").trim();
    if (!businessId) return json(400, { ok: false, error: "Missing businessId" });

    const prisma = await getPrisma();
    const role = await requireMembership(prisma, businessId, userId);
    if (!role) return json(403, { ok: false, error: "Forbidden" });

    const method = getMethod(event);
    const path = getPath(event);
    if (method === "GET" && path.endsWith("/operations/overview")) {
      const rawWeeks = Number(event?.queryStringParameters?.weeks ?? 13);
      const weeks = Number.isFinite(rawWeeks) ? Math.max(4, Math.min(13, Math.floor(rawWeeks))) : 13;
      return json(200, await getOverview(prisma, businessId, weeks));
    }
    if (method === "POST" && path.endsWith("/operations/transfer-pairs")) {
      return applyTransferPair(prisma, event, businessId, userId, String(role));
    }
    return json(404, { ok: false, error: "Not Found" });
  } catch (error: any) {
    console.error("operations overview error", error?.message ?? error);
    return json(500, { ok: false, error: "INTERNAL", message: "Unable to load financial operations." });
  }
}
