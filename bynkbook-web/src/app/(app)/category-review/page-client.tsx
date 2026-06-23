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

import { Tags, Loader2, ChevronRight } from "lucide-react";

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

function categorySuggestionInlineReason(reason: string, categoryName: string, confidence: number) {
  let text = String(reason ?? "").trim();
  if (!text) return "";

  const escapedCategoryName = categoryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let previous = "";

  while (text && text !== previous) {
    previous = text;
    if (escapedCategoryName) {
      text = text.replace(new RegExp(`^Suggested:\\s*${escapedCategoryName}\\b`, "i"), "");
      text = text.replace(new RegExp(`^Suggested category:\\s*${escapedCategoryName}\\b`, "i"), "");
    }

    text = text
      .replace(new RegExp(`^${confidence}%(?=\\s|$|[·•|-])`, "i"), "")
      .replace(/^Review\b/i, "")
      .replace(/^[\s:·•|-]+/, "")
      .trim();
  }

  return text;
}

function hasSuggestionEntry(map: Record<string, any[]>, entryId: string) {
  return Object.prototype.hasOwnProperty.call(map, entryId);
}

function isInactiveEntryForCategoryReview(entry: any) {
  if (entry?.deleted_at || entry?.deletedAt) return true;
  if (entry?.voided_at || entry?.voidedAt) return true;
  if (entry?.removed_at || entry?.removedAt) return true;
  const status = String(entry?.status ?? entry?.entry_status ?? entry?.entryStatus ?? "").trim().toUpperCase();
  return status === "DELETED" || status === "SOFT_DELETED" || status === "VOIDED" || status === "REMOVED";
}

function categorySuggestionRequiresReview(suggestion: any) {
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

function categorySuggestionWarning(suggestion: any) {
  return String(suggestion?.warning ?? "").trim();
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
  const warningText = categorySuggestionWarning(suggestion);
  const requiresReview = categorySuggestionRequiresReview(suggestion);
  const merchantNormalized = String(suggestion?.merchant_normalized ?? suggestion?.merchantNormalized ?? "").trim();

  const lines = [
    `Suggested category: ${categoryName}`,
    `Confidence: ${confidence}% (${tierLabel})`,
    `Source: ${sourceLabel}`,
  ];

  if (requiresReview) lines.push("Review required: yes");
  if (reasonText) lines.push(`Rationale: ${reasonText}`);
  if (warningText) lines.push(`Warning: ${warningText}`);
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

type CategoryReviewEntriesPage = Awaited<ReturnType<typeof listEntriesPage>>;

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
    queryFn: async ({ pageParam }): Promise<CategoryReviewEntriesPage> => {
      if (!selectedBusinessId || !selectedAccountId) {
        return {
          items: [],
          meta: { limit: entriesPageLimit, hasMore: false, nextCursor: null },
        };
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

  // Category grouping
  const [groupedByCategory, setGroupedByCategory] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

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
  const [suggestionLoadedAtByEntryId, setSuggestionLoadedAtByEntryId] = useState<Record<string, number>>({});
  const [suggestionsRequestedKey, setSuggestionsRequestedKey] = useState<string | null>(null);
  const [suggestionRequestNonce, setSuggestionRequestNonce] = useState(0);
  const [autoFixPendingIds, setAutoFixPendingIds] = useState<string[] | null>(null);

  const [applyOpen, setApplyOpen] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applySummary, setApplySummary] = useState<{
    applied: number;
    blocked: number;
    blockedByCode: Record<string, number>;
    stillNeedReview?: number;
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

  function applySummaryMessage(summary: { applied: number; blocked: number; blockedByCode: Record<string, number>; stillNeedReview?: number }) {
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
    const reviewText =
      typeof summary.stillNeedReview === "number"
        ? ` ${summary.stillNeedReview} still need${summary.stillNeedReview === 1 ? "s" : ""} review.`
        : "";
    return `Applied ${summary.applied} categories.${reviewText}${summary.blocked ? ` Blocked ${summary.blocked}.` : ""}${reasonText}`;
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
    setSuggestionLoadedAtByEntryId({});
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
      if (isInactiveEntryForCategoryReview(e)) return false;

      const ymd = String(e.date ?? "").slice(0, 10);
      if (!inRange(ymd)) return false;

      // Category review applies only to active accounting entries.
      const t = String(e.type ?? "").toUpperCase();
      if (t !== "INCOME" && t !== "EXPENSE") return false;

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
    setSuggestionLoadedAtByEntryId({});
    setSuggestionsRequestedKey(null);
    setSelectedSuggestionByEntryId({});
    setManualCategoryByEntryId({});
    setAutoFixPendingIds(null);
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
    const loadedAt = Date.now();
    setSuggestionLoadedAtByEntryId((prev) => {
      const next = { ...prev };
      for (const entryId of Object.keys(nextData)) next[entryId] = loadedAt;
      return next;
    });
  }, [suggestionsQ.data]);

  const sugByEntryId = suggestionMapByEntryId;

  // -------------------------
  // Category grouping — groups visibleRows by suggested or existing category
  // -------------------------
  type CategoryGroup = {
    key: string;
    categoryId: string | null;
    categoryName: string;
    entries: any[];
    totalAmountCents: number;
  };

  const categoryGroupList = useMemo<CategoryGroup[]>(() => {
    if (!groupedByCategory) return [];

    const groupMap = new Map<string, CategoryGroup>();

    for (const e of visibleRows) {
      const id = String(e.id);
      const suggestions = Array.isArray(sugByEntryId[id]) ? sugByEntryId[id] : [];
      const topSuggestion = suggestions[0] ?? null;
      const topCategoryId = String(topSuggestion?.category_id ?? topSuggestion?.categoryId ?? "").trim();

      // Group by current category (already categorized) or top suggestion (uncategorized)
      const currentCatId = e.category_id ? String(e.category_id) : null;
      const groupCatId = currentCatId || topCategoryId || null;
      const sugLoaded = hasSuggestionEntry(sugByEntryId, id);
      const key = groupCatId ?? (sugLoaded ? "no-match" : "no-suggestion");

      if (!groupMap.has(key)) {
        let categoryName: string;
        if (groupCatId) {
          categoryName =
            categoryNameById[groupCatId] ||
            topSuggestion?.category_name ||
            topSuggestion?.categoryName ||
            "Unknown category";
        } else if (sugLoaded) {
          categoryName = "No confident match";
        } else {
          categoryName = "No suggestion yet";
        }
        groupMap.set(key, { key, categoryId: groupCatId, categoryName, entries: [], totalAmountCents: 0 });
      }

      const group = groupMap.get(key)!;
      group.entries.push(e);
      group.totalAmountCents += Number(e.amount_cents ?? 0);
    }

    // Sort: named categories alphabetically, then "no confident match", then "no suggestion" last
    return Array.from(groupMap.values()).sort((a, b) => {
      if (a.key === "no-suggestion") return 1;
      if (b.key === "no-suggestion") return -1;
      if (a.key === "no-match") return 1;
      if (b.key === "no-match") return -1;
      return a.categoryName.localeCompare(b.categoryName);
    });
  }, [groupedByCategory, visibleRows, sugByEntryId, categoryNameById]);

  // Flat list of render items — either group headers + entries (grouped) or raw entries (flat)
  type RenderItem = { kind: "entry"; entry: any } | { kind: "group-header"; group: CategoryGroup };
  const flatRenderItems = useMemo<RenderItem[]>(() => {
    if (!groupedByCategory) {
      return visibleRows.map((entry: any) => ({ kind: "entry" as const, entry }));
    }
    const items: RenderItem[] = [];
    for (const group of categoryGroupList) {
      items.push({ kind: "group-header", group });
      if (!collapsedGroups.has(group.key)) {
        for (const entry of group.entries) {
          items.push({ kind: "entry", entry });
        }
      }
    }
    return items;
  }, [groupedByCategory, visibleRows, categoryGroupList, collapsedGroups]);

  function toggleGroupCollapse(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSelectGroup(groupEntries: any[]) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = groupEntries.every((e) => next.has(String(e.id)));
      for (const e of groupEntries) {
        if (allSelected) next.delete(String(e.id));
        else next.add(String(e.id));
      }
      return next;
    });
  }

  const sugLoading = !!suggestionsRequestedKey && suggestionsQ.isFetching && !suggestionsLoadedForCurrentFilters;
  const sugUpdating = !!suggestionsRequestedKey && suggestionsQ.isFetching && suggestionsLoadedForCurrentFilters;
  const autoFixPreparing = !!autoFixPendingIds && suggestionsQ.isFetching;
  const SUGGESTION_STALE_MS = 60_000;

  function requestSuggestionTargets(targets: typeof suggestionTargets) {
    const requestTargets = targets.slice(0, 200);
    const requestKey = requestTargets.map((x) => x.id).join("|");
    if (!requestKey) return false;

    setSuggestionsRequestedKey(requestKey);
    setSuggestionRequestNonce((n) => n + 1);
    return true;
  }

  function loadSuggestionsForCurrentFilters() {
    if (!selectedBusinessId || !selectedAccountId || suggestionTargets.length === 0 || sugLoading || sugUpdating) return;

    clearMutErr();
    setApplySummary(null);

    requestSuggestionTargets(suggestionsLoadedForCurrentFilters ? suggestionTargets : missingSuggestionTargets);
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

  // Per-row category changes apply immediately from the combobox. Suggestion row selection stays local until batch apply.

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

  function selectSuggestedCategoryForReview(entryId: string, categoryId: string, categoryName: string) {
    if (!categoryId) return;

    clearMutErr();
    setApplySummary(null);
    setFailedById((m) => {
      const next = { ...m };
      delete next[entryId];
      return next;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.add(entryId);
      return next;
    });
    setSelectedSuggestionByEntryId((prev) => ({
      ...prev,
      [entryId]: categoryId,
    }));
    setManualCategoryByEntryId((prev) => ({
      ...prev,
      [entryId]: categoryId,
    }));
    setCategoryDraftByEntryId((prev) => ({
      ...prev,
      [entryId]: categoryName || categoryNameById[categoryId] || "",
    }));
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
    const selectedApplyEntryIds = new Set([
      ...selectedApplyItems.map((item) => item.entryId),
      ...manuallySelectedApplyItems.map((item) => item.entryId),
    ]);

    return autoFixRows.reduce((sum, row) => {
      const id = String(row.entry?.id ?? "");
      if (!selectedApplyEntryIds.has(id)) return sum;
      return sum + Number(row.entry?.amount_cents ?? 0);
    }, 0);
  }, [autoFixRows, selectedApplyItems, manuallySelectedApplyItems]);

  const autoFixReadyCount = selectedApplyItems.length + manuallySelectedApplyItems.length;
  const autoFixSafeSelectedCount = selectedApplyItems.length;
  const autoFixReviewRows = useMemo(() => {
    return autoFixRows.filter((row) => !row.bulkSafe);
  }, [autoFixRows]);
  const autoFixReviewNeededCount = Math.max(0, autoFixRows.length - autoFixReadyCount);
  const loadedAutoFixReadyCount = useMemo(() => {
    let count = 0;

    for (const row of visibleRows) {
      const id = String(row.id);
      if (row.category_id) continue;

      const suggestions = Array.isArray(sugByEntryId[id]) ? sugByEntryId[id] : [];
      const top = suggestions[0] ?? null;
      const topCategoryId = String(top?.category_id ?? top?.categoryId ?? "").trim();
      if (topCategoryId && isBulkSafeCategorySuggestion(top, 0)) count += 1;
    }

    return count;
  }, [visibleRows, sugByEntryId]);

  const autoFixGroups = useMemo(() => {
    const categoryNameByIdMap = new Map<string, string>(
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
        confidenceMin: number;
        confidenceMax: number;
        confidenceAvg: number;
        samplePayees: string[];
        rows: typeof autoFixRows;
      }
    >();

    for (const row of autoFixRows) {
      if (!row.bulkSafe || !row.topCategoryId) continue;

      const suggestedCategoryId = String(row.topCategoryId ?? "").trim();
      const groupKey = `safe:${suggestedCategoryId}`;
      const categoryName =
        row.topCategoryName || categoryNameByIdMap.get(suggestedCategoryId) || "Unknown category";
      const top = row.suggestions[0] ?? null;
      const confidence = categorySuggestionConfidence(top?.confidence);
      const payee = String(row.entry?.payee ?? "").trim();

      const existing = groupsMap.get(groupKey);
      if (existing) {
        existing.count += 1;
        existing.totalAmountCents += Number(row.entry?.amount_cents ?? 0);
        existing.confidenceMin = Math.min(existing.confidenceMin, confidence);
        existing.confidenceMax = Math.max(existing.confidenceMax, confidence);
        existing.confidenceAvg =
          Math.round(((existing.confidenceAvg * (existing.count - 1)) + confidence) / existing.count);
        if (payee && !existing.samplePayees.includes(payee) && existing.samplePayees.length < 3) {
          existing.samplePayees.push(payee);
        }
        existing.rows.push(row);
      } else {
        groupsMap.set(groupKey, {
          groupKey,
          categoryId: suggestedCategoryId,
          categoryName,
          count: 1,
          totalAmountCents: Number(row.entry?.amount_cents ?? 0),
          confidenceMin: confidence,
          confidenceMax: confidence,
          confidenceAvg: confidence,
          samplePayees: payee ? [payee] : [],
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

  function isAutoFixGroupSelected(group: { rows: typeof autoFixRows }) {
    return group.rows.every((row) => {
      const id = String(row.entry?.id ?? "");
      return !!id && String(selectedSuggestionByEntryId[id] ?? "") === String(row.topCategoryId ?? "");
    });
  }

  function setAutoFixGroupSelected(group: { rows: typeof autoFixRows }, checked: boolean) {
    setSelectedSuggestionByEntryId((prev) => {
      const next = { ...prev };
      for (const row of group.rows) {
        const id = String(row.entry?.id ?? "");
        const categoryId = String(row.topCategoryId ?? "").trim();
        if (!id || !categoryId || !row.bulkSafe) continue;
        if (checked) next[id] = categoryId;
        else delete next[id];
      }
      return next;
    });
  }

  function setAutoFixRowSelected(row: (typeof autoFixRows)[number], checked: boolean) {
    const id = String(row.entry?.id ?? "");
    const categoryId = String(row.topCategoryId ?? "").trim();
    if (!id || !categoryId || !row.bulkSafe) return;

    setSelectedSuggestionByEntryId((prev) => {
      const next = { ...prev };
      if (checked) next[id] = categoryId;
      else delete next[id];
      return next;
    });
  }

  function openAutoFixCategoriesForIds(
    entryIds: string[],
    suggestionsByEntryId: Record<string, any[]> = sugByEntryId
  ) {
    const idSet = new Set(entryIds);
    const next: Record<string, string> = { ...selectedSuggestionByEntryId };
    const clearManualIds: string[] = [];

    for (const e of visibleRows) {
      const id = String(e.id);
      if (!idSet.has(id)) continue;

      const suggestions = Array.isArray(suggestionsByEntryId[id]) ? suggestionsByEntryId[id] : [];
      const top = suggestions[0] ?? null;
      const topCategoryId = String(top?.category_id ?? top?.categoryId ?? "").trim();

      if (topCategoryId && isBulkSafeCategorySuggestion(top, 0)) {
        next[id] = topCategoryId;
        clearManualIds.push(id);
      }
    }

    const groupCounts = new Map<string, number>();
    for (const e of visibleRows) {
      const id = String(e.id);
      if (!idSet.has(id)) continue;
      const suggestions = Array.isArray(suggestionsByEntryId[id]) ? suggestionsByEntryId[id] : [];
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
    setSelectedIds(idSet);
    setSelectedSuggestionByEntryId(next);
    const clearManualSet = new Set(clearManualIds);
    setManualCategoryByEntryId((prev) => {
      const manualNext = { ...prev };
      for (const id of clearManualIds) delete manualNext[id];
      // Pre-populate non-safe entries with their top suggestion so they show
      // as selected by default — users deselect what they disagree with.
      for (const e of visibleRows) {
        const id = String(e.id);
        if (!idSet.has(id)) continue;
        if (clearManualSet.has(id)) continue; // already safe-selected
        const suggestions = Array.isArray(suggestionsByEntryId[id]) ? suggestionsByEntryId[id] : [];
        const top = suggestions[0] ?? null;
        const topCategoryId = String(top?.category_id ?? top?.categoryId ?? "").trim();
        if (topCategoryId && !manualNext[id]) manualNext[id] = topCategoryId;
      }
      return manualNext;
    });
    setApplySummary(null);
    clearMutErr();
    setApplyOpen(true);
  }

  function handleReviewAutoFix() {
    if (!selectedBusinessId || !selectedAccountId || suggestionTargets.length === 0 || applyBusy || autoFixPreparing) return;

    clearMutErr();
    setApplySummary(null);

    const selectedScope = selectedCount > 0 ? new Set(selectedIds) : null;
    const targetIds = suggestionTargets
      .filter((target) => !selectedScope || selectedScope.has(target.id))
      .map((target) => target.id)
      .slice(0, 200);

    if (!targetIds.length) return;

    const now = Date.now();
    const targetIdSet = new Set(targetIds);
    const targetsNeedingSuggestions = suggestionTargets.filter((target) => {
      if (!targetIdSet.has(target.id)) return false;
      if (!hasSuggestionEntry(suggestionMapByEntryId, target.id)) return true;
      const loadedAt = suggestionLoadedAtByEntryId[target.id] ?? 0;
      return now - loadedAt > SUGGESTION_STALE_MS;
    });

    if (targetsNeedingSuggestions.length > 0 && !sugLoading && !sugUpdating) {
      setAutoFixPendingIds(targetIds);
      requestSuggestionTargets(targetsNeedingSuggestions);
      return;
    }

    openAutoFixCategoriesForIds(targetIds);
  }

  useEffect(() => {
    if (!autoFixPendingIds) return;
    if (suggestionsQ.isFetching) return;
    const resolvedSuggestionsByEntryId = {
      ...sugByEntryId,
      ...((suggestionsQ.data as Record<string, any[]> | undefined) ?? {}),
    };

    if (!suggestionsQ.error) {
      const allPendingSuggestionsLoaded = autoFixPendingIds.every((id) =>
        hasSuggestionEntry(resolvedSuggestionsByEntryId, id)
      );
      if (!allPendingSuggestionsLoaded) return;
    }

    setAutoFixPendingIds(null);
    openAutoFixCategoriesForIds(autoFixPendingIds, resolvedSuggestionsByEntryId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFixPendingIds, suggestionsQ.isFetching, suggestionsQ.error, suggestionsQ.data, sugByEntryId]);

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

      setApplySummary({
        ...summary,
        stillNeedReview: Math.max(0, autoFixRows.length - summary.applied),
      });

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

        setCategoryDraftByEntryId((prev) => {
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
  const autoFixButtonReadyCount = selectedCount > 0 ? autoFixReadyCount : loadedAutoFixReadyCount;
  const autoFixButtonDisabled =
    applyBusy ||
    autoFixPreparing ||
    sugLoading ||
    sugUpdating ||
    entriesQ.isLoading ||
    suggestionTargets.length === 0 ||
    !selectedBusinessId ||
    !selectedAccountId;
  const autoFixButtonTitle =
    autoFixButtonReadyCount === 0
      ? "Review loaded rows and find safe category matches."
      : `${autoFixButtonReadyCount} safe Auto Fix suggestion${autoFixButtonReadyCount === 1 ? "" : "s"} ready on loaded rows.`;

  return (
    <div className="flex min-h-0 h-[calc(100vh-96px)] flex-col gap-2 max-w-6xl overflow-hidden">
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
                    aria-label="Search by payee or memo"
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
                variant={groupedByCategory ? "default" : "outline"}
                className="h-7 px-3 text-xs"
                onClick={() => {
                  setGroupedByCategory((v) => !v);
                  setCollapsedGroups(new Set());
                }}
                title={groupedByCategory ? "Switch to flat list" : "Group entries by suggested category"}
              >
                Group by category
              </Button>

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

              <span className="inline-flex" title={autoFixButtonTitle}>
                <Button
                  variant={autoFixButtonReadyCount === 0 ? "outline" : "default"}
                  className="h-7 px-3 text-xs"
                  disabled={autoFixButtonDisabled}
                  onClick={handleReviewAutoFix}
                >
                  {autoFixPreparing ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Finding safe category matches…
                    </span>
                  ) : (
                    "Review Auto Fix"
                  )}
                </Button>
              </span>

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
                    Apply bulk category to selected loaded rows
                  </Button>

                  {manuallySelectedApplyItems.length > 0 ? (
                    <BusyButton
                      variant="primary"
                      size="sm"
                      className="h-7 px-3 text-xs"
                      busy={applyBusy}
                      busyLabel="Applying..."
                      disabled={applyBusy || manuallySelectedApplyItems.length === 0}
                      onClick={applyManuallySelectedCategories}
                    >
                      {`Apply selected categories to loaded rows (${manuallySelectedApplyItems.length})`}
                    </BusyButton>
                  ) : null}

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
              Finding safe category matches…
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
                  <table className="w-full min-w-[780px] table-fixed border-separate border-spacing-0">
                    <colgroup>
                      <col style={{ width: 36 }} />
                      <col style={{ width: 190 }} />
                      <col style={{ width: 96 }} />
                      <col />
                    </colgroup>

                    <thead className="sticky top-0 z-10 bg-card">
                      <tr className="h-6 border-b border-border bg-muted/50">
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
                      {flatRenderItems.map((item: RenderItem) => {
                        // ── Group header row ──────────────────────────────────────
                        if (item.kind === "group-header") {
                          const { group } = item;
                          const isCollapsed = collapsedGroups.has(group.key);
                          const allGroupSelected =
                            group.entries.length > 0 &&
                            group.entries.every((ge: any) => selectedIds.has(String(ge.id)));
                          const someGroupSelected =
                            !allGroupSelected &&
                            group.entries.some((ge: any) => selectedIds.has(String(ge.id)));

                          return (
                            <tr
                              key={`group-${group.key}`}
                              className="bg-muted/40 border-b border-border sticky top-[25px] z-[5]"
                            >
                              <td className="px-0 py-1 text-center align-middle border-b border-border">
                                <div className="flex items-center justify-center">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4"
                                    checked={allGroupSelected}
                                    ref={(el) => {
                                      if (el) el.indeterminate = someGroupSelected;
                                    }}
                                    onChange={() => toggleSelectGroup(group.entries)}
                                  />
                                </div>
                              </td>
                              <td colSpan={2} className="px-2 py-1 border-b border-border">
                                <button
                                  type="button"
                                  className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors"
                                  onClick={() => toggleGroupCollapse(group.key)}
                                >
                                  <ChevronRight
                                    className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}
                                  />
                                  <span className="truncate">{group.categoryName}</span>
                                  <span className="ml-1.5 inline-flex h-4 min-w-[18px] items-center justify-center rounded bg-primary/10 px-1 text-[10px] font-medium text-primary border border-primary/20">
                                    {group.entries.length}
                                  </span>
                                </button>
                              </td>
                              <td className="px-2 py-1 text-right border-b border-border">
                                <span
                                  className={`text-xs tabular-nums ${
                                    group.totalAmountCents < 0
                                      ? "text-bb-amount-negative"
                                      : "text-bb-amount-neutral"
                                  }`}
                                >
                                  {formatUsdAccountingFromCents(group.totalAmountCents)}
                                </span>
                              </td>
                            </tr>
                          );
                        }

                        // ── Entry row ──────────────────────────────────────────────
                        const e = item.entry;
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
                            <td className="px-0 py-0.5 text-center align-top border-b border-border/60">
                              <div className="flex items-start justify-center pt-0.5">
                                <input
                                  type="checkbox"
                                  className="h-4 w-4"
                                  checked={isSelected}
                                  onChange={() => toggleRow(id)}
                                />
                              </div>
                            </td>

                            <td className="px-1.5 py-0.5 border-b border-border/60">
                              <div className="flex min-w-0 flex-col gap-0.5">
                                <div
                                  className="truncate text-xs font-medium leading-4 text-foreground"
                                  title={payee}
                                >
                                  {payee || "—"}
                                </div>
                                <div className="text-[10px] leading-3 text-muted-foreground tabular-nums">{dateYmd}</div>
                              </div>
                            </td>

                            <td
                              className={`px-1.5 py-0.5 text-xs text-right tabular-nums whitespace-nowrap border-b border-border/60 ${
                                Number(e.amount_cents) < 0 ? "text-bb-amount-negative" : "text-bb-amount-neutral"
                              }`}
                            >
                              {formatUsdAccountingFromCents(e.amount_cents)}
                            </td>

                            <td className="px-1.5 py-0.5 border-b border-border/60">
                              <div className="grid min-w-0 grid-cols-[minmax(128px,170px)_minmax(180px,1fr)] items-start gap-1">
                                <div className="flex min-w-[128px] max-w-[170px] flex-col gap-0.5">
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
                                            const confLabel = String(s?.confidence_label ?? s?.confidenceLabel ?? "").trim();
                                            const tierLabel = categorySuggestionTierLabel(s?.confidence_tier);
                                            const sourceLabel = categorySuggestionSourceLabel(s?.source);
                                            const reasonText = categorySuggestionReason(s);
                                            const warningText = categorySuggestionWarning(s);
                                            const requiresReview = categorySuggestionRequiresReview(s);
                                            const inlineReason = categorySuggestionInlineReason(reasonText, name, conf);
                                            const isPrimaryReviewOnly = requiresReview || !topSuggestionIsBulkSafe;
                                            const metaText = [
                                              confLabel ? `${confLabel} (${conf}%)` : `${conf}%`,
                                              sourceLabel,
                                            ].filter(Boolean).join(" · ");
                                            const buttonTone = categorySuggestionButtonClass(s?.confidence_tier, true);
                                            const isSuggestionSelected =
                                              isSelected && String(manualCategoryByEntryId[id] ?? "") === catId;

                                            return (
                                              <div className="min-w-0">
                                                <div
                                                  key={`${id}:${catId || name}:top`}
                                                  className={`flex min-w-0 items-center gap-1.5 rounded-md border px-1.5 py-0.5 ${
                                                    isPrimaryReviewOnly
                                                      ? "border-bb-status-warning-border bg-bb-status-warning-bg"
                                                      : "border-primary/20 bg-primary/5"
                                                  }`}
                                                  title={[tierLabel, sourceLabel, reasonText, warningText].filter(Boolean).join(" • ")}
                                                >
                                                  <div className="min-w-0">
                                                    <div className="truncate text-[10px] font-semibold text-foreground">
                                                      Suggested: {name}
                                                    </div>
                                                    <div className="truncate text-[10px] text-muted-foreground">
                                                      {metaText}
                                                    </div>
                                                  </div>

                                                  <div className="ml-auto flex shrink-0 items-center gap-1">
                                                    {requiresReview ? (
                                                      <span className="h-5 px-1.5 rounded-full border border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg text-[10px] inline-flex items-center">
                                                        Review required
                                                      </span>
                                                    ) : null}

                                                    <button
                                                      type="button"
                                                      className={`h-5 px-1.5 rounded-md border text-[10px] font-semibold inline-flex items-center disabled:opacity-60 ${buttonTone}`}
                                                      disabled={!!pendingIds[id] || isSuggestionSelected}
                                                      title="Select for Apply selected categories"
                                                      onClick={() => {
                                                        if (!catId) return;
                                                        if (pendingIds[id]) return;

                                                        selectSuggestedCategoryForReview(id, catId, name);
                                                      }}
                                                    >
                                                      {isSuggestionSelected ? "Selected" : "Select"}
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
                                                {inlineReason ? (
                                                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground" title={reasonText}>
                                                    {inlineReason}
                                                  </div>
                                                ) : null}
                                                {warningText ? (
                                                  <div className="mt-0.5 truncate text-[10px] text-bb-status-warning-fg" title={warningText}>
                                                    {warningText}
                                                  </div>
                                                ) : null}
                                              </div>
                                            );
                                          })() : null}

                                          {more > 0 ? <span className="mt-0.5 inline-block text-[10px] text-muted-foreground/80">+{more} more</span> : null}
                                          {!rowSuggestionsLoaded ? (
                                            <span className="text-[10px] text-muted-foreground/80">No confident suggestion loaded</span>
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
                                            <span className="text-[10px] text-muted-foreground/80">No confident suggestion</span>
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
            title="Review Auto Fix"
            size="lg"
            footer={
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  {selectedApplyItems.length > 0
                    ? `${selectedApplyItems.length} safe ${selectedApplyItems.length === 1 ? "fix" : "fixes"} ready`
                    : manuallySelectedApplyItems.length > 0
                      ? `${manuallySelectedApplyItems.length} reviewed ${manuallySelectedApplyItems.length === 1 ? "selection" : "selections"} ready`
                      : "Review suggestions before applying."}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
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
                  {`Apply reviewed (${manuallySelectedApplyItems.length})`}
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

                      setApplySummary({
                        ...summary,
                        stillNeedReview: Math.max(0, autoFixRows.length - summary.applied),
                      });

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

                      setCategoryDraftByEntryId((prev) => {
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
                  {`Apply safe fixes (${selectedApplyItems.length})`}
                </BusyButton>
                </div>
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
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Safe selected</div>
                  <div className="mt-0.5 text-lg font-semibold text-foreground">{autoFixSafeSelectedCount}</div>
                </div>

                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Review needed</div>
                  <div className="mt-0.5 text-lg font-semibold text-foreground">{autoFixReviewNeededCount}</div>
                </div>

                <div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Selected amount</div>
                  <div className="mt-0.5 text-lg font-semibold text-foreground">
                    {formatUsdAccountingFromCents(autoFixTotalAmountCents)}
                  </div>
                </div>
              </div>

              {autoFixSafeSelectedCount === 0 ? (
                <div className="rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-3 py-2 text-[11px] text-bb-status-warning-fg">
                  No safe bulk fixes yet. Choose categories in Needs review, then apply reviewed selections.
                </div>
              ) : autoFixReviewNeededCount > 0 ? (
                <div className="rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-3 py-2 text-[11px] text-bb-status-warning-fg">
                  {autoFixReviewNeededCount} need{autoFixReviewNeededCount === 1 ? "s" : ""} review.
                  Safe fixes can be applied now; reviewed rows apply only after you choose a category.
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground">
                  Safe suggestions are grouped and preselected. Uncheck any group or row before applying.
                </div>
              )}

              <div className="h-[320px] overflow-auto rounded-lg border border-border">
                {autoFixRows.length === 0 ? (
                  <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                    No selected rows available for auto-fix.
                  </div>
                ) : (
                  <div className="min-w-[420px] divide-y divide-border">
                    {autoFixGroups.length === 0 ? (
                      <div className="bg-card px-4 py-4 text-sm text-muted-foreground">
                        Safe category groups will appear here when loaded rows meet the bulk-fix threshold.
                      </div>
                    ) : null}

                    {autoFixGroups.map((group) => {
                      const isExpanded = !!expandedAutoFixGroups[group.groupKey];
                      const isGroupSelected = isAutoFixGroupSelected(group);
                      const confidenceText =
                        group.confidenceMin === group.confidenceMax
                          ? `${group.confidenceAvg}%`
                          : `${group.confidenceMin}-${group.confidenceMax}% avg ${group.confidenceAvg}%`;
                      const samplePayees = group.samplePayees.join(", ");

                      return (
                        <div key={group.groupKey} className="bg-card">
                          <div className="flex w-full items-start justify-between gap-3 px-3 py-2.5 hover:bg-muted/50">
                            <div className="flex min-w-0 items-start gap-2">
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4"
                                checked={isGroupSelected}
                                onChange={(ev) => setAutoFixGroupSelected(group, ev.target.checked)}
                                aria-label={`Select all ${group.categoryName} safe fixes`}
                              />

                              <button
                                type="button"
                                className="mt-0.5 text-sm leading-none text-muted-foreground/80"
                                onClick={() => toggleAutoFixGroup(group.groupKey)}
                                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${group.categoryName}`}
                              >
                                {isExpanded ? "⌄" : "›"}
                              </button>

                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                  <div className="truncate text-sm font-semibold text-foreground">
                                    {group.categoryName}
                                  </div>
                                  <span className="inline-flex min-w-[24px] items-center justify-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground">
                                    {group.count}
                                  </span>
                                </div>
                                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                                  {confidenceText} confidence
                                  {samplePayees ? ` · ${samplePayees}` : ""}
                                </div>
                              </div>
                            </div>

                            <div className="shrink-0 text-right text-sm font-semibold text-foreground">
                              {formatUsdAccountingFromCents(group.totalAmountCents)}
                            </div>
                          </div>

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
                                const topIsBulkSafe = isBulkSafeCategorySuggestion(top, 0);
                                const topWarning = categorySuggestionWarning(top);
                                const topRequiresReview = categorySuggestionRequiresReview(top);

                                return (
                                  <div
                                    key={id}
                                    className="grid grid-cols-[24px_minmax(0,1.5fr)_100px_128px] items-start gap-3 border-b border-border px-3 py-2 last:border-b-0"
                                  >
                                    <div className="pt-0.5">
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4"
                                        checked={String(selectedSuggestionByEntryId[id] ?? "") === topCategoryId}
                                        onChange={(ev) => setAutoFixRowSelected(row, ev.target.checked)}
                                        aria-label={`Select ${String(e.payee ?? "row")} safe fix`}
                                      />
                                    </div>

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
                                      {topWarning ? (
                                        <div className="mt-1 truncate text-[10px] text-bb-status-warning-fg" title={topWarning}>
                                          {topWarning}
                                        </div>
                                      ) : null}
                                    </div>

                                    <div className="pt-0.5 text-right text-xs font-semibold text-foreground">
                                      {formatUsdAccountingFromCents(e.amount_cents)}
                                    </div>

                                    <div className="pt-0.5 text-right text-[10px] font-medium text-primary">
                                      {topIsBulkSafe && !topRequiresReview ? "Safe" : "Review required"}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}

                    {autoFixReviewRows.length > 0 ? (
                      <details className="bg-card" open>
                        <summary className="cursor-pointer px-3 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/50">
                          Needs review ({autoFixReviewRows.length})
                        </summary>

                        <div className="border-t border-border bg-muted/40">
                          <div className="px-3 py-2 text-[11px] text-muted-foreground">
                            AI suggestions are pre-selected below. Change or clear any you want to skip before applying.
                          </div>

                          {autoFixReviewRows.map((row) => {
                            const e = row.entry;
                            const id = String(e.id);
                            const top = row.suggestions[0] ?? null;
                            const topCategoryId = String(top?.category_id ?? top?.categoryId ?? "").trim();
                            const topCategoryName = categorySuggestionCategoryName(top, categoryNameById);
                            const topConfidence = categorySuggestionConfidence(top?.confidence);
                            const topTierLabel = top
                              ? categorySuggestionTierLabel(top?.confidence_tier ?? top?.confidenceTier)
                              : "No confident suggestion";
                            const topReason = String(top?.reason ?? "").trim();
                            const topWarning = categorySuggestionWarning(top);

                            return (
                              <div
                                key={id}
                                className="grid grid-cols-[minmax(0,1.5fr)_100px_180px] items-start gap-3 border-t border-border px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-medium text-foreground" title={String(e.payee ?? "")}>
                                    {String(e.payee ?? "—")}
                                  </div>
                                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                                    {String(e.date ?? "").slice(0, 10)}
                                  </div>
                                  <div className="mt-1 text-[10px] text-muted-foreground">
                                    {topCategoryName ? `${topCategoryName} · ` : ""}
                                    {topTierLabel}
                                    {top ? ` · ${topConfidence}%` : ""}
                                  </div>
                                  {topReason ? (
                                    <div className="mt-1 truncate text-[10px] text-muted-foreground" title={topReason}>
                                      {topReason}
                                    </div>
                                  ) : null}
                                  {topWarning ? (
                                    <div className="mt-1 truncate text-[10px] text-bb-status-warning-fg" title={topWarning}>
                                      {topWarning}
                                    </div>
                                  ) : null}
                                </div>

                                <div className="pt-0.5 text-right text-xs font-semibold text-foreground">
                                  {formatUsdAccountingFromCents(e.amount_cents)}
                                </div>

                                <select
                                  className="h-7 w-full rounded-md border border-border bg-card px-2 text-[11px]"
                                  value={row.manualCategoryId}
                                  onChange={(ev) => {
                                    const nextValue = String(ev.target.value ?? "");
                                    setManualCategoryByEntryId((prev) => {
                                      const next = { ...prev };
                                      if (nextValue) next[id] = nextValue;
                                      else delete next[id];
                                      return next;
                                    });
                                    setSelectedSuggestionByEntryId((prev) => {
                                      const next = { ...prev };
                                      if (nextValue) next[id] = nextValue;
                                      else delete next[id];
                                      return next;
                                    });
                                  }}
                                >
                                  <option value="">— Skip this entry —</option>
                                  {topCategoryId ? (
                                    <option value={topCategoryId}>
                                      {topCategoryName || "Suggested category"} ✓ AI
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
                            );
                          })}
                        </div>
                      </details>
                    ) : null}
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
