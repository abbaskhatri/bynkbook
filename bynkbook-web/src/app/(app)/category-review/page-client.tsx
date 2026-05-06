"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
// Auth is handled by AppShell
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { issueCountKey } from "@/lib/queries/issueKeys";
import { listEntriesPage, updateEntry } from "@/lib/api/entries";
import { listCategories, type CategoryRow } from "@/lib/api/categories";
import { applyCategoryBatch, aiSuggestCategory } from "@/lib/api/ai";
import {
  categorySuggestionConfidenceValue,
  isBulkSafeCategorySuggestion,
} from "@/lib/categorySuggestions";

import { PageHeader } from "@/components/app/page-header";
import { AccountingScopePills } from "@/components/app/accounting-scope-pills";
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
import { CategoryCombobox, type CategoryComboboxOption } from "@/components/categories/category-combobox";

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
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-background/55 backdrop-blur-[1px]">
      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-sm">
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

function categorySuggestionCategoryName(suggestion: any, categoryNameById: Record<string, string>) {
  const categoryId = String(suggestion?.category_id ?? suggestion?.categoryId ?? "").trim();
  return (
    String(suggestion?.category_name ?? suggestion?.categoryName ?? "").trim() ||
    categoryNameById[categoryId] ||
    ""
  );
}

function categorySuggestionReason(suggestion: any) {
  return String(suggestion?.reason ?? "").trim();
}

function hasSuggestionEntry(map: Record<string, any[]>, entryId: string) {
  return Object.prototype.hasOwnProperty.call(map, entryId);
}

function categorySuggestionWhyText(suggestion: any, categoryNameById: Record<string, string>) {
  const categoryId = String(suggestion?.category_id ?? suggestion?.categoryId ?? "").trim();
  const categoryName =
    String(suggestion?.category_name ?? suggestion?.categoryName ?? "").trim() ||
    categoryNameById[categoryId] ||
    "this category";
  const confidence = categorySuggestionConfidence(suggestion?.confidence);
  const tierLabel = categorySuggestionTierLabel(suggestion?.confidence_tier ?? suggestion?.confidenceTier);
  const sourceLabel = categorySuggestionSourceLabel(suggestion?.source);
  const reasonText = String(suggestion?.reason ?? "").trim();
  const merchantNormalized = String(suggestion?.merchant_normalized ?? suggestion?.merchantNormalized ?? "").trim();

  const lines = [
    `Suggested category: ${categoryName}`,
    `Confidence: ${confidence}% (${tierLabel})`,
    `Source: ${sourceLabel}`,
  ];

  if (reasonText) lines.push(`Rationale: ${reasonText}`);
  if (merchantNormalized) lines.push(`Matched merchant key: ${merchantNormalized}`);

  return lines.join("\n");
}

function categorySuggestionButtonClass(rawTier: unknown, isPrimary: boolean) {
  const tier = String(rawTier ?? "").trim().toUpperCase();

  if (tier === "SAFE_DETERMINISTIC" || tier === "STRONG_SUGGESTION") {
    return isPrimary
      ? "border-primary/20 bg-primary/10 text-primary hover:bg-primary/15"
      : "border-border bg-card text-foreground hover:bg-muted/50";
  }

  if (tier === "REVIEW_BUCKET") {
    return "border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg hover:bg-bb-status-warning-bg";
  }

  return "border-border bg-card text-foreground hover:bg-muted/50";
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

  const selectedBusinessName = useMemo(() => {
    const b = (businessesQ.data ?? []).find((row: any) => String(row.id) === String(selectedBusinessId));
    return String(b?.name ?? "Business");
  }, [businessesQ.data, selectedBusinessId]);

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
    if (suggestionsLoadedForCurrentFilters) void suggestionsQ.refetch();
  }

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

  // Entries: backend-filtered, cursor-paged, newest to oldest.
  const entriesPageLimit = 100;
  const entriesKey = useMemo(
    () =>
      [
        "categoryReviewEntries",
        selectedBusinessId,
        selectedAccountId,
        entriesPageLimit,
        applied.from,
        applied.to,
        applied.search.trim(),
        applied.onlyUncategorized,
      ] as const,
    [
      selectedBusinessId,
      selectedAccountId,
      entriesPageLimit,
      applied.from,
      applied.to,
      applied.search,
      applied.onlyUncategorized,
    ]
  );

  const entriesQ = useInfiniteQuery({
    queryKey: entriesKey,
    enabled: !!selectedBusinessId && !!selectedAccountId,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      if (!selectedBusinessId || !selectedAccountId) {
        return Promise.resolve({
          items: [],
          meta: { limit: entriesPageLimit, hasMore: false, nextCursor: null },
        });
      }

      return listEntriesPage({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        limit: entriesPageLimit,
        cursor: typeof pageParam === "string" ? pageParam : null,
        includeDeleted: false,
        type: "EXPENSE,INCOME",
        search: applied.search.trim() || undefined,
        date_from: applied.from || undefined,
        date_to: applied.to || undefined,
        uncategorized: applied.onlyUncategorized,
        excludeOpening: true,
      });
    },
    getNextPageParam: (lastPage) => (lastPage.meta.hasMore ? lastPage.meta.nextCursor ?? undefined : undefined),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });

  const bannerMsg =
    err ||
    appErrorMessageOrNull(businessesQ.error) ||
    appErrorMessageOrNull(accountsQ.error) ||
    null;

  const [whyEntryId, setWhyEntryId] = useState<string | null>(null);
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
  const [manualCategoryByEntryId, setManualCategoryByEntryId] = useState<Record<string, string>>({});
  const [categoryDraftByEntryId, setCategoryDraftByEntryId] = useState<Record<string, string>>({});
  const [suggestionMapByEntryId, setSuggestionMapByEntryId] = useState<Record<string, any[]>>({});
  const [suggestionsRequestedKey, setSuggestionsRequestedKey] = useState<string | null>(null);
  const [suggestionRequestNonce, setSuggestionRequestNonce] = useState(0);

  const [applyOpen, setApplyOpen] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applySummary, setApplySummary] = useState<{
    applied: number;
    blocked: number;
    blockedByCode: Record<string, number>;
  } | null>(null);

  function summarizeApplyResult(res: any) {
    const blockedByCode =
      res?.blockedByCode && typeof res.blockedByCode === "object"
        ? Object.fromEntries(
            Object.entries(res.blockedByCode).map(([code, count]) => [String(code), Number(count) || 0])
          )
        : {};

    if (Object.keys(blockedByCode).length === 0 && Array.isArray(res?.results)) {
      for (const row of res.results) {
        if (row?.ok === true) continue;
        const code = String(row?.code ?? "BLOCKED").trim() || "BLOCKED";
        blockedByCode[code] = (blockedByCode[code] ?? 0) + 1;
      }
    }

    return {
      applied: Number(res?.applied ?? 0) || 0,
      blocked: Number(res?.blocked ?? 0) || 0,
      blockedByCode,
    };
  }

  function applySummaryMessage(summary: { applied: number; blocked: number; blockedByCode: Record<string, number> }) {
    const reasonLabels: Record<string, string> = {
      CLOSED_PERIOD: "closed period",
      INVALID_CATEGORY: "invalid category",
      NOT_FOUND: "entry not found",
      SUGGESTION_UNAVAILABLE: "suggestion unavailable",
      UNSAFE_SUGGESTION: "needs review",
      SUGGESTION_MISMATCH: "suggestion changed",
      UPDATE_FAILED: "update failed",
    };
    const reasons = Object.entries(summary.blockedByCode)
      .filter(([, count]) => count > 0)
      .map(([code, count]) => `${count} ${reasonLabels[code] ?? code.toLowerCase().replace(/_/g, " ")}`);
    const reasonText = reasons.length ? ` Reasons: ${reasons.join(", ")}.` : "";
    return `Applied ${summary.applied}. Blocked ${summary.blocked}.${reasonText}`;
  }

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

  const categoryComboboxOptions = useMemo(() => {
    return categories.map((c) => ({ id: String(c.id), name: c.name }));
  }, [categories]);

  function runFilters() {
    setErr(null);
    setApplied({ from, to, search, onlyUncategorized });
    setSelectedIds(new Set());
    setFailedById({});
    setManualCategoryByEntryId({});
    setCategoryDraftByEntryId({});
    setSelectedSuggestionByEntryId({});
    setSuggestionsRequestedKey(null);
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

  const entriesPages = entriesQ.data?.pages ?? [];
  const allEntries = entriesPages.flatMap((page: any) => (Array.isArray(page?.items) ? page.items : []));

  const entriesMeta = entriesPages[0]?.meta ?? null;
  const lastEntriesMeta = entriesPages[entriesPages.length - 1]?.meta ?? null;
  const totalCount = typeof entriesMeta?.totalCount === "number" ? entriesMeta.totalCount : undefined;
  const hasMoreEntries = !!lastEntriesMeta?.hasMore;

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

  // -------------------------
  // Phase F2: batch suggestions (canonical query key; per-surface retry; no stuck loading)
  // -------------------------
  const suggestionTargets = useMemo(() => {
    return (visibleRows ?? [])
      .filter((r: any) => !r?.category_id)
      .map((r: any) => ({
        kind: "ENTRY" as const,
        id: String(r.id),
        date: String(r.date ?? "").slice(0, 10),
        amount_cents: r.amount_cents,
        payee_or_name: String(r.payee ?? ""),
        memo: String(r.memo ?? ""),
      }));
  }, [visibleRows]);

  const suggestionRequestTargets = useMemo(() => {
    if (!suggestionsRequestedKey) return [];
    const requestedIds = new Set(suggestionsRequestedKey.split("|").filter(Boolean));
    return suggestionTargets.filter((x) => requestedIds.has(x.id));
  }, [suggestionTargets, suggestionsRequestedKey]);

  const missingSuggestionTargets = useMemo(() => {
    return suggestionTargets.filter((x) => !hasSuggestionEntry(suggestionMapByEntryId, x.id));
  }, [suggestionTargets, suggestionMapByEntryId]);

  const suggestionsLoadedForCurrentFilters =
    suggestionTargets.length > 0 && missingSuggestionTargets.length === 0;

  useEffect(() => {
    setSuggestionMapByEntryId({});
    setSuggestionsRequestedKey(null);
    setSelectedSuggestionByEntryId({});
    setManualCategoryByEntryId({});
    setWhyEntryId(null);
    setWhyText(null);
    setWhyErr(null);
  }, [selectedBusinessId, selectedAccountId]);

  const suggestionsQ = useQuery({
    queryKey: [
      "aiCategorySuggestions",
      selectedBusinessId,
      selectedAccountId,
      suggestionsRequestedKey,
      suggestionRequestNonce,
    ],
    enabled:
      !!selectedBusinessId &&
      !!selectedAccountId &&
      !!suggestionsRequestedKey &&
      suggestionRequestTargets.length > 0,

    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,

    queryFn: async () => {
      if (!selectedBusinessId || !selectedAccountId) return {} as Record<string, any[]>;
      if (!suggestionRequestTargets.length) return {} as Record<string, any[]>;

      const res: any = await aiSuggestCategory({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        items: suggestionRequestTargets,
        limitPerItem: 3,
      });

      const next: Record<string, any[]> = {};

      for (const it of suggestionRequestTargets) {
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

  useEffect(() => {
    if (!suggestionsQ.data) return;
    const nextData = suggestionsQ.data as Record<string, any[]>;
    setSuggestionMapByEntryId((prev) => ({ ...prev, ...nextData }));
  }, [suggestionsQ.data]);

  const sugByEntryId = suggestionMapByEntryId;
  const sugLoading = !!suggestionsRequestedKey && suggestionsQ.isFetching && !suggestionsLoadedForCurrentFilters;
  const sugUpdating = !!suggestionsRequestedKey && suggestionsQ.isFetching && suggestionsLoadedForCurrentFilters;

  function loadSuggestionsForCurrentFilters() {
    if (!selectedBusinessId || !selectedAccountId || suggestionTargets.length === 0 || sugLoading || sugUpdating) return;

    clearMutErr();
    setApplySummary(null);

    const requestTargets = (suggestionsLoadedForCurrentFilters ? suggestionTargets : missingSuggestionTargets).slice(0, 200);
    const requestKey = requestTargets.map((x) => x.id).join("|");
    if (!requestKey) return;

    setSuggestionsRequestedKey(requestKey);
    setSuggestionRequestNonce((n) => n + 1);
  }

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
    setManualCategoryByEntryId({});
    setCategoryDraftByEntryId({});
  }

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkCategoryId("__NONE__");
    setFailedById({});
    setSelectedSuggestionByEntryId({});
    setManualCategoryByEntryId({});
    setCategoryDraftByEntryId({});
    setApplyOpen(false);
    setExpandedAutoFixGroups({});
  }, [selectedBusinessId, selectedAccountId]);

  // Bulk apply state + confirm
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("__NONE__");

  // Per-row status
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [failedById, setFailedById] = useState<Record<string, string>>({});

  const tableUpdating =
    (entriesQ.isFetching && !entriesQ.isFetchingNextPage && allEntries.length > 0) ||
    sugUpdating ||
    applyBusy;

  // F7a (session-local): AI badge + undo for suggestion-pill applies only when source is AI.
  const [aiAppliedById, setAiAppliedById] = useState<Record<string, boolean>>({});
  const [undoByEntryId, setUndoByEntryId] = useState<
    Record<string, { prevCategoryId: string | null; nextCategoryId: string | null; expiresAt: number }>
  >({});
  const undoTimerByEntryIdRef = useRef<Record<string, number>>({});

  function updateCategoryReviewEntriesCache(updateRow: (row: any) => any) {
    qc.setQueryData(entriesKey, (current: any) => {
      if (!current || !Array.isArray(current.pages)) return current;

      let totalDelta = 0;
      const pages = current.pages.map((page: any) => {
        const items = Array.isArray(page?.items) ? page.items : [];
        const nextItems = items.map((row: any) => {
          const nextRow = updateRow(row);
          if (applied.onlyUncategorized) {
            const wasUncategorized = !row?.category_id;
            const isUncategorized = !nextRow?.category_id;
            if (wasUncategorized && !isUncategorized) totalDelta -= 1;
            if (!wasUncategorized && isUncategorized) totalDelta += 1;
          }
          return nextRow;
        });
        return { ...page, items: nextItems };
      });

      const nextPages = totalDelta
        ? pages.map((page: any) => {
            const meta = page?.meta;
            if (!meta || typeof meta.totalCount !== "number") return page;
            return {
              ...page,
              meta: {
                ...meta,
                totalCount: Math.max(0, meta.totalCount + totalDelta),
              },
            };
          })
        : pages;

      return { ...current, pages: nextPages };
    });
  }

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

    const prev = allEntries;
    const idx = prev.findIndex((x: any) => String(x.id) === entryId);
    const prevEntry = idx >= 0 ? prev[idx] : null;

    // Patch only after the API succeeds so single-row applies feel immediate without rollback risk.

    try {
      const updatedEntry = await updateEntry({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        entryId,
        updates: {
          category_id: categoryId,
          suggested_category_id: suggestedCategoryId ?? null,
        },
      });

      updateCategoryReviewEntriesCache((row: any) =>
          String(row.id) === entryId
            ? {
                ...row,
                ...updatedEntry,
                category_id: categoryId,
                suggested_category_id: suggestedCategoryId ?? null,
              }
            : row
      );

      if (categoryId) {
        setSelectedIds((prevIds) => {
          const next = new Set(prevIds);
          next.delete(entryId);
          return next;
        });
        setSelectedSuggestionByEntryId((prevMap) => {
          const next = { ...prevMap };
          delete next[entryId];
          return next;
        });
        setManualCategoryByEntryId((prevMap) => {
          const next = { ...prevMap };
          delete next[entryId];
          return next;
        });
      }

      // Keep the row fast locally; refresh dependent surfaces in the background.
      void qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false });
      void qc.invalidateQueries({ queryKey: issueCountKey(selectedBusinessId, selectedAccountId, "OPEN"), exact: false });
      void qc.invalidateQueries({ queryKey: ["ledgerSummary", selectedBusinessId, selectedAccountId], exact: false });

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bynk:ledger-refresh-now"));
      }

    } catch (e: any) {
      // Revert this entry only
      if (idx >= 0 && prevEntry) {
        updateCategoryReviewEntriesCache((row: any) => (String(row.id) === entryId ? prevEntry : row));
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

  async function applyReviewedRowCategory(
    entryId: string,
    categoryId: string | null,
    suggestedCategoryId?: string | null
  ) {
    if (!selectedBusinessId || !selectedAccountId) return;
    if (pendingIds[entryId]) return;

    if (categoryId && !categoryNameById[String(categoryId)]) {
      setFailedById((m) => ({ ...m, [entryId]: "Category is archived or invalid. Refresh categories." }));
      return;
    }

    clearMutErr();

    const hadAi = !!aiAppliedById[entryId];
    const undoSnap = undoByEntryId[entryId] ?? null;

    if (hadAi) {
      setAiAppliedById((m) => {
        const next = { ...m };
        delete next[entryId];
        return next;
      });
    }
    if (undoSnap) {
      setUndoByEntryId((m) => {
        const next = { ...m };
        delete next[entryId];
        return next;
      });
      clearUndoTimer(entryId);
    }

    try {
      await applyCategoryToEntry(entryId, categoryId, suggestedCategoryId ?? null);
    } catch {
      if (hadAi) setAiAppliedById((m) => ({ ...m, [entryId]: true }));
      if (undoSnap) {
        setUndoByEntryId((m) => ({ ...m, [entryId]: undoSnap }));
        const remaining = Math.max(0, (undoSnap.expiresAt ?? 0) - Date.now());
        if (remaining > 0) {
          clearUndoTimer(entryId);
          undoTimerByEntryIdRef.current[entryId] = window.setTimeout(() => {
            setUndoByEntryId((m) => {
              if (!m[entryId]) return m;
              const next = { ...m };
              delete next[entryId];
              return next;
            });
            clearUndoTimer(entryId);
          }, remaining);
        }
      }
    } finally {
      setCategoryDraftByEntryId((prev) => {
        const next = { ...prev };
        delete next[entryId];
        return next;
      });
    }
  }

  function runWhy(entryId: string, suggestion: any) {
    setWhyEntryId(entryId);
    setWhyErr(null);
    setWhyText(categorySuggestionWhyText(suggestion, categoryNameById));
  }

  async function runApplySelectedConfirmed() {
    if (bulkCategoryId === "__NONE__") return;

    clearMutErr();

    const categoryId = bulkCategoryId === "__UNCATEGORIZED__" ? null : bulkCategoryId;

    const ids = visibleRows.map((e: any) => String(e.id)).filter((id) => selectedIds.has(id));
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
      const entry = visibleRows.find((e: any) => String(e.id) === entryId);
      if (!entry || entry.category_id) continue;
      if (manualCategoryByEntryId[entryId]) continue;

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
  }, [selectedIds, selectedSuggestionByEntryId, manualCategoryByEntryId, sugByEntryId, visibleRows]);

  const manuallySelectedApplyItems = useMemo(() => {
    const out: Array<{ entryId: string; category_id: string; suggested_category_id?: string }> = [];

    for (const entryId of Array.from(selectedIds)) {
      const category_id = String(manualCategoryByEntryId[entryId] ?? "").trim();
      if (!category_id) continue;

      const entry = visibleRows.find((e: any) => String(e.id) === entryId);
      if (!entry || entry.category_id) continue;
      if (!categoryNameById[category_id]) continue;

      out.push({
        entryId,
        category_id,
      });
    }

    return out.slice(0, 200);
  }, [selectedIds, manualCategoryByEntryId, visibleRows, categoryNameById]);

  const autoFixRows = useMemo(() => {
    return visibleRows
      .filter((e: any) => selectedIds.has(String(e.id)))
      .map((e: any) => {
        const id = String(e.id);
        const suggestions = Array.isArray(sugByEntryId[id]) ? sugByEntryId[id] : [];
        const top = suggestions[0] ?? null;
        const topCategoryId = String(top?.category_id ?? top?.categoryId ?? "").trim();
        const topCategoryName = categorySuggestionCategoryName(top, categoryNameById);
        const bulkSafeTopCategoryId = isBulkSafeCategorySuggestion(top, 0) ? topCategoryId : "";

        return {
          entry: e,
          suggestions,
          topCategoryId,
          topCategoryName,
          selectedCategoryId: String(selectedSuggestionByEntryId[id] ?? bulkSafeTopCategoryId ?? "").trim(),
          manualCategoryId: String(manualCategoryByEntryId[id] ?? "").trim(),
          bulkSafe: !!topCategoryId && isBulkSafeCategorySuggestion(top, 0),
        };
      });
  }, [visibleRows, selectedIds, sugByEntryId, selectedSuggestionByEntryId, manualCategoryByEntryId, categoryNameById]);

  const [expandedAutoFixGroups, setExpandedAutoFixGroups] = useState<Record<string, boolean>>({});

  const autoFixTotalAmountCents = useMemo(() => {
    return autoFixRows.reduce((sum, row) => sum + Number(row.entry?.amount_cents ?? 0), 0);
  }, [autoFixRows]);

  const autoFixReadyCount = selectedApplyItems.length + manuallySelectedApplyItems.length;
  const autoFixReviewNeededCount = Math.max(0, autoFixRows.length - autoFixReadyCount);

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
        readyCount: number;
        reviewCount: number;
        totalAmountCents: number;
        rows: typeof autoFixRows;
      }
    >();

    for (const row of autoFixRows) {
      const suggestedCategoryId = String(row.topCategoryId ?? "").trim();
      const manualCategoryId = String(row.manualCategoryId ?? "").trim();
      const selectedCategoryId = String(row.selectedCategoryId ?? "").trim();
      const categoryId = manualCategoryId || suggestedCategoryId || selectedCategoryId;
      const groupKey = manualCategoryId
        ? `manual:${manualCategoryId}`
        : suggestedCategoryId
          ? `suggested:${suggestedCategoryId}`
          : "__NO_STRONG_SUGGESTION__";
      const categoryName = manualCategoryId
        ? `Selected: ${categoryNameById.get(manualCategoryId) || "Unknown category"}`
        : suggestedCategoryId
          ? row.topCategoryName || categoryNameById.get(suggestedCategoryId) || "Unknown category"
          : "No strong suggestion";
      const rowReady =
        !!manualCategoryId ||
        (!!row.bulkSafe && !!row.selectedCategoryId && row.selectedCategoryId === row.topCategoryId);

      const existing = groupsMap.get(groupKey);
      if (existing) {
        existing.count += 1;
        if (rowReady) existing.readyCount += 1;
        else existing.reviewCount += 1;
        existing.totalAmountCents += Number(row.entry?.amount_cents ?? 0);
        existing.rows.push(row);
      } else {
        groupsMap.set(groupKey, {
          groupKey,
          categoryId,
          categoryName,
          count: 1,
          readyCount: rowReady ? 1 : 0,
          reviewCount: rowReady ? 0 : 1,
          totalAmountCents: Number(row.entry?.amount_cents ?? 0),
          rows: [row],
        });
      }
    }

    return Array.from(groupsMap.values()).sort((a, b) => {
      if (a.groupKey === "__NO_STRONG_SUGGESTION__" && b.groupKey !== "__NO_STRONG_SUGGESTION__") return 1;
      if (b.groupKey === "__NO_STRONG_SUGGESTION__" && a.groupKey !== "__NO_STRONG_SUGGESTION__") return -1;
      if (a.groupKey.startsWith("manual:") && !b.groupKey.startsWith("manual:")) return -1;
      if (b.groupKey.startsWith("manual:") && !a.groupKey.startsWith("manual:")) return 1;
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

    const groupCounts = new Map<string, number>();
    for (const e of visibleRows) {
      const id = String(e.id);
      if (!selectedIds.has(id)) continue;
      const suggestions = Array.isArray(sugByEntryId[id]) ? sugByEntryId[id] : [];
      const top = suggestions[0] ?? null;
      const topCategoryId = String(top?.category_id ?? top?.categoryId ?? "").trim();
      const manualCategoryId = String(manualCategoryByEntryId[id] ?? "").trim();
      const groupKey = manualCategoryId
        ? `manual:${manualCategoryId}`
        : topCategoryId
          ? `suggested:${topCategoryId}`
          : "__NO_STRONG_SUGGESTION__";
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

  async function applyManuallySelectedCategories() {
    if (!selectedBusinessId || !selectedAccountId || manuallySelectedApplyItems.length === 0) return;

    setApplyBusy(true);
    clearMutErr();

    try {
      const res: any = await applyCategoryBatch({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        items: manuallySelectedApplyItems,
      });

      const summary = summarizeApplyResult(res);
      const applied = summary.applied;
      const blocked = summary.blocked;
      const results = Array.isArray(res?.results) ? res.results : [];
      const successIds = new Set<string>();

      for (const r of results) {
        const id = String(r?.entryId ?? "");
        if (!id) continue;
        if (r?.ok === true) successIds.add(id);
      }

      if (successIds.size === 0 && applied === manuallySelectedApplyItems.length && blocked === 0) {
        for (const item of manuallySelectedApplyItems) successIds.add(item.entryId);
      }

      setApplySummary(summary);

      if (successIds.size > 0) {
        updateCategoryReviewEntriesCache((row: any) => {
          const id = String(row.id);
          if (!successIds.has(id)) return row;
          const nextCategoryId = String(manualCategoryByEntryId[id] ?? "").trim();
          return {
            ...row,
            category_id: nextCategoryId || row.category_id,
            category_name: categoryNameById[nextCategoryId] ?? row.category_name ?? null,
          };
        });

        setSelectedSuggestionByEntryId((prev) => {
          const next = { ...prev };
          for (const id of Array.from(successIds)) delete next[id];
          return next;
        });

        setManualCategoryByEntryId((prev) => {
          const next = { ...prev };
          for (const id of Array.from(successIds)) delete next[id];
          return next;
        });

        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of Array.from(successIds)) next.delete(id);
          return next;
        });
      }

      void qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false });
      void qc.invalidateQueries({ queryKey: issueCountKey(selectedBusinessId, selectedAccountId, "OPEN"), exact: false });
      void qc.invalidateQueries({ queryKey: ["ledgerSummary", selectedBusinessId, selectedAccountId], exact: false });

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("bynk:ledger-refresh-now"));
      }

      if (blocked === 0) setApplyOpen(false);
    } catch (e: any) {
      applyMutationError(e, "Can’t apply selected categories");
    } finally {
      setApplyBusy(false);
    }
  }

  const loadedCount = visibleRows.length;
  const resultNoun = applied.onlyUncategorized ? "uncategorized entries" : "entries";
  const filtersActive = !!applied.from || !!applied.to || !!applied.search.trim() || !applied.onlyUncategorized;
  const countStatus = Number.isFinite(totalCount)
    ? `Showing ${loadedCount} of ${totalCount} ${filtersActive ? "matching " : ""}${resultNoun}.`
    : `Showing latest ${loadedCount} ${filtersActive ? "matching " : ""}${resultNoun}.`;
  const paginationStatus = hasMoreEntries ? " Load more to review older rows." : "";
  const filterStatus = filtersActive ? " Filters are applied on the backend." : "";
  const reviewStatusText = `${countStatus}${paginationStatus}${filterStatus}`;
  const suggestionsButtonLabel = sugLoading
    ? "Loading suggestions"
    : suggestionsLoadedForCurrentFilters
      ? "Reload loaded-row suggestions"
      : missingSuggestionTargets.length > 200
        ? "Load next 200 suggestions"
        : "Load suggestions for loaded rows";

  return (
    <div className="flex min-h-0 h-[calc(100vh-96px)] flex-col gap-4 max-w-6xl overflow-hidden">
      {/* Unified header container (match Ledger/Issues) */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<Tags className="h-4 w-4" />}
            title="Category Review"
            afterTitle={
              <AccountingScopePills
                businessName={selectedBusinessName}
                businessLoading={businessesQ.isLoading}
                accountControl={capsule}
              />
            }
            right={null}
          />
        </div>

        <div className="mt-2 h-px bg-border" />

        <div className="px-3 py-2">
          <FilterBar
            left={
              <>
                <div className="space-y-1">
                  <div className="text-[11px] text-muted-foreground">From</div>
                  <div className="w-[160px]">
                    <AppDatePicker value={from} onChange={setFrom} ariaLabel="From date" />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] text-muted-foreground">To</div>
                  <div className="w-[160px]">
                    <AppDatePicker value={to} onChange={setTo} ariaLabel="To date" />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] text-muted-foreground">Search</div>
                  <Input
                    className="h-7 w-[220px] text-xs"
                    placeholder="Payee or memo"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>

                <div className="ml-2 space-y-1">
                  <div className="text-[11px] text-muted-foreground">&nbsp;</div>
                  <div className="h-7 px-2 rounded-md border border-border bg-card flex items-center gap-2">
                    <span className="text-xs text-muted-foreground whitespace-nowrap">Uncategorized only</span>
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
              title="Categories applied"
              message={applySummaryMessage(applySummary)}
              actionLabel={(applySummary.blockedByCode.CLOSED_PERIOD ?? 0) > 0 ? "Go to Close Periods" : null}
              actionHref={
                (applySummary.blockedByCode.CLOSED_PERIOD ?? 0) > 0
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
              {applied.onlyUncategorized ? "Uncategorized" : "Review rows"}
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-md bg-primary/10 px-1.5 text-[11px] font-semibold text-primary border border-primary/20">
                {loadedCount}
              </span>
              {sugUpdating ? <span className="text-[11px] text-muted-foreground">Updating…</span> : null}
            </CardTitle>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="h-7 px-3 text-xs"
                disabled={
                  applyBusy ||
                  sugLoading ||
                  sugUpdating ||
                  entriesQ.isLoading ||
                  suggestionTargets.length === 0 ||
                  !selectedBusinessId ||
                  !selectedAccountId
                }
                onClick={loadSuggestionsForCurrentFilters}
              >
                {sugLoading ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading suggestions
                  </span>
                ) : suggestionsLoadedForCurrentFilters ? (
                  suggestionsButtonLabel
                ) : (
                  suggestionsButtonLabel
                )}
              </Button>

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
                      const suggestions = Array.isArray(sugByEntryId[id]) ? sugByEntryId[id] : [];
                      const top = suggestions[0] ?? null;
                      const topCategoryId = String(top?.category_id ?? top?.categoryId ?? "").trim();
                      const manualCategoryId = String(manualCategoryByEntryId[id] ?? "").trim();
                      const groupKey = manualCategoryId
                        ? `manual:${manualCategoryId}`
                        : topCategoryId
                          ? `suggested:${topCategoryId}`
                          : "__NO_STRONG_SUGGESTION__";
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
                Auto Fix loaded rows
              </Button>

              {selectedCount > 0 ? (
                <>
                  <select
                    className="h-7 rounded-md border border-border bg-card px-2 text-xs"
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
                    Apply to selected loaded rows
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
            <div className="text-sm text-bb-status-danger-fg" role="alert">
              {err}
            </div>
          ) : null}

          {!entriesQ.isLoading ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{reviewStatusText}</span>
              {hasMoreEntries ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  disabled={entriesQ.isFetchingNextPage || applyBusy}
                  onClick={() => void entriesQ.fetchNextPage()}
                >
                  {entriesQ.isFetchingNextPage ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading older rows
                    </span>
                  ) : (
                    "Load more"
                  )}
                </Button>
              ) : null}
            </div>
          ) : null}

          {sugLoading && !sugUpdating ? (
            <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading category suggestions…
            </div>
          ) : null}

          {entriesQ.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : visibleRows.length === 0 ? (
            <div className="text-sm text-muted-foreground">No entries match these filters.</div>
          ) : (
            <div className="relative min-h-0 flex-1 rounded-lg border border-border overflow-hidden bg-card">
              {tableUpdating ? <UpdatingOverlay /> : null}
              <div className={`min-h-0 h-full ${tableUpdating ? "pointer-events-none select-none blur-[1px]" : ""}`}>
                <div className="h-full overflow-auto">
                  <table className="w-full min-w-[860px] table-fixed border-separate border-spacing-0">
                    <colgroup>
                      <col style={{ width: 36 }} />
                      <col style={{ width: 260 }} />
                      <col style={{ width: 112 }} />
                      <col />
                    </colgroup>

                    <thead className="sticky top-0 z-10 bg-card">
                      <tr className="h-7 border-b border-border bg-muted/50">
                        <th className="px-0 text-center align-middle border-b border-border">
                          <div className="flex h-7 items-center justify-center">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={allVisibleSelected}
                              onChange={toggleSelectAllVisible}
                            />
                          </div>
                        </th>
                        <th className="px-2 text-left text-[10px] font-semibold text-muted-foreground border-b border-border">Payee</th>
                        <th className="px-2 text-right text-[10px] font-semibold text-muted-foreground border-b border-border">Amount</th>
                        <th className="px-2 text-left text-[10px] font-semibold text-muted-foreground border-b border-border">Category</th>
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
                        const rowSuggestions = Array.isArray(sugByEntryId[id]) ? sugByEntryId[id] : [];
                        const rowSuggestionsLoaded = hasSuggestionEntry(sugByEntryId, id);
                        const topSuggestion = rowSuggestions[0] ?? null;
                        const topSuggestedCategoryId = String(
                          topSuggestion?.category_id ?? topSuggestion?.categoryId ?? ""
                        ).trim();
                        const topSuggestedCategoryName = categorySuggestionCategoryName(topSuggestion, categoryNameById);
                        const hasTopSuggestion = !e.category_id && !!topSuggestion && !!topSuggestedCategoryId;
                        const topSuggestionIsBulkSafe =
                          hasTopSuggestion && isBulkSafeCategorySuggestion(topSuggestion, 0);
                        const categoryDraft = categoryDraftByEntryId[id];
                        const currentCategoryName =
                          !isOpening && e.category_id
                            ? categoryNameById[String(e.category_id)] || String(e.category_name ?? "")
                            : "";
                        const categoryComboboxValue = categoryDraft ?? currentCategoryName;

                        return (
                          <tr key={id} className={`border-b border-border/60 align-top ${isSelected ? "bg-accent" : ""}`}>
                            <td className="px-0 py-1.5 text-center align-top border-b border-border/60">
                              <div className="flex items-start justify-center pt-0.5">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={isSelected}
                                  onChange={() => toggleRow(id)}
                                />
                              </div>
                            </td>

                            <td className="px-2 py-1.5 border-b border-border/60">
                              <div className="flex min-w-0 flex-col gap-0.5">
                                <div
                                  className="max-h-8 overflow-hidden break-words text-xs font-medium leading-4 text-foreground"
                                  title={payee}
                                >
                                  {payee || "—"}
                                </div>
                                <div className="text-[10px] leading-3 text-muted-foreground tabular-nums">{dateYmd}</div>
                              </div>
                            </td>

                            <td
                              className={`px-2 py-1.5 text-xs text-right tabular-nums whitespace-nowrap border-b border-border/60 ${
                                Number(e.amount_cents) < 0 ? "text-bb-amount-negative" : "text-bb-amount-neutral"
                              }`}
                            >
                              {formatUsdAccountingFromCents(e.amount_cents)}
                            </td>

                            <td className="px-2 py-1.5 border-b border-border/60">
                              <div className="grid min-w-0 grid-cols-[minmax(150px,200px)_minmax(0,1fr)] items-start gap-1.5">
                                <div className="flex min-w-[160px] max-w-[220px] flex-col gap-1">
                                  <CategoryCombobox
                                    options={categoryComboboxOptions}
                                    value={isOpening ? "" : categoryComboboxValue}
                                    placeholder="Uncategorized"
                                    disabled={isOpening || !!pendingIds[id]}
                                    allowClear={!isOpening && !!e.category_id}
                                    inputClassName={`h-6 w-full rounded-md border bg-card px-2 text-[11px] text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 ${
                                      hasTopSuggestion ? "border-bb-status-warning-border ring-1 ring-bb-status-warning-border/40" : "border-border"
                                    }`}
                                    onChange={(value) => {
                                      if (isOpening) return;
                                      setCategoryDraftByEntryId((prev) => {
                                        const next = { ...prev };
                                        if (value) next[id] = value;
                                        else delete next[id];
                                        return next;
                                      });
                                    }}
                                    onSelect={(option: CategoryComboboxOption) => {
                                      const nextCategoryId = option.id ? String(option.id) : null;
                                      void applyReviewedRowCategory(id, nextCategoryId, topSuggestedCategoryId || null);
                                    }}
                                    onClear={() => {
                                      setCategoryDraftByEntryId((prev) => ({ ...prev, [id]: "" }));
                                      void applyReviewedRowCategory(id, null, topSuggestedCategoryId || null);
                                    }}
                                  />

                                  {hasTopSuggestion ? (
                                    <div className="truncate text-[10px] text-muted-foreground">
                                      Suggested: {topSuggestedCategoryName || "category"}
                                    </div>
                                  ) : null}

                                  <div className="flex min-h-5 flex-wrap items-center gap-1">
                                    {pendingIds[id] ? (
                                      <span className="inline-flex items-center" title="Applying…">
                                        <Loader2 className="h-3 w-3 text-muted-foreground/80 animate-spin" />
                                      </span>
                                    ) : null}

                                    {failMsg ? <span className="text-[11px] text-bb-status-danger-fg">Failed</span> : null}

                                    {aiAppliedById[id] ? (
                                      <span className="h-5 px-1.5 rounded-full border border-primary/20 bg-primary/10 text-primary text-[10px] inline-flex items-center">
                                        AI
                                      </span>
                                    ) : null}

                                    {undoByEntryId[id] && Date.now() < (undoByEntryId[id]?.expiresAt ?? 0) ? (
                                      <button
                                        type="button"
                                        className="h-5 px-1.5 rounded-full border border-primary/20 bg-card text-primary text-[10px] inline-flex items-center hover:bg-primary/10 disabled:opacity-60"
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
                                  </div>
                                </div>

                                {!e.category_id ? (
                                  <div className="min-w-0">
                                    {(() => {
                                      const list = rowSuggestions.slice(0, 3);
                                      const top = list[0] ?? null;
                                      const more = Math.max(0, list.length - (top ? 1 : 0));

                                      return (
                                        <>
                                          {top ? (() => {
                                            const s = top;
                                            const catId = String(s?.category_id ?? s?.categoryId ?? "");
                                            const name = categorySuggestionCategoryName(s, categoryNameById) || "—";
                                            const conf = categorySuggestionConfidence(s?.confidence);
                                            const tierLabel = categorySuggestionTierLabel(s?.confidence_tier);
                                            const sourceLabel = categorySuggestionSourceLabel(s?.source);
                                            const reasonText = categorySuggestionReason(s);
                                            const shortReason = reasonText || sourceLabel;
                                            const buttonTone = categorySuggestionButtonClass(s?.confidence_tier, true);
                                            const isPrimaryReviewOnly = !topSuggestionIsBulkSafe;

                                            return (
                                              <div
                                                key={`${id}:${catId || name}:top`}
                                                className={`flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 ${
                                                  isPrimaryReviewOnly
                                                    ? "border-bb-status-warning-border bg-bb-status-warning-bg"
                                                    : "border-primary/20 bg-primary/5"
                                                }`}
                                                title={[tierLabel, sourceLabel, reasonText].filter(Boolean).join(" • ")}
                                              >
                                                <span className="min-w-0 max-w-[150px] truncate text-[10px] font-semibold text-foreground">
                                                  Suggested: {name}
                                                </span>

                                                <span className="shrink-0 rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                                                  {conf}%
                                                </span>

                                                {isPrimaryReviewOnly ? (
                                                  <span className="shrink-0 rounded-full border border-bb-status-warning-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-bb-status-warning-fg">
                                                    Review
                                                  </span>
                                                ) : null}

                                                <span className="hidden min-w-0 max-w-[130px] truncate text-[10px] text-muted-foreground sm:inline">
                                                  {shortReason}
                                                </span>

                                                <div className="ml-auto flex shrink-0 items-center gap-1">
                                                  <button
                                                    type="button"
                                                    className={`h-5 px-1.5 rounded-md border text-[10px] font-semibold inline-flex items-center disabled:opacity-60 ${buttonTone}`}
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
                                                    Use
                                                  </button>

                                                  <button
                                                    type="button"
                                                    className="h-5 px-1.5 rounded-md border border-border bg-card text-muted-foreground text-[10px] inline-flex items-center hover:bg-muted/50 disabled:opacity-60"
                                                    disabled={!!pendingIds[id]}
                                                    onClick={() => runWhy(id, s)}
                                                  >
                                                    Why?
                                                  </button>
                                                </div>
                                              </div>
                                            );
                                          })() : null}

                                          {more > 0 ? <span className="mt-0.5 inline-block text-[10px] text-muted-foreground/80">+{more} more</span> : null}
                                          {!rowSuggestionsLoaded ? (
                                            <span className="text-[10px] text-muted-foreground/80">Suggestions not loaded</span>
                                          ) : null}
                                          {rowSuggestionsLoaded && sugLoading && !list.length ? <span className="h-4 w-16 rounded-full bg-muted animate-pulse" /> : null}
                                          {rowSuggestionsLoaded && !sugLoading && suggestionsQ.error && !list.length ? (
                                            <div className="inline-flex items-center gap-2 min-w-0">
                                              <span className="text-[10px] text-muted-foreground">Category suggestions unavailable</span>
                                              <button
                                                type="button"
                                                className="text-[10px] text-primary hover:underline"
                                                onClick={() => void suggestionsQ.refetch()}
                                              >
                                                Retry
                                              </button>
                                            </div>
                                          ) : null}
                                          {rowSuggestionsLoaded && !sugLoading && !suggestionsQ.error && !list.length ? (
                                            <span className="text-[10px] text-muted-foreground/80">No category suggestions</span>
                                          ) : null}
                                        </>
                                      );
                                    })()}
                                  </div>
                                ) : null}

                                {whyEntryId === id ? (
                                  <div className="col-span-2 mt-1 w-full rounded-md border border-border bg-card p-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <div className="text-[11px] font-semibold text-foreground">Suggestion rationale</div>
                                      <button
                                        type="button"
                                        className="text-[11px] text-muted-foreground hover:text-foreground"
                                        onClick={() => {
                                          setWhyEntryId(null);
                                          setWhyText(null);
                                          setWhyErr(null);
                                        }}
                                      >
                                        Close
                                      </button>
                                    </div>

                                    {whyErr ? (
                                      <div className="mt-2 rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-2 py-1.5 text-[11px] text-bb-status-warning-fg">
                                        {whyErr}
                                      </div>
                                    ) : (
                                      <div className="mt-2 text-[11px] text-foreground whitespace-pre-wrap">{whyText ?? ""}</div>
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
            title="Auto Fix Loaded Rows"
            size="lg"
            footer={
              <div className="flex items-center justify-end gap-2">
                <Button variant="outline" onClick={() => setApplyOpen(false)} disabled={applyBusy}>
                  Cancel
                </Button>

                <BusyButton
                  variant="secondary"
                  size="md"
                  busy={applyBusy}
                  busyLabel="Applying..."
                  disabled={applyBusy || manuallySelectedApplyItems.length === 0}
                  onClick={applyManuallySelectedCategories}
                >
                  {`Apply ${manuallySelectedApplyItems.length} selected categor${manuallySelectedApplyItems.length === 1 ? "y" : "ies"}`}
                </BusyButton>

                <BusyButton
                  variant="primary"
                  size="md"
                  busy={applyBusy}
                  busyLabel="Applying..."
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

                      const summary = summarizeApplyResult(res);
                      const applied = summary.applied;
                      const blocked = summary.blocked;

                      setApplySummary(summary);

                      const results = Array.isArray(res?.results) ? res.results : [];
                      const successIds = new Set<string>();

                      for (const r of results) {
                        const id = String(r?.entryId ?? "");
                        if (!id) continue;
                        if (r?.ok === true) successIds.add(id);
                      }

                      if (successIds.size === 0 && applied === selectedApplyItems.length && blocked === 0) {
                        for (const item of selectedApplyItems) successIds.add(item.entryId);
                      }

                      if (successIds.size > 0) {
                        const categoryByEntryId = new Map(
                          selectedApplyItems.map((item) => [item.entryId, item.category_id])
                        );

                        updateCategoryReviewEntriesCache((row: any) => {
                          const id = String(row.id);
                          if (!successIds.has(id)) return row;
                          const nextCategoryId = String(categoryByEntryId.get(id) ?? "").trim();
                          return {
                            ...row,
                            category_id: nextCategoryId || row.category_id,
                            category_name: categoryNameById[nextCategoryId] ?? row.category_name ?? null,
                            suggested_category_id: nextCategoryId || (row.suggested_category_id ?? null),
                          };
                        });
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

                      void qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false });
                      void qc.invalidateQueries({ queryKey: issueCountKey(selectedBusinessId, selectedAccountId, "OPEN"), exact: false });
                      void qc.invalidateQueries({ queryKey: ["ledgerSummary", selectedBusinessId, selectedAccountId], exact: false });

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
                  {`Auto Fix ${selectedApplyItems.length} categor${selectedApplyItems.length === 1 ? "y" : "ies"}`}
                </BusyButton>
              </div>
            }
          >
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 sm:grid-cols-4">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Selected</div>
                  <div className="mt-0.5 text-lg font-semibold text-foreground">{autoFixRows.length}</div>
                </div>

                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Ready</div>
                  <div className="mt-0.5 text-lg font-semibold text-foreground">{autoFixReadyCount}</div>
                </div>

                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Review needed</div>
                  <div className="mt-0.5 text-lg font-semibold text-foreground">{autoFixReviewNeededCount}</div>
                </div>

                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Total amount</div>
                  <div className="mt-0.5 text-lg font-semibold text-foreground">
                    {formatUsdAccountingFromCents(autoFixTotalAmountCents)}
                  </div>
                </div>
              </div>

              {autoFixReviewNeededCount > 0 ? (
                <div className="rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-3 py-2 text-[11px] text-bb-status-warning-fg">
                  {autoFixReviewNeededCount} need{autoFixReviewNeededCount === 1 ? "s" : ""} review.
                  Auto Fix only uses strong suggestions on loaded selected rows; selected dropdown categories use Apply selected categories.
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  Strong suggestions are ready for loaded selected rows. Selected dropdown categories stay separate.
                </div>
              )}

              <div className="h-[320px] overflow-auto rounded-lg border border-border">
                {autoFixGroups.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No selected rows available for auto-fix.
                  </div>
                ) : (
                  <div className="min-w-[420px] divide-y divide-border">
                    {autoFixGroups.map((group) => {
                      const isExpanded = !!expandedAutoFixGroups[group.groupKey];

                      return (
                        <div key={group.groupKey} className="bg-card">
                          <button
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
                            onClick={() => toggleAutoFixGroup(group.groupKey)}
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <div className="text-sm leading-none text-muted-foreground/80">
                                {isExpanded ? "⌄" : "›"}
                              </div>

                              <div className="truncate text-sm font-semibold text-foreground">
                                {group.categoryName}
                              </div>

                              <span className="inline-flex min-w-[24px] items-center justify-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground">
                                {group.count}
                              </span>

                              <span className="hidden rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary sm:inline-flex">
                                {group.readyCount} ready
                              </span>

                              {group.reviewCount > 0 ? (
                                <span className="hidden rounded-full border border-bb-status-warning-border bg-bb-status-warning-bg px-2 py-0.5 text-[10px] font-medium text-bb-status-warning-fg sm:inline-flex">
                                  {group.reviewCount} review
                                </span>
                              ) : null}
                            </div>

                            <div className="shrink-0 text-right text-sm font-semibold text-foreground">
                              {formatUsdAccountingFromCents(group.totalAmountCents)}
                            </div>
                          </button>

                          {isExpanded ? (
                            <div className="border-t border-border bg-muted/40">
                              {group.rows.map((row) => {
                                const e = row.entry;
                                const id = String(e.id);
                                const top = row.suggestions[0] ?? null;
                                const topReason = String(top?.reason ?? "").trim();
                                const topTierLabel = categorySuggestionTierLabel(top?.confidence_tier);
                                const topSourceLabel = categorySuggestionSourceLabel(top?.source);
                                const topConfidence = categorySuggestionConfidence(top?.confidence);
                                const topCategoryId = String(top?.category_id ?? top?.categoryId ?? "").trim();
                                const topCategoryName = categorySuggestionCategoryName(top, categoryNameById);
                                const topIsBulkSafe = isBulkSafeCategorySuggestion(top, 0);

                                return (
                                  <div
                                    key={id}
                                    className="grid grid-cols-[minmax(0,1.5fr)_100px_180px] items-start gap-3 border-b border-border px-3 py-2 last:border-b-0"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-xs font-medium text-foreground" title={String(e.payee ?? "")}>
                                        {String(e.payee ?? "—")}
                                      </div>
                                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                                        {String(e.date ?? "").slice(0, 10)}
                                      </div>
                                      {top ? (
                                        <div className="mt-1 text-[10px] text-muted-foreground">
                                          {topTierLabel} • {topSourceLabel} • {topConfidence}%
                                        </div>
                                      ) : null}
                                      {topReason ? (
                                        <div className="mt-1 truncate text-[10px] text-muted-foreground" title={topReason}>
                                          {topReason}
                                        </div>
                                      ) : null}
                                    </div>

                                    <div className="pt-0.5 text-right text-xs font-semibold text-foreground">
                                      {formatUsdAccountingFromCents(e.amount_cents)}
                                    </div>

                                    <div>
                                      <select
                                        className={`h-7 w-full rounded-md border bg-card px-2 text-[11px] ${
                                          topCategoryId ? "border-bb-status-warning-border ring-1 ring-bb-status-warning-border/40" : "border-border"
                                        }`}
                                        value={row.manualCategoryId || row.selectedCategoryId}
                                        onChange={(ev) => {
                                          const nextValue = String(ev.target.value ?? "");
                                          setSelectedSuggestionByEntryId((prev) => ({
                                            ...prev,
                                            [id]: nextValue,
                                          }));
                                          setManualCategoryByEntryId((prev) => {
                                            const next = { ...prev };
                                            if (nextValue) next[id] = nextValue;
                                            else delete next[id];
                                            return next;
                                          });
                                        }}
                                      >
                                        <option value="">Choose category…</option>
                                        {topCategoryId ? (
                                          <option value={topCategoryId}>
                                            {topCategoryName || "Suggested category"} (
                                            {topIsBulkSafe ? "Auto Fix ready" : "needs review"})
                                          </option>
                                        ) : null}
                                        {categories
                                          .filter((c) => !topCategoryId || String(c.id) !== topCategoryId)
                                          .map((c) => (
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
