import { getPrisma } from "./lib/db";
import { logActivity } from "./lib/activityLog";
import { authorizeWrite } from "./lib/authz";
import { assertNotClosedPeriod } from "./lib/closedPeriods";
import { writeCategoryMemoryFeedback } from "./lib/categoryMemoryWriteback";
import { computeCategorySuggestionsForItems, type CategorySuggestion } from "./aiCategorySuggestions";
import { randomUUID } from "node:crypto";

// Reuse the same auth-claims helper pattern used elsewhere
function getClaims(event: any) {
  const auth = event?.requestContext?.authorizer ?? {};
  return auth?.jwt?.claims ?? auth?.claims ?? {};
}

function json(statusCode: number, body: any) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  };
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

// Phase 6A: deny-by-default write permissions
function canWrite(role: string | null) {
  const r = (role ?? "").toString().trim().toUpperCase();
  return r === "OWNER" || r === "ADMIN" || r === "BOOKKEEPER" || r === "ACCOUNTANT";
}

function parseLimit(q: any) {
  const raw = (q?.limit ?? "").toString().trim();

  const n = raw ? Number(raw) : 200;
  if (!Number.isFinite(n) || n <= 0) return 200;
  return Math.min(Math.max(Math.floor(n), 1), 500);
}

type BankTransactionStatusFilter = "all" | "matched" | "unmatched";

function parseStatusParam(q: any): BankTransactionStatusFilter | null {
  const raw = (q?.status ?? "all").toString().trim().toLowerCase();
  if (raw === "all" || raw === "matched" || raw === "unmatched") return raw;
  return null;
}

function parseDateParam(s?: string | null): Date | null {
  if (!s) return null;
  const t = s.toString().trim();
  if (!t) return null;
  // Expect YYYY-MM-DD
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function absBig(n: bigint) {
  return n < 0n ? -n : n;
}

const POSSIBLE_DUPLICATE_ENTRY_CODE = "POSSIBLE_DUPLICATE_ENTRY";
const POSSIBLE_DUPLICATE_ENTRY_MESSAGE =
  "Possible existing ledger entry found. Review and match existing entry instead of creating a new one.";
const PENDING_BANK_TRANSACTION_CODE = "PENDING_BANK_TRANSACTION_NOT_ACTIONABLE";
const PENDING_BANK_TRANSACTION_MESSAGE =
  "Pending bank transactions can be reviewed once they post.";
const PENDING_ENTRY_CONSENT_REQUIRED_CODE = "PENDING_ENTRY_CONSENT_REQUIRED";
const PENDING_ENTRY_CONSENT_REQUIRED_MESSAGE =
  "Confirm that you understand this pending transaction may change or disappear before creating an unmatched ledger entry.";
const PENDING_AUTO_MATCH_NOT_ALLOWED_CODE = "PENDING_AUTO_MATCH_NOT_ALLOWED";
const PENDING_AUTO_MATCH_NOT_ALLOWED_MESSAGE =
  "Pending bank transactions cannot be matched until they post.";
const CREATE_ENTRY_DUPLICATE_WINDOW_DAYS = 3;
const CREATE_ENTRY_GENERIC_BANK_DUPLICATE_WINDOW_DAYS = 7;

function trustedBankEntryCategory(suggestion: CategorySuggestion | null | undefined) {
  if (!suggestion?.category_id) return false;

  const source = String(suggestion.source ?? "").trim().toUpperCase();
  const tier = String(suggestion.confidence_tier ?? "").trim().toUpperCase();
  const confidence = Number(suggestion.confidence ?? 0);
  const reason = String(suggestion.reason ?? "").trim().toLowerCase();
  const isExactAcceptedHistory =
    source === "HEURISTIC" &&
    (reason.includes("exact merchant match in account history") || reason.includes("vendor-linked account history"));

  // A repeated user-approved merchant/category memory or an explicit vendor default
  // is safe to reuse for a newly-created bank entry. Risky keyword/AI guesses remain
  // suggestions and are never silently applied here.
  return (
    (source === "MEMORY" || source === "VENDOR_DEFAULT" || isExactAcceptedHistory) &&
    tier === "SAFE_DETERMINISTIC" &&
    Number.isFinite(confidence) &&
    confidence >= 95
  );
}

async function inferTrustedBankEntryCategory(args: {
  prisma: any;
  businessId: string;
  accountId: string;
  bankTransactionId: string;
  payee: string;
  memo: string;
  amountCents: bigint;
}) {
  try {
    const computed = await computeCategorySuggestionsForItems({
      prisma: args.prisma,
      businessId: args.businessId,
      accountId: args.accountId,
      includeAiFallback: false,
      limitPerItem: 3,
      items: [
        {
          kind: "BANK_TXN",
          id: args.bankTransactionId,
          payee_or_name: args.payee,
          memo: args.memo,
          amount_cents: args.amountCents,
        },
      ],
    });

    const top = computed.suggestionsById[args.bankTransactionId]?.[0] ?? null;
    return trustedBankEntryCategory(top) ? top : null;
  } catch {
    // Category inference must never block ledger creation. The uncategorized row
    // remains available for Category Review if intelligence data is unavailable.
    return null;
  }
}
const ALLOWED_BANK_ENTRY_METHODS = new Set([
  "CASH",
  "CARD",
  "ACH",
  "WIRE",
  "CHECK",
  "DIRECT_DEPOSIT",
  "ZELLE",
  "TRANSFER",
  "OTHER",
]);

function normalizeCheckNumberCandidate(value: any) {
  const s = String(value ?? "").trim();
  if (!s) return "";
  if (!/^\d{2,8}$/.test(s)) return "";
  if (/^0+$/.test(s)) return "";
  return s;
}

function normalizeCheckNumberForCompare(value: any) {
  const candidate = normalizeCheckNumberCandidate(String(value ?? "").replace(/\D/g, ""));
  if (!candidate) return "";
  return candidate.replace(/^0+/, "") || candidate;
}

// Extract a labeled reference/trace number from a text string.
// Mirrors the same logic in issuesScan.ts — only matches explicit labels to
// avoid false matches on store IDs, amounts, or masked account fragments.
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

function rawString(raw: any, keys: string[]) {
  if (!raw || typeof raw !== "object") return "";
  for (const key of keys) {
    const v = raw?.[key];
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
  }
  return "";
}

function bankTransactionSearchText(bankTxn: any) {
  const raw = bankTxn?.raw && typeof bankTxn.raw === "object" ? bankTxn.raw : {};
  const rawParts = [
    rawString(raw, ["name", "merchant_name", "merchantName", "original_description", "originalDescription"]),
    rawString(raw, ["payment_channel", "paymentChannel", "transaction_type", "transactionType"]),
    rawString(raw, ["check_number", "checkNumber", "check_num", "checkNum"]),
    rawString(raw, ["payment_meta", "paymentMeta"]),
  ];

  return [bankTxn?.name, ...rawParts]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function inferMethodFromBankTransaction(bankTxn: any) {
  if (extractCheckNumberFromBankTransaction(bankTxn)) return "CHECK";

  const text = bankTransactionSearchText(bankTxn);
  if (/\b(?:bank\s*card|bankcard|merchant\s+services?|card\s+settlement|card\s+deposit)\b/i.test(text)) {
    return "CARD";
  }
  if (/\bzelle\b/i.test(text)) return "ZELLE";
  if (/\bwire(?:\s+type)?\b/i.test(text)) return "WIRE";
  if (/\bach\b/i.test(text)) return ALLOWED_BANK_ENTRY_METHODS.has("ACH") ? "ACH" : "OTHER";
  if (/\b(?:check|chk)\b/i.test(text)) return "CHECK";
  if (/\b(?:mobile|remote|pre\s*encoded|preencoded)\b[\s\S]{0,40}\bdeposit\b/i.test(text)) return "CHECK";
  if (/\bdeposit\b[\s\S]{0,40}\b(?:mobile|remote|pre\s*encoded|preencoded)\b/i.test(text)) return "CHECK";
  if (/\bdirect\s+deposit\b/i.test(text)) return "DIRECT_DEPOSIT";
  if (/\btransfer\b/i.test(text)) return ALLOWED_BANK_ENTRY_METHODS.has("TRANSFER") ? "TRANSFER" : "OTHER";

  return "OTHER";
}

function resolveBankEntryMethod(methodOverride: string, inferredMethod: string) {
  if (!ALLOWED_BANK_ENTRY_METHODS.has(methodOverride)) return inferredMethod;
  if (methodOverride === "OTHER" && inferredMethod && inferredMethod !== "OTHER") return inferredMethod;
  return methodOverride;
}

function extractCheckNumberFromBankTransaction(bankTxn: any) {
  const raw = bankTxn?.raw && typeof bankTxn.raw === "object" ? bankTxn.raw : {};
  const explicit = normalizeCheckNumberCandidate(
    rawString(raw, ["check_number", "checkNumber", "check_num", "checkNum"])
  );
  if (explicit) return explicit;

  const parts = [
    bankTxn?.name,
    rawString(raw, ["name", "merchant_name", "merchantName", "original_description", "originalDescription"]),
  ]
    .map((x) => String(x ?? "").trim())
    .filter(Boolean);

  for (const text of parts) {
    const patterns = [
      /\b(?:check|chk)\s*(?:#|no\.?|number)?\s*([0-9]{2,8})\b/i,
      /\bdeposit\s+check\s*(?:#|no\.?|number)?\s*([0-9]{2,8})\b/i,
    ];
    for (const pattern of patterns) {
      const candidate = normalizeCheckNumberCandidate(text.match(pattern)?.[1]);
      if (candidate) return candidate;
    }
  }

  return "";
}

function memoHasRef(memo: any) {
  return /\bref\s*:/i.test(String(memo ?? ""));
}

function memoWithCheckRef(memo: string, checkRef: string) {
  const ref = normalizeCheckNumberCandidate(checkRef);
  const base = String(memo ?? "").trim();
  if (!ref || memoHasRef(base)) return base;
  if (!base) return `Ref: ${ref}`;
  return `Ref: ${ref}\n${base}`.slice(0, 400);
}

function extractCheckNumberFromEntry(entry: any) {
  const explicit = normalizeCheckNumberCandidate(
    String(
      entry?.ref ??
        entry?.reference ??
        entry?.reference_number ??
        entry?.referenceNumber ??
        ""
    ).replace(/\D/g, "")
  );
  if (explicit) return explicit;

  const memoRef = String(entry?.memo ?? "").match(/\bref\s*:\s*([0-9]{2,8})\b/i)?.[1];
  const normalizedMemoRef = normalizeCheckNumberCandidate(String(memoRef ?? ""));
  if (normalizedMemoRef) return normalizedMemoRef;

  const ref = extractRefFromText(`${entry?.memo ?? ""} ${entry?.payee ?? ""}`);
  return normalizeCheckNumberCandidate(String(ref ?? "").replace(/\D/g, ""));
}

function sameCheckNumber(bankCheckRef: string, entry: any) {
  const bankComparable = normalizeCheckNumberForCompare(bankCheckRef);
  const entryComparable = normalizeCheckNumberForCompare(extractCheckNumberFromEntry(entry));
  return !!bankComparable && !!entryComparable && bankComparable === entryComparable;
}

function dateOnlyUtc(ymd: string) {
  return new Date(`${ymd}T00:00:00Z`);
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isOpeningEntryLike(entry: any) {
  const payee = String(entry?.payee ?? "").trim().toLowerCase();
  const memo = String(entry?.memo ?? "").trim().toLowerCase();
  return (
    payee === "opening balance" ||
    payee === "opening balance (estimated)" ||
    payee.startsWith("opening balance") ||
    memo.includes("opening balance")
  );
}

function isDuplicatePreflightEligibleEntry(entry: any) {
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

function hasSimilarPayee(bankDescription: any, entry: any) {
  const bankTokens = duplicateTokens(bankDescription);
  if (bankTokens.length === 0) return false;

  const entryTokens = duplicateTokens(`${entry?.payee ?? ""} ${entry?.memo ?? ""}`);
  if (entryTokens.length === 0) return false;

  const entryTokenSet = new Set(entryTokens);
  if (bankTokens.some((token) => token.length >= 4 && entryTokenSet.has(token))) return true;

  const bankText = normalizedDuplicateText(bankDescription);
  const entryText = normalizedDuplicateText(`${entry?.payee ?? ""} ${entry?.memo ?? ""}`);
  if (!bankText || !entryText) return false;

  return bankTokens.some((token) => token.length >= 4 && entryText.includes(token)) ||
    entryTokens.some((token) => token.length >= 4 && bankText.includes(token));
}

function hasGenericBankDescriptor(value: any) {
  const text = String(value ?? "").trim();
  if (!text) return false;

  return [
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
    /\b(?:check|chk)\b/i,
    /\bcheck\s*#?\s*\d+\b/i,
  ].some((pattern) => pattern.test(text));
}

function dateDistanceDays(a: any, bYmd: string) {
  const aDate = a instanceof Date ? a : new Date(a);
  const bDate = dateOnlyUtc(bYmd);
  if (Number.isNaN(aDate.getTime()) || Number.isNaN(bDate.getTime())) return Number.POSITIVE_INFINITY;

  const aDay = Math.floor(Date.UTC(aDate.getUTCFullYear(), aDate.getUTCMonth(), aDate.getUTCDate()) / 86400000);
  const bDay = Math.floor(Date.UTC(bDate.getUTCFullYear(), bDate.getUTCMonth(), bDate.getUTCDate()) / 86400000);
  return Math.abs(aDay - bDay);
}

function hasManualDuplicateText(entry: any) {
  return duplicateTokens(`${entry?.payee ?? ""} ${entry?.memo ?? ""}`).length > 0;
}

function isGenericBankManualDuplicateCandidate(args: {
  bankFullText: string;
  bankRef: string | null;
  entry: any;
  entryAmountCents: bigint;
  entryDateYmd: string;
}) {
  const { bankFullText, bankRef, entry, entryAmountCents, entryDateYmd } = args;
  if (!hasGenericBankDescriptor(bankFullText)) return false;
  if (!hasManualDuplicateText(entry)) return false;
  if (BigInt(entry?.amount_cents ?? 0) !== entryAmountCents) return false;
  if (dateDistanceDays(entry?.date, entryDateYmd) > CREATE_ENTRY_GENERIC_BANK_DUPLICATE_WINDOW_DAYS) return false;

  const entryRef = extractRefFromText(`${entry?.memo ?? ""} ${entry?.payee ?? ""}`);
  if (bankRef && entryRef && bankRef !== entryRef) return false;

  return true;
}

function duplicateCandidatePayload(
  entry: any,
  evidence: { reason?: string; confidence?: "high" | "medium" | "review"; date_distance_days?: number } = {}
) {
  return {
    entry_id: entry.id,
    date: isoToYmd(entry.date),
    payee: entry.payee ?? null,
    memo: entry.memo ?? null,
    ref: (() => {
      const m = String(entry?.memo ?? "").match(/\bref\s*:\s*([^\n\r;|,]+)/i);
      return m?.[1]?.trim() || null;
    })(),
    category_id: entry.category_id ?? null,
    amount_cents: entry.amount_cents,
    status: entry.status ?? null,
    duplicate_reason: evidence.reason ?? "similar_payee",
    duplicate_confidence: evidence.confidence ?? "medium",
    date_distance_days: evidence.date_distance_days ?? null,
  };
}

async function findPossibleCreateEntryDuplicates(args: {
  prisma: any;
  businessId: string;
  accountId: string;
  bankTransactionId: string;
  bankTxn: any;
  entryAmountCents: bigint;
  entryDateYmd: string;
}) {
  const { prisma, businessId, accountId, bankTransactionId, bankTxn, entryAmountCents, entryDateYmd } = args;
  const entryDate = dateOnlyUtc(entryDateYmd);
  if (Number.isNaN(entryDate.getTime())) return [];

  const bankAbs = absBig(BigInt(bankTxn.amount_cents));
  const amountCandidates = Array.from(new Set([entryAmountCents, bankAbs, -bankAbs].map((v) => v.toString()))).map((v) => BigInt(v));
  const duplicateWindowDays = CREATE_ENTRY_GENERIC_BANK_DUPLICATE_WINDOW_DAYS;

  const rows = await prisma.entry.findMany({
    where: {
      business_id: businessId,
      account_id: accountId,
      deleted_at: null,
      date: {
        gte: addUtcDays(entryDate, -duplicateWindowDays),
        lte: addUtcDays(entryDate, duplicateWindowDays),
      },
      amount_cents: { in: amountCandidates },
    } as any,
    select: {
      id: true,
      date: true,
      payee: true,
      memo: true,
      category_id: true,
      amount_cents: true,
      type: true,
      status: true,
      entry_kind: true,
      deleted_at: true,
      is_adjustment: true,
      transfer_id: true,
      sourceBankTransactionId: true,
    } as any,
    orderBy: [{ date: "desc" as any }, { created_at: "desc" as any }],
    take: 10,
  });

  // Build the richest possible description text for this bank transaction.
  // bankTransactionSearchText includes name + raw.original_description, merchant_name,
  // payment_channel, etc. — Plaid reference/trace numbers almost always live in
  // original_description, not in the short name, so using the full text is essential
  // for both payee similarity and reference-number extraction.
  const bankFullText = bankTransactionSearchText(bankTxn);
  const bankCheckRef = extractCheckNumberFromBankTransaction(bankTxn);
  const bankRef = bankCheckRef || extractRefFromText(bankFullText);

  return rows
    // An entry already linked to any bank transaction is a different real-world
    // transaction by definition — including recurring charges with same amount/payee.
    .filter((entry: any) => !String(entry?.sourceBankTransactionId ?? "").trim())
    .filter(isDuplicatePreflightEligibleEntry)
    .map((entry: any) => {
      const dateDistance = dateDistanceDays(entry?.date, entryDateYmd);
      const checkNumberMatch = sameCheckNumber(bankCheckRef || bankRef || "", entry);
      const similarPayee = dateDistance <= CREATE_ENTRY_DUPLICATE_WINDOW_DAYS && hasSimilarPayee(bankFullText, entry);
      const genericBankManual = isGenericBankManualDuplicateCandidate({
        bankFullText,
        bankRef,
        entry,
        entryAmountCents,
        entryDateYmd,
      });

      return {
        entry,
        dateDistance,
        duplicateReason: checkNumberMatch ? "matching_check_number" : genericBankManual ? "generic_bank_manual_same_amount" : "similar_payee",
        duplicateConfidence: checkNumberMatch || genericBankManual ? "high" : "medium",
        isDuplicateCandidate: similarPayee || genericBankManual || checkNumberMatch,
      };
    })
    .filter((candidate: any) => candidate.isDuplicateCandidate)
    // If the bank transaction and the manual entry both carry a labeled reference
    // number and those numbers differ, they are definitely different transactions.
    .filter((candidate: any) => {
      if (!bankRef) return true;
      const entry = candidate.entry;
      const entryRef = extractCheckNumberFromEntry(entry) || extractRefFromText(`${entry?.memo ?? ""} ${entry?.payee ?? ""}`);
      if (!entryRef) return true;
      const bankComparable = normalizeCheckNumberForCompare(bankRef);
      const entryComparable = normalizeCheckNumberForCompare(entryRef);
      if (bankComparable && entryComparable) return bankComparable === entryComparable;
      return bankRef === entryRef;
    })
    .slice(0, 5)
    .map((candidate: any) =>
      duplicateCandidatePayload(candidate.entry, {
        reason: candidate.duplicateReason,
        confidence: candidate.duplicateConfidence,
        date_distance_days: candidate.dateDistance,
      })
    );
}

function isoToYmd(iso: any): string {
  try {
    return new Date(String(iso)).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

type BankTransactionCursor = {
  postedDate: Date;
  createdAt: Date;
  id: string;
};

function parseCursorParam(s?: string | null): BankTransactionCursor | null {
  const raw = (s ?? "").toString().trim();
  if (!raw) return null;

  try {
    const decoded = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const postedDate = new Date(String(decoded?.posted_date ?? ""));
    const createdAt = new Date(String(decoded?.created_at ?? ""));
    const id = String(decoded?.id ?? "").trim();

    if (Number.isNaN(postedDate.getTime())) return null;
    if (Number.isNaN(createdAt.getTime())) return null;
    if (!id) return null;

    return { postedDate, createdAt, id };
  } catch {
    return null;
  }
}

function encodeCursor(row: any): string {
  const payload = {
    posted_date: new Date(row.posted_date).toISOString(),
    created_at: new Date(row.created_at).toISOString(),
    id: String(row.id),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function cursorWhere(cursor: BankTransactionCursor) {
  return {
    OR: [
      { posted_date: { lt: cursor.postedDate } },
      {
        posted_date: cursor.postedDate,
        created_at: { lt: cursor.createdAt },
      },
      {
        posted_date: cursor.postedDate,
        created_at: cursor.createdAt,
        id: { lt: cursor.id },
      },
    ],
  };
}

async function activeMatchedBankTransactionIds(prisma: any, businessId: string, accountId: string) {
  const [groupBanks, legacyMatches] = await Promise.all([
    prisma.matchGroupBank.findMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        matchGroup: { status: "ACTIVE" },
      },
      select: { bank_transaction_id: true },
    }),
    prisma.bankMatch.findMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        voided_at: null,
      },
      select: { bank_transaction_id: true },
    }),
  ]);

  return Array.from(
    new Set(
      [...groupBanks, ...legacyMatches]
        .map((row: any) => String(row?.bank_transaction_id ?? "").trim())
        .filter(Boolean)
    )
  );
}

async function activeMatchGroupIds(prisma: any, businessId: string, accountId: string) {
  const activeGroups = await prisma.matchGroup.findMany({
    where: { business_id: businessId, account_id: accountId, status: "ACTIVE" },
    select: { id: true },
  });
  return activeGroups.map((g: any) => String(g?.id ?? "").trim()).filter(Boolean);
}

async function hasActiveBankMatchGroup(prisma: any, args: {
  businessId: string;
  accountId: string;
  bankTransactionId: string;
  activeGroupIds?: string[];
}) {
  const ids = args.activeGroupIds ?? await activeMatchGroupIds(prisma, args.businessId, args.accountId);
  if (ids.length === 0) return false;

  const first = await prisma.matchGroupBank.findFirst({
    where: {
      business_id: args.businessId,
      account_id: args.accountId,
      bank_transaction_id: args.bankTransactionId,
      match_group_id: { in: ids },
    },
    select: { match_group_id: true },
  });

  return !!first;
}

async function hasActiveEntryMatchGroup(prisma: any, args: {
  businessId: string;
  accountId: string;
  entryId: string;
  activeGroupIds?: string[];
}) {
  const ids = args.activeGroupIds ?? await activeMatchGroupIds(prisma, args.businessId, args.accountId);
  if (ids.length === 0) return false;

  const first = await prisma.matchGroupEntry.findFirst({
    where: {
      business_id: args.businessId,
      account_id: args.accountId,
      entry_id: args.entryId,
      match_group_id: { in: ids },
    },
    select: { match_group_id: true },
  });

  return !!first;
}

async function createBankEntryMatchGroup(prisma: any, args: {
  businessId: string;
  accountId: string;
  bankTransactionId: string;
  entryId: string;
  bankAbs: bigint;
  direction: "INFLOW" | "OUTFLOW";
  sub: string;
  now: Date;
}) {
  const groupId = randomUUID();

  await prisma.matchGroup.create({
    data: ({
      id: groupId,
      business_id: args.businessId,
      account_id: args.accountId,
      status: "ACTIVE",
      direction: args.direction,
      created_by_user_id: args.sub,
      created_at: args.now,
    } as any),
    select: { id: true },
  });

  await prisma.matchGroupBank.create({
    data: {
      business_id: args.businessId,
      account_id: args.accountId,
      match_group_id: groupId,
      bank_transaction_id: args.bankTransactionId,
      matched_amount_cents: args.bankAbs,
    },
  });

  await prisma.matchGroupEntry.create({
    data: {
      business_id: args.businessId,
      account_id: args.accountId,
      match_group_id: groupId,
      entry_id: args.entryId,
      matched_amount_cents: args.bankAbs,
    },
  });

  return groupId;
}

/**
 * GET /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions?from=&to=&status=&limit=&cursor=
 * - scoped by businessId + accountId
 * - excludes is_removed=true
 * - ordered by posted_date desc
 */
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

  // Phase 4D+ v1: bank txn POST actions
  const method = event?.requestContext?.http?.method;
  const rawPath = (event?.requestContext?.http?.path ?? "").toString();
  const bankTransactionId = (event?.pathParameters?.bankTransactionId ?? "").toString().trim();

  const isUnmatch = method === "POST" && bankTransactionId && rawPath.endsWith("/unmatch");
  const isCreateEntriesBatch = method === "POST" && rawPath.endsWith("/create-entries-batch");
  const isCleanupPlaidOverlap = method === "POST" && rawPath.endsWith("/cleanup-plaid-overlap");
  const isCreateEntry = method === "POST" && bankTransactionId && rawPath.endsWith("/create-entry");

  // -------------------------
  // POST /bank-transactions/{bankTransactionId}/unmatch
  // (legacy v1 unmatch remains)
  // -------------------------
  if (isUnmatch) {
    if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

    const az = await authorizeWrite(prisma, {
      businessId: businessId,
      scopeAccountId: accountId,
      actorUserId: sub,
      actorRole: role,
      actionKey: "reconcile.match.void",
      requiredLevel: "FULL",
      endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/{bankTransactionId}/unmatch",
    });

    if (!az.allowed) {
      return json(403, {
        ok: false,
        error: "Policy denied",
        code: "POLICY_DENIED",
        actionKey: "reconcile.match.void",
        requiredLevel: az.requiredLevel,
        policyValue: az.policyValue,
        policyKey: az.policyKey,
      });
    }

    const now = new Date();

    const updated = await prisma.bankMatch.updateMany({
      where: {
        business_id: businessId,
        account_id: accountId,
        bank_transaction_id: bankTransactionId,
        voided_at: null,
      },
      data: {
        voided_at: now,
        voided_by_user_id: sub,
      },
    });

    await logActivity(prisma, {
      businessId: businessId,
      actorUserId: sub,
      scopeAccountId: accountId,
      eventType: "RECONCILE_MATCH_VOIDED",
      payloadJson: { account_id: accountId, bank_transaction_id: bankTransactionId, voided_count: updated.count },
    });

    return json(200, { ok: true, voidedCount: updated.count });
  }

  // -------------------------------------------------------------------
  // POST /bank-transactions/cleanup-plaid-overlap
  // Soft-removes unmatched Plaid rows that overlap existing matched, manual/uploaded, or ledger history.
  // This repairs a first/full Plaid drain that imported rows already present in the account.
  // -------------------------------------------------------------------
  if (isCleanupPlaidOverlap) {
    try {
      if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

      const az = await authorizeWrite(prisma, {
        businessId: businessId,
        scopeAccountId: accountId,
        actorUserId: sub,
        actorRole: role,
        actionKey: "reconcile.bank.cleanupPlaidOverlap",
        requiredLevel: "FULL",
        endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/cleanup-plaid-overlap",
      });

      if (!az.allowed) {
        return json(403, {
          ok: false,
          error: "Policy denied",
          code: "POLICY_DENIED",
          actionKey: "reconcile.bank.cleanupPlaidOverlap",
          requiredLevel: az.requiredLevel,
          policyValue: az.policyValue,
          policyKey: az.policyKey,
        });
      }

      const activeMatchedIds = await activeMatchedBankTransactionIds(prisma, businessId, accountId);
      const [latestNonPlaid, latestMatchedRows, latestLedgerEntry] = await Promise.all([
        prisma.bankTransaction.findFirst({
          where: {
            business_id: businessId,
            account_id: accountId,
            is_removed: false,
            OR: [
              { plaid_transaction_id: null },
              { source: { not: "PLAID" } },
            ],
          },
          orderBy: [
            { posted_date: "desc" as any },
            { created_at: "desc" as any },
            { id: "desc" as any },
          ],
          select: { posted_date: true },
        }),
        activeMatchedIds.length > 0
          ? prisma.bankTransaction.findMany({
              where: {
                business_id: businessId,
                account_id: accountId,
                id: { in: activeMatchedIds } as any,
                is_removed: false,
              },
              orderBy: [
                { posted_date: "desc" as any },
                { created_at: "desc" as any },
                { id: "desc" as any },
              ],
              take: 1,
              select: { posted_date: true },
            })
          : Promise.resolve([]),
        prisma.entry.findFirst({
          where: {
            business_id: businessId,
            account_id: accountId,
            deleted_at: null,
          },
          orderBy: [
            { date: "desc" as any },
            { created_at: "desc" as any },
            { id: "desc" as any },
          ],
          select: { date: true },
        }),
      ]);

      const candidates = [
        latestNonPlaid?.posted_date ? { date: latestNonPlaid.posted_date, source: "bank_history" } : null,
        latestMatchedRows?.[0]?.posted_date ? { date: latestMatchedRows[0].posted_date, source: "matched_bank" } : null,
        latestLedgerEntry?.date ? { date: latestLedgerEntry.date, source: "ledger_entries" } : null,
      ].filter(Boolean) as Array<{ date: Date; source: string }>;
      const cutoff = candidates.sort((a, b) => b.date.getTime() - a.date.getTime())[0] ?? null;

      if (!cutoff) {
        return json(200, {
          ok: true,
          removedCount: 0,
          throughDate: null,
          historySources: [],
          message: "No bank, matched, or ledger history found for this account.",
        });
      }

      const now = new Date();
      const where: any = {
        business_id: businessId,
        account_id: accountId,
        is_removed: false,
        plaid_transaction_id: { not: null },
        posted_date: { lte: cutoff.date },
      };
      if (activeMatchedIds.length > 0) {
        where.id = { notIn: activeMatchedIds };
      }

      const updated = await prisma.bankTransaction.updateMany({
        where,
        data: {
          is_removed: true,
          removed_at: now,
          updated_at: now,
        },
      });

      await logActivity(prisma, {
        businessId: businessId,
        actorUserId: sub,
        scopeAccountId: accountId,
        eventType: "BANK_TRANSACTION_PLAID_OVERLAP_CLEANED",
        payloadJson: {
          account_id: accountId,
          removed_count: updated.count,
          through_date: cutoff.date.toISOString().slice(0, 10),
          through_source: cutoff.source,
          history_sources: candidates.map((candidate) => candidate.source),
          protected_matched_count: activeMatchedIds.length,
        },
      });

      return json(200, {
        ok: true,
        removedCount: updated.count,
        throughDate: cutoff.date.toISOString().slice(0, 10),
        throughSource: cutoff.source,
        historySources: candidates.map((candidate) => candidate.source),
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "Unknown error");
      return json(500, { ok: false, code: "CLEANUP_FAILED", error: "Plaid overlap cleanup failed.", detail: msg });
    }
  }

  // -------------------------------------------------------------------
  // POST /bank-transactions/create-entries-batch
  // Best-effort: per-item created/skipped/failed. Idempotent via source_bank_transaction_id.
  // FULL-match only (no partial): if bank txn in any ACTIVE group -> SKIPPED/FAILED.
  // -------------------------------------------------------------------
  if (isCreateEntriesBatch) {
    try {
      if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

      const az = await authorizeWrite(prisma, {
        businessId: businessId,
        scopeAccountId: accountId,
        actorUserId: sub,
        actorRole: role,
        actionKey: "reconcile.entry.create.batch",
        requiredLevel: "FULL",
        endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/create-entries-batch",
      });

      if (!az.allowed) {
        return json(403, {
          ok: false,
          error: "Policy denied",
          code: "POLICY_DENIED",
          actionKey: "reconcile.entry.create.batch",
          requiredLevel: az.requiredLevel,
          policyValue: az.policyValue,
          policyKey: az.policyKey,
        });
      }

      let body: any = {};
      try {
        body = event?.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }

      const items: any[] = Array.isArray(body?.items) ? body.items : [];
      if (items.length === 0) return json(400, { ok: false, error: "Missing items[]" });

      const results: any[] = [];

      for (const it of items) {
        const bankId = String(it?.bank_transaction_id ?? "").trim();
        if (!bankId) {
          results.push({
            bank_transaction_id: "",
            status: "FAILED",
            code: "INVALID_ITEM",
            error: "Missing bank_transaction_id",
          });
          continue;
        }

        const autoMatch = it?.autoMatch === true;

        try {
          const bankTxn = await prisma.bankTransaction.findFirst({
            where: {
              business_id: businessId,
              account_id: accountId,
              id: bankId,
              is_removed: false,
            },
            select: { id: true, posted_date: true, name: true, amount_cents: true, is_pending: true, raw: true },
          });

          if (!bankTxn) {
            results.push({
              bank_transaction_id: bankId,
              status: "FAILED",
              code: "NOT_FOUND",
              error: "Bank transaction not found",
            });
            continue;
          }
          if (bankTxn.is_pending) {
            results.push({
              bank_transaction_id: bankId,
              status: "SKIPPED",
              code: PENDING_BANK_TRANSACTION_CODE,
              error: PENDING_BANK_TRANSACTION_MESSAGE,
            });
            continue;
          }

          const entryDateYmd = isoToYmd(bankTxn.posted_date);

          // CLOSED_PERIOD based on ENTRY effective date basis
          const cp = await assertNotClosedPeriod({ prisma, businessId: businessId, dateInput: entryDateYmd });
          if (!cp.ok) {
            // Canonical cp.response already contains {ok:false, code:"CLOSED_PERIOD", error:"..."} with 409
            const parsed = (() => {
              try { return JSON.parse(cp.response.body); } catch { return { ok: false, code: "CLOSED_PERIOD", error: "This period is closed. Reopen period to modify." }; }
            })();

            results.push({
              bank_transaction_id: bankId,
              status: "FAILED",
              code: parsed?.code ?? "CLOSED_PERIOD",
              error: parsed?.error ?? "This period is closed. Reopen period to modify.",
            });
            continue;
          }

          // FULL-match only: if bank txn is in ANY ACTIVE group, we treat it as matched (no partial).
          const activeGroupIds = await activeMatchGroupIds(prisma, businessId, accountId);
          const hasActive = await hasActiveBankMatchGroup(prisma, {
            businessId,
            accountId,
            bankTransactionId: bankId,
            activeGroupIds,
          });

          if (hasActive) {
            results.push({
              bank_transaction_id: bankId,
              status: "SKIPPED",
              code: "ALREADY_MATCHED",
              error: "Bank transaction is already fully matched.",
            });
            continue;
          }

          // Idempotency: real key (source_bank_transaction_id), soft-delete friendly
          const existing = await prisma.entry.findFirst({
            where: {
              business_id: businessId,
              account_id: accountId,
              deleted_at: null,
              sourceBankTransactionId: bankId,
            } as any,
            select: { id: true },
          });

          const bankAmt = BigInt(bankTxn.amount_cents);
          const bankAbs = absBig(bankAmt);
          const sign = bankAmt < 0n ? -1n : 1n;
          const entryType = sign > 0n ? "INCOME" : "EXPENSE";
          const entryAmountCents = sign > 0n ? bankAbs : -bankAbs;

          const rawMemo = it?.memo ? String(it.memo) : "";
          const memoOverride = rawMemo.trim() ? rawMemo.trim().slice(0, 400) : "";
          const defaultMemo = `Bank txn: ${(bankTxn.name ?? "").toString().trim() || "—"} • ${bankId}`;
          const memo = memoWithCheckRef(memoOverride || defaultMemo, extractCheckNumberFromBankTransaction(bankTxn));

          const rawMethod = it?.method ? String(it.method) : "";
          const methodOverride = rawMethod.trim().toUpperCase();

          const rawCategoryId = it?.category_id ? String(it.category_id) : "";
          const categoryIdOverride = rawCategoryId.trim() ? rawCategoryId.trim() : "";

          const inferredMethod = inferMethodFromBankTransaction(bankTxn);
          const methodFinal = resolveBankEntryMethod(methodOverride, inferredMethod);
          const inferredCategory = categoryIdOverride
            ? null
            : await inferTrustedBankEntryCategory({
                prisma,
                businessId,
                accountId,
                bankTransactionId: bankId,
                payee: (bankTxn.name ?? "").toString().trim() || "Bank transaction",
                memo: memoOverride || (bankTxn.name ?? "").toString(),
                amountCents: entryAmountCents,
              });
          const categoryIdFinal = categoryIdOverride || inferredCategory?.category_id || null;

          const now = new Date();

          // If already created, optionally allow autoMatch to create group (if requested and safe)
          if (existing?.id) {
            let createdMatchGroupId: string | null = null;

            if (autoMatch) {
              await prisma.$transaction(async (tx: any) => {
                const txActiveGroupIds = await activeMatchGroupIds(tx, businessId, accountId);
                const bankAlreadyMatched = await hasActiveBankMatchGroup(tx, {
                  businessId,
                  accountId,
                  bankTransactionId: bankId,
                  activeGroupIds: txActiveGroupIds,
                });
                if (bankAlreadyMatched) {
                  const err: any = new Error("Bank transaction is already matched.");
                  err.code = "ALREADY_IN_GROUP";
                  throw err;
                }

                const entryAlreadyMatched = await hasActiveEntryMatchGroup(tx, {
                  businessId,
                  accountId,
                  entryId: existing.id,
                  activeGroupIds: txActiveGroupIds,
                });
                if (entryAlreadyMatched) {
                  const err: any = new Error("Entry is already matched.");
                  err.code = "ENTRY_ALREADY_IN_GROUP";
                  throw err;
                }

                createdMatchGroupId = await createBankEntryMatchGroup(tx, {
                  businessId,
                  accountId,
                  bankTransactionId: bankId,
                  entryId: existing.id,
                  bankAbs,
                  direction: bankAmt < 0n ? "OUTFLOW" : "INFLOW",
                  sub,
                  now,
                });
              });
            }

            results.push({
              bank_transaction_id: bankId,
              status: "SKIPPED",
              code: "DUPLICATE",
              error: "Entry already exists for this bank transaction.",
              entry_id: existing.id,
              match_group_id: createdMatchGroupId,
              auto_matched: !!createdMatchGroupId,
            });
            continue;
          }

          const possibleDuplicateCandidates = await findPossibleCreateEntryDuplicates({
            prisma,
            businessId,
            accountId,
            bankTransactionId: bankId,
            bankTxn,
            entryAmountCents,
            entryDateYmd,
          });

          if (possibleDuplicateCandidates.length > 0) {
            results.push({
              bank_transaction_id: bankId,
              status: "SKIPPED",
              code: POSSIBLE_DUPLICATE_ENTRY_CODE,
              error: POSSIBLE_DUPLICATE_ENTRY_MESSAGE,
              possible_duplicate_candidates: possibleDuplicateCandidates,
            });
            continue;
          }

          const entryId = randomUUID();
          let createdEntryId = entryId;
          let createdMatchGroupId: string | null = null;
          let existingEntryInTx = false;

          await prisma.$transaction(async (tx: any) => {
            const txActiveGroupIds = await activeMatchGroupIds(tx, businessId, accountId);
            const bankAlreadyMatched = await hasActiveBankMatchGroup(tx, {
              businessId,
              accountId,
              bankTransactionId: bankId,
              activeGroupIds: txActiveGroupIds,
            });
            if (bankAlreadyMatched) {
              const err: any = new Error("Bank transaction already matched");
              err.code = "ALREADY_IN_GROUP";
              throw err;
            }

            const existingInTx = await tx.entry.findFirst({
              where: {
                business_id: businessId,
                account_id: accountId,
                deleted_at: null,
                sourceBankTransactionId: bankId,
              } as any,
              select: { id: true },
            });

            if (existingInTx?.id) {
              createdEntryId = existingInTx.id;
              existingEntryInTx = true;

              if (autoMatch) {
                const entryAlreadyMatched = await hasActiveEntryMatchGroup(tx, {
                  businessId,
                  accountId,
                  entryId: existingInTx.id,
                  activeGroupIds: txActiveGroupIds,
                });
                if (entryAlreadyMatched) {
                  const err: any = new Error("Entry is already matched.");
                  err.code = "ENTRY_ALREADY_IN_GROUP";
                  throw err;
                }

                createdMatchGroupId = await createBankEntryMatchGroup(tx, {
                  businessId,
                  accountId,
                  bankTransactionId: bankId,
                  entryId: existingInTx.id,
                  bankAbs,
                  direction: bankAmt < 0n ? "OUTFLOW" : "INFLOW",
                  sub,
                  now,
                });
              }

              return;
            }

            const createdEntry = await tx.entry.create({
              data: {
                id: entryId,
                business_id: businessId,
                account_id: accountId,
                date: new Date(`${entryDateYmd}T00:00:00Z`),
                payee: (bankTxn.name ?? "").toString().trim() || "Bank transaction",
                memo,
                amount_cents: entryAmountCents,
                type: entryType,
                method: methodFinal,
                // CLEARED when immediately matched to a posted bank transaction;
                // EXPECTED when the user still needs to review and confirm the match.
                status: autoMatch ? "CLEARED" : "EXPECTED",
                category_id: categoryIdFinal,
                deleted_at: null,
                sourceBankTransactionId: bankId,
                created_at: now,
                updated_at: now,
              } as any,
              select: { id: true },
            });

            if (autoMatch) {
              createdMatchGroupId = await createBankEntryMatchGroup(tx, {
                businessId,
                accountId,
                bankTransactionId: bankId,
                entryId: createdEntry.id,
                bankAbs,
                direction: bankAmt < 0n ? "OUTFLOW" : "INFLOW",
                sub,
                now,
              });
            }
          });

          results.push({
            bank_transaction_id: bankId,
            status: existingEntryInTx ? "SKIPPED" : "CREATED",
            ...(existingEntryInTx ? { code: "DUPLICATE", error: "Entry already exists for this bank transaction." } : {}),
            entry_id: createdEntryId,
            match_group_id: createdMatchGroupId,
            auto_matched: !!createdMatchGroupId,
            category_id: categoryIdFinal,
            category_auto_applied: !categoryIdOverride && !!inferredCategory,
          });
        } catch (e: any) {
          const code = String(e?.code ?? "BATCH_CREATE_FAILED");
          const msg = String(e?.message ?? "Create failed");

          if (code === "ALREADY_IN_GROUP") {
            results.push({
              bank_transaction_id: String(it?.bank_transaction_id ?? ""),
              status: "FAILED",
              code: "ALREADY_IN_GROUP",
              error: "Bank transaction is already matched.",
            });
            continue;
          }
          if (code === "ENTRY_ALREADY_IN_GROUP") {
            results.push({
              bank_transaction_id: String(it?.bank_transaction_id ?? ""),
              status: "FAILED",
              code: "ALREADY_IN_GROUP",
              error: "Entry is already matched.",
            });
            continue;
          }

          results.push({
            bank_transaction_id: String(it?.bank_transaction_id ?? ""),
            status: "FAILED",
            code: "CREATE_FAILED",
            error: msg,
          });
        }
      }

      return json(200, { ok: true, results });
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "Unknown error");
      return json(500, { ok: false, code: "BATCH_FAILED", error: "Batch create failed.", detail: msg });
    }
  }

  // -------------------------------------------------------
  // POST /bank-transactions/{bankTransactionId}/create-entry
  // - Creates a ledger entry derived from the bank txn
  // - Optional FULL auto-match via MatchGroups (v2)
  // -------------------------------------------------------
  if (isCreateEntry) {
    try {
      if (!canWrite(role)) return json(403, { ok: false, error: "Insufficient permissions" });

      const az = await authorizeWrite(prisma, {
        businessId: businessId,
        scopeAccountId: accountId,
        actorUserId: sub,
        actorRole: role,
        actionKey: "reconcile.entry.create",
        requiredLevel: "FULL",
        endpointForLog: "POST /v1/businesses/{businessId}/accounts/{accountId}/bank-transactions/{bankTransactionId}/create-entry",
      });

      if (!az.allowed) {
        return json(403, {
          ok: false,
          error: "Policy denied",
          code: "POLICY_DENIED",
          actionKey: "reconcile.entry.create",
          requiredLevel: az.requiredLevel,
          policyValue: az.policyValue,
          policyKey: az.policyKey,
        });
      }

      let body: any = {};
      try {
        body = event?.body ? JSON.parse(event.body) : {};
      } catch {
        return json(400, { ok: false, error: "Invalid JSON body" });
      }

      const autoMatch = body?.autoMatch === true;
      const allowPossibleDuplicate = body?.allowPossibleDuplicate === true;
      const pendingEntryConsent = body?.pendingEntryConsent === true;

      const rawMemo = body?.memo ? String(body.memo) : "";
      const memoOverride = rawMemo.trim() ? rawMemo.trim().slice(0, 400) : "";

      const rawMethod = body?.method ? String(body.method) : "";
      const methodOverride = rawMethod.trim().toUpperCase();

      const rawCategoryId = body?.category_id ? String(body.category_id) : "";
      const categoryIdOverride = rawCategoryId.trim() ? rawCategoryId.trim() : "";

      const suggestedCategoryRaw = body?.suggested_category_id ?? body?.suggestedCategoryId ?? "";
      const suggestedCategoryId = String(suggestedCategoryRaw ?? "").trim();

      const bankTxn = await prisma.bankTransaction.findFirst({
        where: {
          business_id: businessId,
          account_id: accountId,
          id: bankTransactionId,
          is_removed: false,
        },
        select: {
          id: true,
          posted_date: true,
          name: true,
          amount_cents: true,
          is_pending: true,
          raw: true,
        },
      });

      if (!bankTxn) return json(404, { ok: false, error: "Bank transaction not found" });
      if (bankTxn.is_pending) {
        if (!pendingEntryConsent) {
          return json(409, {
            ok: false,
            code: PENDING_ENTRY_CONSENT_REQUIRED_CODE,
            error: PENDING_ENTRY_CONSENT_REQUIRED_MESSAGE,
          });
        }
        if (autoMatch) {
          return json(409, {
            ok: false,
            code: PENDING_AUTO_MATCH_NOT_ALLOWED_CODE,
            error: PENDING_AUTO_MATCH_NOT_ALLOWED_MESSAGE,
          });
        }
      }

      const bankAmt = BigInt(bankTxn.amount_cents);
      const bankAbs = absBig(bankAmt);

      // ENTRY effective date basis (ymd used to set Entry.date)
      const entryDateYmd = isoToYmd(bankTxn.posted_date);

      // CLOSED_PERIOD based on ENTRY effective date basis
      const cp = await assertNotClosedPeriod({ prisma, businessId: businessId, dateInput: entryDateYmd });
      if (!cp.ok) return cp.response;

      // FULL-match only: if bank txn is in ANY ACTIVE group, treat as matched (no partial remaining calc).
      const activeGroupIds = await activeMatchGroupIds(prisma, businessId, accountId);
      const hasActive = await hasActiveBankMatchGroup(prisma, {
        businessId,
        accountId,
        bankTransactionId,
        activeGroupIds,
      });

      if (hasActive) {
        return json(409, {
          ok: false,
          code: autoMatch ? "ALREADY_IN_GROUP" : "ALREADY_MATCHED",
          error: "Bank transaction is already fully matched.",
        });
      }

      // Idempotency via real key (soft-delete friendly)
      const existing = await prisma.entry.findFirst({
        where: {
          business_id: businessId,
          account_id: accountId,
          deleted_at: null,
          sourceBankTransactionId: bankTransactionId,
        } as any,
        select: { id: true },
      });

      const sign = bankAmt < 0n ? -1n : 1n;
      const entryType = sign > 0n ? "INCOME" : "EXPENSE";
      const entryAmountCents = sign > 0n ? bankAbs : -bankAbs;

      const defaultMemo = `Bank txn: ${(bankTxn.name ?? "").toString().trim() || "—"} • ${bankTransactionId}`;
      const memo = memoWithCheckRef(memoOverride || defaultMemo, extractCheckNumberFromBankTransaction(bankTxn));

      const inferredMethod = inferMethodFromBankTransaction(bankTxn);
      const methodFinal = resolveBankEntryMethod(methodOverride, inferredMethod);
      const inferredCategory = categoryIdOverride
        ? null
        : await inferTrustedBankEntryCategory({
            prisma,
            businessId,
            accountId,
            bankTransactionId,
            payee: (bankTxn.name ?? "").toString().trim() || "Bank transaction",
            memo: memoOverride || (bankTxn.name ?? "").toString(),
            amountCents: entryAmountCents,
          });
      const categoryIdFinal = categoryIdOverride || inferredCategory?.category_id || null;
      const effectiveSuggestedCategoryId = suggestedCategoryId || inferredCategory?.category_id || "";

      const now = new Date();
      const entryId = randomUUID();

      // If entry already exists for this bank txn, optionally allow autoMatch to create group (if safe).
      if (existing?.id) {
        let createdMatchGroupId: string | null = null;

        if (autoMatch) {
          await prisma.$transaction(async (tx: any) => {
            const txActiveGroupIds = await activeMatchGroupIds(tx, businessId, accountId);
            const bankAlreadyMatched = await hasActiveBankMatchGroup(tx, {
              businessId,
              accountId,
              bankTransactionId,
              activeGroupIds: txActiveGroupIds,
            });
            if (bankAlreadyMatched) {
              const err: any = new Error("Bank transaction is already matched.");
              err.code = "ALREADY_IN_GROUP";
              throw err;
            }

            const entryAlreadyMatched = await hasActiveEntryMatchGroup(tx, {
              businessId,
              accountId,
              entryId: existing.id,
              activeGroupIds: txActiveGroupIds,
            });
            if (entryAlreadyMatched) {
              const err: any = new Error("Entry is already matched.");
              err.code = "ENTRY_ALREADY_IN_GROUP";
              throw err;
            }

            createdMatchGroupId = await createBankEntryMatchGroup(tx, {
              businessId,
              accountId,
              bankTransactionId,
              entryId: existing.id,
              bankAbs,
              direction: bankAmt < 0n ? "OUTFLOW" : "INFLOW",
              sub,
              now,
            });
          });
        }

        return json(200, {
          ok: true,
          entry_id: existing.id,
          match_group_id: createdMatchGroupId,
          auto_matched: !!createdMatchGroupId,
          pending_entry: !!bankTxn.is_pending,
          requires_posting_before_match: !!bankTxn.is_pending,
        });
      }

      const possibleDuplicateCandidates = await findPossibleCreateEntryDuplicates({
        prisma,
        businessId,
        accountId,
        bankTransactionId,
        bankTxn,
        entryAmountCents,
        entryDateYmd,
      });

      if (possibleDuplicateCandidates.length > 0 && !allowPossibleDuplicate) {
        return json(409, {
          ok: false,
          code: POSSIBLE_DUPLICATE_ENTRY_CODE,
          error: POSSIBLE_DUPLICATE_ENTRY_MESSAGE,
          possible_duplicate_candidates: possibleDuplicateCandidates,
        });
      }

      const result = await prisma.$transaction(async (tx: any) => {
        const txActiveGroupIds = await activeMatchGroupIds(tx, businessId, accountId);
        const bankAlreadyMatched = await hasActiveBankMatchGroup(tx, {
          businessId,
          accountId,
          bankTransactionId,
          activeGroupIds: txActiveGroupIds,
        });
        if (bankAlreadyMatched) {
          const err: any = new Error("Bank transaction already matched");
          err.code = "ALREADY_IN_GROUP";
          throw err;
        }

        const existingInTx = await tx.entry.findFirst({
          where: {
            business_id: businessId,
            account_id: accountId,
            deleted_at: null,
            sourceBankTransactionId: bankTransactionId,
          } as any,
          select: { id: true },
        });

        if (existingInTx?.id) {
          let createdMatchGroupId: string | null = null;

          if (autoMatch) {
            const entryAlreadyMatched = await hasActiveEntryMatchGroup(tx, {
              businessId,
              accountId,
              entryId: existingInTx.id,
              activeGroupIds: txActiveGroupIds,
            });
            if (entryAlreadyMatched) {
              const err: any = new Error("Entry is already matched.");
              err.code = "ENTRY_ALREADY_IN_GROUP";
              throw err;
            }

            createdMatchGroupId = await createBankEntryMatchGroup(tx, {
              businessId,
              accountId,
              bankTransactionId,
              entryId: existingInTx.id,
              bankAbs,
              direction: bankAmt < 0n ? "OUTFLOW" : "INFLOW",
              sub,
              now,
            });
          }

          return { createdEntryId: existingInTx.id, createdMatchGroupId, existingEntry: true };
        }

        const createdEntry = await tx.entry.create({
          data: {
            id: entryId,
            business_id: businessId,
            account_id: accountId,
            date: new Date(`${entryDateYmd}T00:00:00Z`),
            sourceBankTransactionId: bankTransactionId,
            payee: (bankTxn.name ?? "").toString().trim() || "Bank transaction",
            memo,
            amount_cents: entryAmountCents,
            type: entryType,
            method: methodFinal,
            // CLEARED when immediately matched to a posted bank transaction;
            // EXPECTED when the user still needs to review and confirm the match.
            status: autoMatch ? "CLEARED" : "EXPECTED",
            category_id: categoryIdFinal,
            deleted_at: null,
            created_at: now,
            updated_at: now,
          },
          select: { id: true },
        });

        let createdMatchGroupId: string | null = null;

        if (autoMatch) {
          createdMatchGroupId = await createBankEntryMatchGroup(tx, {
            businessId,
            accountId,
            bankTransactionId,
            entryId: createdEntry.id,
            bankAbs,
            direction: bankAmt < 0n ? "OUTFLOW" : "INFLOW",
            sub,
            now,
          });
        }

        return { createdEntryId: createdEntry.id, createdMatchGroupId, existingEntry: false };
      });

      if (result.existingEntry) {
        return json(200, {
          ok: true,
          entry_id: result.createdEntryId,
          match_group_id: result.createdMatchGroupId,
          auto_matched: !!result.createdMatchGroupId,
          pending_entry: !!bankTxn.is_pending,
          requires_posting_before_match: !!bankTxn.is_pending,
        });
      }

      if (categoryIdFinal) {
        await writeCategoryMemoryFeedback({
          prisma,
          business_id: businessId,
          entry: {
            id: result.createdEntryId,
            payee: (bankTxn.name ?? "").toString().trim() || "Bank transaction",
            memo,
            amount_cents: entryAmountCents,
            type: entryType,
          },
          selected_category_id: categoryIdFinal,
          suggested_category_id: effectiveSuggestedCategoryId || null,
        });
      }

      await logActivity(prisma, {
        businessId: businessId,
        actorUserId: sub,
        scopeAccountId: accountId,
        eventType: "RECONCILE_MATCH_CREATED",
        payloadJson: {
          action: "BANK_TXN_CREATE_ENTRY",
          account_id: accountId,
          bank_transaction_id: bankTransactionId,
          entry_id: result.createdEntryId,
          auto_matched: !!result.createdMatchGroupId,
          match_group_id: result.createdMatchGroupId,
          duplicate_warning_overridden: allowPossibleDuplicate && possibleDuplicateCandidates.length > 0,
          possible_duplicate_candidates: allowPossibleDuplicate ? possibleDuplicateCandidates : undefined,
          pending_entry: !!bankTxn.is_pending,
          pending_entry_consent: !!bankTxn.is_pending && pendingEntryConsent,
          remaining_abs_cents: result.createdMatchGroupId ? "0" : bankAbs.toString(),
        },
      });

      return json(201, {
        ok: true,
        entry_id: result.createdEntryId,
        match_group_id: result.createdMatchGroupId,
        auto_matched: !!result.createdMatchGroupId,
        duplicate_warning_overridden: allowPossibleDuplicate && possibleDuplicateCandidates.length > 0,
        pending_entry: !!bankTxn.is_pending,
        requires_posting_before_match: !!bankTxn.is_pending,
        category_id: categoryIdFinal,
        category_auto_applied: !categoryIdOverride && !!inferredCategory,
        category_suggestion_source: inferredCategory?.source ?? null,
      });
    } catch (e: any) {
      const code = String(e?.code ?? "");
      if (code === "ALREADY_IN_GROUP") {
        return json(409, { ok: false, code: "ALREADY_IN_GROUP", error: "Bank transaction is already matched." });
      }
      if (code === "ENTRY_ALREADY_IN_GROUP") {
        return json(409, { ok: false, code: "ALREADY_IN_GROUP", error: "Entry is already matched." });
      }

      const msg = String(e?.message ?? e ?? "Unknown error");
      return json(500, {
        ok: false,
        code: "CREATE_ENTRY_FAILED",
        error: "Create-entry failed.",
        detail: msg,
      });
    }
  }

  // -------------------------
  // GET list
  // -------------------------
  const q = event?.queryStringParameters ?? {};
  const limit = parseLimit(q);
  const status = parseStatusParam(q);
  if (!status) return json(400, { ok: false, error: "Invalid status" });

  const from = parseDateParam(q?.from ?? null);
  const to = parseDateParam(q?.to ?? null);
  const rawCursor = (q?.cursor ?? "").toString().trim();
  const cursor = rawCursor ? parseCursorParam(rawCursor) : null;
  if (rawCursor && !cursor) return json(400, { ok: false, error: "Invalid cursor" });

  // whereBase = filters without the cursor (used for the count).
  // where = whereBase + cursor (used for the page fetch).
  const whereBase: any = {
    business_id: businessId,
    account_id: accountId,
    is_removed: false,
  };
  if (from || to) {
    whereBase.posted_date = {};
    if (from) whereBase.posted_date.gte = from;
    if (to) whereBase.posted_date.lte = to;
  }

  if (status !== "all") {
    const matchedIds = await activeMatchedBankTransactionIds(prisma, businessId, accountId);

    if (status === "matched") {
      if (matchedIds.length === 0) {
        return json(200, { ok: true, items: [], nextCursor: null, totalCount: 0 });
      }
      // Active match history is an accounting audit record. Older Plaid sync
      // behavior could mark the bank row removed when Plaid rotated an ID;
      // keep that actively matched row visible until the match is voided.
      delete whereBase.is_removed;
      whereBase.id = { in: matchedIds };
    } else {
      whereBase.id = { notIn: matchedIds };
      // Zero-amount bank transactions (e.g. Plaid "fee waiver" reward line
      // items) can never be matched — match groups reject a $0 bank side —
      // so they would sit in the Unmatched queue forever as noise. Exclude
      // them from the needs-action (unmatched) view and its count. They are
      // still visible under the "All" tab.
      whereBase.amount_cents = { not: 0n };
    }
  }

  const where: any = cursor
    ? { ...whereBase, AND: [...(whereBase.AND ?? []), cursorWhere(cursor)] }
    : whereBase;

  // PERF: count + findMany in parallel. Lets the frontend show "Showing N of
  // M" without doing a 20-page probe loop just to compute M. The count uses
  // the un-cursored whereBase so it's stable across paging.
  const [rows, totalCount] = await Promise.all([
    prisma.bankTransaction.findMany({
      where,
      orderBy: [{ posted_date: "desc" }, { created_at: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: {
        id: true,
        posted_date: true,
        name: true,
        amount_cents: true,
        is_pending: true,
        iso_currency_code: true,
        source: true,
        source_parser: true,
        source_upload_id: true,
        source_removed_at: true,
        source_removal_code: true,
        import_hash: true,
        created_at: true,
        raw: true,
      },
    }),
    prisma.bankTransaction.count({ where: whereBase }),
  ]);

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const items = pageRows.map((row: any) => {
    const { raw, ...rest } = row;
    return {
      ...rest,
      check_number: extractCheckNumberFromBankTransaction(row) || null,
    };
  });
  const nextCursor = hasMore ? encodeCursor(pageRows[pageRows.length - 1]) : null;

  return json(200, { ok: true, items, nextCursor, totalCount });
}
