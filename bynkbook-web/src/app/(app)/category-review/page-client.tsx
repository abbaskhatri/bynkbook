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
import { applyCategoryBatch, aiSuggestCategory, aiExplainEntry, aiMerchantNormalize, getCategorySuggestions } from "@/lib/api/ai";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { LedgerTableShell } from "@/components/ledger/ledger-table-shell";
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

  const merchantCacheRef = useRef<Record<string, { merchant: string; confidence: number; reason: string }>>({});
  const [merchantBusyId, setMerchantBusyId] = useState<string | null>(null);
  const [merchantErrByEntryId, setMerchantErrByEntryId] = useState<Record<string, "429" | "ERR">>({});
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

      let res: any = null;

      // Prefer LLM endpoint (Bundle E). Fallback to heuristic endpoint if unavailable.
      try {
        res = await aiSuggestCategory({
          businessId: selectedBusinessId,
          accountId: selectedAccountId,
          items: suggestionTargets,
          limitPerItem: 3,
        });
      } catch {
        res = null;
      }

      const aiLooksEmpty = (() => {
        if (!res?.ok) return true;
        const byId = res?.suggestionsById;
        if (!byId || typeof byId !== "object") return true;

        for (const it of suggestionTargets) {
          const arr = byId?.[it.id];
          if (Array.isArray(arr) && arr.length > 0) return false;
        }
        return true;
      })();

      if (aiLooksEmpty) {
        res = await getCategorySuggestions({
          businessId: selectedBusinessId,
          accountId: selectedAccountId,
          items: suggestionTargets,
          limitPerItem: 3,
        });
      }

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
  }

  // Bulk apply state + confirm
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("__NONE__");
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Per-row status
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [failedById, setFailedById] = useState<Record<string, string>>({});

  const tableUpdating =
    (entriesQ.isFetching && !!(entriesQ.data ?? []).length) ||
    sugUpdating ||
    whyBusy ||
    applyBusy ||
    Object.keys(pendingIds).length > 0;

  // F7a (session-local): AI attribution + undo (suggestion-pill applies only; dropdown does NOT set AI)
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

  async function applyCategoryToEntry(entryId: string, categoryId: string | null) {
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
        updates: { category_id: categoryId },
      });

      // Refresh all ledger/account entry surfaces immediately.
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

  async function getMerchant(entryId: string, payee: string, memo?: string) {
    const cached = merchantCacheRef.current[entryId];
    if (cached) return cached;

    if (!selectedBusinessId) return null;

    setMerchantBusyId(entryId);
    setMerchantErrByEntryId((m) => {
      const next = { ...m };
      delete next[entryId];
      return next;
    });

    try {
      const res: any = await aiMerchantNormalize({ businessId: selectedBusinessId, payee, memo: memo ?? "" });
      if (!res?.ok) throw new Error(res?.error || "Merchant detect failed");

      const out = {
        merchant: String(res.merchant ?? "").trim(),
        confidence: Number(res.confidence ?? 0),
        reason: String(res.reason ?? "").trim(),
      };

      if (out.merchant) merchantCacheRef.current[entryId] = out;
      return out;
    } catch (e: any) {
      const msg = String(e?.message ?? "Merchant detect failed");
      setMerchantErrByEntryId((m) => ({
        ...m,
        [entryId]: msg.includes("429") ? "429" : "ERR",
      }));
      return null;
    } finally {
      setMerchantBusyId(null);
    }
  }

  async function applyMerchant(entryId: string, merchant: string) {
    if (!selectedBusinessId || !selectedAccountId) return;

    // Suggestion-only: apply only on explicit click (writes through existing entry update API)
    setPendingIds((m) => ({ ...m, [entryId]: true }));
    setFailedById((m) => {
      const next = { ...m };
      delete next[entryId];
      return next;
    });

    try {
      await updateEntry({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        entryId,
        updates: { payee: merchant },
      });

      await qc.invalidateQueries({ queryKey: ["entries", selectedBusinessId, selectedAccountId], exact: false });
      await qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false });
      await qc.invalidateQueries({ queryKey: ["ledgerSummary", selectedBusinessId, selectedAccountId], exact: false });

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bynk:ledger-refresh-now"));
      }
    } catch (e: any) {
      const r = applyMutationError(e, "Can’t apply merchant");
      if (!r.isClosed) setFailedById((m) => ({ ...m, [entryId]: r.msg }));
    } finally {
      setPendingIds((m) => {
        const next = { ...m };
        delete next[entryId];
        return next;
      });
    }
  }

  async function applySelectedConfirmed() {
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

    setConfirmOpen(false);

    const remaining = ids.filter((id) => !successes.has(id)); // failures stay selected
    if (remaining.length === 0) {
      clearMutErr();
      clearSelection();
      return;
    }

    setSelectedIds(new Set(remaining));
  }

  // Auth handled by AppShell
  const selectedApplyItems = useMemo(() => {
    const out: Array<{ entryId: string; category_id: string }> = [];
    for (const [entryId, category_id] of Object.entries(selectedSuggestionByEntryId)) {
      if (!category_id) continue;
      out.push({ entryId, category_id });
    }
    return out.slice(0, 200);
  }, [selectedSuggestionByEntryId]);
  return (
    <div className="flex h-[calc(100vh-96px)] flex-col gap-4 max-w-6xl overflow-hidden">
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
      <Card className="flex min-h-0 flex-1 flex-col">
        <CHeader className="shrink-0 pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="inline-flex items-center gap-2">
              Uncategorized
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-primary/10 px-1.5 text-[11px] font-semibold text-primary border border-primary/20">
                {visibleRows.length}
              </span>
              {sugUpdating ? <span className="text-[11px] text-slate-500">Updating…</span> : null}
            </CardTitle>
          </div>
        </CHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
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
            <div className="relative h-full min-h-0 flex-1 rounded-lg border border-slate-200 overflow-hidden">
              {tableUpdating ? <UpdatingOverlay /> : null}
              <div className={`h-full min-h-0 ${tableUpdating ? "pointer-events-none select-none blur-[1px]" : ""}`}>
                <div className="h-full min-h-0">
                  <LedgerTableShell scrollMode="auto"
                  colgroup={
                    <>
                      <col style={{ width: 36 }} />
                      <col style={{ width: 98 }} />
                      <col />
                      <col style={{ width: 120 }} />
                      <col style={{ width: 360 }} />
                    </>
                  }
                  header={
                    <tr className="h-7">
                    <th className="px-0 text-center align-middle">
                      <div className="flex h-7 items-center justify-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={allVisibleSelected}
                          onChange={toggleSelectAllVisible}
                        />
                      </div>
                    </th>
                    <th className="px-2 text-left text-[10px] font-semibold text-slate-600">Date</th>
                    <th className="px-2 text-left text-[10px] font-semibold text-slate-600">Payee</th>
                    <th className="px-2 text-right text-[10px] font-semibold text-slate-600">Amount</th>
                    <th className="px-2 text-left text-[10px] font-semibold text-slate-600">Category</th>
                  </tr>
                }
                addRow={null}
                body={
                  <>
                    {visibleRows.map((e: any) => {
                      const id = String(e.id);
                      const payee = String(e.payee ?? "");
                      const dateYmd = String(e.date ?? "").slice(0, 10);
                      const failMsg = failedById[id];
                      const isSelected = selectedIds.has(id);
                      const typeUpper = String(e.type ?? "").toUpperCase();
                      const payeeLower = String(e.payee ?? "").trim().toLowerCase();
                      const isOpening = typeUpper === "OPENING" || payeeLower.startsWith("opening balance");
                      const categoryLabel = e.category_id
                        ? (categoryNameById[String(e.category_id)] ?? "Unknown category")
                        : "Uncategorized";

                      return (
                        <tr key={id} className={`h-7 border-b border-slate-100 ${isSelected ? "bg-accent" : ""}`}>
                          <td className="px-0 text-center align-middle">
                            <div className="flex h-7 items-center justify-center">
                              <input
                                type="checkbox"
                                className="h-4 w-4"
                                checked={isSelected}
                                onChange={() => toggleRow(id)}
                              />
                            </div>
                          </td>

                          <td className="px-2 text-xs text-slate-700 whitespace-nowrap">{dateYmd}</td>

                          <td className="px-2">
                            <div className="flex flex-col min-w-0">
                              <div className="text-xs text-slate-900 truncate font-medium">{payee}</div>

                              {(() => {
                                const memo = String(e.memo ?? "");
                                const looksNoisy = /[#\d]{2,}|(POS|WEB|ACH|DEBIT|CREDIT)/i.test(payee) && payee.length >= 8;
                                if (!looksNoisy) return null;

                                const cached = merchantCacheRef.current[id] ?? null;
                                const merchantErr = merchantErrByEntryId[id] ?? null;

                                if (merchantErr === "429") {
                                  return <div className="mt-0.5 text-[11px] text-amber-700">AI limit reached. Merchant suggestion unavailable.</div>;
                                }

                                if (merchantErr === "ERR") {
                                  return <div className="mt-0.5 text-[11px] text-slate-500">AI merchant suggestion unavailable right now.</div>;
                                }

                                return (
                                  <div className="mt-0.5 flex items-center gap-2">
                                    {cached ? (
                                      <>
                                        <div className="text-[11px] text-slate-600">
                                          Merchant detected: <span className="font-semibold text-slate-900">{cached.merchant}</span>
                                          <span className="text-slate-400"> • {Math.round((cached.confidence || 0) * 100)}%</span>
                                        </div>

                                        <button
                                          type="button"
                                          className="h-6 px-2 rounded-md border border-slate-200 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                                          disabled={!!pendingIds[id]}
                                          onClick={() => void applyMerchant(id, cached.merchant)}
                                        >
                                          Apply
                                        </button>
                                      </>
                                    ) : merchantBusyId === id ? (
                                      <div className="h-3 w-44 rounded bg-slate-200 animate-pulse" />
                                    ) : (
                                      <button
                                        type="button"
                                        className="text-[11px] text-slate-600 hover:text-slate-900 underline"
                                        onClick={() => void getMerchant(id, payee, memo)}
                                      >
                                        Detect merchant
                                      </button>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </td>

                          <td
                            className={`px-2 text-xs text-right tabular-nums ${Number(e.amount_cents) < 0 ? "text-red-700" : "text-slate-900"
                              }`}
                          >
                            {formatUsdAccountingFromCents(e.amount_cents)}
                          </td>

                          <td className="px-2">
                            <div className="flex items-center justify-start gap-1.5">
                              {null}

                              {/* Per-row category dropdown (applies immediately on change) */}
                              <select
                                className="h-6 max-w-[220px] rounded-md border border-slate-200 bg-white px-2 text-[11px]"
                                value={isOpening ? "" : (e.category_id ? String(e.category_id) : "")}
                                disabled={isOpening || !!pendingIds[id]}
                                onChange={async (ev) => {
                                  if (isOpening) return;
                                  if (!selectedBusinessId || !selectedAccountId) return;

                                  const v = ev.target.value;
                                  const nextCategoryId = v ? v : null;

                                  // Prevent double-submit while row is applying
                                  if (pendingIds[id]) return;

                                  // Guardrail: never send an archived/invalid category id (prevents 400 Invalid category)
                                  if (nextCategoryId && !categoryNameById[String(nextCategoryId)]) {
                                    setFailedById((m) => ({ ...m, [id]: "Category is archived or invalid. Refresh categories." }));
                                    return;
                                  }

                                  clearMutErr();

                                  // Manual override should NOT be attributed to AI.
                                  // If it fails, restore prior session-local AI/undo state.
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
                                    await applyCategoryToEntry(id, nextCategoryId);
                                  } catch {
                                    // applyCategoryToEntry handles rollback + CLOSED_PERIOD banner + row failure state
                                    // Restore session-local state if the manual change failed.
                                    if (hadAi) setAiAppliedById((m) => ({ ...m, [id]: true }));
                                    if (undoSnap) {
                                      setUndoByEntryId((m) => ({ ...m, [id]: undoSnap }));
                                      // restore timer with remaining time (best-effort)
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

                              {/* Row-level pending spinner */}
                              {pendingIds[id] ? (
                                <span className="inline-flex items-center" title="Applying…">
                                  <Loader2 className="h-3 w-3 text-slate-400 animate-spin" />
                                </span>
                              ) : null}

                              {failMsg ? <span className="text-[11px] text-red-600">Failed</span> : null}

                              {/* F7a: session-local AI attribution + Undo (only for suggestion-pill applies) */}
                              {aiAppliedById[id] ? (
                                <span
                                  className="h-5 px-1.5 rounded-full border border-primary/20 bg-primary/10 text-primary text-[10px] inline-flex items-center"
                                  title="Applied via AI suggestion"
                                >
                                  AI
                                </span>
                              ) : null}

                              {undoByEntryId[id] && Date.now() < (undoByEntryId[id]?.expiresAt ?? 0) ? (
                                <button
                                  type="button"
                                  className="h-5 px-1.5 rounded-full border border-primary/20 bg-white text-primary text-[10px] inline-flex items-center hover:bg-primary/10 disabled:opacity-60"
                                  title="Undo"
                                  disabled={!!pendingIds[id]}
                                  onClick={async () => {
                                    if (pendingIds[id]) return;

                                    const snapAi = !!aiAppliedById[id];
                                    const snapUndo = undoByEntryId[id] ?? null;
                                    if (!snapUndo) return;

                                    clearMutErr();

                                    try {
                                      await applyCategoryToEntry(id, snapUndo.prevCategoryId);

                                      // Guardrail: clear undo state only on SUCCESS
                                      setUndoByEntryId((m) => {
                                        const next = { ...m };
                                        delete next[id];
                                        return next;
                                      });
                                      clearUndoTimer(id);

                                      // Since undo is a manual action, remove AI attribution on success
                                      if (snapAi) {
                                        setAiAppliedById((m) => {
                                          const next = { ...m };
                                          delete next[id];
                                          return next;
                                        });
                                      }
                                    } catch {
                                      // Guardrail: restore undo state if undo fails
                                      if (snapAi) setAiAppliedById((m) => ({ ...m, [id]: true }));
                                      if (snapUndo) {
                                        setUndoByEntryId((m) => ({ ...m, [id]: snapUndo }));
                                        const remaining = Math.max(0, (snapUndo.expiresAt ?? 0) - Date.now());
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
                                  Undo
                                </button>
                              ) : null}

                              {/* Compact suggestions (top 2 + +more); click applies immediately */}
                              {!e.category_id ? (
                                <div className="flex items-center gap-1 overflow-hidden">
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
                                          const conf = Math.round((Number(s?.confidence ?? 0) || 0) * 100);

                                          return (
                                            <div key={`${id}:${catId || name}:${idx}`} className="flex items-center gap-1">
                                              <button
                                                type="button"
                                                className="h-5 px-1.5 rounded-full border border-primary/20 bg-primary/10 text-primary text-[10px] inline-flex items-center gap-1 hover:bg-primary/15 disabled:opacity-60"
                                                title={String(s?.reason ?? "")}
                                                disabled={!!pendingIds[id]}
                                                onClick={async () => {
                                                  if (!catId) return;

                                                  // Auto-apply immediately (explicit click on suggestion)
                                                  if (!selectedBusinessId || !selectedAccountId) return;

                                                  // Prevent double-submit
                                                  if (pendingIds[id]) return;

                                                  clearMutErr();

                                                  // Snapshot previous category for undo (session-local)
                                                  const prevCategoryId = e.category_id ? String(e.category_id) : null;

                                                  try {
                                                    await applyCategoryToEntry(id, catId);

                                                    // SUCCESS: mark AI attribution + start undo window (10s)
                                                    setAiAppliedById((m) => ({ ...m, [id]: true }));
                                                    setUndoWindow(id, prevCategoryId, catId);
                                                  } catch {
                                                    // applyCategoryToEntry handles rollback + CLOSED_PERIOD banner + row failure state
                                                  }
                                                }}
                                              >
                                                <span className="font-semibold truncate max-w-[88px]">{name}</span>
                                                <span className="text-primary">{conf}%</span>
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

                                        {more > 0 ? <span className="text-[10px] text-slate-400">+{more}</span> : null}
                                        {sugLoading && !list.length ? (
                                          <span className="inline-flex items-center gap-1">
                                            <span className="h-4 w-16 rounded-full bg-slate-100 animate-pulse" />
                                          </span>
                                        ) : null}

                                        {!sugLoading && suggestionsQ.error && !list.length ? (
                                          <div className="inline-flex items-center gap-2 min-w-0">
                                            <span className="text-[10px] text-slate-500">AI suggestions unavailable</span>
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
                                          <span className="text-[10px] text-slate-400">No AI suggestions</span>
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

                                  {whyBusy && whyText ? <div className="mt-1 text-[11px] text-slate-500">Updating…</div> : null}
                                </div>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </>
                }
                  footer={null}
                />
                </div>
              </div>
            </div>
          )}

          {/* Reserve space so sticky bar doesn't cover last row */}
          {selectedCount > 0 ? <div className="h-12" /> : null}

          {/* Sticky bulk action bar */}
          {selectedCount > 0 ? (
            <div className="sticky bottom-0 z-10 rounded-lg border border-slate-200 bg-white shadow-sm px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-slate-700">
                  <span className="font-medium">{selectedCount}</span> selected
                  {Object.keys(failedById).length ? (
                    <span className="ml-2 text-red-600">• {Object.keys(failedById).length} failed</span>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <BusyButton
                    variant="primary"
                    size="sm"
                    busy={applyBusy}
                    busyLabel="Applying…"
                    disabled={
                      applyBusy ||
                      !Object.keys(selectedSuggestionByEntryId).some((k) => !!selectedSuggestionByEntryId[k])
                    }
                    onClick={() => {
                      setApplySummary(null);
                      setApplyOpen(true);
                    }}
                  >
                    Apply selected suggestions
                  </BusyButton>
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

                  <Button className="h-7 px-3 text-xs" disabled={bulkCategoryId === "__NONE__"} onClick={() => setConfirmOpen(true)}>
                    Apply to selected
                  </Button>

                  <Button variant="outline" className="h-7 px-3 text-xs" onClick={clearSelection}>
                    Clear
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Phase F2: Apply selected suggestions (explicit confirm) */}
          <AppDialog
            open={applyOpen}
            onClose={() => {
              if (applyBusy) return;
              setApplyOpen(false);
            }}
            title="Apply suggestions"
            size="md"
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

                      // Remove successful selections; keep blocked ones so user can retry later
                      const results = Array.isArray(res?.results) ? res.results : [];
                      setSelectedSuggestionByEntryId((prev) => {
                        const next = { ...prev };
                        for (const r of results) {
                          const id = String(r?.entryId ?? "");
                          if (!id) continue;
                          if (r?.ok === true) delete next[id];
                        }
                        return next;
                      });

                      await entriesQ.refetch?.();
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
                  Apply
                </BusyButton>
              </div>
            }
          >
            <div className="text-sm text-slate-700">
              Apply category changes to <span className="font-medium">{selectedApplyItems.length}</span> entries?
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              Entries in closed periods will be blocked and counted separately.
            </div>
          </AppDialog>
        </CardContent>
      </Card>
    </div>
  );
}