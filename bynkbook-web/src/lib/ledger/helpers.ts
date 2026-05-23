// Pure helper functions and types extracted from ledger/page-client.tsx.
// No React, no JSX, no closures over component state — moving them out
// shrinks the page-client file without changing any behavior.
//
// IMPORTANT: every function in this file MUST behave identically to the
// previous in-file version. Do not modify logic; this file exists purely
// to relocate code that didn't belong in a page-client.

import type { Entry } from "@/lib/api/entries";
import type { EntryIssueRow } from "@/lib/api/issues";

export type FixIssueKind = "DUPLICATE" | "MISSING_CATEGORY" | "STALE_CHECK";

export type FixIssueDialogRow = {
  id: string;
  date: string;
  payee: string;
  amountStr: string;
  methodDisplay: string;
  category: string;
  categoryId: string | null;
};

export type LedgerRangePreset =
  | "TODAY"
  | "YESTERDAY"
  | "LAST_7_DAYS"
  | "LAST_30_DAYS"
  | "THIS_WEEK"
  | "LAST_WEEK"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_QUARTER"
  | "LAST_QUARTER"
  | "THIS_YEAR"
  | "LAST_YEAR"
  | "CUSTOM";

export type LedgerRangeValue = {
  preset: LedgerRangePreset;
  from: string;
  to: string;
};

export type LedgerViewMode = "chronological" | "needsReconcile";

export type UiType = "INCOME" | "EXPENSE" | "TRANSFER" | "ADJUSTMENT";

export type UiMethod =
  | "CASH"
  | "CARD"
  | "ACH"
  | "WIRE"
  | "CHECK"
  | "DIRECT_DEPOSIT"
  | "ZELLE"
  | "TRANSFER"
  | "OTHER";

export const ZERO = BigInt(0);
export const HUNDRED = BigInt(100);
export const ENTRIES_API_MAX_LIMIT = 200;

export function daysUntilYmd(ymd: string): number | null {
  const s = String(ymd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;

  const [y, m, d] = s.split("-").map((x) => Number(x));
  const target = new Date(y, m - 1, d);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffMs = target.getTime() - today.getTime();
  return Math.floor(diffMs / 86400000);
}

export function todayYmd() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function allTimeStartYmd() {
  return "2000-01-01";
}

export function ledgerCategorySuggestionRequiresReview(suggestion: any) {
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

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function dateToYmdLocal(dt: Date) {
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

export function parseYmdLocal(ymd: string) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function startOfWeek(dt: Date) {
  const copy = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const day = copy.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + delta);
  return copy;
}

export function endOfWeek(dt: Date) {
  const copy = startOfWeek(dt);
  copy.setDate(copy.getDate() + 6);
  return copy;
}

export function startOfMonthLocal(dt: Date) {
  return new Date(dt.getFullYear(), dt.getMonth(), 1);
}

export function endOfMonthLocal(dt: Date) {
  return new Date(dt.getFullYear(), dt.getMonth() + 1, 0);
}

export function startOfQuarterLocal(dt: Date) {
  const quarterMonth = Math.floor(dt.getMonth() / 3) * 3;
  return new Date(dt.getFullYear(), quarterMonth, 1);
}

export function endOfQuarterLocal(dt: Date) {
  const start = startOfQuarterLocal(dt);
  return new Date(start.getFullYear(), start.getMonth() + 3, 0);
}

export function startOfYearLocal(dt: Date) {
  return new Date(dt.getFullYear(), 0, 1);
}

export function endOfYearLocal(dt: Date) {
  return new Date(dt.getFullYear(), 11, 31);
}

export function addDaysLocal(dt: Date, days: number) {
  const copy = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function getLedgerRangeValue(preset: LedgerRangePreset): LedgerRangeValue {
  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  switch (preset) {
    case "TODAY":
      return { preset, from: dateToYmdLocal(current), to: dateToYmdLocal(current) };
    case "YESTERDAY": {
      const d = addDaysLocal(current, -1);
      return { preset, from: dateToYmdLocal(d), to: dateToYmdLocal(d) };
    }
    case "LAST_7_DAYS":
      return { preset, from: dateToYmdLocal(addDaysLocal(current, -6)), to: dateToYmdLocal(current) };
    case "LAST_30_DAYS":
      return { preset, from: dateToYmdLocal(addDaysLocal(current, -29)), to: dateToYmdLocal(current) };
    case "THIS_WEEK":
      return { preset, from: dateToYmdLocal(startOfWeek(current)), to: dateToYmdLocal(endOfWeek(current)) };
    case "LAST_WEEK": {
      const anchor = addDaysLocal(startOfWeek(current), -1);
      return { preset, from: dateToYmdLocal(startOfWeek(anchor)), to: dateToYmdLocal(endOfWeek(anchor)) };
    }
    case "THIS_MONTH":
      return { preset, from: dateToYmdLocal(startOfMonthLocal(current)), to: dateToYmdLocal(endOfMonthLocal(current)) };
    case "LAST_MONTH": {
      const anchor = new Date(current.getFullYear(), current.getMonth() - 1, 1);
      return { preset, from: dateToYmdLocal(startOfMonthLocal(anchor)), to: dateToYmdLocal(endOfMonthLocal(anchor)) };
    }
    case "THIS_QUARTER":
      return { preset, from: dateToYmdLocal(startOfQuarterLocal(current)), to: dateToYmdLocal(endOfQuarterLocal(current)) };
    case "LAST_QUARTER": {
      const currentQuarterStart = startOfQuarterLocal(current);
      const anchor = new Date(currentQuarterStart.getFullYear(), currentQuarterStart.getMonth() - 1, 1);
      return { preset, from: dateToYmdLocal(startOfQuarterLocal(anchor)), to: dateToYmdLocal(endOfQuarterLocal(anchor)) };
    }
    case "THIS_YEAR":
      return { preset, from: dateToYmdLocal(startOfYearLocal(current)), to: dateToYmdLocal(endOfYearLocal(current)) };
    case "LAST_YEAR": {
      const anchor = new Date(current.getFullYear() - 1, 0, 1);
      return { preset, from: dateToYmdLocal(startOfYearLocal(anchor)), to: dateToYmdLocal(endOfYearLocal(anchor)) };
    }
    case "CUSTOM":
    default:
      return { preset: "CUSTOM", from: "", to: "" };
  }
}

export function ledgerPresetLabel(preset: LedgerRangePreset) {
  switch (preset) {
    case "TODAY": return "Today";
    case "YESTERDAY": return "Yesterday";
    case "LAST_7_DAYS": return "Last 7 days";
    case "LAST_30_DAYS": return "Last 30 days";
    case "THIS_WEEK": return "This week";
    case "LAST_WEEK": return "Last week";
    case "THIS_MONTH": return "This month";
    case "LAST_MONTH": return "Last month";
    case "THIS_QUARTER": return "This quarter";
    case "LAST_QUARTER": return "Last quarter";
    case "THIS_YEAR": return "This year";
    case "LAST_YEAR": return "Last year";
    case "CUSTOM": return "Custom";
    default: return "Custom";
  }
}

export function formatLedgerDateForDisplay(ymd: string) {
  const dt = parseYmdLocal(ymd);
  if (!dt) return ymd || "—";
  try {
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return ymd;
  }
}

export function formatLedgerDateTimeForPrint(ts: string) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

export function escapeHtml(value: string) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toBigIntSafe(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  } catch { }
  return ZERO;
}

export function absBigInt(n: bigint) {
  return n < 0n ? -n : n;
}

export function formatUsdFromCents(cents: bigint) {
  const neg = cents < ZERO;
  const abs = neg ? -cents : cents;
  const dollars = abs / HUNDRED;
  const pennies = abs % HUNDRED;
  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const core = `${withCommas}.${pennies.toString().padStart(2, "0")}`;
  return neg ? `($${core})` : `$${core}`;
}

export function parseMoneyToCents(input: string): number {
  const raw = (input || "").trim();
  if (!raw) return 0;

  const parenNeg = raw.startsWith("(") && raw.endsWith(")");
  const cleaned0 = raw.replace(/^\(|\)$/g, "").replace(/[\$,]/g, "").trim();
  if (!cleaned0) return 0;

  const m = cleaned0.match(/^(-)?(\d+)(?:\.(\d{0,2}))?$/);
  if (!m) return 0;

  const neg = parenNeg || !!m[1];
  const dollars = Number(m[2] || "0");
  const centsPart = (m[3] || "").padEnd(2, "0").slice(0, 2);
  const cents = Number(centsPart || "0");
  const total = dollars * 100 + cents;
  return neg ? -total : total;
}

export function sortEntriesDisplayDesc(a: Entry, b: Entry) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ca = a.created_at || "";
  const cb = b.created_at || "";
  if (ca === cb) return 0;
  return ca < cb ? 1 : -1;
}

export function sortEntriesChronAsc(a: Entry, b: Entry) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ca = a.created_at || "";
  const cb = b.created_at || "";
  if (ca === cb) return 0;
  return ca < cb ? -1 : 1;
}

export function sortLedgerQueueRowsDesc<T extends { date?: string | null }>(rows: T[]) {
  return rows.slice().sort((a, b) => {
    const ad = String(a.date ?? "").slice(0, 10);
    const bd = String(b.date ?? "").slice(0, 10);
    if (ad === bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return ad < bd ? 1 : -1;
  });
}

export function ledgerReviewPriority(row: { rawStatus?: string | null }) {
  const status = String(row.rawStatus ?? "").trim().toUpperCase();
  if (status === "PARTIAL") return 0;
  if (status === "EXPECTED") return 1;
  return 2;
}

export function sortLedgerReviewRowsAsc<T extends { date?: string | null; rawStatus?: string | null }>(rows: T[]) {
  return rows.slice().sort((a, b) => {
    const ap = ledgerReviewPriority(a);
    const bp = ledgerReviewPriority(b);
    if (ap !== bp) return ap - bp;

    const ad = String(a.date ?? "").slice(0, 10);
    const bd = String(b.date ?? "").slice(0, 10);
    if (ad === bd) return 0;
    if (!ad) return 1;
    if (!bd) return -1;
    return ad < bd ? -1 : 1;
  });
}

const INACTIVE_ENTRY_STATUSES = new Set(["DELETED", "SOFT_DELETED", "VOIDED", "REMOVED"]);

export function entryStatusValue(row: any) {
  return String(row?.status ?? row?.entry_status ?? row?.entryStatus ?? "").trim().toUpperCase();
}

export function isInactiveEntryRecord(row: any) {
  if (!row) return false;
  if (row.deleted_at || row.deletedAt) return true;
  if (row.voided_at || row.voidedAt) return true;
  if (row.removed_at || row.removedAt) return true;
  return INACTIVE_ENTRY_STATUSES.has(entryStatusValue(row));
}

export function isIncomeOrExpenseType(rawType: unknown) {
  const t = String(rawType ?? "").trim().toUpperCase();
  return t === "INCOME" || t === "EXPENSE";
}

export function titleCase(s: string) {
  const t = (s || "").trim().toLowerCase();
  if (!t) return "";
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function issueSnapshotToFixIssueRow(issue: EntryIssueRow): FixIssueDialogRow | null {
  const id = String(issue.entry_id ?? "").trim();
  if (!id) return null;

  return {
    id,
    date: String(issue.entry_date ?? ""),
    payee: String(issue.entry_payee ?? ""),
    amountStr:
      issue.entry_amount_cents === undefined || issue.entry_amount_cents === null
        ? "—"
        : formatUsdFromCents(toBigIntSafe(issue.entry_amount_cents)),
    methodDisplay: titleCase(String(issue.entry_method ?? "")),
    category: String(issue.entry_category_name ?? ""),
    categoryId: issue.entry_category_id ?? null,
  };
}

export function isFixIssueContextIncomplete(
  kind: FixIssueKind | null | undefined,
  entryId: string | null | undefined,
  issues: EntryIssueRow[],
  rowsById: Record<string, FixIssueDialogRow>
) {
  if (!kind || !entryId) return false;

  const base = issues.find((x) => x.entry_id === entryId && x.issue_type === kind);
  if (!base) return true;

  if (kind !== "DUPLICATE") return !rowsById[entryId];

  const groupKey = String(base.group_key ?? "").trim();
  if (!groupKey) return !rowsById[entryId];

  const peerEntryIds = Array.from(
    new Set(
      issues
        .filter((x) => x.issue_type === "DUPLICATE" && x.group_key === groupKey)
        .map((x) => String(x.entry_id ?? "").trim())
        .filter(Boolean)
    )
  );

  return peerEntryIds.length < 2 || peerEntryIds.some((id) => !rowsById[id]);
}

export function statusTone(
  status: string
): "default" | "success" | "warning" | "danger" | "info" {
  const s = (status || "").trim().toUpperCase();

  if (s === "DELETED") return "danger";
  if (s === "MATCHED") return "success";
  if (s === "CLEARED") return "success";
  if (s === "PARTIAL") return "warning";
  if (s === "EXPECTED") return "default";

  return "default";
}

export function statusLabel(status: string) {
  const s = String(status || "").trim();
  if (!s) return "Expected";
  return s
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isOpeningLikePayee(payee: string | null | undefined): boolean {
  const x = String(payee ?? "").trim().toLowerCase();
  return x === "opening balance" || x === "opening balance (estimated)" || x.startsWith("opening balance");
}

export function stripMoneyDisplay(s: string): string {
  const cleaned = (s || "").replace(/[$,]/g, "").trim();
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) return cleaned.slice(1, -1);
  return cleaned;
}

export function normMerchant(s: string) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normVendorKey(s: string) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function normalizeCategoryName(name: string): string {
  return (name || "").trim().replace(/\s+/g, " ");
}

export function centsFromDollarsInput(s: string): number {
  const n = Number((s || "").trim());
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

export function computeAutoAlloc(bills: any[], amountAbsCents: bigint) {
  let remaining = amountAbsCents;
  const next: Record<string, string> = {};

  for (const b of bills) {
    if (remaining <= ZERO) break;
    const out = toBigIntSafe((b as any).outstanding_cents ?? 0);
    if (out <= ZERO) continue;

    const use = remaining < out ? remaining : out;
    next[String(b.id)] = (Number(use) / 100).toFixed(2);
    remaining -= use;
  }

  return { alloc: next, remaining };
}

export function normKey(name: string): string {
  return normalizeCategoryName(name).toLowerCase();
}

export function filterOptions(query: string, options: string[]) {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, 8);
  const starts = options.filter((o) => o.toLowerCase().startsWith(q));
  const contains = options.filter(
    (o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q)
  );
  return [...starts, ...contains].slice(0, 8);
}

export function normalizeBackendType(uiType: UiType): "INCOME" | "EXPENSE" | "TRANSFER" | "ADJUSTMENT" {
  if (uiType === "INCOME") return "INCOME";
  if (uiType === "EXPENSE") return "EXPENSE";
  if (uiType === "TRANSFER") return "TRANSFER";
  return "ADJUSTMENT";
}

export function normalizeBackendMethod(uiMethod: UiMethod): string {
  if (uiMethod === "CASH") return "CASH";
  if (uiMethod === "CARD") return "CARD";
  if (uiMethod === "CHECK") return "CHECK";
  if (uiMethod === "ACH") return "ACH";
  if (uiMethod === "WIRE") return "WIRE";
  if (uiMethod === "DIRECT_DEPOSIT") return "DIRECT_DEPOSIT";
  if (uiMethod === "ZELLE") return "ZELLE";
  if (uiMethod === "TRANSFER") return "TRANSFER";
  return "OTHER";
}

export function extractEntryRef(entry: any): string {
  const explicit = String(entry?.ref ?? entry?.reference ?? entry?.reference_number ?? entry?.referenceNumber ?? "").trim();
  if (explicit) return explicit;
  const memo = String(entry?.memo ?? "");
  const m = memo.match(/\bref\s*:\s*([^\n\r;|,]+)/i);
  return m?.[1]?.trim() || "";
}

export function stripMemoRef(memo: any): string {
  return String(memo ?? "")
    .replace(/^\s*ref\s*:\s*[^\n\r;|,]+(?:\r?\n)?/i, "")
    .replace(/\r?\n\s*ref\s*:\s*[^\n\r;|,]+/gi, "")
    .trim();
}

export function memoWithRef(note: any, ref: any): string | undefined {
  const cleanNote = stripMemoRef(note);
  const cleanRef = String(ref ?? "").trim();
  if (cleanRef && cleanNote) return `Ref: ${cleanRef}\n${cleanNote}`;
  if (cleanRef) return `Ref: ${cleanRef}`;
  return cleanNote || undefined;
}

export function uiTypeFromRaw(raw: string | null | undefined): UiType {
  const t = String(raw || "").toUpperCase();
  if (t === "INCOME") return "INCOME";
  if (t === "EXPENSE") return "EXPENSE";
  if (t === "TRANSFER") return "TRANSFER";
  if (t === "ADJUSTMENT") return "ADJUSTMENT";
  return "EXPENSE";
}

export function uiMethodFromRaw(raw: string | null | undefined): UiMethod {
  const m = String(raw || "").toUpperCase();
  const allowed: UiMethod[] = [
    "CASH", "CARD", "ACH", "WIRE", "CHECK", "DIRECT_DEPOSIT", "ZELLE", "TRANSFER", "OTHER",
  ];
  return (allowed as string[]).includes(m) ? (m as UiMethod) : "OTHER";
}

export function uiMethodLabel(m: UiMethod): string {
  if (m === "CASH") return "Cash";
  if (m === "CARD") return "Card";
  if (m === "ACH") return "ACH";
  if (m === "WIRE") return "Wire";
  if (m === "CHECK") return "Check";
  if (m === "DIRECT_DEPOSIT") return "Direct Deposit";
  if (m === "ZELLE") return "Zelle";
  if (m === "TRANSFER") return "Transfer";
  return "Other";
}
