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
import { getBusinessIssuesCount, listAccountIssues, type EntryIssueRow } from "@/lib/api/issues";

import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/primitives/FilterBar";
import { LedgerTableShell } from "@/components/ledger/ledger-table-shell";
import { FixIssueDialog } from "@/components/ledger/fix-issue-dialog";
import { StatusChip } from "@/components/primitives/StatusChip";
import { inputH7, selectTriggerClass } from "@/components/primitives/tokens";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { TotalsFooter } from "@/components/ledger/totals-footer";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api/client";
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
  } catch { }
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

function isOpeningLikePayee(payee: string | null | undefined): boolean {
  const x = String(payee ?? "").trim().toLowerCase();
  return x === "opening balance" || x === "opening balance (estimated)" || x.startsWith("opening balance");
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
    !options.some((o) => normKey(o) === normKey(currentValue)) &&
    // Extra guard: if categories already contain it (even if options lag), don't show Create
    !(typeof (globalThis as any).__BYNK_CATEGORY_NORM_MAP_HAS === "function"
      ? (globalThis as any).__BYNK_CATEGORY_NORM_MAP_HAS(normKey(currentValue))
      : false);

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

function VendorSuggestPill(props: {
  businessId: string;
  accountId: string;
  entryId: string;
  payee: string;
  onLinked: (vendor: { id: string; name: string }) => void;
  onDismiss: () => void;
}) {
  const { businessId, accountId, entryId, payee, onLinked, onDismiss } = props;
  const [best, setBest] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    const q = (payee || "").trim();
    if (!businessId || q.length < 2) {
      setBest(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res: any = await apiFetch(
          `/v1/businesses/${businessId}/vendors?q=${encodeURIComponent(q)}`,
          { method: "GET" }
        );
        const vendors = Array.isArray(res?.vendors) ? res.vendors : [];
        if (!vendors.length) return setBest(null);

        const norm = (s: string) => String(s || "").trim().toLowerCase();
        const exact = vendors.find((v: any) => norm(v.name) === norm(q));
        const v = exact || vendors[0];

        if (v?.id && v?.name) setBest({ id: v.id, name: v.name });
        else setBest(null);
      } catch {
        setBest(null);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [businessId, payee]);

  if (!best) return null;

  return (
    <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
      {/* vendor icon */}
      <span className="inline-flex items-center justify-center">
        <Info className="h-3.5 w-3.5 text-slate-600" />
      </span>

      {/* vendor name */}
      <span className="font-medium text-slate-900">{best.name}</span>

      {/* actions */}
      <button
        type="button"
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-emerald-200"
        title="Link to vendor"
        onClick={async () => {
          try {
            const res: any = await apiFetch(
              `/v1/businesses/${businessId}/accounts/${accountId}/entries/${entryId}`,
              {
                method: "PATCH",
                body: JSON.stringify({ vendor_id: best.id }),
              }
            );

            if (!res?.ok) {
              // keep pill visible if backend rejected
              return;
            }

            onLinked({ id: best.id, name: best.name });
          } catch {
            // keep pill visible on error
          }
        }}
      >
        <Check className="h-3.5 w-3.5 text-emerald-700" />
      </button>

      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-slate-200"
        title="Dismiss"
        onClick={onDismiss}
      >
        <X className="h-3.5 w-3.5 text-slate-600" />
      </button>
    </div>
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

function normalizeBackendType(uiType: UiType): "INCOME" | "EXPENSE" | "TRANSFER" | "ADJUSTMENT" {
  if (uiType === "INCOME") return "INCOME";
  if (uiType === "EXPENSE") return "EXPENSE";
  if (uiType === "TRANSFER") return "TRANSFER";
  return "ADJUSTMENT";
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
  note?: string;
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
    "CASH", "CARD", "ACH", "WIRE", "CHECK", "DIRECT_DEPOSIT", "ZELLE", "TRANSFER", "OTHER",
  ];
  return (allowed as string[]).includes(m) ? (m as UiMethod) : "OTHER";
}

function uiMethodLabel(m: UiMethod): string {
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

// ================================
// SECTION: Component
// ================================
export default function LedgerPageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const containerStyle = { height: "calc(100vh - 56px - 48px)" as const };

  // Vendor payment suggestion (deterministic, no AI)
  // Vendor suggestion is shown post-save on the created row only.
  const [uploadType] = useState<"RECEIPT">("RECEIPT");
  const [openUpload, setOpenUpload] = useState(false);
  const [lastCreatedEntryId, setLastCreatedEntryId] = useState<string | null>(null);

  // Optimistic vendor badge map (so linked indicator persists immediately, even before refetch)
  const [linkedVendorByEntryId, setLinkedVendorByEntryId] = useState<Record<string, string>>({});
  const [lastCreatedLinkedVendor, setLastCreatedLinkedVendor] = useState<{ id: string; name: string } | null>(null);

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
      void qc.invalidateQueries({ queryKey: entriesKey, exact: false });

      // Also refresh summary in the same coalesced cycle (prevents stale footer totals)
      void qc.invalidateQueries({ queryKey: summaryKey, exact: false });

      perfLog(`[PERF][entriesRefresh] fired (${reason})`);
    }, 15000); // 15s idle
  };

  const cancelEntriesRefresh = () => {
    if (entriesRefreshTimerRef.current) {
      window.clearTimeout(entriesRefreshTimerRef.current);
      entriesRefreshTimerRef.current = null;
    }
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

  // Uploads "create entries" triggers a lightweight ledger refresh (no storms)
  useEffect(() => {
    const fn = () => scheduleEntriesRefresh("uploadsCreateEntries");
    window.addEventListener("bynk:ledger-refresh", fn as any);
    return () => window.removeEventListener("bynk:ledger-refresh", fn as any);
  }, [scheduleEntriesRefresh]);

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

  const accountNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accountsQ.data ?? []) m.set(a.id, a.name);
    return m;
  }, [accountsQ.data]);

  // Transfer display is derived from backend fields on each entry (stable across refetch).

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

  // Issues: backend truth (open issues + header button)
  const issuesCountQ = useQuery({
    queryKey: ["issuesCount", selectedBusinessId],
    enabled: !!selectedBusinessId,
    queryFn: async () => {
      if (!selectedBusinessId) return { ok: true as const, total_open: 0, by_account: {} as Record<string, number> };
      return getBusinessIssuesCount({ businessId: selectedBusinessId });
    },
  });

  const issuesListQ = useQuery({
    queryKey: ["entryIssues", selectedBusinessId, selectedAccountId],
    enabled: !!selectedBusinessId && !!selectedAccountId,
    queryFn: async () => {
      if (!selectedBusinessId || !selectedAccountId) return { ok: true as const, issues: [] as EntryIssueRow[] };
      return listAccountIssues({ businessId: selectedBusinessId, accountId: selectedAccountId, status: "OPEN", limit: 300 });
    },
  });

  const openIssues = issuesListQ.data?.issues ?? [];

  const openIssueCountForAccount = useMemo(() => {
    const by = issuesCountQ.data?.by_account;
    if (by && selectedAccountId) return Number(by[selectedAccountId] ?? 0) || 0;
    // fallback to list count (account scoped)
    return openIssues.length;
  }, [issuesCountQ.data, openIssues.length, selectedAccountId]);

  // Totals scope (all-time for Phase 3)
  const from = allTimeStartYmd();
  const to = todayYmd();
  const summaryKey = ["ledgerSummary", selectedBusinessId, selectedAccountId, from, to] as const;

  // Totals footer is computed from visible rows (WYSIWYG). No ledger-summary query needed.

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

    // If backend already has a real opening entry, do NOT inject the synthetic system opening row.
    const hasRealOpening = entriesSorted.some((e: any) => isOpeningLikePayee(e?.payee));

    if (hasRealOpening) return entriesSorted;

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
      // IMPORTANT: include archived for DISPLAY so historical entries still show their category name.
      // The picker will still hide archived categories.
      return listCategories(selectedBusinessId, { includeArchived: true });
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

  // Used by AutoInput to prevent showing "Create" when options lag behind fetched categories.
  useEffect(() => {
    (globalThis as any).__BYNK_CATEGORY_NORM_MAP_HAS = (k: string) => categoryIdByNormName.has(k);
    return () => {
      try {
        delete (globalThis as any).__BYNK_CATEGORY_NORM_MAP_HAS;
      } catch { }
    };
  }, [categoryIdByNormName]);

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
      const cid = ((e as any).category_id ?? (e as any).categoryId ?? null) as string | null;
      const catName = ((e as any).category_name ?? (e as any).categoryName ?? null) as string | null;
      const vid = ((e as any).vendor_id ?? (e as any).vendorId ?? null) as string | null;
      const vname = ((e as any).vendor_name ?? (e as any).vendorName ?? null) as string | null;

      const tid = ((e as any).transfer_id ?? (e as any).transferId ?? null) as string | null;
      const tOtherName = ((e as any).transfer_other_account_name ?? null) as string | null;
      const tDir = ((e as any).transfer_direction ?? null) as ("IN" | "OUT" | null);

      return {
        id: e.id,
        date: e.date,
        ref: "",
        payee: e.payee ?? "",
        typeDisplay: titleCase(e.type ?? ""),
        methodDisplay: uiMethodLabel(uiMethodFromRaw(e.method ?? "")),
        rawType: (e.type ?? "").toString(),
        rawMethod: (e.method ?? "").toString(),

        category: (() => {
          const t = (e.type ?? "").toString().toUpperCase();

          // TRANSFER: use durable backend fields (stable across refetch/reload)
          if (t === "TRANSFER" && tid) {
            if (tDir && tOtherName) {
              // Direction is relative to THIS account row
              return tDir === "OUT" ? `To: ${tOtherName}` : `From: ${tOtherName}`;
            }
            return "Transfer";
          }

          // ADJUSTMENT: show memo as note
          if (t === "ADJUSTMENT") {
            const note = (e.memo ?? "").toString().trim();
            return note ? note : "";
          }

          // Default: prefer backend category_name (covers archived categories too), fallback to local map
          if (catName) return catName;
          return cid ? (categoryNameById.get(cid) ?? "Unknown") : "";
        })(),
        categoryTooltip: (() => {
          const t = (e.type ?? "").toString().toUpperCase();
          if (t === "ADJUSTMENT") {
            const note = (e.memo ?? "").toString().trim();
            return note || "";
          }
          // For Transfer label, tooltip not needed (label is short)
          return "";
        })(),
        categoryId: cid,
        vendorId: vid,
        vendorName: vname,
        transferId: tid,
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

      // Ignore types that don't require categories
      const t = (r.rawType || "").toString().toUpperCase();
      if (r.id === "opening_balance") continue;
      if (t === "OPENING" || t === "TRANSFER" || t === "ADJUSTMENT") continue;

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
        dupIssueId?: string;
        missingIssueId?: string;
        staleIssueId?: string;
        dupGroupKey?: string | null;
        dupTooltip: string;
        missingTooltip: string;
        staleTooltip: string;
      }
    > = {};

    for (const iss of openIssues) {
      const eid = iss.entry_id;
      if (!eid) continue;

      const cur = map[eid] ?? {
        dup: false,
        missing: false,
        stale: false,
        dupIssueId: undefined,
        missingIssueId: undefined,
        staleIssueId: undefined,
        dupGroupKey: null,
        dupTooltip: "",
        missingTooltip: "",
        staleTooltip: "",
      };

      if (iss.issue_type === "DUPLICATE") {
        cur.dup = true;
        cur.dupIssueId = cur.dupIssueId ?? iss.id;
        cur.dupGroupKey = iss.group_key ?? null;
        cur.dupTooltip = iss.details || "• Potential duplicate";
      }

      if (iss.issue_type === "MISSING_CATEGORY") {
        // Guardrail: only show "missing category" if the entry truly has no category_id.
        // (Prevents false positives if backend scan used legacy fields.)
        const row = rowModels.find((r) => r.id === eid);
        const hasCatId = !!row?.categoryId;
        if (!hasCatId) {
          cur.missing = true;
          cur.missingIssueId = cur.missingIssueId ?? iss.id;
          cur.missingTooltip = iss.details || "• Category missing";
        }
      }

      if (iss.issue_type === "STALE_CHECK") {
        cur.stale = true;
        cur.staleIssueId = cur.staleIssueId ?? iss.id;
        cur.staleTooltip = iss.details || "• Stale check";
      }

      map[eid] = cur;
    }

    return map;
  }, [openIssues, rowModels]);

  // Stage A attention counts (UI-only; not authoritative)
  const issuesAttentionCount = useMemo(() => {
    // Ledger badge should reflect real open issues for this account
    return openIssueCountForAccount;
  }, [openIssueCountForAccount]);

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

  // ================================
  // WYSIWYG footer totals (current visible rows only)
  // - exclude deleted
  // - exclude opening_balance
  // - exclude TRANSFER (so totals aren't distorted)
  // - balance = top visible running balance (first non-deleted row), not a sum
  // ================================
  const footerTotals = useMemo(() => {
    let income = ZERO;
    let expense = ZERO; // will remain negative (signed)
    for (const r of pageRows) {
      if (r.isDeleted) continue;
      if (r.id === "opening_balance") continue;

      const t = (r.rawType || "").toString().toUpperCase();
      if (t === "TRANSFER") continue;

      const amt = toBigIntSafe(r.amountCents);
      if (amt > ZERO) income += amt;
      else if (amt < ZERO) expense += amt;
    }

    const net = income + expense;

    // Balance: first visible non-deleted row's running balance
    const top = pageRows.find((r) => !r.isDeleted && r.id !== "opening_balance" && r.balanceStr && r.balanceStr !== "—") ?? null;
    const balCents = top ? BigInt(parseMoneyToCents(top.balanceStr)) : ZERO;
    const balStr = top ? top.balanceStr : "—";

    return { income, expense, net, balanceCents: balCents, balanceStr: balStr };
  }, [pageRows]);

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

      const cached = (qc.getQueryData(entriesKey) as Entry[] | undefined) ?? [];
      const byId = new Map(cached.map((e) => [e.id, e] as const));

      // Transfers: must delete atomically (both legs selected) via deleteTransfer(transfer_id)
      const transferIds = new Set<string>();
      for (const id of entryIds) {
        const e = byId.get(id);
        if (!e) continue;
        if ((e.type || "").toUpperCase() === "TRANSFER" && e.transfer_id) transferIds.add(e.transfer_id);
      }

      for (const tid of transferIds) {
        const legs = cached.filter((e) => e.transfer_id === tid && (e.type || "").toUpperCase() === "TRANSFER");
        const selectedLegs = legs.filter((e) => entryIds.includes(e.id));
        if (legs.length > 0 && selectedLegs.length !== legs.length) {
          throw new Error("Cannot bulk delete a transfer unless both legs are selected.");
        }
      }

      const tasks: Promise<any>[] = [];

      // One call per transfer_id
      for (const tid of transferIds) {
        tasks.push(deleteTransfer({ businessId: selectedBusinessId, scopeAccountId: selectedAccountId, transferId: tid }));
      }

      // Non-transfer entries: normal soft delete
      for (const id of entryIds) {
        const e = byId.get(id);
        const isTransfer = !!e && (e.type || "").toUpperCase() === "TRANSFER" && !!e.transfer_id;
        if (isTransfer) continue;
        tasks.push(deleteEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId: id }));
      }

      const results = await Promise.allSettled(tasks);
      const failed = results.filter((r) => r.status === "rejected").length;
      return { failed, total: tasks.length };
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

  const [draftNote, setDraftNote] = useState("");

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
          includeMissingCategory: true,
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

  // Vendor payment suggestion is shown post-save on the created row only.

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
      // IMPORTANT: amount_cents must be SIGNED relative to the current account.
      // negative => money leaves current account (OUT)
      // positive => money enters current account (IN)
      if (vars.type === "TRANSFER") {
        if (!vars.toAccountId) throw new Error("To account is required");
        return createTransfer({
          businessId: selectedBusinessId,
          fromAccountId: selectedAccountId,
          input: {
            to_account_id: vars.toAccountId,
            date: vars.date,
            amount_cents: centsRaw, // <-- signed, not abs
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
            memo:
              (vars.note ?? "").trim() ||
              (vars.ref?.trim() ? `Ref: ${vars.ref.trim()}` : undefined),
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
          memo: (vars.note ?? "").trim() || (vars.ref?.trim() ? `Ref: ${vars.ref.trim()}` : undefined),
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
      cancelEntriesRefresh();
      await qc.cancelQueries({ queryKey: entriesKey });

      const previous = (qc.getQueryData(entriesKey) as Entry[] | undefined) ?? [];
      const nowIso = new Date().toISOString();

      const cents = parseMoneyToCents(vars.amountStr);

      // optimistic amount/type rules
      let backendType: string = vars.type;
      let signed: number = cents;

      if (vars.type === "TRANSFER") {
        backendType = "TRANSFER";
        signed = cents; // IMPORTANT: keep the signed value user typed for current account
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
        memo: vars.type === "ADJUSTMENT" ? ((vars.note ?? "").trim() || null) : null,
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
      setDraftNote("");
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
      // Track last created entry so we can show a post-save suggestion pill
      const createdId =
        (_data?.entry?.id as string | undefined) ||
        (_data?.id as string | undefined) ||
        (_data?.entry_id as string | undefined) ||
        null;

      if (createdId) {
        setLastCreatedEntryId(createdId);
        setLastCreatedLinkedVendor(null);
      }
      const mark = ctx?.__perf?.mark || `[PERF][create][${vars?.tempId || "noid"}]`;
      const t0 = ctx?.__perf?.t0 ?? performance.now();
      const tOk = performance.now();
      perfLog(`${mark} server success after ${(tOk - t0).toFixed(1)}ms`);

      // Transfer labels are derived from backend fields; no session-only maps.

      // Fast refresh (once): replace optimistic row with real server row
      void qc.invalidateQueries({ queryKey: entriesKey, exact: false });

      // Footer totals should update promptly (cheap query)
      void qc.invalidateQueries({ queryKey: summaryKey, exact: false });

      // Also refresh categories once (ensures new category names are available)
      void qc.invalidateQueries({ queryKey: ["categories", selectedBusinessId], exact: false });

      // Fast refresh issues (once): so icons update immediately
      void qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false });
      void qc.invalidateQueries({ queryKey: ["issuesCount", selectedBusinessId], exact: false });

      // Best-effort scan so DUP/STALE issues appear without manual scan
      // (silent; errors ignored)
      void scanIssues();

      // Keep coalesced refresh too (safe)
      scheduleEntriesRefresh("create");
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

      // Update footer totals promptly (cheap query; no entries refetch storm)
      void qc.invalidateQueries({ queryKey: summaryKey, exact: false });
    },

  });

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const deleteMut = useMutation({
    mutationFn: async (p: { entryId: string; transferId?: string | null; isTransfer?: boolean }) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");

      // CRITICAL: Transfer deletes must delete BOTH legs atomically
      if (p.isTransfer && p.transferId) {
        return deleteTransfer({ businessId: selectedBusinessId, scopeAccountId: selectedAccountId, transferId: p.transferId });
      }

      return deleteEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId: p.entryId });
    },
    onMutate: async (p) => {
      const entryId = p.entryId;
      const t0 = performance.now();
      const mark = `[PERF][delete][${entryId || "noid"}]`;
      perfLog(`${mark} click→onMutate start`);

      // Do NOT auto-toggle Deleted view. User control must remain stable.
      setDeletingId(entryId);
      cancelEntriesRefresh();
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

    onError: (e: any, p: any, ctx: any) => {
      const id = p?.entryId;
      setDeletingId(null);
      const mark = ctx?.__perf?.mark || `[PERF][delete][${id || "noid"}]`;
      const t0 = ctx?.__perf?.t0 ?? performance.now();
      const tErr = performance.now();
      perfLog(`${mark} server error after ${(tErr - t0).toFixed(1)}ms`, e);

      // If server says already gone, treat as success (idempotent UI)
      const msg = String(e?.message ?? "");
      if (msg.includes("404") || msg.includes("Entry not found")) {
        setErr(null);
        // ensure row stays deleted in UI
        void qc.invalidateQueries({ queryKey: entriesKey, exact: false });
        return;
      }

      if (ctx?.previous) qc.setQueryData(entriesKey, ctx.previous);
      setErr("Delete failed");
    },
    onSuccess: async (_data: any, p: any, ctx: any) => {
      const id = p?.entryId;
      setDeletingId(null);
      const mark = ctx?.__perf?.mark || `[PERF][delete][${id || "noid"}]`;
      const t0 = ctx?.__perf?.t0 ?? performance.now();
      const tOk = performance.now();
      perfLog(`${mark} server success after ${(tOk - t0).toFixed(1)}ms`);

      // Recompute issue groups after deletion (best-effort)
      setTimeout(() => void scanIssues(), 1500);

      scheduleEntriesRefresh("delete");

      // If transfer, also clear cached entries for other accounts (cross-account atomic UX)
      if (p?.isTransfer && p?.transferId && selectedBusinessId) {
        void qc.invalidateQueries({
          predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "entries" && q.queryKey[1] === selectedBusinessId,
        });
      }

      // Update footer totals promptly (cheap query)
      void qc.invalidateQueries({ queryKey: summaryKey, exact: false });
    },

  });

  const restoreMut = useMutation({
    mutationFn: async (p: { entryId: string; transferId?: string | null; isTransfer?: boolean }) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");

      // CRITICAL: Transfer restores must restore BOTH legs atomically
      if (p.isTransfer && p.transferId) {
        return restoreTransfer({ businessId: selectedBusinessId, scopeAccountId: selectedAccountId, transferId: p.transferId });
      }

      return restoreEntry({ businessId: selectedBusinessId, accountId: selectedAccountId, entryId: p.entryId });
    },
    onMutate: async (p) => {
      const entryId = p.entryId;
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

    onError: (e: any, p: any, ctx: any) => {
      const entryId = p?.entryId;
      const mark = ctx?.__perf?.mark || `[PERF][restore][${entryId || "noid"}]`;
      const t0 = ctx?.__perf?.t0 ?? performance.now();
      const tErr = performance.now();
      perfLog(`${mark} server error after ${(tErr - t0).toFixed(1)}ms`, e);

      if (ctx?.previous) qc.setQueryData(entriesKey, ctx.previous);
      setErr("Restore failed");
    },
    onSuccess: async (_data: any, p: any, ctx: any) => {
      const entryId = p?.entryId;
      const mark = ctx?.__perf?.mark || `[PERF][restore][${entryId || "noid"}]`;
      const t0 = ctx?.__perf?.t0 ?? performance.now();
      const tOk = performance.now();
      perfLog(`${mark} server success after ${(tOk - t0).toFixed(1)}ms`);

      void scanIssues();

      scheduleEntriesRefresh("restore");

      // If transfer, also clear cached entries for other accounts (cross-account atomic UX)
      if (p?.isTransfer && p?.transferId && selectedBusinessId) {
        void qc.invalidateQueries({
          predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "entries" && q.queryKey[1] === selectedBusinessId,
        });
      }

      // Update footer totals promptly (cheap query)
      void qc.invalidateQueries({ queryKey: summaryKey, exact: false });
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
      cancelEntriesRefresh();
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

    // Category id (only meaningful for income/expense)
    const catName = normalizeCategoryName(editDraft.category || "");
    const catId = catName ? (categoryIdByNormName.get(normKey(catName)) ?? null) : null;

    // TRANSFER edits must go through updateTransfer (atomic)
    if (backendType === "TRANSFER") {
      const row = rowModels.find((r) => r.id === entryId);
      const transferId = row?.transferId ?? null;
      if (!transferId) {
        setErr("Transfer link missing. Cannot edit this transfer.");
        setEditingId(null);
        setEditDraft(null);
        return;
      }

      const centsRaw = parseMoneyToCents(editDraft.amountStr);
      if (centsRaw === 0) return setErr("Amount is required");

      updateTransfer({
        businessId: selectedBusinessId!,
        scopeAccountId: selectedAccountId!,
        transferId,
        updates: {
          date: editDraft.date,
          payee: editDraft.payee.trim(),
          memo: editDraft.ref?.trim() ? `Ref: ${editDraft.ref.trim()}` : null,
          amount_cents: centsRaw, // signed relative to this account
          method: "TRANSFER",
          status: "EXPECTED",
        },
      })
        .then(() => {
          scheduleEntriesRefresh("transferEdit");
          setEditingId(null);
          setEditDraft(null);
        })
        .catch((e: any) => {
          setErr(e?.message || "Transfer update failed");
        });

      return;
    }

    // ADJUSTMENT keeps raw sign exactly as entered
    let signed: number;
    if (backendType === "ADJUSTMENT") {
      signed = parseMoneyToCents(editDraft.amountStr);
    } else {
      // INCOME/EXPENSE enforce sign
      signed = backendType === "EXPENSE" ? -centsAbs : centsAbs;
    }

    updateMut.mutate({
      entryId,
      updates: {
        date: editDraft.date,
        payee: editDraft.payee.trim(),
        category_id: backendType === "INCOME" || backendType === "EXPENSE" ? catId : null,
        memo: backendType === "ADJUSTMENT" ? catName || null : undefined,
        amount_cents: signed,
        type: backendType,
        method: backendType === "ADJUSTMENT" ? "OTHER" : normalizeBackendMethod(editDraft.method),
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

  async function submitInline() {
    const { payee, amountStr, centsAbs } = readSubmitValues();
    if (!payee) return setErr("Payee is required");
    if (centsAbs === 0) return setErr("Amount is required");

    setErr(null);

    const categoryName = normalizeCategoryName(categoryInputRef.current?.value ?? draftCategory);

    let categoryId =
      draftCategoryId ??
      (categoryName ? categoryIdByNormName.get(normKey(categoryName)) ?? null : null);

    // Only Income/Expense require categories here
    const t = (draftType || "").toString().toUpperCase();
    const needsCategory = t === "INCOME" || t === "EXPENSE";

    // If typed category doesn't exist yet, create it before submitting the entry
    if (needsCategory && categoryName && !categoryId && selectedBusinessId) {
      try {
        const res = await createCategory(selectedBusinessId, categoryName);
        categoryId = res.row.id;

        // Keep UI state aligned
        setDraftCategory(res.row.name);
        setDraftCategoryId(res.row.id);
        if (categoryInputRef.current) categoryInputRef.current.value = res.row.name;

        void qc.invalidateQueries({ queryKey: ["categories", selectedBusinessId], exact: false });
      } catch (e: any) {
        setErr(e?.message || "Failed to create category");
        return;
      }
    }

    createMut.mutate({
      tempId: `temp_${Date.now()}`,
      date: draftDate,
      ref: draftRef,
      payee,
      type: draftType,
      method: draftMethod,
      categoryName,
      categoryId,
      note: draftNote,
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
    <col key="c6" style={{ width: "120px" }} />,  // category (restore width so Actions stays visible)
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
        <div className="min-w-0">
          <AutoInput
            value={draftPayee}
            onValueChange={(v) => setDraftPayee(v)}
            options={payeeOptions}
            placeholder="Payee"
            inputRef={payeeInputRef}
            inputClassName={inputH7}
            onSubmit={submitInline}
          />

          {/* Vendor suggestion is shown after save on the created row (not while typing). */}

        </div>
      </td>

      {/* Type */}
      <td className={td}>
        <Select
          open={typeOpen}
          onOpenChange={setTypeOpen}
          value={draftType}
          onValueChange={(v) => {
            const next = v as UiType;
            setDraftType(next);

            // Auto-set method for special types
            if (next === "TRANSFER") setDraftMethod("TRANSFER");
            if (next === "ADJUSTMENT") setDraftMethod("OTHER");
          }}
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

      {/* Category / Note / To Account */}
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
        ) : draftType === "ADJUSTMENT" ? (
          <input
            className={inputH7}
            placeholder="Note"
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitInline()}
          />
        ) : (
          <AutoInput
            value={draftCategory}
            onValueChange={(v) => {
              setDraftCategory(v);

              // Keep category_id aligned with what the user typed/selected
              const n = normalizeCategoryName(v);
              const hit = categoryIdByNormName.get(normKey(n)) ?? null;
              setDraftCategoryId(hit);
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

              {categoryRows
                .filter((c) => !c.archived_at)
                .map((c) => (
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
                qc.invalidateQueries({ queryKey: entriesKey, exact: false });
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
  const [deleteDialog, setDeleteDialog] = useState<{
    id: string;
    mode: "soft" | "hard";
    isTransfer?: boolean;
    transferId?: string | null;
  } | null>(null);

  // Stage 2A: Close period dialog
  const [closePeriodOpen, setClosePeriodOpen] = useState(false);

  // FixIssue dialog (reusable; Ledger + Issues page)
  const [fixDialog, setFixDialog] = useState<
    | {
      id: string;
      kind: "DUPLICATE" | "MISSING_CATEGORY" | "STALE_CHECK";
    }
    | null
  >(null);

  // Quick-fix: Missing Category inline (no dialog)

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
              <div className="flex items-center gap-2 min-w-0">
                <span className={trunc + " font-medium " + deletedText + " min-w-0"}>{r.payee}</span>

                {/* Single-line vendor indicator (persisted) */}
                {(r.vendorName || linkedVendorByEntryId[r.id]) ? (
                  <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-emerald-50 px-2 text-[11px] text-emerald-700 max-w-[180px] shrink-0">
                    {/* vendor icon */}
                    <BookOpen className="h-3.5 w-3.5 text-emerald-700 shrink-0" />

                    {/* vendor name (truncate with …) */}
                    <span
                      className="font-semibold truncate min-w-0"
                      title={r.vendorName ?? linkedVendorByEntryId[r.id]}
                    >
                      {(() => {
                        const full = (r.vendorName ?? linkedVendorByEntryId[r.id] ?? "").trim();
                        const first = full.split(/\s+/)[0] || "";
                        return first ? `${first}...` : "";
                      })()}

                    </span>

                    {/* unlink */}
                    <button
                      type="button"
                      className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-emerald-100 shrink-0"
                      title="Unlink vendor"
                      onClick={async () => {
                        try {
                          await apiFetch(
                            `/v1/businesses/${selectedBusinessId}/accounts/${selectedAccountId}/entries/${r.id}`,
                            { method: "PATCH", body: JSON.stringify({ vendor_id: null }) }
                          );

                          setLinkedVendorByEntryId((m) => {
                            const next = { ...m };
                            delete next[r.id];
                            return next;
                          });

                          scheduleEntriesRefresh("vendorUnlink");
                        } catch {
                          // non-blocking
                        }
                      }}
                    >
                      <X className="h-3.5 w-3.5 text-emerald-700" />
                    </button>
                  </span>

                ) : r.id === lastCreatedEntryId && (r.rawType || "").toString().toUpperCase() === "EXPENSE" ? (
                  <VendorSuggestPill
                    businessId={selectedBusinessId ?? ""}
                    accountId={selectedAccountId ?? ""}
                    entryId={r.id}
                    payee={r.payee}
                    onLinked={(v) => {
                      setLinkedVendorByEntryId((m) => ({ ...m, [r.id]: v.name }));
                      scheduleEntriesRefresh("vendorLink");
                      setLastCreatedEntryId(null);
                    }}
                    onDismiss={() => setLastCreatedEntryId(null)}
                  />
                ) : null}

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
                  <SelectItem value="ADJUSTMENT">Adjustment</SelectItem>
                  <SelectItem value="TRANSFER">Transfer</SelectItem>
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
          <td className={td + " min-w-0 " + deletedText}>
            {isEditing && editDraft ? (
              <input
                className={inputH7}
                value={editDraft.category}
                onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })}
                onKeyDown={onEditKeyDown}
              />
            ) : (

              // IMPORTANT: do NOT wrap long text in HoverTooltip (it forces h-5 w-5).
              // Use native title tooltip so truncation/ellipsis uses the full column width.
              <span
                className="block max-w-full truncate"
                title={r.categoryTooltip ? r.categoryTooltip : r.category}
              >
                {r.category}
              </span>
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
            {!deletedRow &&
              r.hasMissing &&
              (() => {
                const t = (r.rawType || "").toString().toUpperCase();
                return t !== "TRANSFER" && t !== "ADJUSTMENT" && t !== "OPENING";
              })() ? (
              <HoverTooltip text={r.missingTooltip}>
                <button
                  type="button"
                  className="inline-flex items-center justify-center"
                  onClick={() => {
                    if (r.id.startsWith("temp_")) return setErr("Still syncing—try again in a moment.");
                    setFixDialog({ id: r.id, kind: "MISSING_CATEGORY" });
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
                      restoreMut.mutate({
                        entryId: r.id,
                        isTransfer: (r.rawType || "").toString().toUpperCase() === "TRANSFER",
                        transferId: r.transferId ?? null,
                      });
                    }}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    className="h-6 w-8 p-0"
                    title={deletingId === r.id || hardDeleteMut.isPending ? "Deleting…" : "Delete permanently"}
                    disabled={deletingId === r.id || hardDeleteMut.isPending}
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
                            className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-100 inline-flex items-center gap-2 disabled:opacity-50"
                            disabled={(r.rawType || "").toString().toUpperCase() === "TRANSFER"}
                            onMouseDown={(ev) => {
                              ev.preventDefault();
                              setMenuOpenId(null);

                              // Transfers are linked double-entry pairs and require selecting the other account.
                              if ((r.rawType || "").toString().toUpperCase() === "TRANSFER") {
                                setErr("Duplicate is not available for transfers.");
                                return;
                              }

                              createMut.mutate({
                                tempId: `dup_${Date.now()}`,
                                date: r.date,
                                ref: "",
                                payee: r.payee,
                                type: uiTypeFromRaw(r.rawType),
                                method: uiMethodFromRaw(r.rawMethod),
                                categoryName: r.category || "",
                                categoryId: r.categoryId ?? null,
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
                        disabled={deletingId === r.id || deleteMut.isPending}
                        onClick={() => {
                          if (r.id.startsWith("temp_")) return setErr("Still syncing—try again in a moment.");
                          if (deletingId === r.id || deleteMut.isPending) return;
                          setDeleteDialog({
                            id: r.id,
                            mode: "soft",
                            isTransfer: (r.rawType || "").toString().toUpperCase() === "TRANSFER",
                            transferId: r.transferId ?? null,
                          });
                        }}
                      >
                        {deletingId === r.id || deleteMut.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
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
  }, [pageRows, menuOpenId, editingId, editDraft, selectedIds, editedIds, editTypeOpen, editMethodOpen, showDeleted]);

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
                    setOpenUpload(true);
                  }}
                >
                  Upload Receipt
                </button>

                {/* Upload Invoice lives on Vendor page only */}

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
                incomeText={
                  entriesQ.isLoading ? (
                    "…"
                  ) : (
                    <span className="text-emerald-700 font-semibold">
                      {formatUsdFromCents(footerTotals.income)}
                    </span>
                  )
                }
                expenseText={
                  entriesQ.isLoading ? (
                    "…"
                  ) : (
                    <span className={footerTotals.expense < ZERO ? "text-red-700 font-semibold" : "text-red-700 font-semibold"}>
                      {formatUsdFromCents(footerTotals.expense)}
                    </span>
                  )
                }
                netText={
                  entriesQ.isLoading ? (
                    "…"
                  ) : (
                    <span className={footerTotals.net < ZERO ? "text-red-700 font-semibold" : "text-emerald-700 font-semibold"}>
                      {formatUsdFromCents(footerTotals.net)}
                    </span>
                  )
                }
                balanceText={
                  entriesQ.isLoading ? (
                    "…"
                  ) : footerTotals.balanceStr === "—" ? (
                    "—"
                  ) : (
                    <span className={footerTotals.balanceCents < ZERO ? "text-red-700 font-semibold" : "text-emerald-700 font-semibold"}>
                      {footerTotals.balanceStr}
                    </span>
                  )
                }
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
        businessId={selectedBusinessId ?? ""}
        accountId={selectedAccountId ?? ""}
        kind={fixDialog?.kind ?? null}
        entryId={fixDialog?.id ?? null}
        issues={openIssues}
        rowsById={Object.fromEntries(
          rowModels.map((r) => [
            r.id,
            {
              id: r.id,
              date: r.date,
              payee: r.payee,
              amountStr: r.amountStr,
              methodDisplay: r.methodDisplay,
              category: r.category || "",
              categoryId: r.categoryId,
            },
          ])
        )}
        categories={categoryRows.map((c) => ({ id: c.id, name: c.name }))}
        onDidMutate={() => {
          // refresh issues + entries after resolution
          if (selectedBusinessId && selectedAccountId) {
            void qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false });
            void qc.invalidateQueries({ queryKey: entriesKey, exact: false });
            void qc.invalidateQueries({ queryKey: ["issuesCount", selectedBusinessId], exact: false });
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

                if (deleteDialog.mode === "hard") {
                  hardDeleteMut.mutate(deleteDialog.id);
                } else {
                  deleteMut.mutate({
                    entryId: deleteDialog.id,
                    isTransfer: !!deleteDialog.isTransfer,
                    transferId: deleteDialog.transferId ?? null,
                  });
                }

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
