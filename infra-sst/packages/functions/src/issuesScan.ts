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
    "and",
    "bank",
    "bankcard",
    "card",
    "check",
    "checkcard",
    "ccd",
    "co",
    "company",
    "corp",
    "corporation",
    "debit",
    "dep",
    "des",
    "deposit",
    "id",
    "inc",
    "llc",
    "llp",
    "lp",
    "ltd",
    "online",
    "payment",
    "pllc",
    "pos",
    "purchase",
    "sale",
    "the",
    "transaction",
    "transfer",
    "txn",
    "visa",
    "withdrawal",
    "zelle",
  ]);

  const out: string[] = [];
  const seen = new Set<string>();

  for (const token of String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b\d{4,}\b/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !/^\d+$/.test(token) && !stop.has(token))) {
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }

  return out;
}

function hasNearDuplicateTokenMatch(aTokens: string[], bTokens: string[]) {
  if (aTokens.length === 0 || bTokens.length === 0) return false;

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const shared = aTokens.filter((token) => bSet.has(token));
  if (shared.length === 0) return false;
  if (!shared.some((token) => token.length >= 3)) return false;
  if (shared.length >= 2) return true;

  const smaller = aTokens.length <= bTokens.length ? aTokens : bTokens;
  const largerSet = aTokens.length <= bTokens.length ? bSet : aSet;
  if (smaller.every((token) => largerSet.has(token))) return true;

  // At this point shared.length is exactly 1 (0 and ≥2 were handled above),
  // and the single shared token is not a full-subset match, so the pair is not
  // similar enough to be a near-duplicate.
  return false;
}

function duplicateTokenSignature(tokens: string[]) {
  return Array.from(new Set(tokens))
    .sort()
    .slice(0, 6)
    .join("-");
}

function duplicateComponentTokenSignature(tokenRows: string[][]) {
  const rows = tokenRows.filter((tokens) => tokens.length > 0);
  if (rows.length === 0) return "generic";

  let shared = new Set(rows[0]);
  for (const tokens of rows.slice(1)) {
    const set = new Set(tokens);
    shared = new Set(Array.from(shared).filter((token) => set.has(token)));
  }

  const sharedSig = duplicateTokenSignature(Array.from(shared));
  if (sharedSig) return sharedSig;

  return duplicateTokenSignature(rows.flat()) || "generic";
}

function duplicateEvidenceText(entry: any, bankDescriptions: string[] = []) {
  return [
    entry?.payee ?? "",
    entry?.memo ?? "",
    ...bankDescriptions,
  ].join(" ");
}

function hasGenericBankDescriptor(bankDescriptions: string[]) {
  const genericPatterns = [
    /\bbk\s*of\s*america\b/i,
    /\bbkofamerica\b/i,
    /\bbank\s*of\s*america\b/i,
    /\bboa\b/i,
    /\bmobile\b/i,
    /\bpre\s*encoded\b/i,
    /\bpreencoded\b/i,
    /\bremote\b/i,
    /\bdeposit\b/i,
    /\bbankcard\b/i,
    /\bmerchant\s+services?\b/i,
    /\bcheck\s*#?\s*\d+\b/i,
  ];

  for (const desc of bankDescriptions) {
    const text = String(desc ?? "").trim();
    if (!text) continue;
    if (genericPatterns.some((pattern) => pattern.test(text))) return true;
  }

  return false;
}

function isGenericBankManualDuplicatePair(
  a: {
    day: number;
    amount: bigint;
    sign: -1 | 0 | 1;
    type: string;
    tokens: string[];
    linkedBankIds: string[];
    bankDescriptions: string[];
    ref: string | null;
  },
  b: {
    day: number;
    amount: bigint;
    sign: -1 | 0 | 1;
    type: string;
    tokens: string[];
    linkedBankIds: string[];
    bankDescriptions: string[];
    ref: string | null;
  }
) {
  if (a.amount !== b.amount) return false;
  if (a.sign === 0 || b.sign === 0 || a.sign !== b.sign) return false;
  if (a.type && b.type && a.type !== b.type) return false;
  if (Math.abs(b.day - a.day) > 7) return false;

  const aLinked = a.linkedBankIds.length > 0;
  const bLinked = b.linkedBankIds.length > 0;
  if (aLinked === bLinked) return false;

  const bankSide = aLinked ? a : b;
  const manualSide = aLinked ? b : a;
  if (!hasGenericBankDescriptor(bankSide.bankDescriptions)) return false;

  // Require at least one meaningful manual token so two generic deposit rows do not
  // become a duplicate family just because the amount is the same.
  if (manualSide.tokens.length === 0) return false;

  // Different explicit references are strong evidence that these are separate events.
  if (a.ref && b.ref && a.ref !== b.ref) return false;

  return true;
}

// Extract a labeled reference/trace number from a text string.
// Only matches explicit labels (REF:, TRACE:, ID:, etc.) to avoid false
// matches on store IDs, amounts, or account fragments.
function extractRefFromText(text: string): string | null {
  const s = String(text ?? "").trim();
  if (!s) return null;
  const patterns = [
    /\bref\s*[:#]?\s*(\d{5,})/i,
    /\btrace\s*[:#]?\s*(\d{5,})/i,
    /\btrn\s*[:#]?\s*(\d{5,})/i,
    /\bppd\s+id\s*[:#]?\s*(\d{5,})/i,
    /\bweb\s+id\s*[:#]?\s*(\d{5,})/i,
    /\bid\s*:\s*(\d{5,})/i,
    /\bcheck\s*#?\s*(\d{2,8})\b/i,
  ];
  for (const p of patterns) {
    const m = s.match(p);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractEntryRef(entry: any, bankDescriptions: string[] = []): string | null {
  for (const text of [entry?.memo ?? "", entry?.payee ?? "", ...bankDescriptions]) {
    const ref = extractRefFromText(text);
    if (ref) return ref;
  }
  return null;
}

function duplicateExactBaseKey(entry: any) {
  const methodUpper = (entry?.method || "").toString().toUpperCase();
  const isCheck = methodUpper === "CHECK";
  const payeeKey = normalizePayee(entry?.payee || "");
  const amount = String(entry?.amount_cents ?? "");
  if (!amount || !payeeKey) return "";

  return isCheck
    ? `CHECK|${amount}|${payeeKey}`
    : `NONCHECK|${amount}|${methodUpper}|${payeeKey}`;
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

  function bankEventFingerprint(bankId: string) {
    const bank = bankById.get(bankId);
    if (!bank) return "";

    const ymd = dateToYmd(bank.posted_date);
    const amount = String(bank.amount_cents ?? "");
    const description = normalizePayee(String(bank.name ?? ""));
    if (!ymd || !amount || !description) return "";
    return `${ymd}|${amount}|${description}`;
  }

  function linkedBankEvidenceOverlaps(aIds: string[], bIds: string[]) {
    const bIdSet = new Set(bIds);
    if (aIds.some((id) => bIdSet.has(id))) return true;

    // Plaid replays or an earlier sync bug can produce different local bank IDs for
    // the same posted event. An exact bank date/amount/full-description fingerprint
    // is therefore duplicate evidence even when the local IDs differ.
    const bFingerprints = new Set(bIds.map(bankEventFingerprint).filter(Boolean));
    return aIds.map(bankEventFingerprint).filter(Boolean).some((fingerprint) => bFingerprints.has(fingerprint));
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
  // - TRANSFER: never requires category (including entries with transfer_id or entry_kind=TRANSFER)
  // - CASH account entries: never require category
  // - VOID/VOIDED/DELETED entries: should never surface issues
  if (includeMissingCategory) {
    for (const e of entries) {
      const typeUpper = String((e as any).type ?? "").toUpperCase();
      const statusUpper = String((e as any).status ?? "").toUpperCase();
      const kindUpper = String((e as any).entry_kind ?? "").toUpperCase();
      const accountTypeUpper = String((e as any)?.account?.type ?? "").toUpperCase();
      const payeeLower = String((e as any).payee ?? "").trim().toLowerCase();

      const isOpening =
        typeUpper === "OPENING" ||
        kindUpper === "OPENING" ||
        payeeLower.startsWith("opening balance");

      const isAdjustment = typeUpper === "ADJUSTMENT" || (e as any).is_adjustment === true;
      // Catch all transfer variants: type=TRANSFER, entry_kind=TRANSFER, or transfer_id is set
      const isTransfer = typeUpper === "TRANSFER" || kindUpper === "TRANSFER" || !!(e as any).transfer_id;
      const isCashAccount = accountTypeUpper === "CASH";
      // Voided/deleted entries should never surface category issues
      const isVoided = statusUpper === "VOID" || statusUpper === "VOIDED" || statusUpper === "DELETED";

      if (isOpening || isAdjustment || isTransfer || isCashAccount || isVoided) {
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
  //
  // A "stale check" means a check you wrote that has NOT cleared the bank yet
  // (outstanding / uncashed). A check that has cleared — i.e. it was matched to
  // a bank transaction, or the entry was created directly from an imported bank
  // transaction (sourceBankTransactionId) — is reconciled, not stale. Flagging
  // reconciled checks here produced false positives on the Issues page where
  // entries shown as matched in Reconcile still appeared as "stale checks".
  for (const e of entries) {
    const typeUpper = String((e as any).type ?? "").toUpperCase();
    const statusUpper = String((e as any).status ?? "").toUpperCase();
    const payeeLower = String((e as any).payee ?? "").trim().toLowerCase();

    // Voided/deleted entries should never surface stale-check issues
    if (statusUpper === "VOID" || statusUpper === "VOIDED" || statusUpper === "DELETED") continue;

    if (
      typeUpper === "OPENING" ||
      typeUpper === "ADJUSTMENT" ||
      payeeLower.startsWith("opening balance")
    ) {
      continue;
    }

    const methodUpper = (e.method || "").toString().toUpperCase();
    if (methodUpper !== "CHECK") continue;

    // Reconciled checks have cleared the bank and are never stale.
    const isMatched = activeMatchGroupIdsByEntryId.has(String(e.id));
    const hasBankSource = !!sourceBankTxnId(e);
    if (isMatched || hasBankSource) continue;

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

  // Returns every bank transaction ID that is linked to an entry, combining:
  //   1. sourceBankTransactionId  — set when the entry was created via the create-entry flow
  //   2. active match groups      — set when a manually-created entry was later reconciled
  // Using both sources ensures that entries reconciled either way are treated as
  // "belongs to a specific bank transaction" and are never flagged as duplicates of
  // entries belonging to a different bank transaction.
  function getEntryLinkedBankIds(entryId: string, directBankTxnId: string): string[] {
    const ids: string[] = [];
    if (directBankTxnId) ids.push(directBankTxnId);
    const groupIds = activeMatchGroupIdsByEntryId.get(entryId) ?? new Set<string>();
    for (const groupId of groupIds) {
      const bIds = bankIdsByMatchGroupId.get(groupId) ?? new Set<string>();
      for (const bId of bIds) ids.push(bId);
    }
    return Array.from(new Set(ids));
  }

  // Duplicate groups: CHECK window 30d, non-check window 7d
  const groups = new Map<string, Array<{ id: string; day: number; ymd: string; isCheck: boolean; linkedBankIds: string[]; ref: string | null }>>();

  for (const e of entries) {
    if (!isDuplicateScanEligibleEntry(e)) continue;

    const methodUpper = (e.method || "").toString().toUpperCase();
    const isCheck = methodUpper === "CHECK";

    const payeeKey = normalizePayee(e.payee || "");
    const descriptorKey = normalizePayee(String((e as any).memo ?? ""));
    const bankDescs = entryBankDescriptions(e);
    const evidenceTokens = duplicateTokens(duplicateEvidenceText(e, bankDescs));
    if (evidenceTokens.length === 0) continue;

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

    const linkedBankIds = getEntryLinkedBankIds(String(e.id), sourceBankTxnId(e));
    const ref = extractEntryRef(e, bankDescs);
    const arr = groups.get(key);
    if (arr) arr.push({ id: e.id, day, ymd, isCheck, linkedBankIds, ref });
    else groups.set(key, [{ id: e.id, day, ymd, isCheck, linkedBankIds, ref }]);
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
        // Distinct bank IDs normally prove distinct events, except when their exact
        // posted date, signed amount, and full bank description also match. That is
        // the replay shape produced by duplicate imports and must remain detectable.
        if (items[i].linkedBankIds.length > 0 && items[j].linkedBankIds.length > 0) {
          if (!linkedBankEvidenceOverlaps(items[i].linkedBankIds, items[j].linkedBankIds)) continue;
        }
        // Different labeled reference numbers (REF:, TRACE:, ID:, etc.) mean different transactions
        if (items[i].ref && items[j].ref && items[i].ref !== items[j].ref) continue;
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

  const nearDuplicateDetails = "Potential duplicate: similar payee, same amount, close date. Review before merging or cleanup.";

  type NearDuplicateCandidate = {
    id: string;
    day: number;
    amount: bigint;
    amountAbs: bigint;
    sign: -1 | 0 | 1;
    tokens: string[];
    isCheck: boolean;
    type: string;
    exactKey: string;
    linkedBankIds: string[];
    bankDescriptions: string[];
    ref: string | null;
  };

  const nearCandidates: NearDuplicateCandidate[] = [];
  for (const e of entries as any[]) {
    if (!isDuplicateScanEligibleEntry(e)) continue;

    const ymd = dateToYmd(e.date);
    const day = ymdToDay(ymd);
    if (!Number.isFinite(day)) continue;

    const amount = BigInt(e.amount_cents);
    const bankDescriptions = entryBankDescriptions(e);
    const tokens = duplicateTokens(duplicateEvidenceText(e, bankDescriptions));
    if (tokens.length === 0) continue;

    nearCandidates.push({
      id: String(e.id),
      day,
      amount,
      amountAbs: absBig(amount),
      sign: amount < 0n ? -1 : amount > 0n ? 1 : 0,
      tokens,
      isCheck: String(e.method ?? "").toUpperCase() === "CHECK",
      type: String(e.type ?? "").trim().toUpperCase(),
      exactKey: duplicateExactBaseKey(e),
      linkedBankIds: getEntryLinkedBankIds(String(e.id), sourceBankTxnId(e)),
      bankDescriptions,
      ref: extractEntryRef(e, bankDescriptions),
    });
  }

  nearCandidates.sort((a, b) => (a.day !== b.day ? a.day - b.day : a.id.localeCompare(b.id)));

  const nearParent = new Array<number>(nearCandidates.length);
  for (let i = 0; i < nearParent.length; i++) nearParent[i] = i;

  const nearFind = (x: number): number => {
    while (nearParent[x] !== x) {
      nearParent[x] = nearParent[nearParent[x]];
      x = nearParent[x];
    }
    return x;
  };

  const nearUnion = (a: number, b: number) => {
    const ra = nearFind(a);
    const rb = nearFind(b);
    if (ra !== rb) nearParent[rb] = ra;
  };

  for (let i = 0; i < nearCandidates.length; i++) {
    const a = nearCandidates[i];
    for (let j = i + 1; j < nearCandidates.length; j++) {
      const b = nearCandidates[j];
      const windowDays = a.isCheck && b.isCheck ? 30 : 7;
      if (b.day - a.day > windowDays) break;

      const sameSignedAmount = a.amount === b.amount;
      const sameCompatibleAbs = a.amountAbs === b.amountAbs && a.sign !== 0 && a.sign === b.sign;
      if (!sameSignedAmount && !sameCompatibleAbs) continue;
      if (a.sign !== 0 && b.sign !== 0 && a.sign !== b.sign) continue;
      if (a.type && b.type && a.type !== b.type) continue;

      // Exact duplicate groups keep their original group_key, copy, and LEGIT_DUP suppression.
      if (a.exactKey && b.exactKey && a.exactKey === b.exactKey) continue;

      // Preserve exact replay evidence even when duplicate bank rows have different
      // local IDs; otherwise matched duplicates disappear from the issue scan.
      if (a.linkedBankIds.length > 0 && b.linkedBankIds.length > 0) {
        if (!linkedBankEvidenceOverlaps(a.linkedBankIds, b.linkedBankIds)) continue;
      }
      // Different labeled reference numbers mean different transactions
      if (a.ref && b.ref && a.ref !== b.ref) continue;

      if (!hasNearDuplicateTokenMatch(a.tokens, b.tokens)) continue;

      nearUnion(i, j);
    }
  }

  const nearComps = new Map<number, number[]>();
  for (let i = 0; i < nearCandidates.length; i++) {
    const r = nearFind(i);
    const arr = nearComps.get(r);
    if (arr) arr.push(i);
    else nearComps.set(r, [i]);
  }

  for (const idxs of nearComps.values()) {
    if (idxs.length < 2) continue;

    const rows = idxs.map((ix) => nearCandidates[ix]);
    const minDay = Math.min(...rows.map((row) => row.day));
    const signedAmount = rows[0]?.amount?.toString() ?? "0";
    const typeSig = Array.from(new Set(rows.map((row) => row.type).filter(Boolean))).sort().join("+") || "ANY";
    const tokenSig = duplicateComponentTokenSignature(rows.map((row) => row.tokens));
    const groupKey = `NEAR_DUP|${signedAmount}|${typeSig}|${minDay}|${tokenSig}`;

    for (const row of rows) {
      detected.push({
        entry_id: row.id,
        issue_type: "DUPLICATE",
        severity: "WARNING",
        status: "OPEN",
        group_key: groupKey,
        details: nearDuplicateDetails,
      });
    }
  }

  const bankManualDuplicateDetails =
    "Potential duplicate: bank-imported transaction and manual entry share the same amount and close dates. Review before merging or cleanup.";

  const bankManualParent = new Array<number>(nearCandidates.length);
  for (let i = 0; i < bankManualParent.length; i++) bankManualParent[i] = i;

  const bankManualFind = (x: number): number => {
    while (bankManualParent[x] !== x) {
      bankManualParent[x] = bankManualParent[bankManualParent[x]];
      x = bankManualParent[x];
    }
    return x;
  };

  const bankManualUnion = (a: number, b: number) => {
    const ra = bankManualFind(a);
    const rb = bankManualFind(b);
    if (ra !== rb) bankManualParent[rb] = ra;
  };

  for (let i = 0; i < nearCandidates.length; i++) {
    const a = nearCandidates[i];
    for (let j = i + 1; j < nearCandidates.length; j++) {
      const b = nearCandidates[j];
      if (b.day - a.day > 7) break;

      // Exact duplicate groups keep their original group_key, copy, and LEGIT_DUP suppression.
      if (a.exactKey && b.exactKey && a.exactKey === b.exactKey) continue;

      if (!isGenericBankManualDuplicatePair(a, b)) continue;
      bankManualUnion(i, j);
    }
  }

  const bankManualComps = new Map<number, number[]>();
  for (let i = 0; i < nearCandidates.length; i++) {
    const r = bankManualFind(i);
    const arr = bankManualComps.get(r);
    if (arr) arr.push(i);
    else bankManualComps.set(r, [i]);
  }

  for (const idxs of bankManualComps.values()) {
    if (idxs.length < 2) continue;

    const rows = idxs.map((ix) => nearCandidates[ix]);
    const hasLinked = rows.some((row) => row.linkedBankIds.length > 0);
    const hasManual = rows.some((row) => row.linkedBankIds.length === 0);
    if (!hasLinked || !hasManual) continue;

    const minDay = Math.min(...rows.map((row) => row.day));
    const signedAmount = rows[0]?.amount?.toString() ?? "0";
    const typeSig = Array.from(new Set(rows.map((row) => row.type).filter(Boolean))).sort().join("+") || "ANY";
    const idSig = rows.map((row) => row.id).sort().slice(0, 6).join("-");
    const groupKey = `BANK_MANUAL_DUP|${signedAmount}|${typeSig}|${minDay}|${idSig}`;

    for (const row of rows) {
      detected.push({
        entry_id: row.id,
        issue_type: "DUPLICATE",
        severity: "WARNING",
        status: "OPEN",
        group_key: groupKey,
        details: bankManualDuplicateDetails,
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

  const types = includeMissingCategory
    ? ["DUPLICATE", "STALE_CHECK", "MISSING_CATEGORY"]
    : ["DUPLICATE", "STALE_CHECK"];

  // Load ALL existing issues for this scope in one query (OPEN + RESOLVED).
  // We need RESOLVED rows too: a previously-resolved issue that re-fires should
  // be updated back to OPEN rather than creating a duplicate row.
  // This also eliminates the N+1 findFirst-per-issue loop below.
  const allExisting = await prisma.entryIssue.findMany({
    where: {
      business_id: biz,
      account_id: acct,
      issue_type: { in: types },
    },
    select: { id: true, entry_id: true, issue_type: true, status: true },
  });

  // Build a lookup: "entry_id|issue_type" → existing row id
  const existingIdByKey = new Map<string, string>();
  for (const row of allExisting as any[]) {
    existingIdByKey.set(`${row.entry_id}|${row.issue_type}`, String(row.id));
  }

  const detectedKeys = new Set(persistDetected.map((d) => `${d.entry_id}|${d.issue_type}`));

  // Resolve OPEN issues that are no longer detected
  const toResolveIds = (allExisting as any[])
    .filter((row: any) =>
      String(row.status ?? "").toUpperCase() === "OPEN" &&
      !detectedKeys.has(`${row.entry_id}|${row.issue_type}`)
    )
    .map((row: any) => String(row.id));

  // Split detected issues into updates (row already exists) and creates (new row needed)
  const toUpdate: Array<{ id: string; d: Detected }> = [];
  const toCreate: Detected[] = [];
  for (const d of persistDetected) {
    const existingId = existingIdByKey.get(`${d.entry_id}|${d.issue_type}`);
    if (existingId) {
      toUpdate.push({ id: existingId, d });
    } else {
      toCreate.push(d);
    }
  }

  // Execute all upserts in parallel — eliminates the previous N+1 sequential loop
  await Promise.all([
    ...toUpdate.map(({ id, d }) =>
      prisma.entryIssue.update({
        where: { id },
        data: {
          status: "OPEN",
          severity: "WARNING",
          group_key: d.group_key,
          details: d.details,
          detected_at: now,
          resolved_at: null,
          updated_at: now,
        },
      })
    ),
    ...toCreate.map((d) =>
      prisma.entryIssue.create({
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
      })
    ),
  ]);

  const upserted = persistDetected.length;

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
