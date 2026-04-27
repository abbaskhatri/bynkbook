"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
// Auth is handled by AppShell
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useEntries } from "@/lib/queries/useEntries";
import { updateEntry, type Entry } from "@/lib/api/entries";
import { listCategories, type CategoryRow } from "@/lib/api/categories";
import { applyCategoryBatch, aiSuggestCategory, aiExplainEntry } from "@/lib/api/ai";
import {
  categorySuggestionConfidenceValue,
  isBulkSafeCategorySuggestion,
} from "@/lib/categorySuggestions";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FilterBar } from "@/components/primitives/FilterBar";
import { AppDialog } from "@/components/primitives/AppDialog";
import { AppDatePicker } from "@/components/primitives/AppDatePicker";
import { PillToggle } from "@/components/primitives/PillToggle";
import { BusyButton } from "@/components/primitives/BusyButton";

import { InlineBanner } from "@/components/app/inline-banner";
import { EmptyStateCard } from "@/components/app/empty-state";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";

import { Tags, Loader2 } from "lucide-react";

function formatUsdAccountingFromCents(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return "";
  const neg = n < 0;
  const abs = Math.abs(n);

  const dollars = Math.floor(abs / 100);
  const cents = Math.round(abs % 100);

  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const core = `$${withCommas}.${String(cents).padStart(2, "0")}`;
  return neg ? `(${core})` : core;
}

function UpdatingOverlay({ label = "Updating…" }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-white/55 backdrop-blur-[1px]">
      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function firstOfThisMonth() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

function categorySuggestionConfidence(raw: unknown) {
  return categorySuggestionConfidenceValue(raw) ?? 0;
}

function categorySuggestionTierLabel(raw: unknown) {
  const tier = String(raw ?? "").trim().toUpperCase();
  if (tier === "SAFE_DETERMINISTIC") return "Strong suggestion";
  if (tier === "STRONG_SUGGESTION") return "Strong suggestion";
  if (tier === "ALTERNATE") return "Alternate";
  if (tier === "REVIEW_BUCKET") return "Review needed";
  return "Suggestion";
}

function categorySuggestionSourceLabel(raw: unknown) {
  const source = String(raw ?? "").trim().toUpperCase();
  if (source === "VENDOR_DEFAULT") return "Vendor default";
  if (source === "MEMORY") return "Learned from your history";
  if (source === "HEURISTIC") return "Pattern match";
  if (source === "AI") return "AI suggestion";
  return "Suggestion";
}

function categorySuggestionButtonClass(rawTier: unknown, isPrimary: boolean) {
  const tier = String(rawTier ?? "").trim().toUpperCase();

  if (tier === "SAFE_DETERMINISTIC" || tier === "STRONG_SUGGESTION") {
    return isPrimary
      ? "border-primary/20 bg-primary/10 text-primary hover:bg-primary/15"
      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
  }

  if (tier === "REVIEW_BUCKET") {
    return "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100";
  }

  return "border-slate-200 bg-white text-slate-700 hover:bg-slate-50";
}

export default function CategoryReviewPageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();

  // Prevent infinite router.replace loops (Next searchParams can cause repeated effects)
  const didSyncUrlRef = useRef(false);

  // Auth is handled by AppShell

  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");
  const accountIdFromUrl = sp.get("accountId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const accountsQ = useAccounts(selectedBusinessId);

  const [err, setErr] = useState<string | null>(null);

  const selectedAccountId = useMemo(() => {
    const list = accountsQ.data ?? [];
    if (accountIdFromUrl) return accountIdFromUrl;
    return list.find((a) => !a.archived_at)?.id ?? "";
  }, [accountsQ.data, accountIdFromUrl]);

  // Local selection state to prevent SelectTrigger/router feedback loops
  const [accountSelectId, setAccountSelectId] = useState<string>("");

  // Keep local selection in sync with derived selectedAccountId (only when changed)
  useEffect(() => {
    if (!selectedAccountId) return;
    setAccountSelectId((prev) => (prev === selectedAccountId ? prev : selectedAccountId));
  }, [selectedAccountId]);

  // Allow URL sync to run again when scope changes
  // (removed: this caused router.replace loops in dev)

  useEffect(() => {
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;
    if (accountsQ.isLoading) return;

    // Only sync once per scope (prevents infinite loops)
    if (didSyncUrlRef.current) return;

    const hasBiz = !!bizIdFromUrl;
    const hasAcct = !!accountIdFromUrl;

    // If URL missing businessId, add it (and stop)
    if (!hasBiz) {
      didSyncUrlRef.current = true;
      router.replace(`/category-review?businessId=${selectedBusinessId}`);
      return;
    }

    // If URL missing accountId, add it (and stop)
    if (selectedAccountId && !hasAcct) {
      didSyncUrlRef.current = true;
      router.replace(`/category-review?businessId=${selectedBusinessId}&accountId=${selectedAccountId}`);
      return;
    }

    // URL already complete; mark synced so we never loop
    didSyncUrlRef.current = true;
  }, [
    businessesQ.isLoading,
    accountsQ.isLoading,
    selectedBusinessId,
    selectedAccountId,
    router,
  ]);
  const opts = (accountsQ.data ?? [])
    .filter((a) => !a.archived_at)
    .map((a) => ({ value: a.id, label: a.name }));

  const capsule = (
    <div className="h-6 px-1.5 rounded-lg border border-primary/20 bg-primary/10 flex items-center">
      <CapsuleSelect
        variant="flat"
        loading={accountsQ.isLoading}
        value={accountSelectId || (opts[0]?.value ?? "")}
        onValueChange={(v) => {
          // Update local state for UI stability
          setAccountSelectId(v);

          // Navigate only if it truly changed (prevents SelectTrigger loops)
          if (!selectedBusinessId) return;
          const current = sp.get("accountId") ?? "";
          if (current === v) return;

          router.replace(`/category-review?businessId=${selectedBusinessId}&accountId=${v}`);
        }}
        options={opts}
        placeholder="Select account"
      />
    </div>
  );

  function retryCategoryReview() {
    void entriesQ.refetch?.();
    void categoriesQ.refetch();
    void suggestionsQ.refetch();
  }

  // Entries (single fetch via hook; filters only apply after Run)
  const entriesLimit = 2000;
  const entriesKey = useMemo(
    () => ["entries", selectedBusinessId, selectedAccountId, entriesLimit, false] as const,
    [selectedBusinessId, selectedAccountId, entriesLimit]
  );

  const entriesQ = useEntries({
    businessId: selectedBusinessId,
    accountId: selectedAccountId,
    limit: entriesLimit,
    includeDeleted: false,
  });

  const bannerMsg =
    err ||
    appErrorMessageOrNull(businessesQ.error) ||
    appErrorMessageOrNull(accountsQ.error) ||
    null;

  const whyOpenRef = useRef<string | null>(null);
  const [whyEntryId, setWhyEntryId] = useState<string | null>(null);
  const [whyBusy, setWhyBusy] = useState(false);
  const [whyText, setWhyText] = useState<string | null>(null);
  const [whyErr, setWhyErr] = useState<string | null>(null);

  // Now that entriesQ exists, include it in the banner mapping
  const bannerMsgWithEntries =
    bannerMsg || appErrorMessageOrNull(entriesQ.error) || null;

  // -------------------------
  // Mutation banner (single region; CLOSED_PERIOD consistency)
  // -------------------------
  const [mutErr, setMutErr] = useState<string | null>(null);
  const [mutErrTitle, setMutErrTitle] = useState<string | null>(null);

  // Phase F2: suggestions (batch) + selection + bulk apply
  const [selectedSuggestionByEntryId, setSelectedSuggestionByEntryId] = useState<Record<string, string>>({});

  const [applyOpen, setApplyOpen] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applySummary, setApplySummary] = useState<{ applied: number; blocked: number } | null>(null);

  function clearMutErr() {
    setMutErr(null);
    setMutErrTitle("");
  }

  function applyMutationError(e: any, fallbackTitle: string) {
    const msg = appErrorMessageOrNull(e) ?? e?.message ?? "Something went wrong. Try again.";

    const code =
      e?.code ||
      e?.response?.data?.code ||
      e?.data?.code;

    const isClosed =
      code === "CLOSED_PERIOD" ||
      (typeof msg === "string" && msg.includes("This period is closed"));

    if (isClosed) {
      setMutErrTitle("Period closed");
      setMutErr("This period is closed. Reopen period to modify.");
      return { msg: "This period is closed. Reopen period to modify.", isClosed: true };
    }

    setMutErrTitle(fallbackTitle);
    setMutErr(String(msg));
    return { msg: String(msg), isClosed: false };
  }

  // Categories list (canonical query key)
  const categoriesQ = useQuery({
    // IMPORTANT: includeArchived must be part of the cache key so we never reuse an archived-inclusive cache.
    queryKey: ["categories", selectedBusinessId, false],
    enabled: !!selectedBusinessId,
    queryFn: async () => {
      if (!selectedBusinessId) return { ok: true as const, rows: [] as CategoryRow[] };
      return listCategories(selectedBusinessId, { includeArchived: false });
    },
  });

  // Never offer archived categories in Category Review dropdowns.
  const categories = (categoriesQ.data?.rows ?? []).filter((c) => !c.archived_at);

  const categoryNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of categories) m[String(c.id)] = c.name;
    return m;
  }, [categories]);

  // Filters (inputs)
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [search, setSearch] = useState("");
  const [onlyUncategorized, setOnlyUncategorized] = useState(true);

  // Applied filters (set only on Run)
  const [applied, setApplied] = useState({
    from: "",
    to: "",
    search: "",
    onlyUncategorized: true,
  });

  function runFilters() {
    setErr(null);
    setApplied({ from, to, search, onlyUncategorized });
    setSelectedIds(new Set());
    setFailedById({});
  }

  // Auto-run once so the list is visible by default (no blank state)
  const didAutoRunRef = useRef(false);
  useEffect(() => {
    if (didAutoRunRef.current) return;
    if (entriesQ.isLoading) return;
    didAutoRunRef.current = true;
    runFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesQ.isLoading]);

  const allEntries = (entriesQ.data ?? []) as any[];

  const visibleRows = useMemo(() => {
    const s = applied.search.trim().toLowerCase();
    const fromYmd = applied.from;
    const toYmd = applied.to;

    const inRange = (ymd: string) => {
      if (!ymd) return false;
      if (fromYmd && ymd < fromYmd) return false;
      if (toYmd && ymd > toYmd) return false;
      return true;
    };

    return allEntries.filter((e) => {
      const ymd = String(e.date ?? "").slice(0, 10);
      if (!inRange(ymd)) return false;

      // Exclude types that don't require categories
      const t = String(e.type ?? "").toUpperCase();
      if (t === "TRANSFER" || t === "ADJUSTMENT" || t === "OPENING") return false;

      // Exclude opening balance placeholders (these must never be categorized)
      const payeeText = String(e.payee ?? "").trim().toLowerCase();
      if (payeeText.startsWith("opening balance")) return false;

      if (applied.onlyUncategorized && e.category_id) return false;
      if (s) {
        const p = String(e.payee ?? "").toLowerCase();
        const m = String(e.memo ?? "").toLowerCase();
        if (!p.includes(s) && !m.includes(s)) return false;
      }

      return true;
    });
  }, [allEntries, applied]);

  // Stable suggestion target key (prevents useEffect loops)
  const suggestionTargetIds = useMemo(() => {
    return (visibleRows ?? [])
      .filter((r: any) => !r?.category_id)
      .slice(0, 200)
      .map((r: any) => String(r.id))
      .join("|");
  }, [visibleRows]);

  // -------------------------
  // Phase F2: batch suggestions (canonical query key; per-surface retry; no stuck loading)
  // -------------------------
  const suggestionTargets = useMemo(() => {
    return (visibleRows ?? [])
      .filter((r: any) => !r?.category_id)
      .slice(0, 200)
      .map((r: any) => ({
        kind: "ENTRY" as const,
        id: String(r.id),
        date: String(r.date ?? "").slice(0, 10),
        amount_cents: r.amount_cents,
        payee_or_name: String(r.payee ?? ""),
        memo: String(r.memo ?? ""),
      }));
  }, [visibleRows]);

  const suggestionTargetsKey = useMemo(() => {
    return suggestionTargets.map((x) => x.id).join("|");
  }, [suggestionTargets]);

  const suggestionsQ = useQuery({
    queryKey: ["aiCategorySuggestions", selectedBusinessId, selectedAccountId, suggestionTargetsKey],
    enabled: !!selectedBusinessId && !!selectedAccountId && suggestionTargets.length > 0,

    // Keep last-good suggestions while refetching; no empty flash.
    placeholderData: (prev) => prev ?? ({} as Record<string, any[]>),

    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,

    queryFn: async () => {
      if (!selectedBusinessId || !selectedAccountId) return {} as Record<string, any[]>;
      if (!suggestionTargets.length) return {} as Record<string, any[]>;

      const res: any = await aiSuggestCategory({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        items: suggestionTargets,
        limitPerItem: 3,
      });

      const next: Record<string, any[]> = {};

      for (const it of suggestionTargets) {
        let s: any[] = [];

        if (Array.isArray(res?.suggestionsById?.[it.id])) {
          s = res.suggestionsById[it.id];
        } else if (Array.isArray(res?.items)) {
          const hit = res.items.find(
            (x: any) =>
              String(x?.id ?? x?.entryId ?? "") === String(it.id)
          );
          if (Array.isArray(hit?.suggestions)) s = hit.suggestions;
        } else if (Array.isArray(res?.suggestions)) {
          s = res.suggestions.filter(
            (x: any) => String(x?.entryId ?? x?.id ?? "") === String(it.id)
          );
        }

        next[it.id] = Array.isArray(s) ? s : [];
      }

      return next;
    },
  });

  const sugByEntryId = (suggestionsQ.data ?? {}) as Record<string, any[]>;
  const sugLoading = suggestionsQ.isFetching;
  const sugUpdating = suggestionsQ.isFetching && !!suggestionsQ.data && Object.keys(suggestionsQ.data as any).length > 0;

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedCount = selectedIds.size;

  const allVisibleSelected = useMemo(() => {
    if (visibleRows.length === 0) return false;
    for (const e of visibleRows) {
      if (!selectedIds.has(String(e.id))) return false;
    }
    return true;
  }, [visibleRows, selectedIds]);

  function toggleSelectAllVisible() {
    setFailedById({});
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const shouldSelect = !allVisibleSelected;
      if (shouldSelect) {
        for (const e of visibleRows) next.add(String(e.id));
      } else {
        for (const e of visibleRows) next.delete(String(e.id));
      }
      return next;
    });
  }

  function toggleRow(id: string) {
    setFailedById((m) => {
      const next = { ...m };
      delete next[id];
      return next;
    });

    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkCategoryId("__NONE__");
    setFailedById({});
    setSelectedSuggestionByEntryId({});
  }

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkCategoryId("__NONE__");
    setFailedById({});
    setSelectedSuggestionByEntryId({});
    setApplyOpen(false);
    setExpandedAutoFixGroups({});
  }, [selectedBusinessId, selectedAccountId]);

  // Bulk apply state + confirm
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("__NONE__");

  // Per-row status
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [failedById, setFailedById] = useState<Record<string, string>>({});

  const tableUpdating =
    (entriesQ.isFetching && !!(entriesQ.data ?? []).length) ||
    sugUpdating ||
    whyBusy ||
    applyBusy ||
    Object.keys(pendingIds).length > 0;

  // F7a (session-local): AI badge + undo for suggestion-pill applies only when source is AI.
  const [aiAppliedById, setAiAppliedById] = useState<Record<string, boolean>>({});
  const [undoByEntryId, setUndoByEntryId] = useState<
    Record<string, { prevCategoryId: string | null; nextCategoryId: string | null; expiresAt: number }>
  >({});
  const undoTimerByEntryIdRef = useRef<Record<string, number>>({});

  const clearUndoTimer = (entryId: string) => {
    const t = undoTimerByEntryIdRef.current[entryId];
    if (t) {
      window.clearTimeout(t);
      delete undoTimerByEntryIdRef.current[entryId];
    }
  };

  const setUndoWindow = (entryId: string, prevCategoryId: string | null, nextCategoryId: string | null) => {
    clearUndoTimer(entryId);
    const expiresAt = Date.now() + 10_000;

    setUndoByEntryId((m) => ({
      ...m,
      [entryId]: { prevCategoryId, nextCategoryId, expiresAt },
    }));

    undoTimerByEntryIdRef.current[entryId] = window.setTimeout(() => {
      setUndoByEntryId((m) => {
        if (!m[entryId]) return m;
        const next = { ...m };
        delete next[entryId];
        return next;
      });
      clearUndoTimer(entryId);
    }, 10_000);
  };

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      const map = undoTimerByEntryIdRef.current;
      for (const k of Object.keys(map)) {
        window.clearTimeout(map[k]);
      }
      undoTimerByEntryIdRef.current = {};
    };
  }, []);

  // Per-row category changes apply immediately (dropdown onChange + suggestion pill click)

  async function applyCategoryToEntry(
    entryId: string,
    categoryId: string | null,
    suggestedCategoryId?: string | null
  ) {
    if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");

    setPendingIds((m) => ({ ...m, [entryId]: true }));
    setFailedById((m) => {
      const next = { ...m };
      delete next[entryId];
      return next;
    });

    const prev = (qc.getQueryData(entriesKey) as any[] | undefined) ?? [];
    const idx = prev.findIndex((x: any) => String(x.id) === entryId);
    const prevEntry = idx >= 0 ? prev[idx] : null;

    // No cache write here: keep hook-owned cache authoritative to avoid mismatched query keys.
    // We rely on targeted refetch after mutation.

    try {
      await updateEntry({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        entryId,
        updates: {
          category_id: categoryId,
          suggested_category_id: suggestedCategoryId ?? null,
        },
      });

      // Refresh all ledger/account entry surfaces immediately.
      await qc.invalidateQueries({ queryKey: ["aiCategorySuggestions", selectedBusinessId, selectedAccountId], exact: false });
      await qc.invalidateQueries({ queryKey: ["entries", selectedBusinessId, selectedAccountId], exact: false });
      await qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false });
      await qc.invalidateQueries({ queryKey: ["ledgerSummary", selectedBusinessId, selectedAccountId], exact: false });

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bynk:ledger-refresh-now"));
      }

    } catch (e: any) {
      // Revert this entry only
      if (idx >= 0 && prevEntry) {
        const cur = (qc.getQueryData(entriesKey) as any[] | undefined) ?? [];
        const j = cur.findIndex((x: any) => String(x.id) === entryId);
        if (j >= 0) {
          const next = cur.slice();
          next[j] = prevEntry;
          qc.setQueryData(entriesKey, next);
        }
      }

      const r = applyMutationError(e, "Can’t apply category");
      if (!r.isClosed) {
        setFailedById((m) => ({ ...m, [entryId]: r.msg }));
      }

      throw e;
    } finally {
      setPendingIds((m) => {
        const next = { ...m };
        delete next[entryId];
        return next;
      });
    }
  }

  async function runWhy(entryId: string) {
    if (!selectedBusinessId) return;

    setWhyEntryId(entryId);
    setWhyBusy(true);
    setWhyErr(null);
    setWhyText(null);

    try {
      const res: any = await aiExplainEntry({ businessId: selectedBusinessId, entryId });
      if (!res?.ok) throw new Error(res?.error || "Explain failed");
      setWhyText(String(res.answer ?? ""));
    } catch (e: any) {
      const msg = String(e?.message ?? "Explain failed");
      setWhyErr(msg.includes("429") ? "AI daily limit reached for this business. Try again tomorrow." : "AI is unavailable right now.");
    } finally {
      setWhyBusy(false);
    }
  }

  async function runApplySelectedConfirmed() {
    if (bulkCategoryId === "__NONE__") return;

    clearMutErr();

    const categoryId = bulkCategoryId === "__UNCATEGORIZED__" ? null : bulkCategoryId;

    const ids = Array.from(selectedIds);
    const BATCH = 8;

    const successes = new Set<string>();

    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const results = await Promise.allSettled(chunk.map((id) => applyCategoryToEntry(id, categoryId)));
      results.forEach((r, idx) => {
        if (r.status === "fulfilled") successes.add(chunk[idx]);
      });
    }

    const remaining = ids.filter((id) => !successes.has(id));
    if (remaining.length === 0) {
      clearMutErr();
      clearSelection();
      return;
    }

    setSelectedIds(new Set(remaining));
  }

  // Auth handled by AppShell
  const selectedApplyItems = useMemo(() => {
    const out: Array<{ entryId: string; category_id: string; suggested_category_id?: string }> = [];

    for (const entryId of Array.from(selectedIds)) {
      const category_id = String(selectedSuggestionByEntryId[entryId] ?? "").trim();
      if (!category_id) continue;

      const list = Array.isArray(sugByEntryId[entryId]) ? sugByEntryId[entryId] : [];
      const top = list[0] ?? null;
      const suggested_category_id = String(top?.category_id ?? top?.categoryId ?? "").trim();
      if (!isBulkSafeCategorySuggestion(top, 0)) continue;
      if (!suggested_category_id || category_id !== suggested_category_id) continue;

      out.push({
        entryId,
        category_id,
        suggested_category_id: suggested_category_id || undefined,
      });
    }

    return out.slice(0, 200);
  }, [selectedIds, selectedSuggestionByEntryId, sugByEntryId]);

  const autoFixRows = useMemo(() => {
    return visibleRows
      .filter((e: any) => selectedIds.has(String(e.id)))
      .map((e: any) => {
        const id = String(e.id);
        const suggestions = Array.isArray(sugByEntryId[id]) ? sugByEntryId[id] : [];
        const top = suggestions[0] ?? null;
        const topCategoryId = String(top?.category_id ?? top?.categoryId ?? "").trim();
        const bulkSafeTopCategoryId = isBulkSafeCategorySuggestion(top, 0) ? topCategoryId : "";

        return {
          entry: e,
          suggestions,
          topCategoryId,
          selectedCategoryId: String(selectedSuggestionByEntryId[id] ?? bulkSafeTopCategoryId ?? "").trim(),
        };
      });
  }, [visibleRows, selectedIds, sugByEntryId, selectedSuggestionByEntryId]);

  const [expandedAutoFixGroups, setExpandedAutoFixGroups] = useState<Record<string, boolean>>({});

  const autoFixTotalAmountCents = useMemo(() => {
    return autoFixRows.reduce((sum, row) => sum + Number(row.entry?.amount_cents ?? 0), 0);
  }, [autoFixRows]);

  const autoFixReviewNeededCount = Math.max(0, autoFixRows.length - selectedApplyItems.length);

  const autoFixGroups = useMemo(() => {
    const categoryNameById = new Map<string, string>(
      categories.map((c) => [String(c.id), String(c.name)])
    );

    const groupsMap = new Map<
      string,
      {
        groupKey: string;
        categoryId: string;
        categoryName: string;
        count: number;
        totalAmountCents: number;
        rows: typeof autoFixRows;
      }
    >();

    for (const row of autoFixRows) {
      const categoryId = String(row.selectedCategoryId ?? "").trim();
      const groupKey = categoryId || "__UNASSIGNED__";
      const categoryName = categoryId
        ? categoryNameById.get(categoryId) ?? "Unknown category"
        : "Unassigned";

      const existing = groupsMap.get(groupKey);
      if (existing) {
        existing.count += 1;
        existing.totalAmountCents += Number(row.entry?.amount_cents ?? 0);
        existing.rows.push(row);
      } else {
        groupsMap.set(groupKey, {
          groupKey,
          categoryId,
          categoryName,
          count: 1,
          totalAmountCents: Number(row.entry?.amount_cents ?? 0),
          rows: [row],
        });
      }
    }

    return Array.from(groupsMap.values()).sort((a, b) => {
      const aAbs = Math.abs(a.totalAmountCents);
      const bAbs = Math.abs(b.totalAmountCents);
      if (bAbs !== aAbs) return bAbs - aAbs;
      return a.categoryName.localeCompare(b.categoryName);
    });
  }, [autoFixRows, categories]);

  function toggleAutoFixGroup(groupKey: string) {
    setExpandedAutoFixGroups((prev) => ({
      ...prev,
      [groupKey]: !prev[groupKey],
    }));
  }

  function openAutoFixCategories() {
    const next: Record<string, string> = { ...selectedSuggestionByEntryId };

    for (const e of visibleRows) {
      const id = String(e.id);
      if (!selectedIds.has(id)) continue;
      if (next[id]) continue;

      const suggestions = Array.isArray(sugByEntryId[id]) ? sugByEntryId[id] : [];
      const top = suggestions[0] ?? null;
      const topCategoryId = String(top?.category_id ?? top?.categoryId ?? "").trim();

      if (topCategoryId && isBulkSafeCategorySuggestion(top, 0)) next[id] = topCategoryId;
    }

    const categoryNameById = new Map<string, string>(
      categories.map((c) => [String(c.id), String(c.name)])
    );

    const groupCounts = new Map<string, number>();
    for (const e of visibleRows) {
      const id = String(e.id);
      if (!selectedIds.has(id)) continue;
      const groupKey = String(next[id] ?? "").trim() || "__UNASSIGNED__";
      groupCounts.set(groupKey, (groupCounts.get(groupKey) ?? 0) + 1);
    }

    const firstGroups = Array.from(groupCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([groupKey]) => groupKey);

    const nextExpanded: Record<string, boolean> = {};
    for (const groupKey of firstGroups) nextExpanded[groupKey] = true;

    setExpandedAutoFixGroups(nextExpanded);
    setSelectedSuggestionByEntryId(next);
    setApplySummary(null);
    clearMutErr();
    setApplyOpen(true);
  }
  return (
    <div className="flex min-h-0 h-[calc(100vh-96px)] flex-col gap-4 max-w-6xl overflow-hidden">
      {/* Unified header container (match Ledger/Issues) */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<Tags className="h-4 w-4" />}
            title="Category Review"
            afterTitle={capsule}
            right={null}
          />
        </div>

        <div className="mt-2 h-px bg-slate-200" />

        <div className="px-3 py-2">
          <FilterBar
            left={
              <>
                <div className="space-y-1">
                  <div className="text-[11px] text-slate-600">From</div>
                  <div className="w-[160px]">
                    <AppDatePicker value={from} onChange={setFrom} ariaLabel="From date" />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] text-slate-600">To</div>
                  <div className="w-[160px]">
                    <AppDatePicker value={to} onChange={setTo} ariaLabel="To date" />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] text-slate-600">Search</div>
                  <Input
                    className="h-7 w-[220px] text-xs"
                    placeholder="Payee or memo"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <div className="ml-2 space-y-1">
                  <div className="text-[11px] text-slate-600">&nbsp;</div>
                  <div className="h-7 px-2 rounded-md border border-slate-200 bg-white flex items-center gap-2">
                    <span className="text-xs text-slate-600 whitespace-nowrap">Uncategorized only</span>
                    <PillToggle
                      checked={onlyUncategorized}
                      onCheckedChange={(next) => setOnlyUncategorized(next)}
                    />
                  </div>
                </div>
              </>
            }
            right={
              <Button type="button" className="h-7 px-3 text-xs" onClick={runFilters} disabled={entriesQ.isLoading}>
                Run
              </Button>
            }
          />
        </div>

        {applySummary ? (
          <div className="px-3 pb-2">
            <InlineBanner
              title="Suggestions applied"
              message={`Applied ${applySummary.applied}. Blocked ${applySummary.blocked}.`}
              actionLabel={applySummary.blocked > 0 ? "Go to Close Periods" : null}
              actionHref={
                applySummary.blocked > 0
                  ? selectedBusinessId
                    ? `/closed-periods?businessId=${encodeURIComponent(selectedBusinessId)}&focus=reopen`
                    : "/closed-periods?focus=reopen"
                  : null
              }
            />
          </div>
        ) : null}

        {(bannerMsgWithEntries || mutErr) ? (
          <div className="px-3 pb-2">
            {bannerMsgWithEntries ? (
              <InlineBanner title="Can’t load category review" message={bannerMsgWithEntries} onRetry={() => retryCategoryReview()} />
            ) : (
              <InlineBanner
                title={mutErrTitle || "Can’t update category review"}
                message={mutErr}
                actionLabel={mutErrTitle === "Period closed" ? "Go to Close Periods" : null}
                actionHref={
                  mutErrTitle === "Period closed"
                    ? selectedBusinessId
                      ? `/closed-periods?businessId=${encodeURIComponent(selectedBusinessId)}&focus=reopen`
                      : "/closed-periods?focus=reopen"
                    : null
                }
              />
            )}
          </div>
        ) : null}

        {!selectedBusinessId && !businessesQ.isLoading ? (
          <div className="px-3 pb-2">
            <EmptyStateCard
              title="No business yet"
              description="Create a business to start using BynkBook."
              primary={{ label: "Create business", href: "/settings?tab=business" }}
              secondary={{ label: "Reload", onClick: () => retryCategoryReview() }}
            />
          </div>
        ) : null}

        {selectedBusinessId && !accountsQ.isLoading && (accountsQ.data ?? []).length === 0 ? (
          <div className="px-3 pb-2">
            <EmptyStateCard
              title="No accounts yet"
              description="Add an account to start importing and categorizing transactions."
              primary={{ label: "Add account", href: "/settings?tab=accounts" }}
              secondary={{ label: "Reload", onClick: () => retryCategoryReview() }}
            />
          </div>
        ) : null}
      </div>

      {/* Table card */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CHeader className="shrink-0 pb-2">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="inline-flex items-center gap-2">
              Uncategorized
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-primary/10 px-1.5 text-[11px] font-semibold text-primary border border-primary/20">
                {visibleRows.length}
              </span>
              {sugUpdating ? <span className="text-[11px] text-slate-500">Updating…</span> : null}
            </CardTitle>

            <div className="flex items-center gap-2">
              <Button
                className="h-7 px-3 text-xs"
                disabled={applyBusy || visibleRows.length === 0}
                onClick={() => {
                  if (selectedCount === 0) {
                    const allVisibleIds = new Set(visibleRows.map((e: any) => String(e.id)));
                    setSelectedIds(allVisibleIds);

                    const next: Record<string, string> = { ...selectedSuggestionByEntryId };

                    for (const e of visibleRows) {
                      const id = String(e.id);
                      const suggestions = Array.isArray(sugByEntryId[id]) ? sugByEntryId[id] : [];
                      const top = suggestions[0] ?? null;
                      const topCategoryId = String(top?.category_id ?? top?.categoryId ?? "").trim();
                      if (!next[id] && topCategoryId && isBulkSafeCategorySuggestion(top, 0)) next[id] = topCategoryId;
                    }

                    const groupCounts = new Map<string, number>();
                    for (const e of visibleRows) {
                      const id = String(e.id);
                      const groupKey = String(next[id] ?? "").trim() || "__UNASSIGNED__";
                      groupCounts.set(groupKey, (groupCounts.get(groupKey) ?? 0) + 1);
                    }

                    const firstGroups = Array.from(groupCounts.entries())
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 3)
                      .map(([groupKey]) => groupKey);

                    const nextExpanded: Record<string, boolean> = {};
                    for (const groupKey of firstGroups) nextExpanded[groupKey] = true;

                    setExpandedAutoFixGroups(nextExpanded);
                    setSelectedSuggestionByEntryId(next);
                    setApplySummary(null);
                    clearMutErr();
                    setApplyOpen(true);
                    return;
                  }

                  openAutoFixCategories();
                }}
              >
                Auto Fix Categories
              </Button>

              {selectedCount > 0 ? (
                <>
                  <select
                    className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs"
                    value={bulkCategoryId}
                    onChange={(e) => setBulkCategoryId(e.target.value)}
                  >
                    <option value="__NONE__">Choose category…</option>
                    <option value="__UNCATEGORIZED__">Uncategorized</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>

                  <Button
                    className="h-7 px-3 text-xs"
                    disabled={bulkCategoryId === "__NONE__" || selectedCount === 0}
                    onClick={async () => {
                      clearMutErr();
                      setApplyBusy(true);
                      try {
                        await runApplySelectedConfirmed();
                      } finally {
                        setApplyBusy(false);
                      }
                    }}
                  >
                    Apply chosen category
                  </Button>

                  <Button
                    variant="outline"
                    className="h-7 px-3 text-xs"
                    onClick={clearSelection}
                    disabled={selectedCount === 0}
                  >
                    Clear
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </CHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden pb-2">
          {err ? (
            <div className="text-sm text-red-600" role="alert">
              {err}
            </div>
          ) : null}

          {entriesQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : visibleRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No entries match these filters.</div>
          ) : (
            <div className="relative min-h-0 flex-1 rounded-lg border border-slate-200 overflow-hidden bg-white">
              {tableUpdating ? <UpdatingOverlay /> : null}
              <div className={`min-h-0 h-full ${tableUpdating ? "pointer-events-none select-none blur-[1px]" : ""}`}>
                <div className="h-full overflow-auto">
                  <table className="w-full min-w-[760px] border-separate border-spacing-0">
                    <colgroup>
                      <col style={{ width: 36 }} />
                      <col style={{ width: 98 }} />
                      <col />
                      <col style={{ width: 120 }} />
                      <col style={{ width: 360 }} />
                    </colgroup>

                    <thead className="sticky top-0 z-10 bg-white">
                      <tr className="h-7 border-b border-slate-200 bg-slate-50">
                        <th className="px-0 text-center align-middle border-b border-slate-200">
                          <div className="flex h-7 items-center justify-center">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={allVisibleSelected}
                              onChange={toggleSelectAllVisible}
                            />
                          </div>
                        </th>
                        <th className="px-2 text-left text-[10px] font-semibold text-slate-600 border-b border-slate-200">Date</th>
                        <th className="px-2 text-left text-[10px] font-semibold text-slate-600 border-b border-slate-200">Payee</th>
                        <th className="px-2 text-right text-[10px] font-semibold text-slate-600 border-b border-slate-200">Amount</th>
                        <th className="px-2 text-left text-[10px] font-semibold text-slate-600 border-b border-slate-200">Category</th>
                      </tr>
                    </thead>

                    <tbody>
                      {visibleRows.map((e: any) => {
                        const id = String(e.id);
                        const payee = String(e.payee ?? "");
                        const dateYmd = String(e.date ?? "").slice(0, 10);
                        const failMsg = failedById[id];
                        const isSelected = selectedIds.has(id);
                        const typeUpper = String(e.type ?? "").toUpperCase();
                        const payeeLower = String(e.payee ?? "").trim().toLowerCase();
                        const isOpening = typeUpper === "OPENING" || payeeLower.startsWith("opening balance");

                        return (
                          <tr key={id} className={`border-b border-slate-100 align-top ${isSelected ? "bg-accent" : ""}`}>
                            <td className="px-0 pt-2 text-center align-top border-b border-slate-100">
                              <div className="flex items-start justify-center">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={isSelected}
                                  onChange={() => toggleRow(id)}
                                />
                              </div>
                            </td>

                            <td className="px-2 py-2 text-xs text-slate-700 whitespace-nowrap border-b border-slate-100">
                              {dateYmd}
                            </td>

                            <td className="px-2 py-2 border-b border-slate-100">
                              <div className="flex flex-col min-w-0">
                                <div className="text-xs text-slate-900 truncate font-medium">{payee}</div>

                              </div>
                            </td>

                            <td
                              className={`px-2 py-2 text-xs text-right tabular-nums border-b border-slate-100 ${
                                Number(e.amount_cents) < 0 ? "text-red-700" : "text-slate-900"
                              }`}
                            >
                              {formatUsdAccountingFromCents(e.amount_cents)}
                            </td>

                            <td className="px-2 py-2 border-b border-slate-100">
                              <div className="flex items-start justify-start gap-1.5 flex-wrap">
                                <select
                                  className="h-6 w-full min-w-[160px] max-w-[220px] rounded-md border border-slate-200 bg-white px-2 text-[11px]"
                                  value={isOpening ? "" : (e.category_id ? String(e.category_id) : "")}
                                  disabled={isOpening || !!pendingIds[id]}
                                  onChange={async (ev) => {
                                    if (isOpening) return;
                                    if (!selectedBusinessId || !selectedAccountId) return;

                                    const v = ev.target.value;
                                    const nextCategoryId = v ? v : null;
                                    if (pendingIds[id]) return;

                                    if (nextCategoryId && !categoryNameById[String(nextCategoryId)]) {
                                      setFailedById((m) => ({ ...m, [id]: "Category is archived or invalid. Refresh categories." }));
                                      return;
                                    }

                                    clearMutErr();

                                    const hadAi = !!aiAppliedById[id];
                                    const undoSnap = undoByEntryId[id] ?? null;

                                    if (hadAi) {
                                      setAiAppliedById((m) => {
                                        const next = { ...m };
                                        delete next[id];
                                        return next;
                                      });
                                    }
                                    if (undoSnap) {
                                      setUndoByEntryId((m) => {
                                        const next = { ...m };
                                        delete next[id];
                                        return next;
                                      });
                                      clearUndoTimer(id);
                                    }

                                    try {
                                      const topSuggestion = (Array.isArray(sugByEntryId[id]) ? sugByEntryId[id] : [])[0] ?? null;
                                      const suggestedCategoryId = String(
                                        topSuggestion?.category_id ?? topSuggestion?.categoryId ?? ""
                                      ).trim();

                                      await applyCategoryToEntry(
                                        id,
                                        nextCategoryId,
                                        suggestedCategoryId || null
                                      );
                                    } catch {
                                      if (hadAi) setAiAppliedById((m) => ({ ...m, [id]: true }));
                                      if (undoSnap) {
                                        setUndoByEntryId((m) => ({ ...m, [id]: undoSnap }));
                                        const remaining = Math.max(0, (undoSnap.expiresAt ?? 0) - Date.now());
                                        if (remaining > 0) {
                                          clearUndoTimer(id);
                                          undoTimerByEntryIdRef.current[id] = window.setTimeout(() => {
                                            setUndoByEntryId((m) => {
                                              if (!m[id]) return m;
                                              const next = { ...m };
                                              delete next[id];
                                              return next;
                                            });
                                            clearUndoTimer(id);
                                          }, remaining);
                                        }
                                      }
                                    }
                                  }}
                                >
                                  <option value="">Uncategorized</option>
                                  {categories.map((c) => (
                                    <option key={String(c.id)} value={String(c.id)}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>

                                {pendingIds[id] ? (
                                  <span className="inline-flex items-center" title="Applying…">
                                    <Loader2 className="h-3 w-3 text-slate-400 animate-spin" />
                                  </span>
                                ) : null}

                                {failMsg ? <span className="text-[11px] text-red-600">Failed</span> : null}

                                {aiAppliedById[id] ? (
                                  <span className="h-5 px-1.5 rounded-full border border-primary/20 bg-primary/10 text-primary text-[10px] inline-flex items-center">
                                    AI
                                  </span>
                                ) : null}

                                {undoByEntryId[id] && Date.now() < (undoByEntryId[id]?.expiresAt ?? 0) ? (
                                  <button
                                    type="button"
                                    className="h-5 px-1.5 rounded-full border border-primary/20 bg-white text-primary text-[10px] inline-flex items-center hover:bg-primary/10 disabled:opacity-60"
                                    disabled={!!pendingIds[id]}
                                    onClick={async () => {
                                      if (pendingIds[id]) return;
                                      const snapAi = !!aiAppliedById[id];
                                      const snapUndo = undoByEntryId[id] ?? null;
                                      if (!snapUndo) return;

                                      clearMutErr();

                                      try {
                                        await applyCategoryToEntry(id, snapUndo.prevCategoryId);

                                        setUndoByEntryId((m) => {
                                          const next = { ...m };
                                          delete next[id];
                                          return next;
                                        });
                                        clearUndoTimer(id);

                                        if (snapAi) {
                                          setAiAppliedById((m) => {
                                            const next = { ...m };
                                            delete next[id];
                                            return next;
                                          });
                                        }
                                      } catch {
                                        if (snapAi) setAiAppliedById((m) => ({ ...m, [id]: true }));
                                        if (snapUndo) {
                                          setUndoByEntryId((m) => ({ ...m, [id]: snapUndo }));
                                        }
                                      }
                                    }}
                                  >
                                    Undo
                                  </button>
                                ) : null}

                                {!e.category_id ? (
                                  <div className="flex min-w-0 items-center gap-1 overflow-hidden flex-wrap">
                                    {(() => {
                                      const list = (sugByEntryId[String(e.id)] ?? []).slice(0, 3);
                                      const top = list.slice(0, 2);
                                      const more = Math.max(0, list.length - top.length);

                                      return (
                                        <>
                                          {top.map((s: any, idx: number) => {
                                            const catId = String(s?.category_id ?? s?.categoryId ?? "");
                                            const name = String(
                                              s?.category_name ??
                                              s?.categoryName ??
                                              categoryNameById[String(s?.category_id ?? s?.categoryId ?? "")] ??
                                              "—"
                                            );
                                            const conf = categorySuggestionConfidence(s?.confidence);
                                            const tierLabel = categorySuggestionTierLabel(s?.confidence_tier);
                                            const sourceLabel = categorySuggestionSourceLabel(s?.source);
                                            const reasonText = String(s?.reason ?? "").trim();
                                            const buttonTone = categorySuggestionButtonClass(s?.confidence_tier, idx === 0);

                                            return (
                                              <div key={`${id}:${catId || name}:${idx}`} className="flex items-center gap-1">
                                                <button
                                                  type="button"
                                                  className={`h-5 px-1.5 rounded-full border text-[10px] inline-flex items-center gap-1 disabled:opacity-60 ${buttonTone}`}
                                                  title={[tierLabel, sourceLabel, reasonText].filter(Boolean).join(" • ")}
                                                  disabled={!!pendingIds[id]}
                                                  onClick={async () => {
                                                    if (!catId) return;
                                                    if (!selectedBusinessId || !selectedAccountId) return;
                                                    if (pendingIds[id]) return;

                                                    clearMutErr();
                                                    const prevCategoryId = e.category_id ? String(e.category_id) : null;

                                                    try {
                                                      await applyCategoryToEntry(id, catId, catId);
                                                      const isAiSuggestion = String(s?.source ?? "").trim().toUpperCase() === "AI";
                                                      setAiAppliedById((m) => {
                                                        const next = { ...m };
                                                        if (isAiSuggestion) next[id] = true;
                                                        else delete next[id];
                                                        return next;
                                                      });
                                                      setUndoWindow(id, prevCategoryId, catId);
                                                    } catch {}
                                                  }}
                                                >
                                                  <span className="font-semibold truncate max-w-[88px]">{name}</span>
                                                  <span>{conf}%</span>
                                                </button>

                                                <button
                                                  type="button"
                                                  className="h-5 px-1.5 rounded-full border border-slate-200 bg-white text-slate-600 text-[10px] inline-flex items-center hover:bg-slate-50 disabled:opacity-60"
                                                  disabled={!!pendingIds[id] || whyBusy}
                                                  onClick={() => void runWhy(id)}
                                                >
                                                  Why?
                                                </button>
                                              </div>
                                            );
                                          })}

                                          {top[0] ? (
                                            <div className="min-w-0 basis-full break-words text-[10px] text-slate-500">
                                              {categorySuggestionTierLabel(top[0]?.confidence_tier)}
                                              {" • "}
                                              {categorySuggestionSourceLabel(top[0]?.source)}
                                              {String(top[0]?.reason ?? "").trim()
                                                ? ` • ${String(top[0]?.reason ?? "").trim()}`
                                                : ""}
                                            </div>
                                          ) : null}

                                          {more > 0 ? <span className="text-[10px] text-slate-400">+{more}</span> : null}
                                          {sugLoading && !list.length ? <span className="h-4 w-16 rounded-full bg-slate-100 animate-pulse" /> : null}
                                          {!sugLoading && suggestionsQ.error && !list.length ? (
                                            <div className="inline-flex items-center gap-2 min-w-0">
                                              <span className="text-[10px] text-slate-500">Category suggestions unavailable</span>
                                              <button
                                                type="button"
                                                className="text-[10px] text-primary hover:underline"
                                                onClick={() => void suggestionsQ.refetch()}
                                              >
                                                Retry
                                              </button>
                                            </div>
                                          ) : null}
                                          {!sugLoading && !suggestionsQ.error && !list.length ? (
                                            <span className="text-[10px] text-slate-400">No category suggestions</span>
                                          ) : null}
                                        </>
                                      );
                                    })()}
                                  </div>
                                ) : null}

                                {whyEntryId === id ? (
                                  <div className="mt-1 w-full rounded-md border border-slate-200 bg-white p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-[11px] font-semibold text-slate-700">AI explanation</div>
                                      <button
                                        type="button"
                                        className="text-[11px] text-slate-500 hover:text-slate-900"
                                        onClick={() => {
                                          setWhyEntryId(null);
                                          setWhyText(null);
                                          setWhyErr(null);
                                        }}
                                      >
                                        Close
                                      </button>
                                    </div>

                                    {whyBusy && !whyText ? (
                                      <div className="mt-2 space-y-2">
                                        <div className="h-4 w-2/3 rounded bg-slate-200 animate-pulse" />
                                        <div className="h-4 w-full rounded bg-slate-200 animate-pulse" />
                                        <div className="h-4 w-5/6 rounded bg-slate-200 animate-pulse" />
                                      </div>
                                    ) : whyErr ? (
                                      <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900">
                                        {whyErr}
                                      </div>
                                    ) : (
                                      <div className="mt-2 text-[11px] text-slate-700 whitespace-pre-wrap">{whyText ?? ""}</div>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <AppDialog
            open={applyOpen}
            onClose={() => {
              if (applyBusy) return;
              setApplyOpen(false);
            }}
            title="Auto Fix Categories"
            size="lg"
            footer={
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={() => setApplyOpen(false)} disabled={applyBusy}>
                  Cancel
                </Button>

                <BusyButton
                  variant="primary"
                  size="md"
                  busy={applyBusy}
                  busyLabel="Applying…"
                  disabled={applyBusy || selectedApplyItems.length === 0}
                  onClick={async () => {
                    if (!selectedBusinessId || !selectedAccountId) return;

                    setApplyBusy(true);
                    clearMutErr();

                    try {
                      const res: any = await applyCategoryBatch({
                        businessId: selectedBusinessId,
                        accountId: selectedAccountId,
                        items: selectedApplyItems,
                      });

                      const applied = Number(res?.applied ?? 0) || 0;
                      const blocked = Number(res?.blocked ?? 0) || 0;

                      setApplySummary({ applied, blocked });

                      const results = Array.isArray(res?.results) ? res.results : [];
                      const successIds = new Set<string>();

                      for (const r of results) {
                        const id = String(r?.entryId ?? "");
                        if (!id) continue;
                        if (r?.ok === true) successIds.add(id);
                      }

                      setSelectedSuggestionByEntryId((prev) => {
                        const next = { ...prev };
                        for (const id of Array.from(successIds)) {
                          delete next[id];
                        }
                        return next;
                      });

                      setSelectedIds((prev) => {
                        const next = new Set(Array.from(prev));
                        for (const id of Array.from(successIds)) {
                          next.delete(id);
                        }
                        return next;
                      });

                      await entriesQ.refetch?.();
                      await qc.invalidateQueries({ queryKey: ["aiCategorySuggestions", selectedBusinessId, selectedAccountId], exact: false });
                      await qc.invalidateQueries({ queryKey: ["entries", selectedBusinessId, selectedAccountId], exact: false });
                      await qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false });
                      await qc.invalidateQueries({ queryKey: ["ledgerSummary", selectedBusinessId, selectedAccountId], exact: false });

                      if (typeof window !== "undefined") {
                        window.dispatchEvent(new CustomEvent("bynk:ledger-refresh-now"));
                      }

                      setApplyOpen(false);
                    } catch (e: any) {
                      applyMutationError(e, "Can’t apply suggestions");
                    } finally {
                      setApplyBusy(false);
                    }
                  }}
                >
                  {`Apply ${selectedApplyItems.length} categor${selectedApplyItems.length === 1 ? "y" : "ies"}`}
                </BusyButton>
              </div>
            }
          >
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 sm:grid-cols-4">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Selected</div>
                  <div className="mt-0.5 text-lg font-semibold text-slate-900">{autoFixRows.length}</div>
                </div>

                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Ready</div>
                  <div className="mt-0.5 text-lg font-semibold text-slate-900">{selectedApplyItems.length}</div>
                </div>

                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Review needed</div>
                  <div className="mt-0.5 text-lg font-semibold text-slate-900">{autoFixReviewNeededCount}</div>
                </div>

                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Total amount</div>
                  <div className="mt-0.5 text-lg font-semibold text-slate-900">
                    {formatUsdAccountingFromCents(autoFixTotalAmountCents)}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-600">
                Suggested categories are grouped for review. Entries without a strong top suggestion stay unassigned for manual review.
              </div>

              <div className="h-[320px] overflow-auto rounded-lg border border-slate-200">
                {autoFixGroups.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-slate-500">
                    No selected rows available for auto-fix.
                  </div>
                ) : (
                  <div className="min-w-[420px] divide-y divide-slate-200">
                    {autoFixGroups.map((group) => {
                      const isExpanded = !!expandedAutoFixGroups[group.groupKey];

                      return (
                        <div key={group.groupKey} className="bg-white">
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-slate-50"
                            onClick={() => toggleAutoFixGroup(group.groupKey)}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="text-sm leading-none text-slate-400">
                                {isExpanded ? "⌄" : "›"}
                              </div>

                              <div className="truncate text-sm font-semibold text-slate-900">
                                {group.categoryName}
                              </div>

                              <span className="inline-flex min-w-[24px] items-center justify-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                                {group.count}
                              </span>
                            </div>

                            <div className="shrink-0 text-right text-sm font-semibold text-slate-900">
                              {formatUsdAccountingFromCents(group.totalAmountCents)}
                            </div>
                          </button>

                          {isExpanded ? (
                            <div className="border-t border-slate-200 bg-slate-50/40">
                              {group.rows.map((row) => {
                                const e = row.entry;
                                const id = String(e.id);
                                const top = row.suggestions[0] ?? null;
                                const topReason = String(top?.reason ?? "").trim();
                                const topTierLabel = categorySuggestionTierLabel(top?.confidence_tier);
                                const topSourceLabel = categorySuggestionSourceLabel(top?.source);
                                const topConfidence = categorySuggestionConfidence(top?.confidence);

                                return (
                                  <div
                                    key={id}
                                    className="grid grid-cols-[minmax(0,1.5fr)_100px_170px] items-start gap-3 border-b border-slate-200 px-3 py-2.5 last:border-b-0"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-xs font-medium text-slate-900">
                                        {String(e.payee ?? "—")}
                                      </div>
                                      <div className="mt-0.5 text-[10px] text-slate-500">
                                        {String(e.date ?? "").slice(0, 10)}
                                      </div>
                                      {top ? (
                                        <div className="mt-1 text-[10px] text-slate-500">
                                          {topTierLabel} • {topSourceLabel} • {topConfidence}%
                                        </div>
                                      ) : null}
                                      {topReason ? (
                                        <div className="mt-1 text-[10px] text-slate-500">
                                          {topReason}
                                        </div>
                                      ) : null}
                                    </div>

                                    <div className="pt-0.5 text-right text-xs font-semibold text-slate-900">
                                      {formatUsdAccountingFromCents(e.amount_cents)}
                                    </div>

                                    <div>
                                      <select
                                        className="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px]"
                                        value={row.selectedCategoryId}
                                        onChange={(ev) => {
                                          const nextValue = String(ev.target.value ?? "");
                                          setSelectedSuggestionByEntryId((prev) => ({
                                            ...prev,
                                            [id]: nextValue,
                                          }));
                                        }}
                                      >
                                        <option value="">Choose category…</option>
                                        {categories.map((c) => (
                                          <option key={c.id} value={c.id}>
                                            {c.name}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </AppDialog>
        </CardContent>
      </Card>
    </div>
  );
}
