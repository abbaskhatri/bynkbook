"use client";

/**
 * ================================
 * SECTION: Ledger Page (Phase 3)
 * Changes in this version:
 * UI-only polish (micro-task):
 * 1) Reduce vertical gap between header/filter/table
 * 2) Fit table controls when sidebar expanded (tighten fixed widths; payee min bigger)
 * 3) Remove DUP/CAT header text
 * 4) Tighten DUP/CAT columns (~60% smaller)
 * 5) Reset button thin (same height as inputs) + icon style like old app
 * 6) Filters wrapped in compact "filters area"
 * 7) Smaller toggle styling
 *
 * NO behavior changes.
 * ================================
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser, fetchAuthSession } from "aws-amplify/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UploadPanel } from "@/components/uploads/UploadPanel";

import { UploadsList } from "@/components/uploads/UploadsList";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useEntries } from "@/lib/queries/useEntries";
import { useLedgerSummary } from "@/lib/queries/useLedgerSummary";

import {
  createEntry,
  deleteEntry,
  hardDeleteEntry,
  listEntries,
  restoreEntry,
  updateEntry,
  type Entry,
} from "@/lib/api/entries";

import { listCategories, createCategory, type CategoryRow } from "@/lib/api/categories";
import { createTransfer, updateTransfer, deleteTransfer, restoreTransfer } from "@/lib/api/transfers";

import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/primitives/FilterBar";
import { LedgerTableShell } from "@/components/ledger/ledger-table-shell";
import { FixIssueDialog } from "@/components/ledger/fix-issue-dialog";
import { StatusChip } from "@/components/primitives/StatusChip";
import { inputH7, selectTriggerClass } from "@/components/primitives/tokens";
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
import { AppDialog } from "@/components/primitives/AppDialog";
import { ClosePeriodDialog } from "@/components/ledger/close-period-dialog";

import {
  AlertTriangle,
  Copy,
  Info,
  MoreVertical,
  Pencil,
  Plus,
  RotateCcw,
  Loader2,
  Trash2,
  Check,
  X,
  BookOpen,
} from "lucide-react";

// ================================
// SECTION: Helpers
// ================================
const ZERO = BigInt(0);
const HUNDRED = BigInt(100);

function todayYmd() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function allTimeStartYmd() {
  return "2000-01-01";
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

function statusTone(
  status: string
): "default" | "success" | "warning" | "danger" | "info" {
  const s = (status || "").trim().toUpperCase();
  if (!s) return "default";
  if (s === "SYSTEM") return "info";
  if (s === "CLEARED" || s === "POSTED") return "success";
  if (s === "PENDING") return "warning";
  if (s.includes("FAIL") || s.includes("ERROR")) return "danger";
  return "default";
}

function stripMoneyDisplay(s: string): string {
  const cleaned = (s || "").replace(/[$,]/g, "").trim();
  if (cleaned.startsWith("(") && cleaned.endsWith(")")) return cleaned.slice(1, -1);
  return cleaned;
}

function normalizeCategoryName(name: string): string {
  return (name || "").trim().replace(/\s+/g, " ");
}

function normKey(name: string): string {
  return normalizeCategoryName(name).toLowerCase();
}

// ================================
// SECTION: Autocomplete (unchanged)
// ================================
function filterOptions(query: string, options: string[]) {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice(0, 8);
  const starts = options.filter((o) => o.toLowerCase().startsWith(q));
  const contains = options.filter(
    (o) => !o.toLowerCase().startsWith(q) && o.toLowerCase().includes(q)
  );
  return [...starts, ...contains].slice(0, 8);
}

function AutoInput(props: {
  // Controlled usage (existing)
  value?: string;
  onValueChange?: (v: string) => void;

  // Uncontrolled usage (new; for typing isolation)
  defaultValue?: string;

  options: string[];
  placeholder?: string;
  inputClassName?: string;
  onSubmit?: () => void;
  inputRef?: any;

  // Create option (new)
  allowCreate?: boolean;
  onCreate?: (name: string) => void;
}) {
  const {
    value,
    onValueChange,
    defaultValue = "",
    options,
    placeholder,
    inputClassName,
    onSubmit,
    inputRef,
  } = props;

  const isControlled = typeof value === "string" && typeof onValueChange === "function";

  const [inner, setInner] = useState(defaultValue);
  const currentValue = isControlled ? (value as string) : inner;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const filtered = useMemo(() => filterOptions(currentValue, options), [currentValue, options]);

  const canCreate =
    !!props.allowCreate &&
    !!normalizeCategoryName(currentValue) &&
    !options.some((o) => normKey(o) === normKey(currentValue));

  const applyValue = (next: string) => {
    if (isControlled) {
      onValueChange?.(next);
    } else {
      setInner(next);
      if (inputRef?.current) inputRef.current.value = next;
    }
  };

  const onKeyDown = (e: any) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Tab") {
      if (open && filtered[active]) applyValue(filtered[active]);
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
      if (open && filtered[active]) {
        e.preventDefault();
        applyValue(filtered[active]);
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
        value={currentValue}
        onChange={(e) => {
          const next = e.target.value;

          if (isControlled) {
            onValueChange?.(next);
          } else {
            setInner(next);
            if (inputRef?.current) inputRef.current.value = next;
          }

          setActive(0);
          setOpen(next.trim().length > 0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
      />
      {open && (filtered.length > 0 || canCreate) ? (
        <div className="absolute left-0 top-full mt-1 w-full z-50 rounded-md border bg-white shadow-md p-0 max-h-56 overflow-auto">
          {canCreate ? (
            <button
              type="button"
              className="w-full text-left px-2 py-1 text-xs hover:bg-slate-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const name = normalizeCategoryName(currentValue);
                props.onCreate?.(name);
                setOpen(false);
              }}
            >
              <span className="text-slate-700">Create</span>{" "}
              <span className="font-medium text-slate-900">“{normalizeCategoryName(currentValue)}”</span>
            </button>
          ) : null}

          {filtered.map((opt, idx) => (
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

                if (isControlled) {
                  onValueChange?.(opt);
                } else {
                  setInner(opt);
                  if (inputRef?.current) inputRef.current.value = opt;
                }

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

// ================================
// SECTION: Tooltip (portal) for issue icons
// ================================
function HoverTooltip(props: { text: string; children: any }) {
  const { text, children } = props;
  const ref = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
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
            body
          )
        : null}
    </span>
  );
}

// ================================
// SECTION: Types
// ================================
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
  if (uiMethod === "DIRECT_DEPOSIT") return "DIRECT_DEPOSIT";
  if (uiMethod === "ZELLE") return "ZELLE";
  if (uiMethod === "TRANSFER") return "TRANSFER";
  return "OTHER";
}

type CreateVars = {
  tempId: string;
  date: string;
  ref: string;
  payee: string;
  type: UiType;
  method: UiMethod;
  categoryName: string;
  categoryId: string | null;
  toAccountId?: string;
  amountStr: string;
  afterCreateEdit?: boolean;
};

type EditDraft = {
  date: string;
  ref: string;
  payee: string;
  type: UiType;
  method: UiMethod;
  category: string;
  amountStr: string;
};

function uiTypeFromRaw(raw: string | null | undefined): UiType {
  const t = String(raw || "").toUpperCase();
  if (t === "INCOME") return "INCOME";
  if (t === "EXPENSE") return "EXPENSE";
  if (t === "TRANSFER") return "TRANSFER";
  if (t === "ADJUSTMENT") return "ADJUSTMENT";
  return "EXPENSE";
}

function uiMethodFromRaw(raw: string | null | undefined): UiMethod {
  const m = String(raw || "").toUpperCase();
  const allowed: UiMethod[] = [
    "CASH","CARD","ACH","WIRE","CHECK","DIRECT_DEPOSIT","ZELLE","TRANSFER","OTHER",
  ];
  return (allowed as string[]).includes(m) ? (m as UiMethod) : "OTHER";
}

// ================================
// SECTION: Component
// ================================
export default function LedgerPageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const containerStyle = { height: "calc(100vh - 56px - 48px)" as const };

  const [openUpload, setOpenUpload] = useState(false);
  const [uploadType, setUploadType] = useState<"RECEIPT" | "INVOICE">("RECEIPT");

  // PERF logging toggle (default OFF)
  // Enable via localStorage: bynkbook.debug.perf = "1"
  // or via window.__BYNK_DEBUG__ = { perf: true }
  const perfOn = useMemo(() => {
    try {
      const w: any = typeof window !== "undefined" ? (window as any) : null;
      if (w?.__BYNK_DEBUG__?.perf) return true;
      return localStorage.getItem("bynkbook.debug.perf") === "1";
    } catch {
      return false;
    }
  }, []);

  const perfLog = (...args: any[]) => {
    if (!perfOn) return;
    // eslint-disable-next-line no-console
    console.log(...args);
  };

  // Coalesced background refresh for entries (no storms)
  const entriesRefreshTimerRef = useRef<number | null>(null);

  const scheduleEntriesRefresh = (reason: string) => {
    if (!selectedBusinessId || !selectedAccountId) return;

    // coalesce
    if (entriesRefreshTimerRef.current) {
      window.clearTimeout(entriesRefreshTimerRef.current);
      entriesRefreshTimerRef.current = null;
    }

    entriesRefreshTimerRef.current = window.setTimeout(() => {
      entriesRefreshTimerRef.current = null;
      // One background refresh (never block UI)
      void qc.invalidateQueries({ queryKey: ["entries", selectedBusinessId, selectedAccountId] });
      perfLog(`[PERF][entriesRefresh] fired (${reason})`);
    }, 15000); // 15s idle
  };

  // Refresh on window focus (coalesced)
  // Use a stable key here to avoid referencing business/account variables before declaration.
  const refreshScopeKey = `${sp.get("businessId") ?? sp.get("businessesId") ?? ""}|${sp.get("accountId") ?? ""}`;

  useEffect(() => {
    const onFocus = () => scheduleEntriesRefresh("focus");
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshScopeKey]);

  // Auth
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

  // Business/account
  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");
  const accountIdFromUrl = sp.get("accountId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const myBusinessRole = useMemo(() => {
    const list = businessesQ.data ?? [];
    const b = list.find((x: any) => x?.id === selectedBusinessId);
    return String(b?.role ?? "").toUpperCase();
  }, [businessesQ.data, selectedBusinessId]);

  const canClosePeriod = myBusinessRole === "OWNER" || myBusinessRole === "ADMIN";

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

    // Filters + toggle
  const [searchPayee, setSearchPayee] = useState("");
  const [debouncedPayee, setDebouncedPayee] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);

  // Advanced filters (UI-only; local filtering on cached rows)
  const [filterType, setFilterType] = useState<"ALL" | UiType>("ALL");
  const [filterMethod, setFilterMethod] = useState<string>("ALL");
  const [filterCategory, setFilterCategory] = useState<string>("ALL");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");

  // Advanced section visibility (UI-only)
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Amount filters (UI-only; interpreted as dollars, local filtering)
  const [filterAmountMin, setFilterAmountMin] = useState<string>("");
  const [filterAmountMax, setFilterAmountMax] = useState<string>("");
  const [filterAmountExact, setFilterAmountExact] = useState<string>("");

  // Debounce payee search (local filtering only; no refetch)
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedPayee(searchPayee);
      setPage(1);
    }, 200);
    return () => clearTimeout(t);
  }, [searchPayee]);

  // Paging
  const [rowsPerPage, setRowsPerPage] = useState(100);
  const [page, setPage] = useState(1);

  const maxFetch = 500;
  const fetchLimit = useMemo(() => Math.min(maxFetch, rowsPerPage * page), [rowsPerPage, page]);

  const entriesKey = useMemo(
    () => ["entries", selectedBusinessId, selectedAccountId, fetchLimit, showDeleted] as const,
    [selectedBusinessId, selectedAccountId, fetchLimit, showDeleted]
  );

  const entriesQ = useEntries({
    businessId: selectedBusinessId,
    accountId: selectedAccountId,
    limit: fetchLimit,
    includeDeleted: showDeleted,
  });

  // Totals scope (all-time for Phase 3)
  const from = allTimeStartYmd();
  const to = todayYmd();
  const summaryKey = ["ledgerSummary", selectedBusinessId, selectedAccountId, from, to] as const;

  const summaryQ = useLedgerSummary({
    businessId: selectedBusinessId,
    accountId: selectedAccountId,
    from,
    to,
  });

  // Opening entry
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

  const categoriesQ = useQuery({
    queryKey: ["categories", selectedBusinessId],
    enabled: !!selectedBusinessId,
    queryFn: async () => {
      if (!selectedBusinessId) return { ok: true as const, rows: [] as CategoryRow[] };
      return listCategories(selectedBusinessId, { includeArchived: false });
    },
  });

  const categoryRows = categoriesQ.data?.rows ?? [];

  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categoryRows) m.set(c.id, c.name);
    return m;
  }, [categoryRows]);

  const categoryIdByNormName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categoryRows) m.set(normKey(c.name), c.id);
    return m;
  }, [categoryRows]);

  // Autofill options
  const payeeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of entriesWithOpening) {
      const p = (e.payee || "").trim();
      if (p && p !== "Opening Balance") set.add(p);
    }
    return Array.from(set);
  }, [entriesWithOpening]);

  const categoryOptions = useMemo(() => {
    // real categories (not memo)
    return categoryRows
      .filter((c) => !c.archived_at)
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b));
  }, [categoryRows]);

  // Header "Uncategorized" chip count is defined after rowModels (below).

  // Running balance
  const rowModels = useMemo(() => {
    const listDescAll = entriesWithOpening.slice();
    const listAscAll = entriesWithOpening.slice().sort(sortEntriesChronAsc);
    const listAscBal = listAscAll.filter((e) => e.id === "opening_balance" || !e.deleted_at);

    const idxOpen = listAscBal.findIndex((e) => e.id === "opening_balance");
    const delta = listAscBal.map((e) => (e.id === "opening_balance" ? ZERO : toBigIntSafe(e.amount_cents)));
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
      const rowBal = balById.get(e.id);
      return {
        id: e.id,
        date: e.date,
        ref: "",
        payee: e.payee ?? "",
        typeDisplay: titleCase(e.type ?? ""),
        methodDisplay: titleCase(e.method ?? ""),
        rawType: (e.type ?? "").toString(),
        rawMethod: (e.method ?? "").toString(),
        category: (categoryNameById.get((e as any).category_id ?? "") ?? ""),
        categoryId: ((e as any).category_id ?? null) as string | null,
        transferId: ((e as any).transfer_id ?? null) as string | null,
        amountCents: amt.toString(),
        amountStr: formatUsdFromCents(amt),
        amountNeg: amt < ZERO,
        balanceStr: isDeleted || rowBal === undefined ? "—" : formatUsdFromCents(rowBal),
        balanceNeg: !isDeleted && rowBal !== undefined ? rowBal < ZERO : false,
        status: isDeleted ? "Deleted" : titleCase(e.status ?? ""),
        rawStatus: isDeleted ? "DELETED" : (e.status ?? "").toString(),
        isDeleted,
        canDelete: e.id !== "opening_balance",
      };
    });
  }, [entriesWithOpening, openingBalanceCents]);

  // Header "Uncategorized" chip count (Stage A attention indicator; instant, no backend calls).
  // NOTE: Visibility only; Category Review page is the workflow destination.
  const uncategorizedCount = useMemo(() => {
    let n = 0;
    for (const r of rowModels) {
      if (r.isDeleted) continue;
      if (r.id === "opening_balance") continue;
      const cat = (r.category || "").trim();
      if (!cat || cat.toLowerCase() === "uncategorized") n++;
    }
    return n;
  }, [rowModels]);

      // Issues: create separate columns
  const issuesById = useMemo(() => {

    const map: Record<
      string,
      {
        dup: boolean;
        missing: boolean;
        stale: boolean;
        dupTooltip: string;
        missingTooltip: string;
        staleTooltip: string;
      }
    > = {};

    const groups = new Map<string, Array<{ id: string; day: number }>>();

    const ymdToDay = (ymd: string) => {
      const s = (ymd || "").slice(0, 10);
      const y = Number(s.slice(0, 4));
      const m = Number(s.slice(5, 7));
      const d = Number(s.slice(8, 10));
      if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || !y || !m || !d) return NaN;
      return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
    };

    const todayDay = ymdToDay(todayYmd());

    for (const r of rowModels) {
      if (r.isDeleted) continue; // Deleted entries must NEVER create issues
      if (r.id === "opening_balance") continue;

      const cat = (r.category || "").trim();
      if (!cat || cat.toLowerCase() === "uncategorized") {
        map[r.id] = {
          ...(map[r.id] || {
            dup: false,
            missing: false,
            stale: false,
            dupTooltip: "",
            missingTooltip: "",
            staleTooltip: "",
          }),
          missing: true,
          missingTooltip: "• Category missing or uncategorized",
        };
      }

      const day = ymdToDay(r.date);
      if (!Number.isFinite(day) || !Number.isFinite(todayDay)) continue;

      const methodRaw = (r.rawMethod || "").toString().toUpperCase();
      const isCheck = methodRaw === "CHECK";

      // STALE_CHECK: CHECK only, older than 45 days
            if (isCheck && todayDay - day > 45) {
        const ageDays = todayDay - day;
        map[r.id] = {
          ...(map[r.id] || {
            dup: false,
            missing: false,
            stale: false,
            dupTooltip: "",
            missingTooltip: "",
            staleTooltip: "",
          }),
          stale: true,
          staleTooltip: `• Stale check — ${ageDays} days old`,
        };
      }

      // Duplicate grouping key: CHECK vs NONCHECK + signed amountCents + normalized payee
      const payeeKey = (r.payee || "").trim().toLowerCase();
      const bucket = isCheck ? "CHECK" : "NONCHECK";
      const key = `${bucket}|${r.amountCents}|${payeeKey}`;

      const arr = groups.get(key);
      if (arr) arr.push({ id: r.id, day });
      else groups.set(key, [{ id: r.id, day }]);
    }

    // Duplicate clusters: general 7d, checks 30d
    for (const [key, items] of groups.entries()) {
      if (items.length <= 1) continue;

      const bucket = key.startsWith("CHECK|") ? "CHECK" : "NONCHECK";
      const windowDays = bucket === "CHECK" ? 30 : 7;
      const tooltip =
        bucket === "CHECK"
          ? "• Potential duplicate entry (CHECK within 30 days)"
          : "• Potential duplicate entry (within 7 days)";

      items.sort((a, b) => a.day - b.day);

      let start = 0;
      for (let i = 1; i < items.length; i++) {
        while (start < i && items[i].day - items[start].day > windowDays) start++;

        if (i - start >= 1) {
          for (let j = start; j <= i; j++) {
            const id = items[j].id;
            map[id] = {
              ...(map[id] || {
                dup: false,
                missing: false,
                stale: false,
                dupTooltip: "",
                missingTooltip: "",
                staleTooltip: "",
              }),
              dup: true,
              dupTooltip: tooltip,
            };
          }
        }
      }
    }

    return map;
  }, [rowModels]);

  // Stage A attention counts (UI-only; not authoritative)
  const issuesAttentionCount = useMemo(() => {
    // Stage A "Issues" attention count excludes missing category (owned by Category Review).
    let n = 0;
    for (const v of Object.values(issuesById)) {
      if (v?.dup || v?.stale) n++;
    }
    return n;
  }, [issuesById]);

  // Persist attention counts for sidebar badges (per business+account)
  useEffect(() => {
    if (!selectedBusinessId || !selectedAccountId) return;

    try {
      const kIssues = `bynkbook:attn:issues:${selectedBusinessId}:${selectedAccountId}`;
      const kUncat = `bynkbook:attn:uncat:${selectedBusinessId}:${selectedAccountId}`;

      localStorage.setItem(kIssues, String(issuesAttentionCount));
      localStorage.setItem(kUncat, String(uncategorizedCount));

      // Same-tab instant update (storage event does not fire in same tab)
      window.dispatchEvent(
        new CustomEvent("bynkbook:attnCountsUpdated", {
          detail: { businessId: selectedBusinessId, accountId: selectedAccountId },
        })
      );
    } catch {
      // ignore (private mode / storage blocked)
    }
  }, [selectedBusinessId, selectedAccountId, issuesAttentionCount, uncategorizedCount]);

  const rowsUi = useMemo(() => {
    return rowModels.map((r) => {
      const issue = issuesById[r.id];
      return {
        ...r,
        hasDup: !!issue?.dup,
        hasMissing: !!issue?.missing,
        hasStale: !!issue?.stale,
        dupTooltip: issue?.dupTooltip ?? "",
        missingTooltip: issue?.missingTooltip ?? "",
        staleTooltip: issue?.staleTooltip ?? "",
      };
    });
  }, [rowModels, issuesById]);

   const filteredRowsAll = useMemo(() => {
  const q = debouncedPayee.trim().toLowerCase();

  // Normalize date bounds (YYYY-MM-DD strings compare lexicographically)
  const from = (filterFrom || "").trim();
  const to = (filterTo || "").trim();

  // Amount filters (interpreted as dollars; compared on absolute value)
  const exactStr = (filterAmountExact || "").trim();
  const minStr = (filterAmountMin || "").trim();
  const maxStr = (filterAmountMax || "").trim();

  const exactCentsAbs = exactStr ? Math.round(Math.abs(Number(exactStr)) * 100) : null;
  const minCentsAbs = minStr ? Math.round(Math.abs(Number(minStr)) * 100) : null;
  const maxCentsAbs = maxStr ? Math.round(Math.abs(Number(maxStr)) * 100) : null;

  const hasExact = exactCentsAbs !== null && Number.isFinite(exactCentsAbs);
  const hasMin = minCentsAbs !== null && Number.isFinite(minCentsAbs);
  const hasMax = maxCentsAbs !== null && Number.isFinite(maxCentsAbs);

  return rowsUi.filter((r) => {
    // Payee search (debounced)
    if (q && !r.payee.toLowerCase().includes(q)) return false;

    // Type filter (rawType expected to be "INCOME"/"EXPENSE" for real rows)
    if (filterType !== "ALL") {
      const t = (r.rawType || "").toString().toUpperCase();
      if (t !== filterType) return false;
    }

    // Method filter (compare against rawMethod when possible; fallback to display)
    if (filterMethod !== "ALL") {
      const mRaw = (r.rawMethod || "").toString().toUpperCase();
      const mDisp = (r.methodDisplay || "").toString().toUpperCase().replace(/\s+/g, "_");
      const want = filterMethod.toUpperCase();
      if (mRaw !== want && mDisp !== want) return false;
    }

    // Category filter (real category_id)
    if (filterCategory !== "ALL") {
      const cid = r.categoryId;
      if (filterCategory === "__UNCATEGORIZED__") {
        if (cid) return false;
      } else {
        if (cid !== filterCategory) return false;
      }
    }

    // Date range filter (skip if no bounds)
    if (from) {
      const d = (r.date || "").slice(0, 10);
      if (d && d < from) return false;
    }
    if (to) {
      const d = (r.date || "").slice(0, 10);
      if (d && d > to) return false;
    }

    // Amount filter (absolute cents)
    if (hasExact || hasMin || hasMax) {
      const centsAbs = Math.abs(Number(r.amountCents || 0));

      if (hasExact) {
        if (centsAbs !== exactCentsAbs) return false;
      } else {
        if (hasMin && centsAbs < (minCentsAbs as number)) return false;
        if (hasMax && centsAbs > (maxCentsAbs as number)) return false;
      }
    }

    return true;
  });
}, [rowsUi, debouncedPayee, filterType, filterMethod, filterCategory, filterFrom, filterTo, filterAmountMin, filterAmountMax, filterAmountExact]);

  const startIdx = (page - 1) * rowsPerPage;
  const endIdx = page * rowsPerPage;
  const pageRows = filteredRowsAll.slice(startIdx, endIdx);

  const hasMoreOnServer = (entriesQ.data?.length ?? 0) === fetchLimit && fetchLimit < maxFetch;
  const canNext = endIdx < filteredRowsAll.length || hasMoreOnServer;
  const canPrev = page > 1;
  const totalPages = Math.max(1, Math.ceil(filteredRowsAll.length / rowsPerPage));

// Selection
  const checkboxClass =
    "h-4 w-4 rounded border border-slate-300 bg-white checked:bg-slate-900 checked:border-slate-900";
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  // Only rows that actually have checkboxes (matches your row render condition)
  const selectablePageIds = useMemo(() => {
    return pageRows
      .filter((r) => r.id !== "opening_balance" && !r.isDeleted)
      .map((r) => r.id);
  }, [pageRows]);

  const selectedCount = useMemo(() => {
    return selectablePageIds.filter((id) => !!selectedIds[id]).length;
  }, [selectablePageIds, selectedIds]);

  const allPageSelected = useMemo(() => {
    if (selectablePageIds.length === 0) return false;
    return selectablePageIds.every((id) => !!selectedIds[id]);
  }, [selectablePageIds, selectedIds]);

  function toggleRow(id: string) {
    setSelectedIds((m) => ({ ...m, [id]: !m[id] }));
  }

  function toggleAllPage() {
    const next = { ...selectedIds };
    const shouldSelect = !allPageSelected;
    for (const id of selectablePageIds) next[id] = shouldSelect;
    setSelectedIds(next);
  }

  // Bulk actions (Ledger): bulk soft delete only
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  function clearSelection() {
    setSelectedIds({});
    setBulkMsg(null);
  }

  const bulkDeleteMut = useMutation({
    mutationFn: async (entryIds: string[]) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");
      const results = await Promise.allSettled(
        entryIds.map((id) =>
          deleteEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId: id })
        )
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { failed, total: entryIds.length };
    },
    onMutate: async (entryIds) => {
      setErr(null);
      setBulkMsg(null);
      await qc.cancelQueries({ queryKey: entriesKey });
      const prev = (qc.getQueryData(entriesKey) as Entry[] | undefined) ?? [];
      // optimistic: hide by marking deleted_at
      const nowIso = new Date().toISOString();
      qc.setQueryData(
        entriesKey,
        prev.map((e) => (entryIds.includes(e.id) ? { ...e, deleted_at: nowIso } : e))
      );
      return { prev };
    },
    onError: (e: any, _ids: any, ctx: any) => {
      if (ctx?.prev) qc.setQueryData(entriesKey, ctx.prev);
      setErr(e?.message || "Bulk delete failed");
    },
    onSuccess: (res) => {
      if (res.failed > 0) setBulkMsg(`Deleted with ${res.failed} failures`);
      else setBulkMsg("Deleted");
      scheduleEntriesRefresh("bulkDelete");
      clearSelection();
      setTimeout(() => setBulkMsg(null), 1800);
    },
  });

  // Add row
  const [draftDate, setDraftDate] = useState(todayYmd());
  const [draftRef, setDraftRef] = useState("");
  const [draftPayee, setDraftPayee] = useState("");
    const [draftType, setDraftType] = useState<UiType>("EXPENSE");
  const [draftMethod, setDraftMethod] = useState<UiMethod>("CASH");
  const [draftCategory, setDraftCategory] = useState("");
  const [draftCategoryId, setDraftCategoryId] = useState<string | null>(null);

  const [draftToAccountId, setDraftToAccountId] = useState<string>("");

  const [draftAmount, setDraftAmount] = useState("0.00");
  const [err, setErr] = useState<string | null>(null);

    // Last scan (UI-only, persisted per business+account)
  const scanKey = useMemo(() => {
    if (!selectedBusinessId || !selectedAccountId) return "";
    return `bynkbook:lastScanAt:${selectedBusinessId}:${selectedAccountId}`;
  }, [selectedBusinessId, selectedAccountId]);

  const [lastScanAt, setLastScanAt] = useState<string | null>(null);

  useEffect(() => {
    if (!scanKey) return;
    try {
      setLastScanAt(localStorage.getItem(scanKey));
    } catch {
      // ignore
    }
  }, [scanKey]);

  function formatScanLabel(iso: string | null) {
    if (!iso) return "Never";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "Unknown";
    const diffMs = Date.now() - t;

    const min = Math.floor(diffMs / 60000);
    if (min < 1) return "Just now";
    if (min < 60) return `${min}m ago`;

    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;

    const d = Math.floor(hr / 24);
    return `${d}d ago`;
  }

  // Issues scan (Stage B)
  const [scanBusy, setScanBusy] = useState(false);
  async function scanIssues() {
    if (scanBusy) return;
    if (!selectedBusinessId || !selectedAccountId) return;

    setErr(null);
    setScanBusy(true);

    try {
      const session = await fetchAuthSession();
      const token = session.tokens?.accessToken?.toString();
      if (!token) throw new Error("Missing access token");

      const base =
        process.env.NEXT_PUBLIC_API_URL ||
        process.env.NEXT_PUBLIC_API_BASE_URL ||
        process.env.NEXT_PUBLIC_API_ENDPOINT ||
        "";

      if (!base) throw new Error("Missing NEXT_PUBLIC_API_URL");

      const url = `${base}/v1/businesses/${selectedBusinessId}/accounts/${selectedAccountId}/issues/scan`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          includeMissingCategory: false,
          dryRun: false,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Scan failed: ${res.status} ${text}`);
      }

      // Targeted refresh: only issues queries for this account (no storms)
      void qc.invalidateQueries({
        queryKey: ["entryIssues", selectedBusinessId, selectedAccountId],
        exact: false,
      });

      // Persist last scan timestamp (UI-only)
      const nowIso = new Date().toISOString();
      if (scanKey) {
        try {
          localStorage.setItem(scanKey, nowIso);
        } catch {
          // ignore
        }
      }
      setLastScanAt(nowIso);

      // No success toast/message (keep UI quiet)
    } catch (e: any) {
      setErr(e?.message || "Scan failed");
    } finally {
      setScanBusy(false);
    }
  }

  const payeeInputRef = useRef<HTMLInputElement>(null);
  const categoryInputRef = useRef<HTMLInputElement>(null);
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

  // Edit state (ALL fields)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedIds, setEditedIds] = useState<Record<string, boolean>>({});
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  const editPayeeRef = useRef<HTMLInputElement>(null);
  const editAmountRef = useRef<HTMLInputElement>(null);
  const editRefRef = useRef<HTMLInputElement>(null);
  const [editTypeOpen, setEditTypeOpen] = useState(false);
  const [editMethodOpen, setEditMethodOpen] = useState(false);

  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(`[data-rowmenu="${menuOpenId}"]`)) return;
      setMenuOpenId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpenId]);

    // Mutations (keep working behavior)
  const createMut = useMutation({
    mutationFn: async (vars: any) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");

      const centsRaw = parseMoneyToCents(vars.amountStr);
      const centsAbs = Math.abs(centsRaw);

      if (!vars.payee.trim()) throw new Error("Payee is required");
      if (centsAbs === 0) throw new Error("Amount is required");

      // TRANSFER: use transfer endpoint (double-entry)
      if (vars.type === "TRANSFER") {
        if (!vars.toAccountId) throw new Error("To account is required");
        return createTransfer({
          businessId: selectedBusinessId,
          fromAccountId: selectedAccountId,
          input: {
            to_account_id: vars.toAccountId,
            date: vars.date,
            amount_cents: centsAbs,
            payee: vars.payee.trim(),
            memo: vars.ref?.trim() ? `Ref: ${vars.ref.trim()}` : null,
            method: "TRANSFER",
            status: "EXPECTED",
          },
        });
      }

      // ADJUSTMENT: keep sign exactly as user typed
      if (vars.type === "ADJUSTMENT") {
        return createEntry({
          businessId: selectedBusinessId,
          accountId: selectedAccountId,
          input: {
            date: vars.date,
            payee: vars.payee.trim(),
            memo: vars.ref?.trim() ? `Ref: ${vars.ref.trim()}` : undefined,
            category_id: vars.categoryId ?? null,
            amount_cents: centsRaw,
            type: "ADJUSTMENT",
            method: normalizeBackendMethod(vars.method),
            status: "EXPECTED",
          },
        });
      }

      // INCOME/EXPENSE: enforce sign rules (frontend + backend)
      const backendType = vars.type === "INCOME" ? "INCOME" : "EXPENSE";
      const signed = backendType === "EXPENSE" ? -Math.abs(centsRaw) : Math.abs(centsRaw);

      return createEntry({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        input: {
          date: vars.date,
          payee: vars.payee.trim(),
          memo: vars.ref?.trim() ? `Ref: ${vars.ref.trim()}` : undefined,
          category_id: vars.categoryId ?? null,
          amount_cents: signed,
          type: backendType,
          method: normalizeBackendMethod(vars.method),
          status: "EXPECTED",
        },
      });
    },
    onMutate: async (vars: any) => {
  const t0 = performance.now();
  const mark = `[PERF][create][${vars?.tempId || "noid"}]`;
  perfLog(`${mark} click→onMutate start`);

  setErr(null);
  await qc.cancelQueries({ queryKey: entriesKey });

  const previous = (qc.getQueryData(entriesKey) as Entry[] | undefined) ?? [];
  const nowIso = new Date().toISOString();

  const cents = parseMoneyToCents(vars.amountStr);

  // optimistic amount/type rules
  let backendType: string = vars.type;
  let signed: number = cents;

  if (vars.type === "TRANSFER") {
    backendType = "TRANSFER";
    signed = -Math.abs(cents); // from-leg is negative in current account
  } else if (vars.type === "ADJUSTMENT") {
    backendType = "ADJUSTMENT";
    signed = cents; // keep sign
  } else if (vars.type === "INCOME") {
    backendType = "INCOME";
    signed = Math.abs(cents);
  } else {
    backendType = "EXPENSE";
    signed = -Math.abs(cents);
  }

  const optimistic: Entry = {
    id: vars.tempId,
    business_id: selectedBusinessId!,
    account_id: selectedAccountId!,
    date: vars.date,
    payee: vars.payee.trim(),
    memo: null,
    category_id: vars.categoryId ?? null,
    amount_cents: String(signed),
    type: backendType,
    method: normalizeBackendMethod(vars.method),
    status: "EXPECTED",
    deleted_at: null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  // NOTE: Intentionally avoid sorting here to reduce onMutate CPU spikes.
  // Display ordering is handled by existing memoized sorting logic.
  qc.setQueryData(entriesKey, [optimistic, ...previous]);

  // reset add-row
  setDraftRef("");
  setDraftPayee("");
  setDraftCategory("");
  setDraftCategoryId(null);
  setDraftToAccountId("");
  setDraftAmount("0.00");
  setDraftType("EXPENSE");
  setDraftMethod("CASH");

    // Controlled inputs reset via state; no direct DOM writes needed

  requestAnimationFrame(() => payeeInputRef.current?.focus());

  const t1 = performance.now();
  perfLog(`${mark} onMutate end (optimistic applied) in ${(t1 - t0).toFixed(1)}ms`);

  return { previous, __perf: { t0, mark } };
},

    onError: (e: any, vars: any, ctx: any) => {
      const mark = ctx?.__perf?.mark || `[PERF][create][${vars?.tempId || "noid"}]`;
      const t0 = ctx?.__perf?.t0 ?? performance.now();
      const tErr = performance.now();
      perfLog(`${mark} server error after ${(tErr - t0).toFixed(1)}ms`, e);

      if (ctx?.previous) qc.setQueryData(entriesKey, ctx.previous);
      setErr(e?.message || "Create failed");
    },
    onSuccess: async (_data: any, vars: any, ctx: any) => {
  const mark = ctx?.__perf?.mark || `[PERF][create][${vars?.tempId || "noid"}]`;
  const t0 = ctx?.__perf?.t0 ?? performance.now();
  const tOk = performance.now();
  perfLog(`${mark} server success after ${(tOk - t0).toFixed(1)}ms`);

  scheduleEntriesRefresh("create");

  // NOTE: Summary refresh intentionally NOT triggered on every mutation (Phase 3 performance).
  // Totals remain last-known until a later refresh policy is applied.
},

  });

    const updateMut = useMutation({
    mutationFn: async (p: { entryId: string; updates: any }) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");
      return updateEntry({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        entryId: p.entryId,
        updates: p.updates,
      });
    },
    onMutate: async (p) => {
  const t0 = performance.now();
  const mark = `[PERF][update][${p?.entryId || "noid"}]`;
  perfLog(`${mark} click→onMutate start`);

  setErr(null);
  void qc.cancelQueries({ queryKey: entriesKey });

  const previous = (qc.getQueryData(entriesKey) as Entry[] | undefined) ?? [];
  const idx = previous.findIndex((e) => e.id === p.entryId);
  if (idx < 0) {
    const tSkip = performance.now();
    perfLog(`${mark} onMutate skipped (row not in cache) in ${(tSkip - t0).toFixed(1)}ms`);
    return { previous, __perf: { t0, mark } };
  }

  const prevRow = previous[idx];
  const nextRow: Entry = {
    ...prevRow,
    ...p.updates,
    memo: p.updates.memo ?? prevRow.memo,
    updated_at: new Date().toISOString(),
  };

  const next = previous.slice();
  next[idx] = nextRow;

  // NOTE: Intentionally avoid sorting here to reduce onMutate CPU spikes.
  // Display ordering is handled by existing memoized sorting logic.
  qc.setQueryData(entriesKey, next);

  const t1 = performance.now();
  perfLog(`${mark} onMutate end (optimistic applied) in ${(t1 - t0).toFixed(1)}ms`);

  return { previous, __perf: { t0, mark } };
},

    onError: (e: any, vars: any, ctx: any) => {
      const mark = ctx?.__perf?.mark || `[PERF][update][${vars?.entryId || "noid"}]`;
      const t0 = ctx?.__perf?.t0 ?? performance.now();
      const tErr = performance.now();
      perfLog(`${mark} server error after ${(tErr - t0).toFixed(1)}ms`, e);

      if (ctx?.previous) qc.setQueryData(entriesKey, ctx.previous);
      setErr("Update failed");
    },
    onSuccess: async (_data, vars: any, ctx: any) => {
  const mark = ctx?.__perf?.mark || `[PERF][update][${vars?.entryId || "noid"}]`;
  const t0 = ctx?.__perf?.t0 ?? performance.now();
  const tOk = performance.now();
  perfLog(`${mark} server success after ${(tOk - t0).toFixed(1)}ms`);

  if (vars?.entryId) setEditedIds((m) => ({ ...m, [vars.entryId]: true }));

  scheduleEntriesRefresh("update");

  // NOTE: Summary refresh intentionally NOT triggered on every mutation (Phase 3 performance).
  // Totals remain last-known until a later refresh policy is applied.
},

  });

  const deleteMut = useMutation({
  mutationFn: async (entryId: string) => {
    if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");
    return deleteEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId });
  },
  onMutate: async (entryId: string) => {
  const t0 = performance.now();
  const mark = `[PERF][delete][${entryId || "noid"}]`;
  perfLog(`${mark} click→onMutate start`);

  setShowDeleted(true);
  void qc.cancelQueries({ queryKey: entriesKey });

  const previous = (qc.getQueryData(entriesKey) as Entry[] | undefined) ?? [];
  const nowIso = new Date().toISOString();

  const next = previous.map((e) =>
    e.id === entryId ? { ...e, deleted_at: nowIso, updated_at: nowIso } : e
  );

  // NOTE: Intentionally avoid sorting here to reduce onMutate CPU spikes.
  // Display ordering is handled by existing memoized sorting logic.
  qc.setQueryData(entriesKey, next);

  const t1 = performance.now();
  perfLog(`${mark} onMutate end (optimistic applied) in ${(t1 - t0).toFixed(1)}ms`);

  return { previous, __perf: { t0, mark } };
},

  onError: (e: any, id: any, ctx: any) => {
    const mark = ctx?.__perf?.mark || `[PERF][delete][${id || "noid"}]`;
    const t0 = ctx?.__perf?.t0 ?? performance.now();
    const tErr = performance.now();
    perfLog(`${mark} server error after ${(tErr - t0).toFixed(1)}ms`, e);

    if (ctx?.previous) qc.setQueryData(entriesKey, ctx.previous);
    setErr("Delete failed");
  },
  onSuccess: async (_data: any, id: any, ctx: any) => {
  const mark = ctx?.__perf?.mark || `[PERF][delete][${id || "noid"}]`;
  const t0 = ctx?.__perf?.t0 ?? performance.now();
  const tOk = performance.now();
  perfLog(`${mark} server success after ${(tOk - t0).toFixed(1)}ms`);

  scheduleEntriesRefresh("delete");

  // NOTE: Summary refresh intentionally NOT triggered on every mutation (Phase 3 performance).
  // Totals remain last-known until a later refresh policy is applied.
},

});

  const restoreMut = useMutation({
  mutationFn: async (entryId: string) => {
    if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");
    return restoreEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId });
  },
  onMutate: async (entryId: string) => {
  const t0 = performance.now();
  const mark = `[PERF][restore][${entryId || "noid"}]`;
  perfLog(`${mark} click→onMutate start`);

  setErr(null);
  await qc.cancelQueries({ queryKey: entriesKey });

  const previous = (qc.getQueryData(entriesKey) as Entry[] | undefined) ?? [];
  const nowIso = new Date().toISOString();

  // Optimistic: clear deleted_at so it feels instant
  const next = previous.map((e) =>
    e.id === entryId ? { ...e, deleted_at: null, updated_at: nowIso } : e
  );

  // NOTE: Intentionally avoid sorting here to reduce onMutate CPU spikes.
  // Display ordering is handled by existing memoized sorting logic.
  qc.setQueryData(entriesKey, next);

  const t1 = performance.now();
  perfLog(`${mark} onMutate end (optimistic applied) in ${(t1 - t0).toFixed(1)}ms`);

  return { previous, __perf: { t0, mark } };
},

  onError: (e: any, entryId: any, ctx: any) => {
    const mark = ctx?.__perf?.mark || `[PERF][restore][${entryId || "noid"}]`;
    const t0 = ctx?.__perf?.t0 ?? performance.now();
    const tErr = performance.now();
    perfLog(`${mark} server error after ${(tErr - t0).toFixed(1)}ms`, e);

    if (ctx?.previous) qc.setQueryData(entriesKey, ctx.previous);
    setErr("Restore failed");
  },
  onSuccess: async (_data: any, entryId: any, ctx: any) => {
  const mark = ctx?.__perf?.mark || `[PERF][restore][${entryId || "noid"}]`;
  const t0 = ctx?.__perf?.t0 ?? performance.now();
  const tOk = performance.now();
  perfLog(`${mark} server success after ${(tOk - t0).toFixed(1)}ms`);

  scheduleEntriesRefresh("restore");

  // NOTE: Summary refresh intentionally NOT triggered on every mutation (Phase 3 performance).
  // Totals remain last-known until a later refresh policy is applied.
},
});

  const hardDeleteMut = useMutation({
  mutationFn: async (entryId: string) => {
    if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");
    return hardDeleteEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId });
  },
  onMutate: async (entryId: string) => {
    const t0 = performance.now();
    const mark = `[PERF][hardDelete][${entryId || "noid"}]`;
    perfLog(`${mark} click→onMutate start`);

    setErr(null);
    void qc.cancelQueries({ queryKey: entriesKey });

    const previous = (qc.getQueryData(entriesKey) as Entry[] | undefined) ?? [];

    // Optimistic: remove immediately
    const next = previous.filter((e) => e.id !== entryId);
    qc.setQueryData(entriesKey, next);

    const t1 = performance.now();
    perfLog(`${mark} onMutate end (optimistic applied) in ${(t1 - t0).toFixed(1)}ms`);

    return { previous, __perf: { t0, mark } };
  },
  onError: (e: any, entryId: any, ctx: any) => {
    const mark = ctx?.__perf?.mark || `[PERF][hardDelete][${entryId || "noid"}]`;
    const t0 = ctx?.__perf?.t0 ?? performance.now();
    const tErr = performance.now();
    perfLog(`${mark} server error after ${(tErr - t0).toFixed(1)}ms`, e);

    if (ctx?.previous) qc.setQueryData(entriesKey, ctx.previous);
    setErr("Hard delete failed");
  },
  onSuccess: async (_data: any, entryId: any, ctx: any) => {
  const mark = ctx?.__perf?.mark || `[PERF][hardDelete][${entryId || "noid"}]`;
  const t0 = ctx?.__perf?.t0 ?? performance.now();
  const tOk = performance.now();
  perfLog(`${mark} server success after ${(tOk - t0).toFixed(1)}ms`);

  scheduleEntriesRefresh("hardDelete");

  // NOTE: Summary refresh intentionally NOT triggered on every mutation (Phase 3 performance).
  // Totals remain last-known until a later refresh policy is applied.
},
});

  function triggerSaveEdit(entryId: string) {
    if (!editDraft) return;

    // Guard: optimistic temp rows are not yet server-backed (avoid PUT /entries/temp_... 500)
    if (entryId.startsWith("temp_")) {
      setErr("Still syncing—try again in a moment.");
      setEditingId(null);
      setEditDraft(null);
      return;
    }

    // Guards (non-negotiable):
    // - opening balance cannot be edited
    // - deleted rows cannot be edited/saved
    if (entryId === "opening_balance") {
      setErr("Opening balance cannot be edited.");
      setEditingId(null);
      setEditDraft(null);
      return;
    }
    const row = rowModels.find((r) => r.id === entryId);
    if (row?.isDeleted) {
      setErr("Deleted entries cannot be edited. Restore it first.");
      setEditingId(null);
      setEditDraft(null);
      return;
    }

    const centsAbs = Math.abs(parseMoneyToCents(editDraft.amountStr));
    if (!editDraft.payee.trim()) return setErr("Payee is required");
    if (centsAbs === 0) return setErr("Amount is required");

    const backendType = normalizeBackendType(editDraft.type);
    const signed = backendType === "EXPENSE" ? -centsAbs : centsAbs;

    updateMut.mutate({
      entryId,
      updates: {
        date: editDraft.date,
        payee: editDraft.payee.trim(),
        memo: (editDraft.category || "").trim() || null,
        amount_cents: signed,
        type: backendType,
        method: normalizeBackendMethod(editDraft.method),
        ref: editDraft.ref ?? "",
      },
    } as any);

    setEditingId(null);
    setEditDraft(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  function submitInline() {
    const { payee, amountStr, centsAbs } = readSubmitValues();
    if (!payee) return setErr("Payee is required");
    if (centsAbs === 0) return setErr("Amount is required");

    const categoryName = normalizeCategoryName(categoryInputRef.current?.value ?? draftCategory);
    const categoryId =
      draftCategoryId ??
      categoryIdByNormName.get(normKey(categoryName)) ??
      null;

    createMut.mutate({
      tempId: `temp_${Date.now()}`,
      date: draftDate,
      ref: draftRef,
      payee,
      type: draftType,
      method: draftMethod,
      categoryName,
      categoryId,
      amountStr,
      toAccountId: draftToAccountId,
    });
  }

  // ================================
  // SECTION: Column contract (UI-only adjustments)
  // - Keep shell no-horizontal-scroll by shrinking fixed widths
  // - Make Payee breathe more
  // - Tighten DUP/CAT columns and remove header text
  // ================================
  const th =
    "px-1.5 py-0.5 align-middle text-xs font-semibold uppercase tracking-wide text-slate-600";
  const td = "px-1.5 py-0.5 align-middle text-xs";
  const trunc = "truncate overflow-hidden whitespace-nowrap";
  const num = "text-right tabular-nums tracking-tight";
  const center = "text-center";

  const cols = [
    <col key="c0" style={{ width: "28px" }} />,
    <col key="c1" style={{ width: "88px" }} />,   // date (tighter)
    <col key="c2" style={{ width: "56px" }} />,   // ref (tighter)
    <col key="c3" style={{ width: "auto", minWidth: "200px" }} />, // payee flex (bigger min)
    <col key="c4" style={{ width: "96px" }} />,   // type (tighter)
    <col key="c5" style={{ width: "104px" }} />,  // method (tighter)
    <col key="c6" style={{ width: "120px" }} />,  // category (tighter)
    <col key="c7" style={{ width: "110px" }} />,  // amount (tighter)
    <col key="c8" style={{ width: "110px" }} />,  // balance (tighter)
    <col key="c9" style={{ width: "96px" }} />,   // status (tighter)
    <col key="c10" style={{ width: "20px" }} />,  // dup icon (tight ~60%)
    <col key="c11" style={{ width: "20px" }} />,  // cat icon (tight ~60%)
    <col key="c12" style={{ width: "96px" }} />,  // actions (tighter)
  ];

  const headerRow = useMemo(() => (
    <tr className="h-[28px] border-b border-slate-200 bg-slate-50">
      <th className={th + " " + center}>
        <input
          type="checkbox"
          className={checkboxClass}
          checked={allPageSelected}
          onChange={toggleAllPage}
          aria-label="Select all rows on this page"
        />
      </th>
      <th className={th}>Date</th>
      <th className={th}>Ref</th>
      <th className={th}>Payee</th>
      <th className={th}>Type</th>
      <th className={th}>Method</th>
      <th className={th}>Category</th>
      <th className={th + " " + num}>Amount</th>
      <th className={th + " " + num}>Balance</th>
      <th className={th + " " + center}>Status</th>
      {/* No "Dup/Cat" header text */}
      <th className={th + " " + center + " px-0.5"} aria-label="Duplicate issues"></th>
      <th className={th + " " + center + " px-0.5"} aria-label="Missing category issues"></th>
      <th className={th + " text-right"}>Actions</th>
    </tr>
  ), [allPageSelected]);

  const addRow = (
    <tr>
      <td className={td + " " + center}></td>

      {/* Date */}
      <td className={td}>
        <input
          className={inputH7}
          type="date"
          value={draftDate}
          onChange={(e) => setDraftDate(e.target.value)}
        />
      </td>

      {/* Ref */}
      <td className={td}>
        <input
          className={inputH7}
          placeholder="Ref"
          value={draftRef}
          onChange={(e) => setDraftRef(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitInline()}
        />
      </td>

      {/* Payee */}
      <td className={td}>
        <AutoInput
          value={draftPayee}
          onValueChange={(v) => setDraftPayee(v)}
          options={payeeOptions}
          placeholder="Payee"
          inputRef={payeeInputRef}
          inputClassName={inputH7}
          onSubmit={submitInline}
        />
      </td>

      {/* Type */}
      <td className={td}>
        <Select
          open={typeOpen}
          onOpenChange={setTypeOpen}
          value={draftType}
          onValueChange={(v) => setDraftType(v as UiType)}
        >
          <SelectTrigger className={selectTriggerClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="bottom" align="start">
            <SelectItem value="INCOME">Income</SelectItem>
            <SelectItem value="EXPENSE">Expense</SelectItem>
            <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
            <SelectItem value="TRANSFER">Transfer</SelectItem>
          </SelectContent>
        </Select>
      </td>

      {/* Method */}
      <td className={td}>
        <Select
          open={methodOpen}
          onOpenChange={setMethodOpen}
          value={draftMethod}
          onValueChange={(v) => setDraftMethod(v as UiMethod)}
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
      </td>

      {/* Category OR To Account for TRANSFER */}
      <td className={td}>
        {draftType === "TRANSFER" ? (
          <Select value={draftToAccountId} onValueChange={(v) => setDraftToAccountId(v)}>
            <SelectTrigger className={selectTriggerClass}>
              <SelectValue placeholder="To account" />
            </SelectTrigger>
            <SelectContent side="bottom" align="start">
              {(accountsQ.data ?? [])
                .filter((a) => !a.archived_at && a.id !== selectedAccountId)
                .map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        ) : (
          <AutoInput
            value={draftCategory}
            onValueChange={(v) => {
              setDraftCategory(v);
              setDraftCategoryId(null); // typing changes selection; force re-resolve
            }}
            options={categoryOptions}
            placeholder="Category"
            inputRef={categoryInputRef}
            inputClassName={inputH7}
            allowCreate
            onCreate={async (name) => {
              if (!selectedBusinessId) return;

              const n = normalizeCategoryName(name);
              const hit = categoryIdByNormName.get(normKey(n));
              if (hit) {
                setDraftCategoryId(hit);
                setDraftCategory(categoryNameById.get(hit) ?? n);
                if (categoryInputRef.current) categoryInputRef.current.value = categoryNameById.get(hit) ?? n;
                return;
              }

              const res = await createCategory(selectedBusinessId, n);
              setDraftCategoryId(res.row.id);
              setDraftCategory(res.row.name);
              if (categoryInputRef.current) categoryInputRef.current.value = res.row.name;

              void qc.invalidateQueries({ queryKey: ["categories", selectedBusinessId] });
            }}
            onSubmit={submitInline}
          />
        )}
      </td>

      {/* Amount */}
      <td className={td + " " + num}>
        <input
          ref={amountInputRef}
          className={inputH7 + " text-right tabular-nums"}
          value={draftAmount}
          onChange={(e) => setDraftAmount(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitInline()}
        />
      </td>

      {/* Balance */}
      <td className={td + " " + num + " text-slate-400"}>—</td>

      {/* Status */}
      <td className={td + " " + center}></td>

      {/* Issues columns */}
      <td className={td + " " + center + " px-0.5"}></td>
      <td className={td + " " + center + " px-0.5"}></td>

      {/* Actions */}
      <td className={td + " text-right"}>
        <Button className="h-7 w-8 p-0" onClick={submitInline} title="Add entry">
          <Plus className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );

  // Header capsule + filter bar
  const accountCapsule = (
    <CapsuleSelect
      loading={accountsQ.isLoading}
      value={selectedAccountId || ""}
      onValueChange={(v) => {
        setPage(1);
        router.replace(`/ledger?businessId=${selectedBusinessId}&accountId=${v}`);
      }}
      options={(accountsQ.data ?? [])
        .filter((a) => !a.archived_at)
        .map((a) => ({ value: a.id, label: a.name }))}
      placeholder="Select account"
    />
  );

  // Filters wrapped as compact "area" + Reset thin/icon like old app
const filterLeft = useMemo(() => (
  <div className="w-full max-w-full px-3 py-2">
    {/* Top row: compact main strip */}
    <div className="flex items-center gap-2 min-w-0">
      {/* Left cluster: search + filters (can shrink) */}
      <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto whitespace-nowrap pr-2 py-1 pl-1">
        <input
          className={[inputH7, "w-[220px] min-w-0"].join(" ")}
          placeholder="Search payee..."
          value={searchPayee}
          onChange={(e) => setSearchPayee(e.target.value)}
        />

        {/* Type */}
        <Select value={filterType} onValueChange={(v) => { setFilterType(v as any); setPage(1); }}>
          <SelectTrigger className={[selectTriggerClass, "w-[120px]"].join(" ")}>
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="ALL">All Types</SelectItem>
            <SelectItem value="INCOME">Income</SelectItem>
            <SelectItem value="EXPENSE">Expense</SelectItem>
            <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
            <SelectItem value="TRANSFER">Transfer</SelectItem>
          </SelectContent>
        </Select>

        {/* Method */}
        <Select value={filterMethod} onValueChange={(v) => { setFilterMethod(v); setPage(1); }}>
          <SelectTrigger className={[selectTriggerClass, "w-[140px]"].join(" ")}>
            <SelectValue placeholder="Method" />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="ALL">All Methods</SelectItem>
            <SelectItem value="CASH">Cash</SelectItem>
            <SelectItem value="CARD">Card</SelectItem>
            <SelectItem value="ACH">ACH</SelectItem>
            <SelectItem value="WIRE">Wire</SelectItem>
            <SelectItem value="CHECK">Check</SelectItem>
            <SelectItem value="DIRECT_DEPOSIT">Direct Deposit</SelectItem>
            <SelectItem value="ZELLE">Zelle</SelectItem>
            <SelectItem value="TRANSFER">Transfer</SelectItem>
            <SelectItem value="OTHER">Other</SelectItem>
          </SelectContent>
        </Select>

        {/* Category */}
        <Select value={filterCategory} onValueChange={(v) => { setFilterCategory(v); setPage(1); }}>
          <SelectTrigger className={[selectTriggerClass, "w-[160px]"].join(" ")}>
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent align="start">
            <SelectItem value="ALL">All Categories</SelectItem>

            {rowsUi.some((r) => !r.categoryId) ? (
              <SelectItem value="__UNCATEGORIZED__">Uncategorized</SelectItem>
            ) : null}

            {categoryRows.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200 shrink-0">
          {/* Advanced toggle */}
          <button
            type="button"
            className={[
              "h-7 px-1.5 text-xs font-medium rounded-md shrink-0 inline-flex items-center border",
              showAdvancedFilters
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-slate-900",
            ].join(" ")}
            onClick={() => setShowAdvancedFilters((v) => !v)}
            title={showAdvancedFilters ? "Hide advanced filters" : "Show advanced filters"}
          >
            Advanced
          </button>

           {/* Reset All */}
          <Button
            variant="outline"
            className="h-7 px-1 text-xs font-medium shrink-0 inline-flex items-center gap-1"
            onClick={() => {
              setSearchPayee("");
              setFilterType("ALL");
              setFilterMethod("ALL");
              setFilterCategory("ALL");
              setFilterFrom("");
              setFilterTo("");
              setFilterAmountMin("");
              setFilterAmountMax("");
              setFilterAmountExact("");
              setShowAdvancedFilters(false);
              setPage(1);
            }}
            title="Reset all filters"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </Button>

           {/* Bulk actions (compact, after Reset) */}
          {selectedCount > 0 ? (
            <div className="ml-2 flex items-center gap-2 shrink-0">
              <span className="text-xs text-slate-600 whitespace-nowrap">
                Selected: <span className="font-medium text-slate-900">{selectedCount}</span>
              </span>

              <Button
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={() => bulkDeleteMut.mutate(selectablePageIds.filter((id) => !!selectedIds[id]))}
                disabled={bulkDeleteMut.isPending}
                title="Delete selected entries"
              >
                {bulkDeleteMut.isPending ? "Deleting…" : "Delete"}
              </Button>

              <Button
                variant="outline"
                className="h-7 px-2 text-xs"
                onClick={clearSelection}
                title="Clear selection"
              >
                Clear
              </Button>

              {bulkMsg ? <div className="text-xs text-slate-600 whitespace-nowrap">{bulkMsg}</div> : null}
            </div>
          ) : null}

          {/* Divider after Reset area (like old app) */}
          <div className="h-6 w-px bg-slate-200 mx-1 shrink-0" />

          {/* Scan label + Scan button (grouped; Scan immediately after time) */}
          <span className="text-xs text-slate-600 whitespace-nowrap shrink-0">
            Scan: <span className="font-medium text-slate-900">{formatScanLabel(lastScanAt)}</span>
          </span>

          <Button
            variant="outline"
            className="h-7 px-1 text-xs font-medium shrink-0 inline-flex items-center gap-1"
            onClick={scanIssues}
            disabled={scanBusy}
            title="Scan issues"
          >
            {scanBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <span>Scan</span>
          </Button>

          {/* Deleted toggle (last) */}
          <span className="text-xs text-slate-600 whitespace-nowrap shrink-0">Deleted</span>
          <button
            type="button"
            role="switch"
            aria-checked={showDeleted}
            aria-label="Show deleted entries"
            title="Show/hide deleted entries"
            onClick={() => {
              setShowDeleted((v) => !v);
              setPage(1);
              qc.invalidateQueries({ queryKey: ["entries", selectedBusinessId, selectedAccountId] });
            }}
            className={[
              "relative inline-flex items-center rounded-full transition-colors shrink-0",
              "h-[16px] w-[30px]",
              showDeleted ? "bg-emerald-600" : "bg-slate-200",
            ].join(" ")}
          >
            <span
              className={[
                "inline-block rounded-full bg-white shadow transition-transform",
                "h-[12px] w-[12px]",
                showDeleted ? "translate-x-[16px]" : "translate-x-[2px]",
              ].join(" ")}
            />
          </button>

          {err ? (
            <div className="text-sm text-red-600 whitespace-nowrap shrink-0" role="alert">
              {err}
            </div>
          ) : null}
        </div>
      </div>
    </div>

    {/* Expanded advanced area (inside same box) */}
    {showAdvancedFilters ? (
      <>
        <div className="my-2 h-px bg-slate-200" />

        <div className="flex flex-wrap items-center gap-2 px-1 pb-1">
          {/* Date range */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">From</span>
            <input
              className={[inputH7, "w-[132px]"].join(" ")}
              type="date"
              value={filterFrom}
              onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }}
              title="From"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">To</span>
            <input
              className={[inputH7, "w-[132px]"].join(" ")}
              type="date"
              value={filterTo}
              onChange={(e) => { setFilterTo(e.target.value); setPage(1); }}
              title="To"
            />
          </div>

          <div className="h-6 w-px bg-slate-200 mx-1" />

          {/* Amount filters */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">Min</span>
            <input
              className={[inputH7, "w-[108px] text-right tabular-nums"].join(" ")}
              inputMode="decimal"
              placeholder="0.00"
              value={filterAmountMin}
              onChange={(e) => { setFilterAmountMin(e.target.value); setPage(1); }}
              title="Min amount"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">Max</span>
            <input
              className={[inputH7, "w-[108px] text-right tabular-nums"].join(" ")}
              inputMode="decimal"
              placeholder="0.00"
              value={filterAmountMax}
              onChange={(e) => { setFilterAmountMax(e.target.value); setPage(1); }}
              title="Max amount"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-600">Exact</span>
            <input
              className={[inputH7, "w-[108px] text-right tabular-nums"].join(" ")}
              inputMode="decimal"
              placeholder="0.00"
              value={filterAmountExact}
              onChange={(e) => { setFilterAmountExact(e.target.value); setPage(1); }}
              title="Exact amount"
            />
          </div>
        </div>
      </>
    ) : null}
  </div>
), [
  searchPayee,
  filterType,
  filterMethod,
  filterCategory,
  showAdvancedFilters,
  filterFrom,
  filterTo,
  filterAmountMin,
  filterAmountMax,
  filterAmountExact,
  selectedCount,
  allPageSelected,
  scanBusy,
  showDeleted,
  lastScanAt,
  bulkMsg,
]);

const filterRight = null;

  // Delete confirm dialog
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; mode: "soft" | "hard" } | null>(null);

  // Stage 2A: Close period dialog
  const [closePeriodOpen, setClosePeriodOpen] = useState(false);

  // FixIssue dialog (reusable; Ledger + Issues page)
  const [fixDialog, setFixDialog] = useState<
    | {
        id: string;
        kind: "DUPLICATE" | "MISSING_CATEGORY" | "STALE_CHECK";
        flags: { dup: boolean; stale: boolean; missing: boolean };
        entry: {
          id: string;
          date: string;
          payee: string;
          amountStr: string;
          methodDisplay: string;
          category: string;
        };
      }
    | null
  >(null);

  // Quick-fix: Missing Category inline (no dialog)
  const [catQuickEdit, setCatQuickEdit] = useState<{ id: string; value: string } | null>(null);

  // Body rows (memoized so add-row typing doesn't rebuild the full table body)
  const bodyRows = useMemo(() => {

    return pageRows.map((r) => {
      const menuOpen = menuOpenId === r.id;
      const isEditing = editingId === r.id;
      const deletedRow = r.isDeleted;
      const deletedText = deletedRow ? "line-through" : "";

      const rowClass =
        "h-[24px] border-b border-slate-200 " +
        (deletedRow ? "bg-slate-50 text-slate-400 " : "") +
        (!deletedRow && r.hasDup
          ? "bg-yellow-50 hover:bg-yellow-100 "
          : !deletedRow && r.hasStale
            ? "bg-blue-50 hover:bg-blue-100 "
            : "hover:bg-slate-50");

      const onEditKeyDown = (e: any) => {
        if (e.key === "Escape") cancelEdit();
        if (e.key === "Enter") triggerSaveEdit(r.id);
      };

      return (
        <tr key={r.id} className={rowClass}>
          <td className={td + " " + center}>
            {r.id !== "opening_balance" && !deletedRow ? (
              <input
                type="checkbox"
                className={checkboxClass}
                checked={!!selectedIds[r.id]}
                onChange={() => toggleRow(r.id)}
                aria-label={`Select row: ${r.payee || "Unknown payee"} (${r.date})`}
              />
            ) : null}
          </td>

          {/* Date */}
          <td className={td + " " + trunc + " " + deletedText}>
            {isEditing && editDraft ? (
              <input
                className={inputH7}
                type="date"
                value={editDraft.date}
                onChange={(e) => setEditDraft({ ...editDraft, date: e.target.value })}
                onKeyDown={onEditKeyDown}
              />
            ) : (
              r.date
            )}
          </td>

          {/* Ref */}
          <td className={td + " " + trunc + " text-slate-500 " + deletedText}>
            {isEditing && editDraft ? (
              <input
                ref={editRefRef}
                className={inputH7}
                value={editDraft.ref}
                onChange={(e) => setEditDraft({ ...editDraft, ref: e.target.value })}
                onKeyDown={onEditKeyDown}
              />
            ) : (
              r.ref
            )}
          </td>

          {/* Payee */}
          <td className={td + " min-w-0"}>
            {isEditing && editDraft ? (
              <input
                ref={editPayeeRef}
                className={inputH7}
                value={editDraft.payee}
                onChange={(e) => setEditDraft({ ...editDraft, payee: e.target.value })}
                onKeyDown={onEditKeyDown}
              />
            ) : (
              <div className="flex items-center gap-1 min-w-0">
                <span className={trunc + " font-medium " + deletedText}>{r.payee}</span>
                {editedIds[r.id] ? <Pencil className="h-3 w-3 text-slate-400 shrink-0" /> : null}
              </div>
            )}
          </td>

          {/* Type */}
          <td className={td + " " + trunc + " " + deletedText}>
            {isEditing && editDraft ? (
              <Select
                open={editTypeOpen}
                onOpenChange={setEditTypeOpen}
                value={editDraft.type}
                onValueChange={(v) => setEditDraft({ ...editDraft, type: v as UiType })}
              >
                <SelectTrigger className={selectTriggerClass}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="bottom" align="start">
                  <SelectItem value="INCOME">Income</SelectItem>
                  <SelectItem value="EXPENSE">Expense</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              r.typeDisplay
            )}
          </td>

          {/* Method */}
          <td className={td + " " + trunc + " " + deletedText}>
            {isEditing && editDraft ? (
              <Select
                open={editMethodOpen}
                onOpenChange={setEditMethodOpen}
                value={editDraft.method}
                onValueChange={(v) => setEditDraft({ ...editDraft, method: v as UiMethod })}
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
          <td className={td + " " + trunc + " " + deletedText}>
            {isEditing && editDraft ? (
              <input
                className={inputH7}
                value={editDraft.category}
                onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })}
                onKeyDown={onEditKeyDown}
              />
            ) : catQuickEdit?.id === r.id && !deletedRow ? (
              <div className="min-w-0">
                <Select value={catQuickEdit.value} onValueChange={(v) => setCatQuickEdit({ id: r.id, value: v })}>
                  <SelectTrigger className={selectTriggerClass + " h-7 min-w-0"}>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent side="bottom" align="start">
                    <SelectItem value="__UNCATEGORIZED__">Uncategorized</SelectItem>
                    {categoryOptions.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Actions row (below) */}
                <div className="mt-1 flex items-center justify-end gap-1">
                  <Button variant="outline" className="h-6 w-8 p-0" title="Cancel" onClick={() => setCatQuickEdit(null)}>
                    <X className="h-4 w-4" />
                  </Button>

                  <Button
                    className="h-6 w-8 p-0"
                    title="Save"
                    onClick={() => {
                      const v = (catQuickEdit.value || "").trim();
                      const memo = v === "__UNCATEGORIZED__" ? null : v || null;
                      updateMut.mutate({ entryId: r.id, updates: { memo } } as any);
                      setCatQuickEdit(null);
                    }}
                  >
                    <Check className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              r.category
            )}
          </td>

          {/* Amount */}
          <td
            className={
              td +
              " " +
              num +
              " font-semibold " +
              deletedText +
              (r.amountNeg ? " text-red-700" : "")
            }
          >
            {isEditing && editDraft ? (
              <input
                ref={editAmountRef}
                className={inputH7 + " text-right tabular-nums"}
                value={editDraft.amountStr}
                onChange={(e) => setEditDraft({ ...editDraft, amountStr: e.target.value })}
                onKeyDown={onEditKeyDown}
              />
            ) : (
              r.amountStr
            )}
          </td>

          {/* Balance */}
          <td className={td + " " + num + " " + deletedText + (r.balanceNeg ? " text-red-700" : "")}>
            {r.balanceStr}
          </td>

          {/* Status */}
          <td className={td + " " + center}>
            <StatusChip label={r.status} tone={statusTone(r.rawStatus)} />
          </td>

          {/* DUP column (tight padding) */}
          <td className={td + " " + center + " px-0.5"}>
            {!deletedRow && (r.hasDup || r.hasStale) ? (
              <HoverTooltip
                text={[r.hasDup ? r.dupTooltip : "", r.hasStale ? r.staleTooltip : ""].filter(Boolean).join("\n")}
              >
                <button
                  type="button"
                  className="inline-flex items-center justify-center"
                  onClick={() => {
                    if (r.id.startsWith("temp_")) return setErr("Still syncing—try again in a moment.");
                    setFixDialog({
                      id: r.id,
                      kind: r.hasDup ? "DUPLICATE" : "STALE_CHECK",
                      flags: { dup: !!r.hasDup, stale: !!r.hasStale, missing: !!r.hasMissing },
                      entry: {
                        id: r.id,
                        date: r.date,
                        payee: r.payee,
                        amountStr: r.amountStr,
                        methodDisplay: r.methodDisplay,
                        category: r.category || "",
                      },
                    });
                  }}
                  title="Fix issue"
                >
                  <AlertTriangle className={"h-4 w-4 " + (r.hasDup ? "text-amber-500" : "text-sky-600")} />
                </button>
              </HoverTooltip>
            ) : null}
          </td>

          {/* CAT column (tight padding) */}
          <td className={td + " " + center + " px-0.5"}>
            {!deletedRow && r.hasMissing ? (
              <HoverTooltip text={r.missingTooltip}>
                <button
                  type="button"
                  className="inline-flex items-center justify-center"
                  onClick={() => {
                    const current = (r.category || "").trim();
                    setCatQuickEdit({ id: r.id, value: current ? current : "__UNCATEGORIZED__" });
                  }}
                  title="Fix category"
                >
                  <Info className="h-4 w-4 text-violet-500" />
                </button>
              </HoverTooltip>
            ) : null}
          </td>

          {/* Actions */}
          <td className={td + " text-right pr-1"}>
            <div className="relative inline-flex items-center justify-end gap-1 w-[88px]" data-rowmenu={r.id}>
              {deletedRow ? (
                <>
                  <Button
                    variant="outline"
                    className="h-6 w-8 p-0"
                    title="Restore"
                    onClick={() => {
                      if (r.id.startsWith("temp_")) return setErr("Still syncing—try again in a moment.");
                      restoreMut.mutate(r.id);
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="h-6 w-8 p-0"
                    title="Delete permanently"
                    onClick={() => {
                      if (r.id.startsWith("temp_")) return setErr("Still syncing—try again in a moment.");
                      setDeleteDialog({ id: r.id, mode: "hard" });
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </>
              ) : isEditing ? (
                <>
                  <Button variant="outline" className="h-6 w-8 p-0" title="Cancel edit" onClick={cancelEdit}>
                    <X className="h-4 w-4" />
                  </Button>
                  <Button className="h-6 w-8 p-0" title="Save edit" onClick={() => triggerSaveEdit(r.id)}>
                    <Check className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  {r.id !== "opening_balance" ? (
                    <>
                      <Button
                        variant="outline"
                        className="h-6 w-8 p-0"
                        title="Actions"
                        onClick={() => setMenuOpenId(menuOpen ? null : r.id)}
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
                              setMenuOpenId(null);

                              if (r.id === "opening_balance") {
                                setErr("Opening balance cannot be edited.");
                                return;
                              }

                              setEditingId(r.id);
                              setEditDraft({
                                date: r.date,
                                ref: r.ref || "",
                                payee: r.payee,
                                type: uiTypeFromRaw(r.rawType),
                                method: uiMethodFromRaw(r.rawMethod),
                                category: r.category || "",
                                amountStr: stripMoneyDisplay(r.amountStr),
                              });
                              requestAnimationFrame(() => editPayeeRef.current?.focus());
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
                              setMenuOpenId(null);
                              createMut.mutate({
                                tempId: `dup_${Date.now()}`,
                                date: r.date,
                                ref: "",
                                payee: r.payee,
                                type: uiTypeFromRaw(r.rawType),
                                method: uiMethodFromRaw(r.rawMethod),
                                category: r.category || "",
                                amountStr: stripMoneyDisplay(r.amountStr),
                                afterCreateEdit: true,
                              });
                            }}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Duplicate
                          </button>
                        </div>
                      ) : null}

                      <Button
                        variant="outline"
                        className="h-6 w-8 p-0"
                        title="Move to Deleted"
                        onClick={() => {
                          if (r.id.startsWith("temp_")) return setErr("Still syncing—try again in a moment.");
                          setDeleteDialog({ id: r.id, mode: "soft" });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </td>
        </tr>
      );
    });
  }, [pageRows, menuOpenId, editingId, editDraft, selectedIds, editedIds, catQuickEdit, editTypeOpen, editMethodOpen, showDeleted]);

  if (!authReady) return null;

  const accountCapsuleEl = (
    <div className="h-6 px-1.5 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center">
      <CapsuleSelect
        variant="flat"
        loading={accountsQ.isLoading}
        value={selectedAccountId || ""}
        onValueChange={(v) => {
          setPage(1);
          router.replace(`/ledger?businessId=${selectedBusinessId}&accountId=${v}`);
        }}
        options={(accountsQ.data ?? [])
          .filter((a) => !a.archived_at)
          .map((a) => ({ value: a.id, label: a.name }))}
        placeholder="Select account"
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-2 overflow-hidden" style={containerStyle}>
      {/* Unified header + filters container (old app style) */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<BookOpen className="h-4 w-4" />}
            title="Ledger"
            afterTitle={accountCapsuleEl}
            right={
              <div className="flex items-center gap-2">
                {uncategorizedCount > 0 ? (
                  <button
                    type="button"
                    className="h-7 px-2 text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-800 inline-flex items-center gap-1"
                    title="Review uncategorized entries"
                    onClick={() => {
                      if (!selectedBusinessId || !selectedAccountId) return;
                      router.push(
                        `/category-review?businessId=${selectedBusinessId}&accountId=${selectedAccountId}`
                      );
                    }}
                  >
                    Uncategorized: <span className="font-semibold">{uncategorizedCount}</span>
                  </button>
                ) : null}

                <button
  type="button"
  className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
  onClick={() => {
    setUploadType("RECEIPT");
    setOpenUpload(true);
  }}
>
  Upload Receipt
</button>

<button
  type="button"
  className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
  onClick={() => {
    setUploadType("INVOICE");
    setOpenUpload(true);
  }}
>
  Upload Invoice
</button>

<button
  type="button"
  className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
  disabled={!canClosePeriod || !selectedBusinessId || !selectedAccountId}
  title={!canClosePeriod ? "Only OWNER/Admin can close periods" : "Close a period"}
  onClick={() => setClosePeriodOpen(true)}
>
  Close period
</button>
              </div>
            }
          />
        </div>

        <div className="mt-2 h-px bg-slate-200" />

        <FilterBar left={filterLeft} right={filterRight} />
      </div>

      <LedgerTableShell
        colgroup={cols}
        header={headerRow}
        addRow={addRow}
        body={bodyRows}
        footer={
          <tr>
            <td colSpan={13} className="p-0 border-t border-slate-200 bg-slate-50">
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

             <FixIssueDialog
         open={!!fixDialog}
         onOpenChange={(open) => {
           if (!open) setFixDialog(null);
         }}
         entry={fixDialog?.entry ?? null}
         kind={fixDialog?.kind ?? null}
         flags={fixDialog?.flags ?? null}
         categoryOptions={categoryOptions}
         onSaveCategory={(category) => {
           if (!fixDialog) return;

           if (fixDialog.id.startsWith("temp_")) {
             setErr("Still syncing—try again in a moment.");
             return;
           }

           // This uses existing update endpoint/mutation and resolves missing category immediately.
           updateMut.mutate({
             entryId: fixDialog.id,
             updates: { memo: (category || "").trim() || null },
           } as any);

           // Quiet, targeted refresh of issue tags/highlights
           if (selectedBusinessId && selectedAccountId) {
             qc.invalidateQueries({
               queryKey: ["entryIssues", selectedBusinessId, selectedAccountId],
               exact: false,
             });
           }
         }}
         // Quiet placeholders for now: close-on-action happens inside the dialog.
         // We only ensure the Issues tags/highlights do not linger by refreshing Stage A/B issue query.
         onMerge={() => {
           if (selectedBusinessId && selectedAccountId) {
             qc.invalidateQueries({
               queryKey: ["entryIssues", selectedBusinessId, selectedAccountId],
               exact: false,
             });
           }
         }}
         onMarkLegit={() => {
           if (selectedBusinessId && selectedAccountId) {
             qc.invalidateQueries({
               queryKey: ["entryIssues", selectedBusinessId, selectedAccountId],
               exact: false,
             });
           }
         }}
         onAcknowledge={() => {
           if (selectedBusinessId && selectedAccountId) {
             qc.invalidateQueries({
               queryKey: ["entryIssues", selectedBusinessId, selectedAccountId],
               exact: false,
             });
           }
         }}
       />

      <AppDialog
  open={!!deleteDialog}
  onClose={() => setDeleteDialog(null)}
  title={deleteDialog?.mode === "hard" ? "Delete permanently" : "Move entry to Deleted"}
  size="md"
  disableOverlayClose={false}
  footer={
    <div className="flex items-center justify-end gap-2">
      <Button variant="outline" onClick={() => setDeleteDialog(null)}>
        Cancel
      </Button>

      <Button
        variant={deleteDialog?.mode === "hard" ? "destructive" : "default"}
        onClick={() => {
          if (!deleteDialog) return;

          // Guard: opening balance cannot be deleted (soft or hard)
          if (deleteDialog.id === "opening_balance") {
            setErr("Opening balance cannot be deleted.");
            setDeleteDialog(null);
            return;
          }

          // Guard: optimistic temp rows are not yet server-backed (avoid DELETE/PUT against temp ids)
          if (deleteDialog.id.startsWith("temp_")) {
            setErr("Still syncing—try again in a moment.");
            setDeleteDialog(null);
            return;
          }

          if (deleteDialog.mode === "hard") hardDeleteMut.mutate(deleteDialog.id);
          else deleteMut.mutate(deleteDialog.id);

          setDeleteDialog(null);
        }}
      >
        {deleteDialog?.mode === "hard" ? "Delete permanently" : "Move to Deleted"}
      </Button>
    </div>
  }
>
  <div className="text-sm text-slate-700">
    {deleteDialog?.mode === "hard"
      ? "This will permanently delete the entry. This action is irreversible."
      : "This will move the entry to Deleted. You can restore it later (reversible)."}
  </div>
</AppDialog>

<UploadPanel
  open={openUpload}
  onClose={() => setOpenUpload(false)}
  type={uploadType}
  ctx={{ businessId: selectedBusinessId ?? undefined, accountId: selectedAccountId ?? undefined }}
  allowMultiple={true}
/>

{selectedBusinessId && selectedAccountId ? (
  <ClosePeriodDialog
    open={closePeriodOpen}
    onOpenChange={setClosePeriodOpen}
    businessId={selectedBusinessId}
    accountId={selectedAccountId}
    accountName={selectedAccount?.name ?? null}
  />
) : null}
    </div>
  );
}
