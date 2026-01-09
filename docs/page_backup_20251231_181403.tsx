"use client";

// ================================
// SECTION 01: Imports
// ================================

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useEntries } from "@/lib/queries/useEntries";
import { useLedgerSummary } from "@/lib/queries/useLedgerSummary";
import { createEntry, deleteEntry, restoreEntry, hardDeleteEntry, updateEntry, type Entry } from "@/lib/api/entries";
import { metrics } from "@/lib/perf/metrics";

import {
  PageHeader,
  FilterBar,
  LedgerTableShell,
  StatusChip,
  inputH7,
  selectTriggerClass,
} from "@/components/primitives";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { TotalsFooter } from "@/components/ledger/totals-footer";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {AlertTriangle, BookmarkPlus, Check, Copy, Info, MoreVertical, Pencil, Plus, RotateCcw, Trash2, X} from "lucide-react";

// ===== BigInt constants (module scope) =====
const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

// ================================
// SECTION 02: Helpers
// ================================

// ---------- helpers ----------
function todayYmd() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function monthStartYmd() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}-01`;
}
function toBigIntSafe(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  } catch {}
  return ZERO;
}
function formatUsdFromCents(cents: bigint) {
  const neg = cents < ZERO;
  const abs = neg ? -cents : cents;
  const dollars = abs / HUNDRED;
  const pennies = abs % HUNDRED;
  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const core = `${withCommas}.${pennies.toString().padStart(2, "0")}`;
  return neg ? `($${core})` : `$${core}`;
}
function parseMoneyToCents(input: string): number {
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
function sortEntriesDisplayDesc(a: Entry, b: Entry) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  const ca = a.created_at || "";
  const cb = b.created_at || "";
  if (ca === cb) return 0;
  return ca < cb ? 1 : -1;
}
function sortEntriesChronAsc(a: Entry, b: Entry) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ca = a.created_at || "";
  const cb = b.created_at || "";
  if (ca === cb) return 0;
  return ca < cb ? -1 : 1;
}
function titleCase(s: string) {
  const t = (s || "").trim().toLowerCase();
  if (!t) return "";
  return t.replace(/\b\w/g, (c) => c.toUpperCase());
}
function statusTone(status: string):
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "info" {
  const s = (status || "").trim().toUpperCase();
  if (!s) return "default";
  if (s === "SYSTEM") return "info";
  if (s === "CLEARED" || s === "POSTED") return "success";
  if (s === "PENDING") return "warning";
  if (s.includes("FAIL") || s.includes("ERROR")) return "danger";
  return "default";
}

// ================================
// SECTION 03: Autocomplete
// ================================

// ---------- suggestions ----------
function filterOptions(query: string, options: string[]) {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, 8);
  const starts = options.filter((o) => o.toLowerCase().startsWith(q));
  const contains = options.filter(
    (o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q)
  );
  return [...starts, ...contains].slice(0, 8);
}
// ================================
// SECTION: AUTOINPUT (REPLACE ALL)
// ================================
function AutoInput(props: {
  value: string;
  onValueChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  inputClassName?: string;
  onSubmit?: () => void;
  inputRef?: any; // accept ref without TS friction
}) {
  const {
    value,
    onValueChange,
    options,
    placeholder,
    inputClassName,
    onSubmit,
    inputRef,
  } = props;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => filterOptions(value, options), [value, options]);

  const onKeyDown = (e: any) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }

    if (e.key === "Tab") {
      if (open && filtered[active]) onValueChange(filtered[active]);
      setOpen(false);
      return;
    }

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open && filtered.length > 0) setOpen(true);

      setActive((prev: number) => {
        const max = Math.max(0, filtered.length - 1);
        return e.key === "ArrowDown" ? Math.min(max, prev + 1) : Math.max(0, prev - 1);
      });
      return;
    }

    if (e.key === "Enter") {
      // If suggestion list is open, accept the active item AND submit (single-enter UX)
      if (open && filtered[active]) {
        e.preventDefault();
        onValueChange(filtered[active]);
        setOpen(false);
        if (onSubmit) onSubmit();
        return;
      }

      if (onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    }
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={inputClassName}
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          onValueChange(next);
          setActive(0);
          setOpen(next.trim().length > 0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />

      {open && filtered.length > 0 ? (
        <div className="absolute left-0 top-full mt-1 w-full z-50 rounded-md border bg-white shadow-md p-0 max-h-56 overflow-auto">
          {filtered.map((opt: string, idx: number) => (
            <button
              key={opt}
              type="button"
              className={
                "w-full text-left text-xs px-2 py-1.5 " +
                (idx === active ? "bg-slate-100" : "bg-white") +
                " hover:bg-slate-100"
              }
              onMouseDown={(ev) => {
                ev.preventDefault();
                onValueChange(opt);
                setOpen(false);
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
// ==============================
// END SECTION: AUTOINPUT
// ==============================


// ================================
// SECTION 04: Types
// ================================


// ================================
// SECTION: HoverTooltip (portal)
// Ensures tooltips render above table/chips (no z-index/overflow issues).
// ================================
function HoverTooltip(props: { text: string; children: any }) {
  const { text, children } = props;
  const ref = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    if (typeof window === "undefined") return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // Anchor tooltip under the icon, aligned to the icon's right edge.
    setPos({ x: r.right, y: r.bottom });
  }, [open, text]);

  const body = typeof document !== "undefined" ? document.body : null;

  return (
    <span
      ref={ref}
      className="inline-flex h-5 w-5 items-center justify-center"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      aria-label={text}
    >
      {children}
      {open && text && body && pos
        ? createPortal(
            <div
              style={{
                position: "fixed",
                left: pos.x,
                top: pos.y + 6,
                transform: "translateX(-100%)",
                zIndex: 9999,
                pointerEvents: "none",
                maxWidth: 420,
              }}
              className="rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white shadow-lg whitespace-pre-line break-words w-max"
            >
              {text}
            </div>,
            body,
          )
        : null}
    </span>
  );
}
// ================================
// END SECTION: HoverTooltip
// ================================

// ---------- Types ----------
type UiType = "INCOME" | "EXPENSE" | "TRANSFER" | "ADJUSTMENT";
type UiMethod =
  | "CASH"
  | "CARD"
  | "ACH"
  | "WIRE"
  | "CHECK"
  | "DIRECT_DEPOSIT"
  | "ZELLE"
  | "TRANSFER"
  | "OTHER";

function normalizeBackendType(uiType: UiType): "INCOME" | "EXPENSE" {
  if (uiType === "INCOME") return "INCOME";
  return "EXPENSE";
}
function normalizeBackendMethod(uiMethod: UiMethod): string {
  if (uiMethod === "CASH") return "CASH";
  if (uiMethod === "CARD") return "CARD";
  if (uiMethod === "CHECK") return "CHECK";
  if (uiMethod === "ACH") return "ACH";
  if (uiMethod === "WIRE") return "WIRE";
  return "OTHER";
}

type CreateVars = {
  tempId: string;
  date: string;
  ref: string;
  payee: string;
  type: UiType;
  method: UiMethod;
  category: string;
  amountStr: string;
  afterCreateEdit?: boolean;
};

// ================================
// PR-10 Inline row editing helpers
// ================================
type EditDraft = {
  date: string;
  payee: string;
  type: UiType;
  method: UiMethod;
  category: string;
  amountStr: string;
};


type UpdateVars = {
  entryId: string;
  draft: EditDraft;
  oldDate: string;
  oldAmountCents: string; // signed cents (string)
};



function uiTypeFromRaw(raw: string | null | undefined): UiType {
  const t = String(raw || "").toUpperCase();
  if (t === "INCOME") return "INCOME";
  if (t === "EXPENSE") return "EXPENSE";
  return "EXPENSE";
}

function uiMethodFromRaw(raw: string | null | undefined): UiMethod {
  const m = String(raw || "").toUpperCase();
  const allowed: UiMethod[] = [
    "CASH",
    "CARD",
    "ACH",
    "WIRE",
    "CHECK",
    "DIRECT_DEPOSIT",
    "ZELLE",
    "TRANSFER",
    "OTHER",
  ];
  return (allowed as string[]).includes(m) ? (m as UiMethod) : "OTHER";
}

function stripMoneyDisplay(s: string): string {
  // Keep digits and decimal; remove $ , and wrapping parentheses for a clean input value.
  const cleaned = (s || "").replace(/[$,]/g, "").trim();
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) {
    return cleaned.slice(1, -1);
  }
  return cleaned;
}


export default function LedgerPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const containerStyle = { height: "calc(100vh - 56px - 48px)" as const };

  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        setAuthReady(true);
      } catch {
        router.replace("/login");
      }
    })();
  }, [router]);

  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");
  const accountIdFromUrl = sp.get("accountId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const accountsQ = useAccounts(selectedBusinessId);
  const selectedAccountId = useMemo(() => {
    const list = accountsQ.data ?? [];
    if (accountIdFromUrl) return accountIdFromUrl;
    return list.find((a) => !a.archived_at)?.id ?? "";
  }, [accountsQ.data, accountIdFromUrl]);

  const selectedAccount = useMemo(() => {
    const list = accountsQ.data ?? [];
    return list.find((a) => a.id === selectedAccountId) ?? null;
  }, [accountsQ.data, selectedAccountId]);

  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [page, setPage] = useState(1);

  const maxFetch = 500;
  const fetchLimit = useMemo(
    () => Math.min(maxFetch, rowsPerPage * page),
    [rowsPerPage, page]
  );

  const entriesKey = useMemo(
    () => ["entries", selectedBusinessId, selectedAccountId, fetchLimit, showDeleted] as const,
    [selectedBusinessId, selectedAccountId, fetchLimit]
  );

  const entriesQ = useEntries({
    businessId: selectedBusinessId,
    accountId: selectedAccountId,
    limit: fetchLimit,
    includeDeleted: showDeleted,
  });

  const from = monthStartYmd();
  const to = todayYmd();
  const summaryKey = ["ledgerSummary", selectedBusinessId, selectedAccountId, from, to] as const;
  const summaryQ = useLedgerSummary({
    businessId: selectedBusinessId,
    accountId: selectedAccountId,
    from,
    to,
  });

  const openingBalanceCents = useMemo(
    () => BigInt(Number(selectedAccount?.opening_balance_cents ?? 0)),
    [selectedAccount]
  );

  const openingEntry: Entry | null = useMemo(() => {
    if (!selectedBusinessId || !selectedAccountId || !selectedAccount) return null;
    const date = String(selectedAccount.opening_balance_date ?? "").slice(0, 10);
    if (!date || date.length !== 10) return null;

    return {
      id: "opening_balance",
      business_id: selectedBusinessId,
      account_id: selectedAccountId,
      date,
      payee: "Opening Balance",
      memo: selectedAccount.name ?? null,
      amount_cents: String(Number(selectedAccount.opening_balance_cents ?? 0)),
      type: "OPENING",
      method: null,
      status: "SYSTEM",
      deleted_at: null,
      created_at: date + "T00:00:00.000Z",
      updated_at: date + "T00:00:00.000Z",
    };
  }, [selectedBusinessId, selectedAccountId, selectedAccount]);

  const entriesSorted = useMemo(() => {
    const list = (entriesQ.data ?? []).slice();
    list.sort(sortEntriesDisplayDesc);
    return list;
  }, [entriesQ.data]);

  const entriesWithOpening = useMemo(() => {
    if (!openingEntry) return entriesSorted;
    const list = entriesSorted.slice();
    if (!list.some((e) => e.id === "opening_balance")) list.push(openingEntry);
    list.sort(sortEntriesDisplayDesc);
    return list;
  }, [entriesSorted, openingEntry]);

  const payeeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of entriesWithOpening) {
      const p = (e.payee || "").trim();
      if (p && p !== "Opening Balance") set.add(p);
    }
    return Array.from(set);
  }, [entriesWithOpening]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of entriesWithOpening) {
      const c = (e.memo || "").trim();
      if (c && c !== (selectedAccount?.name ?? "")) set.add(c);
    }
    return Array.from(set);
  }, [entriesWithOpening, selectedAccount?.name]);

  const rowModels = useMemo(() => {
    const listDescAll = entriesWithOpening.slice();
    const listAscAll = entriesWithOpening.slice().sort(sortEntriesChronAsc);

    // Running balance and totals must EXCLUDE soft-deleted entries.
    const listAscBal = listAscAll.filter((e) => e.id === "opening_balance" || !e.deleted_at);

    const idxOpen = listAscBal.findIndex((e) => e.id === "opening_balance");

    const delta = listAscBal.map((e) =>
      e.id === "opening_balance" ? ZERO : toBigIntSafe(e.amount_cents),
    );
    const bal = new Array<bigint>(listAscBal.length).fill(ZERO);

    if (idxOpen >= 0) {
      bal[idxOpen] = openingBalanceCents;
      for (let i = idxOpen + 1; i < listAscBal.length; i++) bal[i] = bal[i - 1] + delta[i];
      for (let i = idxOpen - 1; i >= 0; i--) bal[i] = bal[i + 1] - delta[i + 1];
    } else {
      for (let i = 0; i < listAscBal.length; i++) bal[i] = (i === 0 ? ZERO : bal[i - 1]) + delta[i];
    }

    const balById = new Map<string, bigint>();
    for (let i = 0; i < listAscBal.length; i++) balById.set(listAscBal[i].id, bal[i]);

    return listDescAll.map((e) => {
      const isDeleted = !!e.deleted_at;
      const amt = toBigIntSafe(e.amount_cents);
      const rowBal = balById.get(e.id); // undefined for deleted rows
      return {
        id: e.id,
        date: e.date,
        ref: "",
        payee: e.payee ?? "",
        typeDisplay: titleCase(e.type ?? ""),
        methodDisplay: titleCase(e.method ?? ""),
        rawType: (e.type ?? "").toString(),
        rawMethod: (e.method ?? "").toString(),
        category: (e.memo ?? "") || "",
        amountCents: amt.toString(),
        amountStr: formatUsdFromCents(amt),
        amountNeg: amt < ZERO,
        balanceStr: isDeleted || rowBal === undefined ? "—" : formatUsdFromCents(rowBal),
        balanceNeg: !isDeleted && rowBal !== undefined ? rowBal < ZERO : false,
        status: isDeleted ? "Deleted" : titleCase(e.status ?? ""),
        rawStatus: isDeleted ? "DELETED" : (e.status ?? "").toString(),
        isDeleted,
        deletedAt: e.deleted_at,
        canDelete: e.id !== "opening_balance",
      };
    });
  }, [entriesWithOpening, openingBalanceCents]);
// ================================
// SECTION 05: Entry Issues (client-side heuristics)
// - Lightweight; computed from loaded rows only.
// - Used for icons + tooltip in Status column.
// ================================
const issuesById = useMemo(() => {
  const map: Record<string, { code: string; label: string }[]> = {};
  const keyToIds = new Map<string, string[]>();

  for (const r of rowModels) {
    if (r.id === "opening_balance") continue;
    const payeeKey = (r.payee || "").trim().toLowerCase();
    const key = `${r.date}|${r.amountCents}|${payeeKey}`;
    if (!keyToIds.has(key)) keyToIds.set(key, []);
    keyToIds.get(key)!.push(r.id);

    const cat = (r.category || "").trim();
    if (!cat) {
      (map[r.id] ||= []).push({
        code: "missing_category",
        label: "Category missing or uncategorized",
      });
    }
  }

  for (const [key, ids] of keyToIds.entries()) {
    if (ids.length <= 1) continue;
    for (const id of ids) {
      (map[id] ||= []).push({
        code: "possible_duplicate",
        label: "Potential duplicate entry",
      });
    }
  }

  return map;
}, [rowModels]);
// ================================
// SECTION 05B: Rows with Issues (UI model)
// - Adds issueCount/issueSeverity/issueTooltip for rendering.
// ================================  // ================================
  // SECTION: rowsUi (issues + split icons)
  // ================================
  const rowsUi = useMemo(() => {
    return rowModels.map((r) => {
      const issues = issuesById[r.id] || [];

      const dupIssues = issues.filter((i: any) => i.code === "possible_duplicate");
      const missingIssues = issues.filter((i: any) => i.code === "missing_category");

      const hasDup = dupIssues.length > 0;
      const hasMissing = missingIssues.length > 0;

      const issueSeverity = hasDup ? "duplicate" : hasMissing ? "missing_category" : "none";
      const issueTooltip = issues.map((i: any) => `• ${i.label}`).join("/n");

      const dupTooltip =
        dupIssues.map((i: any) => `• ${i.label}`).join("n/") || "• Potential duplicate entry";
      const missingTooltip =
        missingIssues.map((i: any) => `• ${i.label}`).join("/n") ||
        "• Category missing or uncategorized";

      return {
        ...r,
        issueCount: issues.length,
        issueSeverity,
        issueTooltip,

        // New fields for split icons
        hasDup,
        dupCount: dupIssues.length,
        dupTooltip,

        hasMissing,
        missingCount: missingIssues.length,
        missingTooltip,
      };
    });
  }, [rowModels, issuesById]);
  // ================================
  // END SECTION: rowsUi
  // ================================
const [searchPayee, setSearchPayee] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const filteredRowsAll = useMemo(() => {
    const q = searchPayee.trim().toLowerCase();
    if (!q) return rowsUi;
    return rowsUi.filter((r) => r.payee.toLowerCase().includes(q));
  }, [rowsUi, searchPayee]);

  const startIdx = (page - 1) * rowsPerPage;
  const endIdx = page * rowsPerPage;
  const pageRows = filteredRowsAll.slice(startIdx, endIdx);

  const hasMoreOnServer = (entriesQ.data?.length ?? 0) === fetchLimit && fetchLimit < maxFetch;
  const canNext = endIdx < filteredRowsAll.length || hasMoreOnServer;
  const canPrev = page > 1;
  const totalPages = Math.max(1, Math.ceil(filteredRowsAll.length / rowsPerPage));

  const checkboxClass =
    "h-4 w-4 rounded border border-slate-300 bg-white checked:bg-slate-900 checked:border-slate-900";

  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const allPageSelected = useMemo(() => {
    const ids = pageRows.filter((r) => r.id !== "opening_balance").map((r) => r.id);
    if (ids.length === 0) return false;
    return ids.every((id) => !!selectedIds[id]);
  }, [pageRows, selectedIds]);

  function toggleRow(id: string) { setSelectedIds((m) => ({ ...m, [id]: !m[id] })); }
  function toggleAllPage() {
    const ids = pageRows.filter((r) => r.id !== "opening_balance").map((r) => r.id);
    const next = { ...selectedIds };
    const shouldSelect = !allPageSelected;
    for (const id of ids) next[id] = shouldSelect;
    setSelectedIds(next);
  }

  // add row
  const [draftDate, setDraftDate] = useState(todayYmd());
  const [draftRef, setDraftRef] = useState("");
  const [draftPayee, setDraftPayee] = useState("");
  const [draftType, setDraftType] = useState<UiType>("EXPENSE");
  const [draftMethod, setDraftMethod] = useState<UiMethod>("CASH");
  const [draftCategory, setDraftCategory] = useState("");
  const [draftAmount, setDraftAmount] = useState("0.00");
  const [err, setErr] = useState<string | null>(null);


// ================================
// PR-10 Inline row editing state
// ================================
const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
const [editingId, setEditingId] = useState<string | null>(null);
const [editedIds, setEditedIds] = useState<Record<string, boolean>>({});
const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
const editPayeeRef = useRef<HTMLInputElement>(null);
  const editSaveLockRef = useRef(false);
const editAmountRef = useRef<HTMLInputElement>(null);
const [editTypeOpen, setEditTypeOpen] = useState(false);
const [editMethodOpen, setEditMethodOpen] = useState(false);

// Close the row menu when clicking outside.
useEffect(() => {
  if (!menuOpenId) return;
  const handler = (ev: MouseEvent) => {
    const target = ev.target as HTMLElement | null;
    if (!target) return;
    // The menu + button wrapper has data-rowmenu="<rowId>"
    if (target.closest(`[data-rowmenu="${menuOpenId}"]`)) return;
    setMenuOpenId(null);
  };
  document.addEventListener("mousedown", handler);
  return () => document.removeEventListener("mousedown", handler);
}, [menuOpenId]);

  const payeeInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authReady) return;
    requestAnimationFrame(() => payeeInputRef.current?.focus());
  }, [authReady]);

  const [typeOpen, setTypeOpen] = useState(false);
  const [methodOpen, setMethodOpen] = useState(false);

  function readSubmitValues() {
    const payee = (payeeInputRef.current?.value ?? draftPayee).trim();
    const amountStr = (amountInputRef.current?.value ?? draftAmount).trim();
    const centsAbs = Math.abs(parseMoneyToCents(amountStr));
    return { payee, amountStr, centsAbs };
  }

  const createMut = useMutation({
    mutationFn: async (vars: CreateVars) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");

      const centsAbs = Math.abs(parseMoneyToCents(vars.amountStr));
      if (!vars.payee.trim()) throw new Error("Payee is required");
      if (centsAbs === 0) throw new Error("Amount is required");

      const cents = parseMoneyToCents(vars.amountStr);
      const backendType = normalizeBackendType(vars.type);
      const signed = backendType === "EXPENSE" ? -Math.abs(cents) : Math.abs(cents);

      return createEntry({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        input: {
          date: vars.date,
          payee: vars.payee.trim(),
          memo: (vars.category || "").trim() || undefined,
          amount_cents: signed,
          type: backendType,
          method: normalizeBackendMethod(vars.method),
          status: "EXPECTED",
        },
      });
    },
    onMutate: async (vars: CreateVars) => {
      const start = performance.now();
      setErr(null);

      await qc.cancelQueries({ queryKey: entriesKey });
      const previous = (qc.getQueryData(entriesKey) as Entry[] | undefined) ?? [];
      const nowIso = new Date().toISOString();

      const cents = parseMoneyToCents(vars.amountStr);
      const backendType = normalizeBackendType(vars.type);
      const signed = backendType === "EXPENSE" ? -Math.abs(cents) : Math.abs(cents);

      const optimistic: Entry = {
        id: vars.tempId,
        business_id: selectedBusinessId!,
        account_id: selectedAccountId!,
        date: vars.date,
        payee: vars.payee.trim(),
        memo: (vars.category || "").trim() || null,
        amount_cents: String(signed),
        type: backendType,
        method: normalizeBackendMethod(vars.method),
        status: "EXPECTED",
        deleted_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      };

      qc.setQueryData(entriesKey, [optimistic, ...previous]);
// If this create is a "Duplicate", immediately enter inline edit on the optimistic row.
if (vars.afterCreateEdit) {
  setEditingId(vars.tempId);
  setEditDraft({
    date: vars.date,
    payee: vars.payee.trim(),
    type: vars.type,
    method: vars.method,
    category: (vars.category || "").trim(),
    amountStr: vars.amountStr,
  });
  setEditTypeOpen(false);
  setEditMethodOpen(false);
  requestAnimationFrame(() => editPayeeRef.current?.focus());
}

      metrics.timeUi("createEntry click->row", start);

      setDraftRef("");
      setDraftPayee("");
      setDraftCategory("");
      setDraftAmount("0.00");
      setDraftType("EXPENSE");
      setDraftMethod("CASH");
      requestAnimationFrame(() => payeeInputRef.current?.focus());

      return { previous, tempId: vars.tempId };
    },
    onError: (e: any, _vars, ctx: any) => {
      if (ctx?.previous) qc.setQueryData(entriesKey, ctx.previous);
      setErr(e?.message || "Create failed");
    },
    onSuccess: async (serverEntry, vars) => {
      const current = (qc.getQueryData(entriesKey) as Entry[] | undefined) ?? [];
      qc.setQueryData(entriesKey, current.map((e) => (e.id === vars.tempId ? serverEntry : e)));
if (vars.afterCreateEdit && editingId === vars.tempId) {
  setEditingId(serverEntry.id);
}
      await qc.invalidateQueries({ queryKey: summaryKey });
    }const deleteMut = useMutation({
    // Soft delete (moves entry to Deleted)
    mutationFn: async (entryId: string) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");
      return deleteEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId });
    },
    onMutate: async (entryId: string) => {
      const start = performance.now();

      // Auto-enable Show Deleted after a soft delete (your rule).
      setShowDeleted(true);

      const keyNo = ["entries", selectedBusinessId, selectedAccountId, fetchLimit, false] as const;
      const keyYes = ["entries", selectedBusinessId, selectedAccountId, fetchLimit, true] as const;

      await qc.cancelQueries({ queryKey: keyNo });
      await qc.cancelQueries({ queryKey: keyYes });

      const prevNo = (qc.getQueryData(keyNo) as Entry[] | undefined) ?? [];
      const prevYes = (qc.getQueryData(keyYes) as Entry[] | undefined) ?? [];

      const victim = prevNo.find((e) => e.id === entryId) ?? prevYes.find((e) => e.id === entryId);
      const nowIso = new Date().toISOString();

      // Remove from "not deleted" cache
      qc.setQueryData(keyNo, prevNo.filter((e) => e.id !== entryId));

      if (victim) {
        const deletedVictim: Entry = { ...victim, deleted_at: nowIso, updated_at: nowIso };

        // Ensure present in "show deleted" cache (and marked deleted)
        const baseYes = prevYes.length ? prevYes : prevNo;
        const nextYes = baseYes.some((e) => e.id === entryId)
          ? baseYes.map((e) => (e.id === entryId ? deletedVictim : e))
          : [deletedVictim, ...baseYes];
        qc.setQueryData(keyYes, nextYes);

        // Optimistically patch summary so totals/balance update instantly (deleted entries excluded).
        const amt = BigInt(String(victim.amount_cents ?? "0"));
        const delta = ZERO - amt; // remove entry reverses its effect
        qc.setQueryData(summaryKey, (old: any) => {
          if (!old) return old;
          const inc = BigInt(old.totals?.income_cents ?? "0");
          const exp = BigInt(old.totals?.expense_cents ?? "0"); // stored negative
          const net = BigInt(old.totals?.net_cents ?? "0");
          const bal = BigInt(old.balance_cents ?? "0");

          const nextInc = delta > ZERO ? inc + delta : inc;
          const nextExp = delta < ZERO ? exp + delta : exp;

          return {
            ...old,
            totals: {
              ...old.totals,
              income_cents: nextInc.toString(),
              expense_cents: nextExp.toString(),
              net_cents: (net + delta).toString(),
            },
            balance_cents: (bal + delta).toString(),
          };
        });
      }

      metrics.timeUi("softDelete click->row", start);
      return { prevNo, prevYes };
    },
    onError: (_e: any, _id, ctx: any) => {
      if (ctx?.prevNo) qc.setQueryData(["entries", selectedBusinessId, selectedAccountId, fetchLimit, false], ctx.prevNo);
      if (ctx?.prevYes) qc.setQueryData(["entries", selectedBusinessId, selectedAccountId, fetchLimit, true], ctx.prevYes);
      setErr("Delete failed");
    },
  });

  const restoreMut = useMutation({
    mutationFn: async (entryId: string) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");
      return restoreEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId });
    },
    onMutate: async (entryId: string) => {
      const start = performance.now();

      const keyNo = ["entries", selectedBusinessId, selectedAccountId, fetchLimit, false] as const;
      const keyYes = ["entries", selectedBusinessId, selectedAccountId, fetchLimit, true] as const;

      await qc.cancelQueries({ queryKey: keyNo });
      await qc.cancelQueries({ queryKey: keyYes });

      const prevNo = (qc.getQueryData(keyNo) as Entry[] | undefined) ?? [];
      const prevYes = (qc.getQueryData(keyYes) as Entry[] | undefined) ?? [];

      const victim = prevYes.find((e) => e.id === entryId);
      const nowIso = new Date().toISOString();

      if (victim) {
        const restoredVictim: Entry = { ...victim, deleted_at: null, updated_at: nowIso };
        qc.setQueryData(keyYes, prevYes.map((e) => (e.id === entryId ? restoredVictim : e)));

        // Put back into "not deleted" cache if missing
        if (!prevNo.some((e) => e.id === entryId)) {
          qc.setQueryData(keyNo, [restoredVictim, ...prevNo]);
        }

        // Optimistically patch summary (restored entries re-included).
        const amt = BigInt(String(victim.amount_cents ?? "0"));
        const delta = amt;
        qc.setQueryData(summaryKey, (old: any) => {
          if (!old) return old;
          const inc = BigInt(old.totals?.income_cents ?? "0");
          const exp = BigInt(old.totals?.expense_cents ?? "0");
          const net = BigInt(old.totals?.net_cents ?? "0");
          const bal = BigInt(old.balance_cents ?? "0");

          const nextInc = delta > ZERO ? inc + delta : inc;
          const nextExp = delta < ZERO ? exp + delta : exp;

          return {
            ...old,
            totals: {
              ...old.totals,
              income_cents: nextInc.toString(),
              expense_cents: nextExp.toString(),
              net_cents: (net + delta).toString(),
            },
            balance_cents: (bal + delta).toString(),
          };
        });
      }

      metrics.timeUi("restore click->row", start);
      return { prevNo, prevYes };
    },
    onError: (_e: any, _id, ctx: any) => {
      if (ctx?.prevNo) qc.setQueryData(["entries", selectedBusinessId, selectedAccountId, fetchLimit, false], ctx.prevNo);
      if (ctx?.prevYes) qc.setQueryData(["entries", selectedBusinessId, selectedAccountId, fetchLimit, true], ctx.prevYes);
      setErr("Restore failed");
    },
  });

  const hardDeleteMut = useMutation({
    mutationFn: async (entryId: string) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");
      return hardDeleteEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId });
    },
    onMutate: async (entryId: string) => {
      const start = performance.now();
      const keyNo = ["entries", selectedBusinessId, selectedAccountId, fetchLimit, false] as const;
      const keyYes = ["entries", selectedBusinessId, selectedAccountId, fetchLimit, true] as const;

      await qc.cancelQueries({ queryKey: keyNo });
      await qc.cancelQueries({ queryKey: keyYes });

      const prevNo = (qc.getQueryData(keyNo) as Entry[] | undefined) ?? [];
      const prevYes = (qc.getQueryData(keyYes) as Entry[] | undefined) ?? [];

      qc.setQueryData(keyNo, prevNo.filter((e) => e.id !== entryId));
      qc.setQueryData(keyYes, prevYes.filter((e) => e.id !== entryId));

      metrics.timeUi("hardDelete click->rowRemoved", start);
      return { prevNo, prevYes };
    },
    onError: (_e: any, _id, ctx: any) => {
      if (ctx?.prevNo) qc.setQueryData(["entries", selectedBusinessId, selectedAccountId, fetchLimit, false], ctx.prevNo);
      if (ctx?.prevYes) qc.setQueryData(["entries", selectedBusinessId, selectedAccountId, fetchLimit, true], ctx.prevYes);
      setErr("Hard delete failed");
    },
  });
},
  });
  // ================================
  // PR-10 Inline edit mutation
  // ================================
  const updateMut = useMutation({
    mutationFn: async (vars: UpdateVars) => {
      if (!selectedBusinessId || !selectedAccountId) {
        throw new Error("Missing business/account");
      }

      const centsAbsNum = Math.abs(parseMoneyToCents(vars.draft.amountStr));
      if (!vars.draft.payee.trim()) throw new Error("Payee is required");
      if (centsAbsNum === 0) throw new Error("Amount is required");

      const backendType = normalizeBackendType(vars.draft.type);
      const signedNum = backendType === "EXPENSE" ? -centsAbsNum : centsAbsNum;

      return updateEntry({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        entryId: vars.entryId,
        updates: {
          date: vars.draft.date,
          payee: vars.draft.payee.trim(),
          memo: (vars.draft.category || "").trim() || undefined,
          amount_cents: signedNum,
          type: backendType,
          method: normalizeBackendMethod(vars.draft.method),
        },
      });
    },

    onMutate: async (vars: UpdateVars) => {
      const start = performance.now();
      setErr(null);

      const entriesKeyPrefix = ["entries", selectedBusinessId, selectedAccountId] as const;
      await qc.cancelQueries({ queryKey: entriesKeyPrefix });

      const prevEntries = qc.getQueriesData({ queryKey: entriesKeyPrefix });
      const prevSummary = qc.getQueryData(summaryKey);

      // Compute signed deltas for instant footer update.
      const oldSigned = BigInt(vars.oldAmountCents || "0");
      const centsAbsNum = Math.abs(parseMoneyToCents(vars.draft.amountStr));
      const backendType = normalizeBackendType(vars.draft.type);
      const newSignedNum = backendType === "EXPENSE" ? -centsAbsNum : centsAbsNum;
      const newSigned = BigInt(String(newSignedNum));

      // Optimistically update entries across any cached pages.
      qc.setQueriesData({ queryKey: entriesKeyPrefix }, (old: any) => {
        const list = (old as Entry[] | undefined) ?? undefined;
        if (!list) return old;
        return list.map((e) => {
          if (e.id !== vars.entryId) return e;
          return {
            ...e,
            date: vars.draft.date,
            payee: vars.draft.payee.trim(),
            memo: (vars.draft.category || "").trim() || null,
            amount_cents: newSigned.toString(),
            type: backendType,
            method: normalizeBackendMethod(vars.draft.method),
            updated_at: new Date().toISOString(),
          };
        });
      });

      // Optimistically update summary if in-range.
      const oldIn = vars.oldDate >= from && vars.oldDate <= to;
      const newIn = vars.draft.date >= from && vars.draft.date <= to;

      if (prevSummary && (oldIn || newIn)) {
        let delta = ZERO;
        if (oldIn && newIn) delta = newSigned - oldSigned;
        else if (oldIn && !newIn) delta = ZERO - oldSigned;
        else if (!oldIn && newIn) delta = newSigned;

        if (delta !== ZERO) {
          qc.setQueryData(summaryKey, (old: any) => {
            if (!old) return old;

            const inc = BigInt(old.totals?.income_cents ?? "0");
            const exp = BigInt(old.totals?.expense_cents ?? "0"); // stored negative
            const net = BigInt(old.totals?.net_cents ?? "0");
            const bal = BigInt(old.balance_cents ?? "0");

            const nextInc = delta > ZERO ? inc + delta : inc;
            const nextExp = delta < ZERO ? exp + delta : exp;

            return {
              ...old,
              totals: {
                ...old.totals,
                income_cents: nextInc.toString(),
                expense_cents: nextExp.toString(),
                net_cents: (net + delta).toString(),
              },
              balance_cents: (bal + delta).toString(),
            };
          });
        }
      }

      // Mark row as edited for the pencil indicator.
      setEditedIds((m) => ({ ...m, [vars.entryId]: true }));

      // Exit edit mode immediately (instant UX).
      setEditingId(null);
      setEditDraft(null);
      setEditTypeOpen(false);
      setEditMethodOpen(false);

      metrics.timeUi("updateEntry click->row", start);

      return { prevEntries, prevSummary };
    },

    onError: (e: any, _vars, ctx: any) => {
      // Restore all cached pages
      if (ctx?.prevEntries) {
        for (const [key, data] of ctx.prevEntries as any[]) {
          qc.setQueryData(key, data);
        }
      }
      if (ctx?.prevSummary) qc.setQueryData(summaryKey, ctx.prevSummary);
      setErr(e?.message || "Update failed");
    },

    onSuccess: async () => {
      const entriesKeyPrefix = ["entries", selectedBusinessId, selectedAccountId] as const;
      await qc.invalidateQueries({ queryKey: entriesKeyPrefix });
      await qc.invalidateQueries({ queryKey: summaryKey });
    },
  });

  function submitInline() {
    const { payee, amountStr, centsAbs } = readSubmitValues();
    if (!payee) { setErr("Payee is required"); return; }
    if (centsAbs === 0) { setErr("Amount is required"); return; }
    if (createMut.isPending) return;

    createMut.mutate({
      tempId: `temp_${Date.now()}`,
      date: draftDate,
      ref: draftRef,
      payee,
      type: draftType,
      method: draftMethod,
      category: draftCategory,
      amountStr,
    });
  }

  const accountCapsule = (
    <CapsuleSelect
      loading={accountsQ.isLoading}
      value={selectedAccountId || ""}
      onValueChange={(v) => {
        setPage(1);
        router.replace(`/ledger?businessId=${selectedBusinessId}&accountId=${v}`);
      }}
      options={(accountsQ.data ?? []).filter((a) => !a.archived_at).map((a) => ({ value: a.id, label: a.name }))}
      placeholder="Select account"
    />
  );

const cols = [
    <col key="c0" style={{ width: "28px" }} />,                       // checkbox
    <col key="c1" style={{ width: "clamp(74px, 6.5vw, 96px)" }} />,   // date
    <col key="c2" style={{ width: "clamp(56px, 5.5vw, 72px)" }} />,   // ref
    <col key="c3" style={{ width: "auto", minWidth: "140px" }} />,    // payee (flex)
    <col key="c4" style={{ width: "clamp(90px, 7.5vw, 110px)" }} />,  // type
    <col key="c5" style={{ width: "clamp(96px, 8.5vw, 120px)" }} />,  // method
    <col key="c6" style={{ width: "clamp(110px, 10vw, 140px)" }} />,  // category
    <col key="c7" style={{ width: "clamp(100px, 8.5vw, 124px)" }} />, // amount
    <col key="c8" style={{ width: "clamp(96px, 8vw, 118px)" }} />,    // balance (slightly tighter)
    <col key="c9" style={{ width: "clamp(110px, 9vw, 130px)" }} />,   // status (room for icons)
    <col key="c10" style={{ width: "88px" }} />,                      // actions
  ];

  const th =
  "px-1.5 py-0.5 align-middle text-xs font-semibold uppercase tracking-wide text-slate-600";
  const td = "px-1.5 py-0.5 align-middle text-xs";
  const trunc = "truncate overflow-hidden whitespace-nowrap";
  const num = "text-right tabular-nums tracking-tight";
  const center = "text-center";

  const headerRow = (
    <tr className="h-[28px] border-b border-slate-200 bg-slate-50">
      <th className={th}>
        <input type="checkbox" checked={allPageSelected} onChange={toggleAllPage} className={checkboxClass} />
      </th>
      <th className={th}>Date</th>
      <th className={th}>Ref</th>
      <th className={th}>Payee</th>
      <th className={th}>Type</th>
      <th className={th}>Method</th>
      <th className={th}>Category</th>
      <th className={th + " " + num}>Amount</th>
      <th className={th + " " + num}>Balance</th>
      <th className={th + " " + center + " pr-10"}>Status</th>
      <th className={th + " text-right"}>Actions</th>
    </tr>
  );

  const addRow = (
    <tr className="bg-emerald-50 border-b-2 border-emerald-200">
      <td className={"bg-emerald-50 " + td}></td>

      <td className={"bg-emerald-50 " + td}>
        <input className={inputH7} type="date" value={draftDate} onChange={(e) => setDraftDate(e.target.value)} />
      </td>

      {/* FIX: rounded, consistent */}
      <td className={"bg-emerald-50 " + td}>
        <input
          className={inputH7}
          placeholder="Ref"
          value={draftRef}
          onChange={(e) => setDraftRef(e.target.value)}
          maxLength={32}
          onKeyDown={(e) => { if (e.key === "Enter") submitInline(); }}
        />
      </td>

      {/* FIX: rounded, consistent */}
      <td className={"bg-emerald-50 " + td}>
        <AutoInput
          value={draftPayee}
          onValueChange={setDraftPayee}
          options={payeeOptions}
          placeholder="Payee"
          inputRef={payeeInputRef}
          inputClassName={inputH7}
          onSubmit={submitInline}
        />
      </td>

      <td className={"bg-emerald-50 " + td}>
        <Select open={typeOpen} onOpenChange={setTypeOpen} value={draftType} onValueChange={(v) => setDraftType(v as UiType)}>
          <SelectTrigger
            className={selectTriggerClass}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setTypeOpen(true); }
              if (e.key === "Enter" && !typeOpen) { e.preventDefault(); submitInline(); }
            }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="bottom" align="start">
            <SelectItem value="INCOME">Income</SelectItem>
            <SelectItem value="EXPENSE">Expense</SelectItem>
            <SelectItem value="TRANSFER">Transfer</SelectItem>
            <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
          </SelectContent>
        </Select>
      </td>

      <td className={"bg-emerald-50 " + td}>
        <Select open={methodOpen} onOpenChange={setMethodOpen} value={draftMethod} onValueChange={(v) => setDraftMethod(v as UiMethod)}>
          <SelectTrigger
            className={selectTriggerClass}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setMethodOpen(true); }
              if (e.key === "Enter" && !methodOpen) { e.preventDefault(); submitInline(); }
            }}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="bottom" align="start">
            <SelectItem value="CASH">Cash</SelectItem>
            <SelectItem value="CARD">Card</SelectItem>
            <SelectItem value="ACH">ACH</SelectItem>
            <SelectItem value="WIRE">Wire</SelectItem>
            <SelectItem value="CHECK">Check</SelectItem>
            <SelectItem value="DIRECT_DEPOSIT">DD (Direct Deposit)</SelectItem>
            <SelectItem value="ZELLE">Zelle</SelectItem>
            <SelectItem value="TRANSFER">Transfer</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>
      </td>

      <td className={"bg-emerald-50 " + td}>
        <AutoInput
          value={draftCategory}
          onValueChange={setDraftCategory}
          options={categoryOptions}
          placeholder="Category"
          inputClassName={inputH7}
          onSubmit={submitInline}
        />
      </td>

      <td className={"bg-emerald-50 " + td + " " + num}>
        <input
          ref={amountInputRef}
          className={inputH7 + " text-right tabular-nums"}
          placeholder="0.00"
          value={draftAmount}
          onChange={(e) => setDraftAmount(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submitInline(); }}
          onFocus={(e) => e.currentTarget.select()}
        />
      </td>

      <td className={"bg-emerald-50 " + td + " " + num + " text-slate-400"}>—</td>
      <td className={"bg-emerald-50 " + td + " " + center}></td>

      <td className={"bg-emerald-50 " + td + " text-right"}>
        <Button className="h-7 w-8 p-0" disabled={createMut.isPending} onClick={submitInline} aria-label="Add">
          <Plus className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );

  const [deleteDialog, setDeleteDialog] = useState<{ id: string; mode: "soft" | "hard" } | null>(null);
  // ================================
  // PR-10 Inline edit actions + menu
  // ================================
  function beginEditFromRow(r: any) {
    if (r.isDeleted) return;
    if (!r?.canDelete) return; // do not edit opening_balance row
    setMenuOpenId(null);
    setEditingId(r.id);
    setEditDraft({
      date: r.date,
      payee: r.payee,
      type: uiTypeFromRaw(r.rawType),
      method: uiMethodFromRaw(r.rawMethod),
      category: r.category,
      amountStr: stripMoneyDisplay(r.amountStr),
    });
    setEditTypeOpen(false);
    setEditMethodOpen(false);
    requestAnimationFrame(() => editPayeeRef.current?.focus());
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
    setEditTypeOpen(false);
    setEditMethodOpen(false);
  }

  function saveEdit(r: any) {
    if (!editDraft) return;
    if (!r?.id) return;
    if (editSaveLockRef.current) return;

    editSaveLockRef.current = true;
    updateMut.mutate(
      {
        entryId: r.id,
        draft: editDraft,
        oldDate: r.date,
        oldAmountCents: r.amountCents,
      },
      {
        onSettled: () => {
          editSaveLockRef.current = false;
        },
      }
    );
  }

  function duplicateFromRow(r: any) {
    setMenuOpenId(null);
    if (!r?.id) return;

    createMut.mutate({
      tempId: `dup_${Date.now()}`,
      date: r.date,
      ref: "",
      payee: (r.payee || "").toString(),
      type: uiTypeFromRaw(r.rawType),
      method: uiMethodFromRaw(r.rawMethod),
      category: (r.category || "").toString(),
      amountStr: stripMoneyDisplay(r.amountStr),
      afterCreateEdit: true,
    });
  }

  function saveTemplateFromRow(r: any) {
    setMenuOpenId(null);
    try {
      const key = "bynkbook:entryTemplates";
      const current = JSON.parse(localStorage.getItem(key) || "[]");
      const next = [
        ...current,
        {
          id: `tpl_${Date.now()}`,
          payee: r.payee,
          type: uiTypeFromRaw(r.rawType),
          method: uiMethodFromRaw(r.rawMethod),
          category: r.category,
          amountStr: stripMoneyDisplay(r.amountStr),
        },
      ].slice(-25);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  
  const body = entriesQ.isLoading ? (
    <tr>
      <td className="p-6 text-slate-500" colSpan={11}>
        Loading…
      </td>
    </tr>
  ) : (
    pageRows.map((r) => {
      const isEditing = editingId === r.id;
      const menuOpen = menuOpenId === r.id;

      return (
        <tr
          key={r.id}
          className={
            "h-[24px] border-b border-slate-200 " +
            (isEditing
              ? "bg-white"
              : r.issueSeverity === "duplicate"
              ? "bg-yellow-50 hover:bg-yellow-100"
              : "hover:bg-slate-50")
          }
        >
          <td className={td}>
            {r.id !== "opening_balance" && !r.isDeleted ? (
              <input
                type="checkbox"
                checked={!!selectedIds[r.id]}
                onChange={() => toggleRow(r.id)}
                className={checkboxClass}
                disabled={isEditing}
              />
            ) : null}
          </td>

          {/* Date */}
          <td className={td + " " + trunc}>
            {isEditing && editDraft ? (
              <input
                className={inputH7}
                type="date"
                value={editDraft.date}
                onChange={(e) =>
                  setEditDraft((d) => (d ? { ...d, date: e.target.value } : d))
                }
              />
            ) : (
              r.date
            )}
          </td>

          {/* Ref (placeholder) */}
          <td className={td + " " + trunc + " text-slate-500"}>{r.ref}</td>

          {/* Payee */}
<td className={td + " min-w-0"}>
  {isEditing && editDraft ? (
    <AutoInput
      value={editDraft.payee}
      onValueChange={(v) =>
        setEditDraft((d) => (d ? { ...d, payee: v } : d))
      }
      options={payeeOptions}
      placeholder="Payee"
      inputRef={editPayeeRef}
      inputClassName={inputH7}
      onSubmit={() => saveEdit(r)}
    />
  ) : (
    <div className="flex items-center gap-1 min-w-0">
      <span className={trunc + " font-medium"}>{r.payee}</span>

      {editedIds[r.id] ? (
        <Pencil className="h-3 w-3 text-slate-400 shrink-0" />
      ) : null}
    </div>
  )}
</td>

          {/* Type */}
          <td className={td + " " + trunc}>
            {isEditing && editDraft ? (
              <Select
                open={editTypeOpen}
                onOpenChange={setEditTypeOpen}
                value={editDraft.type}
                onValueChange={(v) =>
                  setEditDraft((d) => (d ? { ...d, type: v as UiType } : d))
                }
              >
                <SelectTrigger className={selectTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="bottom" align="start">
                  <SelectItem value="INCOME">Income</SelectItem>
                  <SelectItem value="EXPENSE">Expense</SelectItem>
                  <SelectItem value="TRANSFER">Transfer</SelectItem>
                  <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              r.typeDisplay
            )}
          </td>

          {/* Method */}
          <td className={td + " " + trunc}>
            {isEditing && editDraft ? (
              <Select
                open={editMethodOpen}
                onOpenChange={setEditMethodOpen}
                value={editDraft.method}
                onValueChange={(v) =>
                  setEditDraft((d) => (d ? { ...d, method: v as UiMethod } : d))
                }
              >
                <SelectTrigger className={selectTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="bottom" align="start">
                  <SelectItem value="CASH">Cash</SelectItem>
                  <SelectItem value="CARD">Card</SelectItem>
                  <SelectItem value="ACH">ACH</SelectItem>
                  <SelectItem value="WIRE">Wire</SelectItem>
                  <SelectItem value="CHECK">Check</SelectItem>
                  <SelectItem value="DIRECT_DEPOSIT">DD (Direct Deposit)</SelectItem>
                  <SelectItem value="ZELLE">Zelle</SelectItem>
                  <SelectItem value="TRANSFER">Transfer</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              r.methodDisplay
            )}
          </td>

          {/* Category */}
          <td className={td + " " + trunc}>
            {isEditing && editDraft ? (
              <AutoInput
                value={editDraft.category}
                onValueChange={(v) =>
                  setEditDraft((d) => (d ? { ...d, category: v } : d))
                }
                options={categoryOptions}
                placeholder="Category"
                inputClassName={inputH7}
                onSubmit={() => saveEdit(r)}
              />
            ) : (
              r.category
            )}
          </td>

          {/* Amount */}
          <td className={td + " " + num + " font-semibold" + (r.amountNeg ? " text-red-700" : "")}>
            {isEditing && editDraft ? (
              <input
                ref={editAmountRef}
                className={inputH7 + " text-right tabular-nums"}
                value={editDraft.amountStr}
                onChange={(e) =>
                  setEditDraft((d) =>
                    d ? { ...d, amountStr: e.target.value } : d,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); saveEdit(r); }

                  if (e.key === "Escape") cancelEdit();
                }}
                onFocus={(e) => e.currentTarget.select()}
              />
            ) : (
              r.amountStr
            )}
          </td>

          {/* Balance (read-only) */}
          <td className={td + " " + num + (r.balanceNeg ? " text-red-700" : "")}>
            {r.balanceStr}
          </td>

          {/* Status */}
          <td className={td + " " + center + " relative"}>
          {/* Keep chip aligned to header by reserving space symmetrically */}
          <div className="flex justify-center pr-10">
            <StatusChip label={r.status} tone={statusTone(r.rawStatus)} />
          </div>

          {/* Right-pinned icon cluster (does not shift the chip) */}
          <div className="absolute right-1 top-1/2 -translate-y-1/2 mt-0.5 flex items-center gap-1">
            {r.hasDup ? (
              <HoverTooltip text={r.dupTooltip}>
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              </HoverTooltip>
            ) : null}

            {r.hasMissing ? (
              <HoverTooltip text={r.missingTooltip}>
                <Info className="h-4 w-4 text-blue-500" />
              </HoverTooltip>
            ) : null}
          </div>
        </td>

          {/* Actions */}
          <td className={td + " text-right"}>
            {r.canDelete ? (
              isEditing ? (
                <div className="inline-flex items-center gap-1">
                  <Button
                    variant="outline"
                    className="h-6 w-8 p-0"
                    onClick={() => saveEdit(r)}
                    disabled={updateMut.isPending}
                    aria-label="Save"
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="h-6 w-8 p-0"
                    onClick={cancelEdit}
                    disabled={updateMut.isPending}
                    aria-label="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div
                  className="relative inline-flex items-center gap-1"
                  data-rowmenu={r.id}
                >
                  <Button
                    variant="outline"
                    className="h-6 w-8 p-0"
                    onClick={() => setMenuOpenId(menuOpen ? null : r.id)}
                    aria-label="Row actions"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>

                  {menuOpen ? (
                    <div className="absolute right-0 top-full mt-1 w-44 rounded-md border bg-white shadow-md z-50 p-1">
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 inline-flex items-center gap-2"
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          beginEditFromRow(r);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 inline-flex items-center gap-2"
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          duplicateFromRow(r);
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 inline-flex items-center gap-2"
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          saveTemplateFromRow(r);
                        }}
                      >
                        <BookmarkPlus className="h-3.5 w-3.5" />
                        Save as template
                      </button>
                    </div>
                  ) : null}

                  {r.isDeleted ? (
                  <>
                    <Button
                      variant="outline"
                      className="h-6 w-8 p-0"
                      disabled={restoreMut.isPending}
                      onClick={() => restoreMut.mutate(r.id)}
                      aria-label="Restore"
                      title="Restore"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>

                    <Button
                      variant="outline"
                      className="h-6 w-8 p-0"
                      disabled={hardDeleteMut.isPending}
                      onClick={() => setDeleteDialog({ id: r.id, mode: "hard" })}
                      aria-label="Delete permanently"
                      title="Delete permanently"
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    className="h-6 w-8 p-0"
                    disabled={deleteMut.isPending}
                    onClick={() => setDeleteDialog({ id: r.id, mode: "soft" })}
                    aria-label="Delete"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                </div>
              )
            ) : null}
          </td>
        </tr>
      );
    })
  );


  return (
    <div className="flex flex-col gap-3 overflow-hidden" style={containerStyle}>
      <PageHeader title="Ledger" subtitle="Account-scoped" inlineAfterTitle={
        <CapsuleSelect
          loading={accountsQ.isLoading}
          value={selectedAccountId || ""}
          onValueChange={(v) => {
            setPage(1);
            router.replace(`/ledger?businessId=${selectedBusinessId}&accountId=${v}`);
          }}
          options={(accountsQ.data ?? []).filter((a) => !a.archived_at).map((a) => ({ value: a.id, label: a.name }))}
          placeholder="Select account"
        />
      } />

      <FilterBar
        searchValue={searchPayee}
        onSearchChange={setSearchPayee}
        onReset={() => setSearchPayee("")}
        right={
          <>
            {err ? <div className="text-sm text-red-600">{err}</div> : null}
            <Button
              variant="outline"
              className="h-8"
              onClick={() => setShowDeleted((v) => !v)}
              aria-pressed={showDeleted}
            >
              {showDeleted ? "Hide deleted" : "Show deleted"}
            </Button>
          </>
        }
      />

      <LedgerTableShell
        colgroup={cols}
        header={headerRow}
        addRow={addRow}
        body={body}
        footer={
          <tr>
            <td colSpan={11} className="p-0">
              <TotalsFooter
                rowsPerPage={rowsPerPage}
                setRowsPerPage={setRowsPerPage}
                page={page}
                setPage={setPage}
                totalPages={totalPages}
                canPrev={canPrev}
                canNext={canNext}
                incomeText={summaryQ.isLoading ? "…" : formatUsdFromCents(toBigIntSafe(summaryQ.data?.totals?.income_cents))}
                expenseText={summaryQ.isLoading ? "…" : formatUsdFromCents(toBigIntSafe(summaryQ.data?.totals?.expense_cents))}
                netText={summaryQ.isLoading ? "…" : formatUsdFromCents(toBigIntSafe(summaryQ.data?.totals?.net_cents))}
                balanceText={summaryQ.isLoading ? "…" : formatUsdFromCents(toBigIntSafe(summaryQ.data?.balance_cents))}
              />
            </td>
          </tr>
        }
      />

      <Dialog
        open={!!deleteDialog}
        onOpenChange={(open) => {
          if (!open) setDeleteDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deleteDialog?.mode === "hard" ? "Delete permanently" : "Move entry to Deleted"}</DialogTitle>
            <DialogDescription>
              {deleteDialog?.mode === "hard"
                ? "This will permanently delete the entry. This action cannot be undone."
                : "This will move the entry to Deleted. You can restore it later from Show deleted."}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialog(null)}
              disabled={deleteMut.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!deleteDialog) return;
                if (deleteDialog.mode === "hard") {
                  hardDeleteMut.mutate(deleteDialog.id);
                } else {
                  deleteMut.mutate(deleteDialog.id);
                }
                setDeleteDialog(null);
              }}
              disabled={deleteMut.isPending}
            >
                {deleteDialog?.mode === "hard" ? "Delete permanently" : "Move to Deleted"}
              </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}