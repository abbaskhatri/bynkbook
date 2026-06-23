// Pure helper functions and types extracted from reconcile/page-client.tsx.
// No React, no JSX, no closures over component state — moving them out
// shrinks the page-client file without changing any behavior.
//
// IMPORTANT: every function in this file MUST behave identically to the
// previous in-file version. Do not modify logic; this file exists purely
// to relocate code that didn't belong in a page-client.

import type { MatchGroupPlacementSummary } from "@/lib/api/match-groups";

export type BankTab = "unmatched" | "matched";

export type MatchSignalTone = "default" | "success" | "warning" | "danger";

// These delegate to the canonical lib/money.ts implementations.
// They keep the same exported names so existing call sites don't change.
// Reconcile's display style: NO dollar sign (denser tables), parens for negatives.
import { formatUsd, toBigIntSafe as moneyToBigIntSafe } from "@/lib/money";
export const toBigIntSafe = moneyToBigIntSafe;

export function absBig(n: bigint) {
  return n < 0n ? -n : n;
}

export function formatUsdFromCents(cents: bigint) {
  return formatUsd(cents, { dollarSign: false });
}

export function ymdToTime(ymd: string): number {
  try {
    const n = new Date(`${ymd}T00:00:00Z`).getTime();
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function isoToYmd(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

export function normalizeDesc(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(des|desc|id|indn|trn|conf#|conf)\b/g, " ")
    .replace(/[0-9]/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenSet(s: string): Set<string> {
  const t = normalizeDesc(s);
  const parts = t.split(" ").filter(Boolean);
  return new Set(parts.filter((p) => p.length >= 3));
}

export function tokenOverlap(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit;
}

export function scoreEntryCandidate(bank: any, entry: any) {
  const bankAmt = toBigIntSafe(bank?.amount_cents);
  const bankAbs = absBig(bankAmt);
  const bankTime = bank?.posted_date ? new Date(bank.posted_date).getTime() : 0;

  const entryAmt = toBigIntSafe(entry?.amount_cents);
  const entryAbs = absBig(entryAmt);

  const diff = entryAbs > bankAbs ? entryAbs - bankAbs : bankAbs - entryAbs;
  const dtMs = bankTime ? Math.abs(new Date(`${entry?.date}T00:00:00Z`).getTime() - bankTime) : 0;
  const dtDays = bankTime ? Math.floor(dtMs / 86_400_000) : 9999;

  const overlapRaw = tokenOverlap(String(bank?.name ?? ""), String(entry?.payee ?? ""));
  const overlap = Math.min(overlapRaw, 3);

  const diffN = Number(diff);
  const tokenBonus = diff === 0n && dtDays <= 3 ? overlap * 50_000 : 0;
  const score = diffN * 1_000_000 + dtDays * 10_000 - tokenBonus;

  return {
    score,
    diff,
    dtDays,
    overlap,
    exactAmount: diff === 0n,
  };
}

export function scoreBankCandidate(entry: any, bank: any) {
  const entryAmt = toBigIntSafe(entry?.amount_cents);
  const entryAbs = absBig(entryAmt);
  const entryTime = entry?.date ? new Date(`${entry.date}T00:00:00Z`).getTime() : 0;

  const bankAmt = toBigIntSafe(bank?.amount_cents);
  const bankAbs = absBig(bankAmt);

  const diff = bankAbs > entryAbs ? bankAbs - entryAbs : entryAbs - bankAbs;
  const dtMs = entryTime ? Math.abs(new Date(bank?.posted_date).getTime() - entryTime) : 0;
  const dtDays = entryTime ? Math.floor(dtMs / 86_400_000) : 9999;

  const overlapRaw = tokenOverlap(String(entry?.payee ?? ""), String(bank?.name ?? ""));
  const overlap = Math.min(overlapRaw, 3);

  const diffN = Number(diff);
  const tokenBonus = diff === 0n && dtDays <= 3 ? overlap * 50_000 : 0;
  const score = diffN * 1_000_000 + dtDays * 10_000 - tokenBonus;

  return {
    score,
    diff,
    dtDays,
    overlap,
    exactAmount: diff === 0n,
  };
}

export function pctConfidence(v: number) {
  const n = Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100);
  return `${n}%`;
}

export function categorySuggestionConfidence(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function categorySuggestionTierLabel(raw: unknown) {
  const tier = String(raw ?? "").trim().toUpperCase();
  if (tier === "SAFE_DETERMINISTIC") return "Strong suggestion";
  if (tier === "STRONG_SUGGESTION") return "Strong suggestion";
  if (tier === "ALTERNATE") return "Alternate";
  if (tier === "REVIEW_BUCKET") return "Review needed";
  return "Suggestion";
}

export function categorySuggestionSourceLabel(raw: unknown) {
  const source = String(raw ?? "").trim().toUpperCase();
  if (source === "VENDOR_DEFAULT") return "Vendor default";
  if (source === "MEMORY") return "Learned from your history";
  if (source === "HEURISTIC") return "Pattern match";
  if (source === "AI") return "AI suggestion";
  return "Suggestion";
}

export function categorySuggestionRequiresReview(suggestion: any) {
  return (
    suggestion?.requiresUserConfirmation === true ||
    suggestion?.review_only === true ||
    suggestion?.reviewOnly === true ||
    suggestion?.protected === true ||
    suggestion?.is_protected === true ||
    suggestion?.isProtected === true ||
    !!String(suggestion?.protected_class ?? suggestion?.protectedClass ?? "").trim()
  );
}

// Delegates to the canonical lib/errors/ai helper. Preserves the
// reconcile-specific wording ("Try again in a little while" implies
// short-lived rate-limit, not daily) and the original fallback text.
import { aiUserMessage } from "@/lib/errors/ai";

export function aiUiMessage(err: any, fallback = "Smart suggestions are unavailable right now.") {
  return aiUserMessage(err, {
    fallback,
    quotaMessage: "AI quota reached. Try again in a little while.",
  });
}

export function truncateAiReason(reason: string, max = 120) {
  const s = String(reason ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export function ymdFromBankTxn(bank: any) {
  const raw = String(bank?.posted_date ?? "");
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return isoToYmd(raw);
}

export function ymdFromUnknownDate(value: unknown) {
  const raw = String(value ?? "");
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return isoToYmd(raw);
}

export function compactText(value: unknown, fallback = "—") {
  const s = String(value ?? "").trim();
  return s || fallback;
}

const INACTIVE_ENTRY_STATUSES = new Set(["DELETED", "SOFT_DELETED", "VOIDED", "REMOVED"]);

export function isInactiveEntryRecord(row: any) {
  if (!row) return false;
  if (row.deleted_at || row.deletedAt) return true;
  if (row.voided_at || row.voidedAt) return true;
  if (row.removed_at || row.removedAt) return true;
  const status = String(row?.status ?? row?.entry_status ?? row?.entryStatus ?? "").trim().toUpperCase();
  return INACTIVE_ENTRY_STATUSES.has(status);
}

export function extractCheckRefFromBankTransaction(bank: any) {
  const explicit = compactText(
    bank?.check_number ?? bank?.checkNumber ?? bank?.check_num ?? bank?.checkNum ?? "",
    ""
  ).replace(/[^0-9A-Za-z-]/g, "");
  if (explicit) return explicit;

  const text = [
    bank?.name,
    bank?.merchant_name,
    bank?.original_description,
    bank?.payment_channel,
  ].map((v) => String(v ?? "")).join(" ");

  const match = text.match(/\b(?:check|chk)\s*(?:#|no\.?|number)?\s*([0-9]{2,8})\b/i) ??
    text.match(/\bdeposit\s+check\s*(?:#|no\.?|number)?\s*([0-9]{2,8})\b/i);
  return compactText(match?.[1] ?? "", "");
}

export function extractEntryRefFromEntry(entry: any) {
  const explicit = compactText(
    entry?.ref ?? entry?.reference ?? entry?.reference_number ?? entry?.referenceNumber ?? "",
    ""
  );
  if (explicit) return explicit;

  const memo = String(entry?.memo ?? "");
  const match = memo.match(/\bref\s*:\s*([^\n\r;|,]+)/i);
  return compactText(match?.[1] ?? "", "");
}

export function inferMethodFromBankTransaction(bank: any) {
  if (extractCheckRefFromBankTransaction(bank)) return "CHECK";

  const text = [
    bank?.name,
    bank?.merchant_name,
    bank?.original_description,
    bank?.payment_channel,
  ].map((v) => String(v ?? "")).join(" ");

  if (/\b(?:bank\s*card|bankcard|merchant\s+services?|card\s+settlement|card\s+deposit)\b/i.test(text)) return "CARD";
  if (/\bzelle\b/i.test(text)) return "ZELLE";
  if (/\bwire(?:\s+type)?\b/i.test(text)) return "WIRE";
  if (/\bach\b/i.test(text)) return "ACH";
  if (/\b(?:check|chk)\b/i.test(text)) return "CHECK";
  if (/\b(?:mobile|remote|pre\s*encoded|preencoded)\b[\s\S]{0,40}\bdeposit\b/i.test(text)) return "CHECK";
  if (/\bdeposit\b[\s\S]{0,40}\b(?:mobile|remote|pre\s*encoded|preencoded)\b/i.test(text)) return "CHECK";
  if (/\bdirect\s+deposit\b/i.test(text)) return "DIRECT_DEPOSIT";
  if (/\btransfer\b/i.test(text)) return "TRANSFER";
  return "OTHER";
}

export function directionLabel(amountCents: unknown) {
  return toBigIntSafe(amountCents) < 0n ? "Outflow" : "Inflow";
}

export function sameAmountAbs(a: unknown, b: unknown) {
  return absBig(toBigIntSafe(a)) === absBig(toBigIntSafe(b));
}

export function sameDirection(a: unknown, b: unknown) {
  const aVal = toBigIntSafe(a);
  const bVal = toBigIntSafe(b);
  if (aVal === 0n || bVal === 0n) return false;
  return (aVal < 0n && bVal < 0n) || (aVal > 0n && bVal > 0n);
}

export function duplicateReasonChips(bank: any, candidate: any, matchStatus: string) {
  const chips: Array<{ label: string; tone?: MatchSignalTone; title?: string }> = [];
  const candidateForScore = {
    ...(candidate ?? {}),
    date: ymdFromUnknownDate(candidate?.date),
  };
  const meta = scoreEntryCandidate(bank, candidateForScore);
  const duplicateReason = String(candidate?.duplicate_reason ?? candidate?.duplicateReason ?? "").trim();
  const duplicateConfidence = String(candidate?.duplicate_confidence ?? candidate?.duplicateConfidence ?? "").trim().toLowerCase();

  if (duplicateReason === "generic_bank_manual_same_amount") {
    chips.push({
      label: "generic bank deposit",
      tone: "warning",
      title: "Bank description is generic, but amount/date match an existing manual ledger entry.",
    });
  }

  if (duplicateConfidence === "high") {
    chips.push({ label: "high confidence", tone: "warning" });
  }

  if (sameAmountAbs(bank?.amount_cents, candidate?.amount_cents)) {
    chips.push({ label: "same amount", tone: "success" });
  }

  if (Number(meta.dtDays ?? 9999) <= 3) {
    chips.push({
      label: "nearby date",
      tone: "success",
      title: `${meta.dtDays} day${meta.dtDays === 1 ? "" : "s"} apart`,
    });
  }

  if (Number(meta.overlap ?? 0) > 0) {
    chips.push({ label: "similar payee", tone: "success" });
  }

  if (sameDirection(bank?.amount_cents, candidate?.amount_cents)) {
    chips.push({ label: "same direction", tone: "success" });
  }

  if (matchStatus) {
    chips.push({
      label: matchStatus.toLowerCase().includes("matched") ? "existing matched" : "existing unmatched",
      tone: matchStatus.toLowerCase().includes("matched") ? "warning" : "default",
    });
  }

  return chips.length ? chips : [{ label: "possible duplicate", tone: "warning" as const }];
}

export function entryCategoryLabel(entry: any) {
  return compactText(
    entry?.category_name ??
      entry?.categoryName ??
      entry?.category?.name ??
      entry?.category?.title ??
      ""
  );
}

export function bankCategoryLabel(bank: any) {
  return compactText(
    bank?.category_name ??
      bank?.categoryName ??
      bank?.category?.name ??
      bank?.merchant_category ??
      bank?.personal_finance_category?.primary ??
      ""
  );
}

export function accountLabelFor(row: any, fallbackAccountName?: string) {
  return compactText(row?.account_name ?? row?.accountName ?? row?.account?.name ?? fallbackAccountName ?? "");
}

export function matchSignalMeta(bank: any, entry: any, direction: "bankToEntry" | "entryToBank") {
  return direction === "bankToEntry" ? scoreEntryCandidate(bank, entry) : scoreBankCandidate(entry, bank);
}

export function matchSignalChips(meta: any, similarCandidateCount: number, aiConfidence?: number | null) {
  const chips: Array<{ label: string; tone?: MatchSignalTone; title?: string }> = [];
  const diff = toBigIntSafe(meta?.diff);
  const dtDays = Number(meta?.dtDays ?? 9999);
  const overlap = Number(meta?.overlap ?? 0);
  const confidence = typeof aiConfidence === "number" ? Math.max(0, Math.min(1, aiConfidence)) : null;

  if (diff === 0n) chips.push({ label: "Exact amount", tone: "success" });
  else chips.push({ label: "Amount mismatch", tone: "danger", title: `Difference ${formatUsdFromCents(diff)}` });

  if (dtDays === 0) chips.push({ label: "Same date", tone: "success" });
  else if (dtDays <= 3) chips.push({ label: "Near date", tone: "default", title: `${dtDays} day${dtDays === 1 ? "" : "s"} apart` });
  else chips.push({ label: "Date mismatch", tone: "warning", title: `${dtDays} day${dtDays === 1 ? "" : "s"} apart` });

  if (overlap >= 2) chips.push({ label: "Similar payee", tone: "success" });
  else if (overlap === 1) chips.push({ label: "Some payee overlap", tone: "default" });
  else chips.push({ label: "Payee differs", tone: "warning" });

  if (similarCandidateCount > 1) {
    chips.push({
      label: "Not unique",
      tone: "warning",
      title: `${similarCandidateCount} similar candidates are visible for review`,
    });
  }

  if (confidence !== null && confidence < 0.75) {
    chips.push({ label: "Review needed", tone: "warning", title: `Confidence ${pctConfidence(confidence)}` });
  } else if (diff !== 0n || dtDays > 3 || overlap === 0 || similarCandidateCount > 1) {
    chips.push({ label: "Review needed", tone: "warning" });
  }

  return chips;
}

export function bankSignature(items: any[]): string {
  const count = Array.isArray(items) ? items.length : 0;
  let newest = "";
  for (const t of items ?? []) {
    const d = String(t?.posted_date ?? "");
    if (d && d > newest) newest = d;
  }
  return `${count}|${newest}`;
}

export function matchGroupSignature(items: any[]): string {
  const active = (items ?? [])
    .filter((g: any) => String(g?.status ?? "").toUpperCase() === "ACTIVE")
    .map((g: any) => String(g?.id ?? ""))
    .filter(Boolean)
    .sort();
  return active.join("|");
}

export function upsertMatchGroup(items: any[], group: any): any[] {
  const gid = String(group?.id ?? "");
  if (!gid) return Array.isArray(items) ? items : [];

  const next = Array.isArray(items) ? items.slice() : [];
  const i = next.findIndex((g: any) => String(g?.id ?? "") === gid);
  if (i >= 0) next[i] = group;
  else next.unshift(group);
  return next;
}

export function matchGroupsFromPlacementSummary(summary: MatchGroupPlacementSummary | null): any[] {
  const groupsById = new Map<string, any>();

  for (const link of summary?.activeBankLinks ?? []) {
    const groupId = String(link?.match_group_id ?? "").trim();
    const bankId = String(link?.bank_transaction_id ?? "").trim();
    if (!groupId || !bankId) continue;

    const group = groupsById.get(groupId) ?? { id: groupId, status: "ACTIVE", banks: [], entries: [] };
    group.banks.push({
      match_group_id: groupId,
      bank_transaction_id: bankId,
      matched_amount_cents: link.matched_amount_cents,
    });
    groupsById.set(groupId, group);
  }

  for (const link of summary?.activeEntryLinks ?? []) {
    const groupId = String(link?.match_group_id ?? "").trim();
    const entryId = String(link?.entry_id ?? "").trim();
    if (!groupId || !entryId) continue;

    const group = groupsById.get(groupId) ?? { id: groupId, status: "ACTIVE", banks: [], entries: [] };
    group.entries.push({
      match_group_id: groupId,
      entry_id: entryId,
      matched_amount_cents: link.matched_amount_cents,
    });
    groupsById.set(groupId, group);
  }

  return Array.from(groupsById.values());
}

export function entriesSignature(items: any[]): string {
  const arr = Array.isArray(items) ? items : [];
  return String(arr.length);
}

export function mergeBankTransactions(...lists: any[][]): any[] {
  const m = new Map<string, any>();
  for (const list of lists) {
    for (const row of list ?? []) {
      const id = String(row?.id ?? "").trim();
      if (id) m.set(id, row);
    }
  }
  return Array.from(m.values());
}

export function tagBankTransactionsForStatus(items: any[], status: BankTab): any[] {
  return (items ?? []).map((row: any) => ({
    ...row,
    __reconcile_loaded_status: status,
  }));
}

export function replaceBankTransactionsForStatus(prev: any[], status: BankTab, nextItems: any[]): any[] {
  const kept = (prev ?? []).filter((row: any) => row?.__reconcile_loaded_status !== status);
  return mergeBankTransactions(kept, tagBankTransactionsForStatus(nextItems, status));
}

export function compareEntryDateAsc(a: any, b: any) {
  const da = ymdToTime(String(a?.date ?? ""));
  const db = ymdToTime(String(b?.date ?? ""));
  if (da !== db) return da - db;
  return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}

export function compareEntryDateDesc(a: any, b: any) {
  const da = ymdToTime(String(a?.date ?? ""));
  const db = ymdToTime(String(b?.date ?? ""));
  if (da !== db) return db - da;
  return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}

export function bankPostedTime(t: any) {
  const n = new Date(t?.posted_date).getTime();
  return Number.isFinite(n) ? n : 0;
}

export function compareBankDateAsc(a: any, b: any) {
  const da = bankPostedTime(a);
  const db = bankPostedTime(b);
  if (da !== db) return da - db;
  return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}

export function compareBankDateDesc(a: any, b: any) {
  const da = bankPostedTime(a);
  const db = bankPostedTime(b);
  if (da !== db) return db - da;
  return String(a?.id ?? "").localeCompare(String(b?.id ?? ""));
}
