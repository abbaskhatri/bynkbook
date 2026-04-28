import { getPrisma } from "./lib/db";
import { randomUUID } from "crypto";

// --- Helpers copied in-place (no refactors) ---
function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function pp(event: any) {
  const p = event?.pathParameters ?? {};
  return {
    businessId: p.businessId,
    accountId: p.accountId,
  };
}

function getClaims(event: any) {
  const claims =
    event?.requestContext?.authorizer?.jwt?.claims ??
    event?.requestContext?.authorizer?.claims ??
    {};
  return claims as any;
}

async function requireRole(prisma: any, userId: string, businessId: string) {
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

function ymdToDay(ymd: string) {
  const s = (ymd || "").slice(0, 10);
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || !y || !m || !d) return NaN;
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function normalizePayee(raw: string) {
  const s = (raw || "")
    .toString()
    .trim()
    .toLowerCase();

  if (!s) return "";

  // collapse whitespace
  let out = s.replace(/\s+/g, " ");

  // normalize masked digits like XXXXX / ####
  out = out.replace(/x{3,}/g, "xxxxx");
  out = out.replace(/#{3,}/g, "#####");

  // drop punctuation noise but keep spaces
  out = out.replace(/[^a-z0-9 ]+/g, "");

  // remove long numeric fragments (store IDs, masked account numbers)
  // e.g. 1040232, 0131899, 12301, etc.
  out = out.replace(/\b\d{4,}\b/g, "");

  // collapse again after stripping numbers
  out = out.replace(/\s+/g, " ").trim();

  // final collapse
  out = out.replace(/\s+/g, " ").trim();

  return out;
}

function duplicateTokens(value: any) {
  const stop = new Set([
    "ach",
    "bank",
    "card",
    "check",
    "co",
    "debit",
    "deposit",
    "online",
    "payment",
    "pos",
    "purchase",
    "transaction",
    "txn",
    "visa",
    "withdrawal",
  ]);

  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stop.has(token));
}

function normalizedDuplicateText(value: any) {
  return duplicateTokens(value).join(" ");
}

function hasSimilarDuplicateText(a: any, b: any) {
  const aTokens = duplicateTokens(a);
  const bTokens = duplicateTokens(b);
  if (aTokens.length === 0 || bTokens.length === 0) return false;

  const bSet = new Set(bTokens);
  if (aTokens.some((token) => token.length >= 4 && bSet.has(token))) return true;

  const aText = normalizedDuplicateText(a);
  const bText = normalizedDuplicateText(b);
  if (!aText || !bText) return false;

  return aTokens.some((token) => token.length >= 4 && bText.includes(token)) ||
    bTokens.some((token) => token.length >= 4 && aText.includes(token));
}

function absBig(n: bigint) {
  return n < 0n ? -n : n;
}

function isOpeningEntryLike(entry: any) {
  const type = String(entry?.type ?? "").trim().toUpperCase();
  const payee = String(entry?.payee ?? "").trim().toLowerCase();
  const memo = String(entry?.memo ?? "").trim().toLowerCase();
  return (
    type === "OPENING" ||
    payee === "opening balance" ||
    payee === "opening balance (estimated)" ||
    payee.startsWith("opening balance") ||
    memo.includes("opening balance")
  );
}

function isDuplicateScanEligibleEntry(entry: any) {
  const type = String(entry?.type ?? "").trim().toUpperCase();
  const status = String(entry?.status ?? "").trim().toUpperCase();
  const kind = String(entry?.entry_kind ?? "").trim().toUpperCase();

  if (entry?.deleted_at) return false;
  if (entry?.is_adjustment === true) return false;
  if (entry?.transfer_id) return false;
  if (type === "ADJUSTMENT" || type === "TRANSFER") return false;
  if (status === "VOID" || status === "VOIDED" || status === "DELETED") return false;
  if (kind === "OPENING" || kind === "TRANSFER") return false;
  if (isOpeningEntryLike(entry)) return false;

  return true;
}

function sourceBankTxnId(entry: any) {
  return String(entry?.sourceBankTransactionId ?? entry?.source_bank_transaction_id ?? "").trim();
}

function dateToYmd(date: any) {
  try {
    if (date instanceof Date) return date.toISOString().slice(0, 10);
    return new Date(date).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function todayYmd() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export async function handler(event: any) {
  const method = event?.requestContext?.http?.method;
  const path = event?.requestContext?.http?.path;

  if (method !== "POST" || !path?.includes("/issues/scan")) {
    return json(404, { ok: false, error: "Not found" });
  }

  const claims = getClaims(event);
  const sub = claims.sub as string | undefined;
  if (!sub) return json(401, { ok: false, error: "Unauthorized" });

  const { businessId = "", accountId = "" } = pp(event);
  const biz = businessId.toString().trim();
  const acct = accountId.toString().trim();
  if (!biz || !acct) return json(400, { ok: false, error: "Missing businessId/accountId" });

  let body: any = {};
  try {
    body = event?.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const includeMissingCategory = !!body.includeMissingCategory;
  const dryRun = !!body.dryRun;

  const prisma = await getPrisma();

  const role = await requireRole(prisma, sub, biz);
  if (!role) return json(403, { ok: false, error: "Forbidden" });

  const okAcct = await requireAccountInBusiness(prisma, biz, acct);
  if (!okAcct) return json(404, { ok: false, error: "Account not found" });

  // Fetch entries (deleted entries must never create issues)
  const entries = await prisma.entry.findMany({
    where: {
      business_id: biz,
      account_id: acct,
      deleted_at: null,
    },
    select: {
      id: true,
      date: true,
      payee: true,
      memo: true,
      amount_cents: true,
      method: true,
      type: true,
      status: true,
      entry_kind: true,
      transfer_id: true,
      is_adjustment: true,
      sourceBankTransactionId: true,
      category_id: true,
      account: {
        select: {
          type: true,
        },
      },
    },
  });

  const todayDay = ymdToDay(todayYmd());

  // Detect issues
  type Detected = {
    entry_id: string;
    issue_type: "DUPLICATE" | "STALE_CHECK" | "MISSING_CATEGORY";
    severity: "WARNING";
    status: "OPEN";
    group_key: string | null;
    details: string;
  };

  const detected: Detected[] = [];

  const entryIds = entries.map((e: any) => String(e.id)).filter(Boolean);
  const matchGroupEntries = entryIds.length
    ? await prisma.matchGroupEntry.findMany({
      where: {
        business_id: biz,
        account_id: acct,
        entry_id: { in: entryIds },
        matchGroup: { status: "ACTIVE" },
      },
      select: { entry_id: true, match_group_id: true },
    })
    : [];

  const activeMatchGroupIdsByEntryId = new Map<string, Set<string>>();
  const activeMatchGroupIds = new Set<string>();
  for (const row of matchGroupEntries ?? []) {
    const entryId = String((row as any)?.entry_id ?? "");
    const groupId = String((row as any)?.match_group_id ?? "");
    if (!entryId || !groupId) continue;

    activeMatchGroupIds.add(groupId);
    const set = activeMatchGroupIdsByEntryId.get(entryId) ?? new Set<string>();
    set.add(groupId);
    activeMatchGroupIdsByEntryId.set(entryId, set);
  }

  const matchGroupBanks = activeMatchGroupIds.size
    ? await prisma.matchGroupBank.findMany({
      where: {
        business_id: biz,
        account_id: acct,
        match_group_id: { in: Array.from(activeMatchGroupIds) },
      },
      select: { match_group_id: true, bank_transaction_id: true },
    })
    : [];

  const bankIds = new Set<string>();
  const bankIdsByMatchGroupId = new Map<string, Set<string>>();
  for (const row of matchGroupBanks ?? []) {
    const groupId = String((row as any)?.match_group_id ?? "");
    const bankId = String((row as any)?.bank_transaction_id ?? "");
    if (!groupId || !bankId) continue;

    bankIds.add(bankId);
    const set = bankIdsByMatchGroupId.get(groupId) ?? new Set<string>();
    set.add(bankId);
    bankIdsByMatchGroupId.set(groupId, set);
  }

  for (const e of entries as any[]) {
    const bankId = sourceBankTxnId(e);
    if (bankId) bankIds.add(bankId);
  }

  const bankRows = bankIds.size
    ? await prisma.bankTransaction.findMany({
      where: {
        business_id: biz,
        account_id: acct,
        id: { in: Array.from(bankIds) },
        is_removed: false,
      },
      select: { id: true, posted_date: true, name: true, amount_cents: true, is_removed: true },
    })
    : [];

  const bankById = new Map<string, any>();
  for (const bank of bankRows ?? []) {
    const id = String((bank as any)?.id ?? "");
    if (id) bankById.set(id, bank);
  }

  function entryBankDescriptions(entry: any) {
    const out: string[] = [];

    const directBank = bankById.get(sourceBankTxnId(entry));
    if (directBank?.name) out.push(String(directBank.name));

    const groupIds = activeMatchGroupIdsByEntryId.get(String(entry?.id ?? "")) ?? new Set<string>();
    for (const groupId of groupIds) {
      const bankIdsForGroup = bankIdsByMatchGroupId.get(groupId) ?? new Set<string>();
      for (const bankId of bankIdsForGroup) {
        const bank = bankById.get(bankId);
        if (bank?.name) out.push(String(bank.name));
      }
    }

    return Array.from(new Set(out.map((s) => s.trim()).filter(Boolean)));
  }

  // Missing category (optional)
  // Business rules:
  // - OPENING: never requires category
  // - ADJUSTMENT: never requires category
  // - TRANSFER: never requires category
  // - CASH account entries: never require category
  if (includeMissingCategory) {
    for (const e of entries) {
      const typeUpper = String((e as any).type ?? "").toUpperCase();
      const accountTypeUpper = String((e as any)?.account?.type ?? "").toUpperCase();
      const payeeLower = String((e as any).payee ?? "").trim().toLowerCase();

      const isOpening =
        typeUpper === "OPENING" ||
        payeeLower.startsWith("opening balance");

      const isAdjustment = typeUpper === "ADJUSTMENT";
      const isTransfer = typeUpper === "TRANSFER";
      const isCashAccount = accountTypeUpper === "CASH";

      if (isOpening || isAdjustment || isTransfer || isCashAccount) {
        continue;
      }

      const categoryId = (e as any).category_id ? String((e as any).category_id).trim() : "";
      if (!categoryId) {
        detected.push({
          entry_id: e.id,
          issue_type: "MISSING_CATEGORY",
          severity: "WARNING",
          status: "OPEN",
          group_key: null,
          details: "Category missing or uncategorized",
        });
      }
    }
  }

  // Stale checks
  for (const e of entries) {
    const typeUpper = String((e as any).type ?? "").toUpperCase();
    const payeeLower = String((e as any).payee ?? "").trim().toLowerCase();

    if (
      typeUpper === "OPENING" ||
      typeUpper === "ADJUSTMENT" ||
      payeeLower.startsWith("opening balance")
    ) {
      continue;
    }

    const methodUpper = (e.method || "").toString().toUpperCase();
    if (methodUpper !== "CHECK") continue;

    const day = Math.floor(Date.UTC(e.date.getUTCFullYear(), e.date.getUTCMonth(), e.date.getUTCDate()) / 86400000);
    if (!Number.isFinite(todayDay) || !Number.isFinite(day)) continue;

    const age = todayDay - day;
    if (age > 45) {
      detected.push({
        entry_id: e.id,
        issue_type: "STALE_CHECK",
        severity: "WARNING",
        status: "OPEN",
        group_key: null,
        details: `Stale check — ${age} days old`,
      });
    }
  }

  // Duplicate groups: CHECK window 30d, non-check window 7d
  const groups = new Map<string, Array<{ id: string; day: number; ymd: string; isCheck: boolean }>>();

  for (const e of entries) {
    if (!isDuplicateScanEligibleEntry(e)) continue;

    const methodUpper = (e.method || "").toString().toUpperCase();
    const isCheck = methodUpper === "CHECK";

    const payeeKey = normalizePayee(e.payee || "");
    const descriptorKey = normalizePayee(String((e as any).memo ?? ""));

    // Reduce false positives: skip NONCHECK duplicate detection when payee is too short/generic.
    // Narrow exception: allow short-payee NONCHECK duplicate candidates only when a usable
    // descriptor/memo is present. Exact payee/method/signed-amount matching still comes from the group key,
    // and date-window matching still comes from the grouping pass below.
    if (!isCheck && payeeKey.length < 6 && !descriptorKey) continue;

    const ymd = e.date.toISOString().slice(0, 10);
    const day = ymdToDay(ymd);
    if (!Number.isFinite(day)) continue;

    // Signed amount cents included; prevents INCOME/EXPENSE cross-match by sign
    const amt = e.amount_cents.toString();
    const bucket = isCheck ? "CHECK" : "NONCHECK";

    // Reduce false positives: for NONCHECK include method in the key
    const key = isCheck
      ? `${bucket}|${amt}|${payeeKey}`
      : `${bucket}|${amt}|${methodUpper}|${payeeKey}`;

    const arr = groups.get(key);
    if (arr) arr.push({ id: e.id, day, ymd, isCheck });
    else groups.set(key, [{ id: e.id, day, ymd, isCheck }]);
  }

  for (const [key, items] of groups.entries()) {
    if (items.length <= 1) continue;

    const isCheckGroup = key.startsWith("CHECK|");
    const windowDays = isCheckGroup ? 30 : 7;

    // Deterministic ordering (day asc, then id asc) to ensure stable grouping.
    items.sort((a, b) => (a.day !== b.day ? a.day - b.day : a.id.localeCompare(b.id)));

    // Build deterministic connected components where entries are connected if within windowDays.
    // This avoids overlapping clusters and ensures each entry lands in exactly one stable group_key.
    const n = items.length;
    const parent = new Array<number>(n);
    for (let i = 0; i < n; i++) parent[i] = i;

    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };

    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (items[j].day - items[i].day > windowDays) break;
        union(i, j);
      }
    }

    const comps = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      const arr = comps.get(r);
      if (arr) arr.push(i);
      else comps.set(r, [i]);
    }

    for (const idxs of comps.values()) {
      if (idxs.length < 2) continue;

      let minDay = Number.POSITIVE_INFINITY;
      for (const ix of idxs) {
        if (items[ix].day < minDay) minDay = items[ix].day;
      }

      const groupKey = `${key}|${minDay}`;
      const details = isCheckGroup
        ? "Potential duplicate (CHECK within 30 days)"
        : "Potential duplicate (within 7 days)";

      for (const ix of idxs) {
        detected.push({
          entry_id: items[ix].id,
          issue_type: "DUPLICATE",
          severity: "WARNING",
          status: "OPEN",
          group_key: groupKey,
          details,
        });
      }
    }
  }

  type FlexibleCandidate = {
    id: string;
    day: number;
    ymd: string;
    amount: bigint;
    amountAbs: bigint;
    sign: -1 | 0 | 1;
    text: string;
    isCheck: boolean;
    isMatched: boolean;
    isBankGenerated: boolean;
  };

  const flexibleCandidates: FlexibleCandidate[] = [];
  for (const e of entries as any[]) {
    if (!isDuplicateScanEligibleEntry(e)) continue;

    const ymd = dateToYmd(e.date);
    const day = ymdToDay(ymd);
    if (!Number.isFinite(day)) continue;

    const amount = BigInt(e.amount_cents);
    const bankDescriptions = entryBankDescriptions(e);
    const text = [
      e.payee ?? "",
      e.memo ?? "",
      ...bankDescriptions,
    ].join(" ");

    flexibleCandidates.push({
      id: String(e.id),
      day,
      ymd,
      amount,
      amountAbs: absBig(amount),
      sign: amount < 0n ? -1 : amount > 0n ? 1 : 0,
      text,
      isCheck: String(e.method ?? "").toUpperCase() === "CHECK",
      isMatched: activeMatchGroupIdsByEntryId.has(String(e.id)),
      isBankGenerated: !!sourceBankTxnId(e),
    });
  }

  flexibleCandidates.sort((a, b) => (a.day !== b.day ? a.day - b.day : a.id.localeCompare(b.id)));

  const flexParent = new Array<number>(flexibleCandidates.length);
  for (let i = 0; i < flexParent.length; i++) flexParent[i] = i;

  const flexFind = (x: number): number => {
    while (flexParent[x] !== x) {
      flexParent[x] = flexParent[flexParent[x]];
      x = flexParent[x];
    }
    return x;
  };

  const flexUnion = (a: number, b: number) => {
    const ra = flexFind(a);
    const rb = flexFind(b);
    if (ra !== rb) flexParent[rb] = ra;
  };

  for (let i = 0; i < flexibleCandidates.length; i++) {
    const a = flexibleCandidates[i];
    for (let j = i + 1; j < flexibleCandidates.length; j++) {
      const b = flexibleCandidates[j];
      const windowDays = a.isCheck && b.isCheck ? 30 : 3;
      if (b.day - a.day > windowDays) break;

      const sameSignedAmount = a.amount === b.amount;
      const sameCompatibleAbs = a.amountAbs === b.amountAbs && a.sign !== 0 && a.sign === b.sign;
      if (!sameSignedAmount && !sameCompatibleAbs) continue;

      const hasBankOrMatchEvidence =
        a.isMatched || b.isMatched || a.isBankGenerated || b.isBankGenerated;
      if (!hasBankOrMatchEvidence) continue;

      const hasManualLookingSide =
        (!a.isMatched && !a.isBankGenerated) || (!b.isMatched && !b.isBankGenerated);
      if (!hasManualLookingSide) continue;

      if (!hasSimilarDuplicateText(a.text, b.text)) continue;

      flexUnion(i, j);
    }
  }

  const flexComps = new Map<number, number[]>();
  for (let i = 0; i < flexibleCandidates.length; i++) {
    const r = flexFind(i);
    const arr = flexComps.get(r);
    if (arr) arr.push(i);
    else flexComps.set(r, [i]);
  }

  for (const idxs of flexComps.values()) {
    if (idxs.length < 2) continue;

    const rows = idxs.map((ix) => flexibleCandidates[ix]);
    const hasMatched = rows.some((row) => row.isMatched);
    const hasBankGenerated = rows.some((row) => row.isBankGenerated);
    const minDay = Math.min(...rows.map((row) => row.day));
    const amountAbs = rows[0]?.amountAbs?.toString() ?? "0";
    const tokenSig = duplicateTokens(rows.map((row) => row.text).join(" "))
      .slice(0, 3)
      .join("-");
    const groupKey = `MATCHED_DUP|${amountAbs}|${minDay}|${tokenSig || "bank"}`;
    const details = hasMatched || hasBankGenerated
      ? "Potential duplicate: one entry is matched to a bank transaction. Review match/revert before deleting anything."
      : "Potential duplicate (within 3 days)";

    for (const row of rows) {
      detected.push({
        entry_id: row.id,
        issue_type: "DUPLICATE",
        severity: "WARNING",
        status: "OPEN",
        group_key: groupKey,
        details,
      });
    }
  }

  // De-dupe detected by (entry_id, issue_type) — keep latest group_key/details
  const dedup = new Map<string, Detected>();
  for (const d of detected) {
    dedup.set(`${d.entry_id}|${d.issue_type}`, d);
  }
  const finalDetected = Array.from(dedup.values());

  // Respect minimal durable duplicate legitimize suppression.
  // Suppress only the exact same duplicate family signature from reopening.
  const duplicateSuppressionPrefix = "LEGIT_DUP:";
  const suppressedDuplicateRows = await prisma.entryIssue.findMany({
    where: {
      business_id: biz,
      account_id: acct,
      issue_type: "DUPLICATE",
      status: "RESOLVED",
      group_key: { startsWith: duplicateSuppressionPrefix },
    },
    select: { group_key: true },
  });

  const suppressedDuplicateGroupKeys = new Set<string>(
    suppressedDuplicateRows
      .map((r: any) => String(r.group_key ?? ""))
      .filter(Boolean)
      .map((k: string) => k.slice(duplicateSuppressionPrefix.length))
      .filter(Boolean)
  );

  const persistDetected = finalDetected.filter((d) => {
    if (d.issue_type !== "DUPLICATE") return true;
    if (!d.group_key) return true;
    return !suppressedDuplicateGroupKeys.has(String(d.group_key));
  });

  if (dryRun) {
    return json(200, {
      ok: true,
      dryRun: true,
      detected: persistDetected.length,
      detectedByType: persistDetected.reduce((acc: any, x) => {
        acc[x.issue_type] = (acc[x.issue_type] || 0) + 1;
        return acc;
      }, {}),
    });
  }

  const now = new Date();

  // Load existing OPEN issues for this scope and these types
  const types = includeMissingCategory
    ? ["DUPLICATE", "STALE_CHECK", "MISSING_CATEGORY"]
    : ["DUPLICATE", "STALE_CHECK"];

  const existing = await prisma.entryIssue.findMany({
    where: {
      business_id: biz,
      account_id: acct,
      status: "OPEN",
      issue_type: { in: types },
    },
    select: { id: true, entry_id: true, issue_type: true },
  });

  const detectedKeys = new Set(persistDetected.map((d) => `${d.entry_id}|${d.issue_type}`));

  // Resolve issues no longer detected
  const toResolveIds = existing
    .filter((e: any) => !detectedKeys.has(`${e.entry_id}|${e.issue_type}`))
    .map((e: any) => e.id);

  // Upsert detected issues
  let upserted = 0;
  for (const d of persistDetected) {
    // Manual upsert (avoid Prisma unique-selector name mismatch):
// 1) find existing OPEN/RESOLVED row for this scope+entry+type
// 2) update if found, otherwise create
const existingIssue = await prisma.entryIssue.findFirst({
  where: {
    business_id: biz,
    account_id: acct,
    entry_id: d.entry_id,
    issue_type: d.issue_type,
  },
  select: { id: true },
});

if (existingIssue?.id) {
  await prisma.entryIssue.update({
    where: { id: existingIssue.id },
    data: {
      status: "OPEN",
      severity: "WARNING",
      group_key: d.group_key,
      details: d.details,
      detected_at: now,
      resolved_at: null,
      updated_at: now,
    },
  });
} else {
  await prisma.entryIssue.create({
    data: {
      id: randomUUID(),
      business_id: biz,
      account_id: acct,
      entry_id: d.entry_id,
      issue_type: d.issue_type,
      status: "OPEN",
      severity: "WARNING",
      group_key: d.group_key,
      details: d.details,
      detected_at: now,
      resolved_at: null,
      created_at: now,
      updated_at: now,
    },
  });
}

    upserted++;
  }

  if (toResolveIds.length > 0) {
    await prisma.entryIssue.updateMany({
      where: { id: { in: toResolveIds } },
      data: { status: "RESOLVED", resolved_at: now, updated_at: now },
    });
  }

  return json(200, {
    ok: true,
    businessId: biz,
    accountId: acct,
    detected: persistDetected.length,
    upserted,
    resolved: toResolveIds.length,
  });
}
