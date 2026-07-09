"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRouter, useSearchParams } from "next/navigation";
// Auth is handled by AppShell

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useEntries } from "@/lib/queries/useEntries";
import { usePreferredAccountId } from "@/lib/accountSelection";
import { issueCountKey } from "@/lib/queries/issueKeys";
import { apiFetch } from "@/lib/api/client";
import { listEntriesPage } from "@/lib/api/entries";
import { listCategories } from "@/lib/api/categories";

import { PageHeader } from "@/components/app/page-header";
import { AccountingScopePills } from "@/components/app/accounting-scope-pills";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { FilterBar } from "@/components/primitives/FilterBar";
import { StatusChip } from "@/components/primitives/StatusChip";
import { AppActionMenu } from "@/components/primitives/AppActionMenu";
import { AppDatePicker } from "@/components/primitives/AppDatePicker";
import { inputH7 } from "@/components/primitives/tokens";
import { Skeleton } from "@/components/ui/skeleton";
import { BusyButton } from "@/components/primitives/BusyButton";
import { DialogFooter } from "@/components/primitives/DialogFooter";
import { PillToggle } from "@/components/primitives/PillToggle";
import { Button } from "@/components/ui/button";
import { AppTooltip } from "@/components/ui/tooltip";
import { ringFocus } from "@/components/primitives/tokens";

import { InlineBanner } from "@/components/app/inline-banner";
import { EmptyStateCard } from "@/components/app/empty-state";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";
import { CategoryCombobox } from "@/components/categories/category-combobox";

import { plaidStatus, plaidSync } from "@/lib/api/plaid";
import { listBankTransactions, createEntryFromBankTransaction, type BankTransactionStatusFilter } from "@/lib/api/bankTransactions";
import { listMatches, markEntryAdjustment } from "@/lib/api/matches";
import {
  getChunkedMatchGroupPlacementSummary,
  previewGeneratedEntryRevert,
  confirmGeneratedEntryRevert,
  type MatchGroupRevertPreview,
} from "@/lib/api/match-groups";
import { createMatchGroupsBatch } from "@/lib/api/match-groups";
import { listMatchGroups } from "@/lib/api/match-groups";
import { getRolePolicies, type RolePolicyRow } from "@/lib/api/rolePolicies";
import { canWriteByRolePolicy } from "@/lib/auth/permissionHints";
import { HintWrap } from "@/components/primitives/HintWrap";
import {
  listReconcileSnapshots,
  createReconcileSnapshot,
  getReconcileSnapshot,
  getReconcileSnapshotExportUrl,
  type ReconcileSnapshotListItem,
  type ReconcileSnapshot,
} from "@/lib/api/reconcileSnapshots";
import { getTeam } from "@/lib/api/team";
import { aiSuggestReconcileBank, aiSuggestReconcileEntry } from "@/lib/api/ai";

import { GitMerge, RefreshCw, Download, Sparkles, AlertCircle, Wrench, Undo2, Plus, ClipboardList, RotateCcw, FileText } from "lucide-react";

import {
  type BankTab,
  absBig,
  accountLabelFor,
  aiUiMessage,
  bankSignature,
  categorySuggestionConfidence,
  categorySuggestionRequiresReview,
  categorySuggestionSourceLabel,
  categorySuggestionTierLabel,
  compactText,
  compareBankDateAsc,
  compareBankDateDesc,
  compareEntryDateAsc,
  compareEntryDateDesc,
  checkRefsMatch,
  directionLabel,
  duplicateReasonChips,
  entriesSignature,
  entryCategoryLabel,
  extractCheckRefFromBankTransaction,
  formatUsdFromCents,
  inferMethodFromBankTransaction,
  isInactiveEntryRecord,
  isoToYmd,
  matchGroupSignature,
  matchGroupsFromPlacementSummary,
  mergeBankTransactions,
  pctConfidence,
  replaceBankTransactionsForStatus,
  scoreBankCandidate,
  scoreEntryCandidate,
  tagBankTransactionsForStatus,
  toBigIntSafe,
  truncateAiReason,
  upsertMatchGroup,
  ymdFromUnknownDate,
} from "@/lib/reconcile/helpers";
import {
  MatchPairPreview,
  MatchSignalChip,
  TinySpinner,
} from "@/components/reconcile/match-cards";
import {
  categorySuggestionId,
  categorySuggestionName,
  isBulkSafeCategorySuggestion,
  safeTopCategorySuggestion,
} from "@/lib/categorySuggestions";

const WRITE_ALLOWLIST = new Set(["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"]);

type RefreshBankAndMatchesOptions = {
  preserveOnEmpty?: boolean;
  skipLegacyMatches?: boolean;
  statuses?: BankTab[];
};
type PlaidStatusState = {
  connected?: boolean;
  institutionName?: string | null;
  last4?: string | null;
  status?: string | null;
  lastSyncAt?: string | null;
  needsAttention?: boolean;
  errorMessage?: string | null;
  hasNewTransactions?: boolean;
  lastKnownBalanceCents?: string | null;
  lastKnownBalanceAt?: string | null;
};
type CountProbeResult = { count: number; capped: boolean };
type BankUnmatchedScopeCounts = {
  scopeKey: string;
  allTime: CountProbeResult | null;
  dateRange: CountProbeResult | null;
  loading: boolean;
  error: string | null;
};

const PlaidConnectButton = dynamic(
  () => import("@/components/plaid/PlaidConnectButton").then((mod) => mod.PlaidConnectButton),
  { loading: () => null }
);

const UploadPanel = dynamic(
  () => import("@/components/uploads/UploadPanel").then((mod) => mod.UploadPanel),
  { loading: () => null }
);

const UploadsList = dynamic(
  () => import("@/components/uploads/UploadsList").then((mod) => mod.UploadsList),
  { loading: () => <div className="p-3 text-xs text-bb-text-muted">Loading history...</div> }
);

const DynamicAppDialog = dynamic(
  () => import("@/components/primitives/AppDialog").then((mod) => mod.AppDialog),
  { loading: () => null }
);

function AppDialog(props: any) {
  if (!props.open) return null;
  return <DynamicAppDialog {...props} />;
}

const AutoReconcileDialog = dynamic(
  () => import("@/components/reconcile/auto-reconcile-dialog").then((mod) => mod.AutoReconcileDialog),
  { loading: () => null }
);

type ReconcileBankSuggestion = {
  entryId: string;
  confidence: number;
  reason: string;
};

type ReconcileEntrySuggestion = {
  bankTransactionId: string;
  confidence: number;
  reason: string;
};

export default function ReconcilePageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();

  // Layout: keep only table bodies scrolling
  const containerStyle = { height: "calc(100vh - 56px - 48px)" as const };

  // -------------------------
  // Auth is handled by AppShell
  // -------------------------

  // -------------------------
  // Business + account selection
  // -------------------------
  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");
  const accountIdFromUrl = sp.get("accountId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const accountsQ = useAccounts(selectedBusinessId);

  const bannerMsg =
    appErrorMessageOrNull(businessesQ.error) ||
    appErrorMessageOrNull(accountsQ.error) ||
    null;

  // -------------------------
  // Mutation banner (single region; CLOSED_PERIOD consistency)
  // -------------------------
  const [mutErr, setMutErr] = useState<string | null>(null);
  const [mutErrIsClosed, setMutErrIsClosed] = useState(false);

  const [pendingById, setPendingById] = useState<Record<string, boolean>>({});

  function markPending(id: string) {
    if (!id) return;
    setPendingById((m) => ({ ...m, [id]: true }));
  }

  function clearPending(id: string) {
    if (!id) return;
    setPendingById((m) => {
      if (!m[id]) return m;
      const next = { ...m };
      delete next[id];
      return next;
    });
  }

  const [mutErrTitle, setMutErrTitle] = useState<string>("");

  function clearMutErr() {
    setMutErr(null);
    setMutErrTitle("");
    setMutErrIsClosed(false);
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
      setMutErrIsClosed(true);
      return { msg: "This period is closed. Reopen period to modify.", isClosed: true };
    }

    setMutErrTitle(fallbackTitle);
    setMutErr(String(msg));
    setMutErrIsClosed(false);
    return { msg: String(msg), isClosed: false };
  }

  const possibleDuplicateEntryMessage =
    "Possible existing ledger entry found. Review and match existing entry instead of creating a new one.";
  const matchedOrPendingCreateEntryMessage =
    "This bank transaction already appears matched or pending. Refresh before trying again.";
  const createEntryAndMatchConfirmationCopy =
    "This will create a new ledger entry from this bank transaction and mark it matched. Review the category, amount, and date before continuing.";

  function possibleDuplicateCreateEntryPayload(e: any) {
    const directPayload = e?.payload ?? e?.data ?? e?.response?.data ?? null;
    if (directPayload?.code === "POSSIBLE_DUPLICATE_ENTRY") return directPayload;

    const msg = String(e?.message ?? "");
    const jsonStart = msg.indexOf("{");
    if (jsonStart >= 0) {
      try {
        const payload = JSON.parse(msg.slice(jsonStart));
        if (payload?.code === "POSSIBLE_DUPLICATE_ENTRY") return payload;
      } catch {
        // Fall through to the string check below.
      }
    }

    return null;
  }

  function possibleDuplicateCreateEntryMessage(e: any) {
    const directCode = e?.code || e?.payload?.code || e?.data?.code || e?.response?.data?.code;
    if (directCode === "POSSIBLE_DUPLICATE_ENTRY") return possibleDuplicateEntryMessage;

    if (possibleDuplicateCreateEntryPayload(e)) return possibleDuplicateEntryMessage;

    const msg = String(e?.message ?? "");
    return msg.includes("POSSIBLE_DUPLICATE_ENTRY") ? possibleDuplicateEntryMessage : null;
  }

  // -------------------------
  // Phase 6A: Permission guardrails (deny-by-default)
  // -------------------------
  const noPermTitle = "Insufficient permissions";
  const businessRole = useMemo(() => {
    const list = businessesQ.data ?? [];
    const biz = list.find((b: any) => String(b.id) === String(selectedBusinessId));
    // TS-safe: API may include extra fields not in the Business type
    return (((biz as any)?.role ?? (biz as any)?.user_role ?? null) as string | null);
  }, [businessesQ.data, selectedBusinessId]);

  const canWrite = useMemo(() => {
    const r = (businessRole ?? "").toString().trim().toUpperCase();
    return WRITE_ALLOWLIST.has(r); // unknown/missing => false
  }, [businessRole]);

  const selectedAccountId = usePreferredAccountId({
    businessId: selectedBusinessId,
    accounts: accountsQ.data ?? [],
    accountIdFromUrl,
    excludeCash: true,
    excludeTemp: true,
  });

  const selectedBusinessRole = useMemo(() => {
    const list = businessesQ.data ?? [];
    const row = list.find((b) => b.id === selectedBusinessId);
    return (row?.role ?? "").toString().toUpperCase();
  }, [businessesQ.data, selectedBusinessId]);

  const canWriteSnapshots = useMemo(() => {
    return ["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"].includes(selectedBusinessRole);
  }, [selectedBusinessRole]);

  // Phase 7.2B: role policy hints (frontend-only)
  const policyDeniedTitle = "Not allowed by role policy";
  const [rolePolicyRows, setRolePolicyRows] = useState<RolePolicyRow[]>([]);

  // Prevent duplicate support-metadata fetches for the same scope,
  // especially during development strict-mode remounts.
  const rolePoliciesLoadedForBizRef = useRef<string>("");
  const teamLoadedForBizRef = useRef<string>("");
  const plaidLoadedForScopeRef = useRef<string>("");

  useEffect(() => {
    if (!selectedBusinessId) return;

    if (rolePoliciesLoadedForBizRef.current === String(selectedBusinessId)) return;
    rolePoliciesLoadedForBizRef.current = String(selectedBusinessId);

    let cancelled = false;
    (async () => {
      try {
        const res: any = await getRolePolicies(selectedBusinessId);
        if (!cancelled) {
          setRolePolicyRows(res?.items ?? []);
        }
      } catch {
        // If we cannot load policies, do not block UI (fallback to allowlist only)
        if (!cancelled) {
          setRolePolicyRows([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedBusinessId]);

  // Team map for audit display (UI only)
  useEffect(() => {
    if (!selectedBusinessId) {
      setTeamEmailByUserId(new Map());
      teamLoadedForBizRef.current = "";
      return;
    }

    if (teamLoadedForBizRef.current === String(selectedBusinessId)) return;
    teamLoadedForBizRef.current = String(selectedBusinessId);

    let cancelled = false;
    (async () => {
      try {
        const res = await getTeam(selectedBusinessId);
        if (cancelled) return;

        const m = new Map<string, string>();
        for (const member of res?.members ?? []) {
          const uid = String((member as any)?.user_id ?? "").trim();
          const email = String((member as any)?.email ?? "").trim();
          if (uid && email) m.set(uid, email);
        }
        setTeamEmailByUserId(m);
      } catch {
        if (!cancelled) setTeamEmailByUserId(new Map());
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedBusinessId]);

  const policyReconcileWrite = useMemo(() => {
    // OWNER must never be blocked by frontend policy hints.
    if (selectedBusinessRole === "OWNER") return null;

    // Key: "reconcile"
    return canWriteByRolePolicy(rolePolicyRows, selectedBusinessRole, "reconcile");
  }, [rolePolicyRows, selectedBusinessRole]);

  const canWriteReconcileEffective = useMemo(() => {
    // Allowlist remains hard rail; policy only blocks when explicitly known and denying
    return canWrite && (policyReconcileWrite === null ? true : policyReconcileWrite);
  }, [canWrite, policyReconcileWrite]);

  const canWriteSnapshotsEffective = useMemo(() => {
    return canWriteSnapshots && (policyReconcileWrite === null ? true : policyReconcileWrite);
  }, [canWriteSnapshots, policyReconcileWrite]);

  const reconcileWriteReason = useMemo(() => {
    if (!canWrite) return noPermTitle;
    if (policyReconcileWrite === false) return policyDeniedTitle;
    return null;
  }, [canWrite, noPermTitle, policyReconcileWrite]);

  const snapshotWriteReason = useMemo(() => {
    if (!canWriteSnapshots) return noPermTitle;
    if (policyReconcileWrite === false) return policyDeniedTitle;
    return null;
  }, [canWriteSnapshots, noPermTitle, policyReconcileWrite]);

  useEffect(() => {
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;

    if (!sp.get("businessId")) {
      router.replace(`/reconcile?businessId=${selectedBusinessId}`);
      return;
    }

    if (accountsQ.isLoading) return;

    if (selectedAccountId && !accountIdFromUrl) {
      router.replace(`/reconcile?businessId=${selectedBusinessId}&accountId=${selectedAccountId}`);
    }
  }, [
    businessesQ.isLoading,
    selectedBusinessId,
    accountsQ.isLoading,
    selectedAccountId,
    accountIdFromUrl,
    router,
    sp,
  ]);

  // -------------------------
  // Filters (UI)
  // -------------------------
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  // Tabs (Phase 4D polish)
  const [expectedTab, setExpectedTab] = useState<"expected" | "matched">("expected");
  const [bankTab, setBankTab] = useState<BankTab>("unmatched");

  // Phase 2 Performance: cap initial rows rendered to keep tab switches instant-fast
  const PAGE_CHUNK = 200;
  const ENTRIES_API_LIMIT = 200;
  const ENTRIES_BACKGROUND_MAX_PAGE_COUNT = 8;
  const BANK_TRANSACTION_PAGE_LIMIT = 500;

  const [expectedVisibleN, setExpectedVisibleN] = useState(PAGE_CHUNK);
  const [matchedVisibleN, setMatchedVisibleN] = useState(PAGE_CHUNK);

  const [bankUnmatchedVisibleN, setBankUnmatchedVisibleN] = useState(PAGE_CHUNK);
  const [bankMatchedVisibleN, setBankMatchedVisibleN] = useState(PAGE_CHUNK);
  const bankScopeKey =
    selectedBusinessId && selectedAccountId
      ? `${selectedBusinessId}:${selectedAccountId}:${from || ""}:${to || ""}`
      : "";
  const [bankLoadedScopeByStatus, setBankLoadedScopeByStatus] = useState<Record<BankTab, string>>({
    unmatched: "",
    matched: "",
  });
  const [bankLoadingByStatus, setBankLoadingByStatus] = useState<Record<BankTab, boolean>>({
    unmatched: false,
    matched: false,
  });
  const bankStatusLoaded = useMemo(
    () => ({
      unmatched: !!bankScopeKey && bankLoadedScopeByStatus.unmatched === bankScopeKey,
      matched: !!bankScopeKey && bankLoadedScopeByStatus.matched === bankScopeKey,
    }),
    [bankScopeKey, bankLoadedScopeByStatus]
  );
  const loadedBankStatuses = useMemo(() => {
    const statuses: BankTab[] = [];
    if (bankStatusLoaded.unmatched) statuses.push("unmatched");
    if (bankStatusLoaded.matched) statuses.push("matched");
    return statuses;
  }, [bankStatusLoaded]);
  const [bankNextCursorByStatus, setBankNextCursorByStatus] = useState<Record<BankTransactionStatusFilter, string | null>>({
    all: null,
    unmatched: null,
    matched: null,
  });
  const [bankLoadingMore, setBankLoadingMore] = useState(false);
  const [bankUnmatchedScopeCounts, setBankUnmatchedScopeCounts] = useState<BankUnmatchedScopeCounts>({
    scopeKey: "",
    allTime: null,
    dateRange: null,
    loading: false,
    error: null,
  });
  const [bankCountRefreshSeq, setBankCountRefreshSeq] = useState(0);

  // B2: Bulk create entries from selected bank txns (unmatched tab)
  const [selectedBankTxnIds, setSelectedBankTxnIds] = useState<Set<string>>(new Set());
  const [bulkCreateAutoMatch, setBulkCreateAutoMatch] = useState(true);
  const [bulkCreateResultByBankTxnId, setBulkCreateResultByBankTxnId] = useState<Record<string, any>>({});
  const [bulkCreateBusy, setBulkCreateBusy] = useState(false);

  // -------------------------
  // Data queries
  // -------------------------
  const entriesQ = useEntries({
    businessId: selectedBusinessId,
    accountId: selectedAccountId,
    limit: ENTRIES_API_LIMIT,
    pageCount: 1,
    date_from: from || undefined,
    date_to: to || undefined,
  });
  const entriesIsPlaceholderData = !!(entriesQ as any).isPlaceholderData;

  const [entriesHydratedScopeKey, setEntriesHydratedScopeKey] = useState("");
  const [entriesExtraRows, setEntriesExtraRows] = useState<any[]>([]);
  const [entriesNextCursor, setEntriesNextCursor] = useState<string | null>(null);
  const [entriesHasMore, setEntriesHasMore] = useState(false);
  const [entriesBackgroundPageCount, setEntriesBackgroundPageCount] = useState(0);
  const [entriesBackgroundLoading, setEntriesBackgroundLoading] = useState(false);

  useEffect(() => {
    setEntriesHydratedScopeKey("");
    setEntriesExtraRows([]);
    setEntriesNextCursor(null);
    setEntriesHasMore(false);
    setEntriesBackgroundPageCount(0);
    setExpectedVisibleN(PAGE_CHUNK);
    setMatchedVisibleN(PAGE_CHUNK);
  }, [bankScopeKey]);

  useEffect(() => {
    if (!bankScopeKey) return;
    if (entriesQ.isLoading || entriesIsPlaceholderData) return;

    const meta = (entriesQ.data as any)?.meta ?? {};
    const nextCursor = typeof meta.nextCursor === "string" ? meta.nextCursor : null;
    setEntriesHydratedScopeKey(bankScopeKey);
    setEntriesExtraRows([]);
    setEntriesNextCursor(nextCursor);
    setEntriesHasMore(!!meta.hasMore && !!nextCursor);
    setEntriesBackgroundPageCount(0);
  }, [bankScopeKey, entriesIsPlaceholderData, entriesQ.data, entriesQ.isLoading]);

  useEffect(() => {
    if (!selectedBusinessId || !selectedAccountId) return;
    if (!bankScopeKey || entriesHydratedScopeKey !== bankScopeKey) return;
    if (entriesBackgroundLoading || !entriesHasMore || !entriesNextCursor) return;
    if (entriesBackgroundPageCount >= ENTRIES_BACKGROUND_MAX_PAGE_COUNT - 1) return;

    let cancelled = false;
    const cursor = entriesNextCursor;
    const backgroundDelayMs = Math.min(1800, 650 + entriesBackgroundPageCount * 250);
    const timer = window.setTimeout(() => {
      (async () => {
        setEntriesBackgroundLoading(true);
        try {
          const res = await listEntriesPage({
            businessId: selectedBusinessId,
            accountId: selectedAccountId,
            limit: ENTRIES_API_LIMIT,
            cursor,
            date_from: from || undefined,
            date_to: to || undefined,
          });

          if (cancelled) return;

          setEntriesExtraRows((prev) => {
            const seen = new Set<string>();
            for (const row of entriesQ.data ?? []) {
              const id = String((row as any)?.id ?? "").trim();
              if (id) seen.add(id);
            }
            for (const row of prev) {
              const id = String(row?.id ?? "").trim();
              if (id) seen.add(id);
            }

            const additions = res.items.filter((row: any) => {
              const id = String(row?.id ?? "").trim();
              if (!id || seen.has(id)) return false;
              seen.add(id);
              return true;
            });

            return additions.length ? [...prev, ...additions] : prev;
          });

          const nextCursor = typeof res.meta.nextCursor === "string" ? res.meta.nextCursor : null;
          setEntriesNextCursor(nextCursor);
          setEntriesHasMore(!!res.meta.hasMore && !!nextCursor);
          setEntriesBackgroundPageCount((count) => count + 1);
        } finally {
          if (!cancelled) setEntriesBackgroundLoading(false);
        }
      })();
    }, backgroundDelayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    selectedBusinessId,
    selectedAccountId,
    bankScopeKey,
    entriesHydratedScopeKey,
    entriesBackgroundLoading,
    entriesHasMore,
    entriesNextCursor,
    entriesBackgroundPageCount,
    entriesQ.data,
    from,
    to,
  ]);

  const entriesData = useMemo(() => {
    if (!bankScopeKey || entriesHydratedScopeKey !== bankScopeKey) return [] as any[];

    const combined: any[] = [];
    const seen = new Set<string>();
    for (const row of entriesQ.data ?? []) {
      const id = String((row as any)?.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      combined.push(row);
    }
    for (const row of entriesExtraRows) {
      const id = String(row?.id ?? "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      combined.push(row);
    }

    (combined as any).meta = {
      ...((entriesQ.data as any)?.meta ?? {}),
      hasMore: entriesHasMore,
      nextCursor: entriesNextCursor,
      limit: ENTRIES_API_LIMIT,
    };

    return combined;
  }, [bankScopeKey, entriesHydratedScopeKey, entriesQ.data, entriesExtraRows, entriesHasMore, entriesNextCursor]);

  const entriesInitialLoading =
    !!selectedBusinessId &&
    !!selectedAccountId &&
    (entriesQ.isLoading || !bankScopeKey || entriesHydratedScopeKey !== bankScopeKey);

  const [bankTxLoading, setBankTxLoading] = useState(false);
  const [bankTx, setBankTx] = useState<any[]>([]);

  // Helps delayed refresh decide whether another confirm pull is needed (max 2 tries)
  const bankTxLenRef = useRef(0);
  useEffect(() => {
    bankTxLenRef.current = bankTx.length;
  }, [bankTx.length]);

  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);
  const [matchGroups, setMatchGroups] = useState<any[]>([]);
  const [matchGroupsLoading, setMatchGroupsLoading] = useState(false);
  const [allMatchGroups, setAllMatchGroups] = useState<any[]>([]);
  const [allMatchGroupsLoading, setAllMatchGroupsLoading] = useState(false);
  const [allMatchGroupsLoadedScope, setAllMatchGroupsLoadedScope] = useState("");
  const allMatchGroupsInFlightRef = useRef<Promise<any[]> | null>(null);
  const allMatchGroupsRequestSeqRef = useRef(0);
  const allMatchGroupsScopeKey =
    selectedBusinessId && selectedAccountId ? `${selectedBusinessId}:${selectedAccountId}` : "";
  const allMatchGroupsHydrated =
    !!allMatchGroupsScopeKey && allMatchGroupsLoadedScope === allMatchGroupsScopeKey;
  const placementSummaryRequestSeqRef = useRef(0);

  // Real first-load truth hydration:
  // do not treat bank / match-group truth as ready until each source
  // has completed at least one fetch for the current reconcile scope.
  const [bankTruthHydrated, setBankTruthHydrated] = useState(false);
  const [matchGroupsTruthHydrated, setMatchGroupsTruthHydrated] = useState(false);

  // Reconcile truth gating:
  // keep last-good section results visible until placement truth is ready.
  const [entriesTruthSnapshot, setEntriesTruthSnapshot] = useState<null | {
    expectedList: any[];
    matchedList: any[];
    expectedCount: number;
    matchedCount: number;
  }>(null);

  const [bankTruthSnapshot, setBankTruthSnapshot] = useState<null | {
    unmatchedList: any[];
    matchedList: any[];
    unmatchedCount: number;
    matchedCount: number;
  }>(null);

  // Plaid status + sync UI
  const [plaidLoading, setPlaidLoading] = useState(false);
  const [plaidSyncing, setPlaidSyncing] = useState(false);
  const [plaid, setPlaid] = useState<PlaidStatusState | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);

  // Dialogs
  const [openUpload, setOpenUpload] = useState(false);
  const [openStatementHistory, setOpenStatementHistory] = useState(false);

  // Phase 5D: Export hub (read-only)
  const [openExportHub, setOpenExportHub] = useState(false);

  // Auto-reconcile v1 (suggestion-only)
  const [openAutoReconcile, setOpenAutoReconcile] = useState(false);

  // Phase 5C: Issues (read-only)
  const [openIssuesList, setOpenIssuesList] = useState(false);
  const [issuesKind, setIssuesKind] = useState<"notInView" | "voidHeavy">("notInView");
  const [issuesSearch, setIssuesSearch] = useState("");

  // Phase 5C-2: small info dialog (read-only)
  const [openIssuesInfo, setOpenIssuesInfo] = useState(false);
  const [issuesInfoMsg, setIssuesInfoMsg] = useState<string>("");

  // Phase 5A: Reconciliation history (read-only)
  const [openReconciliationHistory, setOpenReconciliationHistory] = useState(false);
  const [reconHistoryFilter, setReconHistoryFilter] = useState<"all" | "match" | "void">("all");
  const [reconHistoryBankTxnFilterId, setReconHistoryBankTxnFilterId] = useState<string | null>(null);

  // Phase 5B-3: local search (filters only capped visible events)
  const [reconHistorySearch, setReconHistorySearch] = useState("");

  // Phase 5A-2: Audit row detail (read-only)
  const [openReconAuditDetail, setOpenReconAuditDetail] = useState(false);
  const [selectedReconAudit, setSelectedReconAudit] = useState<any | null>(null);

  // Safe generated-entry revert from audit detail.
  const [revertBusy, setRevertBusy] = useState(false);
  const [revertPreviewLoading, setRevertPreviewLoading] = useState(false);
  const [revertPreview, setRevertPreview] = useState<MatchGroupRevertPreview | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);

  async function openGeneratedRevertPreview(args: { matchGroupId: string; bankTransactionId?: string | null }) {
    if (!selectedBusinessId || !selectedAccountId) return;
    if (!canWriteReconcileEffective) return;

    setRevertConfirmOpen(true);
    setRevertPreview(null);
    setRevertError(null);
    setRevertPreviewLoading(true);

    try {
      const preview = await previewGeneratedEntryRevert({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        matchGroupId: args.matchGroupId,
        bankTransactionId: args.bankTransactionId ?? null,
      });
      setRevertPreview(preview);
    } catch (e: any) {
      const r = applyMutationError(e, "Can’t preview revert");
      if (!r.isClosed) setRevertError(r.msg);
      else setRevertError(null);
    } finally {
      setRevertPreviewLoading(false);
    }
  }

  // Phase 6B: Reconcile snapshots
  const [openSnapshots, setOpenSnapshots] = useState(false);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [snapshots, setSnapshots] = useState<ReconcileSnapshotListItem[]>([]);
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null);

  // Default month must be America/Chicago
  const [snapshotMonth, setSnapshotMonth] = useState(() => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
    }).formatToParts(new Date());

    const yyyy = parts.find((p) => p.type === "year")?.value ?? String(new Date().getFullYear());
    const mm = parts.find((p) => p.type === "month")?.value ?? String(new Date().getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
  });

  const [snapshotCreateBusy, setSnapshotCreateBusy] = useState(false);
  const [snapshotCreateError, setSnapshotCreateError] = useState<string | null>(null);

  // 409 "already exists" must be neutral info (not error) + provide View action
  const [snapshotExistsInfo, setSnapshotExistsInfo] = useState<{ month: string; snapshotId: string } | null>(null);

  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<ReconcileSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  // Snapshot downloads busy state (UI only)
  const [snapshotDownloadBusyByKey, setSnapshotDownloadBusyByKey] = useState<Record<string, boolean>>({});

  // Team map (UI only): never show raw user IDs
  const [teamEmailByUserId, setTeamEmailByUserId] = useState<Map<string, string>>(new Map());

  // Disable Create when selected month already exists in list
  const existingSnapshotForMonth = useMemo(() => {
    return snapshots.find((s) => s.month === snapshotMonth) ?? null;
  }, [snapshots, snapshotMonth]);

  const monthAlreadyExists = !!existingSnapshotForMonth?.id;

  // Clear the "exists" info banner whenever month changes
  useEffect(() => {
    setSnapshotExistsInfo(null);
    setSnapshotCreateError(null);
  }, [snapshotMonth]);

  // Phase 4D: Match dialog (bank txn → many entries, v1)
  const [openMatch, setOpenMatch] = useState(false);
  const [matchBankTxnId, setMatchBankTxnId] = useState<string | null>(null);
  const [matchSearch, setMatchSearch] = useState("");
  const [matchSelectedEntryIds, setMatchSelectedEntryIds] = useState<Set<string>>(() => new Set());
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchSuggestLoading, setMatchSuggestLoading] = useState(false);
  const [matchAiSuggestions, setMatchAiSuggestions] = useState<ReconcileBankSuggestion[]>([]);
  const [matchSuggestError, setMatchSuggestError] = useState<string | null>(null);

  // Phase 4D: Adjustment dialog
  const [openAdjust, setOpenAdjust] = useState(false);
  const [adjustEntryId, setAdjustEntryId] = useState<string | null>(null);
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // Phase 4D: Entry → Bank match dialog (Expected row Match button)
  const [openEntryMatch, setOpenEntryMatch] = useState(false);
  const [entryMatchEntryId, setEntryMatchEntryId] = useState<string | null>(null);
  const [entryMatchSelectedBankTxnIds, setEntryMatchSelectedBankTxnIds] = useState<Set<string>>(() => new Set());
  const [entryMatchSearch, setEntryMatchSearch] = useState("");
  const [entryMatchBusy, setEntryMatchBusy] = useState(false);
  const [entryMatchError, setEntryMatchError] = useState<string | null>(null);
  const [entrySuggestLoading, setEntrySuggestLoading] = useState(false);
  const [entryAiSuggestions, setEntryAiSuggestions] = useState<ReconcileEntrySuggestion[]>([]);
  const [entrySuggestError, setEntrySuggestError] = useState<string | null>(null);

  // Hide adjusted entries locally (until we refetch entries with adjustment status)
  const [locallyAdjusted, setLocallyAdjusted] = useState<Set<string>>(() => new Set());

  // Load Plaid status
  useEffect(() => {
    if (!selectedBusinessId) return;
    if (!selectedAccountId) return;

    const scopeKey = `${selectedBusinessId}:${selectedAccountId}`;
    if (plaidLoadedForScopeRef.current === scopeKey) return;
    plaidLoadedForScopeRef.current = scopeKey;

    let cancelled = false;
    (async () => {
      setPlaidLoading(true);
      try {
        const res = await plaidStatus(selectedBusinessId, selectedAccountId);
        if (!cancelled) setPlaid(res);
      } catch {
        if (!cancelled) setPlaid(null);
      } finally {
        if (!cancelled) setPlaidLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedBusinessId, selectedAccountId]);

  // -------------------------
  // Phase 1 Stabilization: Refresh epoch + coalescing
  // - Epoch guard: stale refreshes cannot commit state
  // - Coalescing: prevent overlapping sync + refresh commits (1 in-flight, 1 queued)
  // -------------------------
  const refreshEpochRef = useRef(0);
  const refreshInFlightRef = useRef<Promise<any> | null>(null);
  const refreshQueuedOptsRef = useRef<RefreshBankAndMatchesOptions | null>(null);

  async function refreshBankAndMatches(opts?: RefreshBankAndMatchesOptions) {
    if (!selectedBusinessId || !selectedAccountId) {
      return { bank: [] as any[], matches: [] as any[], matchGroups: [] as any[] };
    }

    // Coalesce refresh calls:
    // - If a refresh is already running, queue ONE follow-up refresh (latest opts wins)
    // - Prevent overlapping sync + refresh commits
    if (refreshInFlightRef.current) {
      refreshQueuedOptsRef.current = opts ?? {};
      return refreshInFlightRef.current;
    }

    const myEpoch = ++refreshEpochRef.current;

    let bankItems: any[] = [];
    let matchItems: any[] = [];
    let matchGroupItems: any[] = [];

    const run = (async () => {
      const bankPromise = (async () => {
        if (myEpoch === refreshEpochRef.current) setBankTxLoading(true);
        const statusesToLoad = Array.from(
          new Set<BankTab>(
            opts?.statuses?.length
              ? opts.statuses
              : loadedBankStatuses.length
                ? loadedBankStatuses
                : [bankTab]
          )
        );
        try {
          setBankLoadingByStatus((prev) => {
            const next = { ...prev };
            for (const status of statusesToLoad) next[status] = true;
            return next;
          });

          const results = await Promise.all(
            statusesToLoad.map((status) =>
              listBankTransactions({
                businessId: selectedBusinessId,
                accountId: selectedAccountId,
                from: from || undefined,
                to: to || undefined,
                status,
                limit: BANK_TRANSACTION_PAGE_LIMIT,
              })
            )
          );

          const nextByStatus = new Map<BankTab, any[]>();
          statusesToLoad.forEach((status, index) => {
            nextByStatus.set(status, results[index]?.items ?? []);
          });
          const next = statusesToLoad.flatMap((status) => nextByStatus.get(status) ?? []);
          bankItems = next;

          if (myEpoch === refreshEpochRef.current) {
            setBankTx((prev) => {
              let merged = prev;
              for (const status of statusesToLoad) {
                const statusItems = nextByStatus.get(status) ?? [];
                const previousStatusCount = merged.filter((row: any) => row?.__reconcile_loaded_status === status).length;
                if (opts?.preserveOnEmpty && statusItems.length === 0 && previousStatusCount > 0) continue;
                merged = replaceBankTransactionsForStatus(merged, status, statusItems);
              }
              return merged;
            });
            setBankNextCursorByStatus((prev) => {
              const nextCursors = { ...prev, all: null };
              statusesToLoad.forEach((status, index) => {
                nextCursors[status] = results[index]?.nextCursor ?? null;
              });
              return nextCursors;
            });
            setBankLoadedScopeByStatus((prev) => {
              const nextScopes = { ...prev };
              for (const status of statusesToLoad) nextScopes[status] = bankScopeKey;
              return nextScopes;
            });
          }
        } catch {
          if (myEpoch === refreshEpochRef.current) {
            setBankTx((prev) => (opts?.preserveOnEmpty ? prev : []));
            if (!opts?.preserveOnEmpty) {
              setBankNextCursorByStatus({ all: null, unmatched: null, matched: null });
              setBankLoadedScopeByStatus({ unmatched: "", matched: "" });
            }
          }
        } finally {
          setBankLoadingByStatus((prev) => {
            const next = { ...prev };
            for (const status of statusesToLoad) next[status] = false;
            return next;
          });
          if (myEpoch === refreshEpochRef.current) {
            setBankTxLoading(false);
            setBankTruthHydrated(true);
          }
        }
      })();

      const matchesPromise = opts?.skipLegacyMatches
        ? Promise.resolve()
        : (async () => {
            if (myEpoch === refreshEpochRef.current) setMatchesLoading(true);
            try {
              const m = await listMatches({ businessId: selectedBusinessId, accountId: selectedAccountId });
              matchItems = m?.items ?? [];
              if (myEpoch === refreshEpochRef.current) setMatches(matchItems);
            } catch {
              if (myEpoch === refreshEpochRef.current) setMatches([]);
            } finally {
              if (myEpoch === refreshEpochRef.current) setMatchesLoading(false);
            }
          })();

      matchGroupItems = matchGroups;

      await Promise.all([bankPromise, matchesPromise]);

      return { bank: bankItems, matches: matchItems, matchGroups: matchGroupItems };
    })();

    refreshInFlightRef.current = run;

    try {
      return await run;
    } finally {
      // Clear in-flight
      if (refreshInFlightRef.current === run) refreshInFlightRef.current = null;

      // Run at most one queued refresh (latest wins)
      const queued = refreshQueuedOptsRef.current;
      refreshQueuedOptsRef.current = null;
      if (queued) {
        // Fire-and-forget (do not cascade waits / storms)
        void refreshBankAndMatches(queued);
      }
    }
  }

  const loadAllMatchGroups = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!selectedBusinessId || !selectedAccountId || !allMatchGroupsScopeKey) return [] as any[];
      if (!opts?.force && allMatchGroupsHydrated) return allMatchGroups;
      if (!opts?.force && allMatchGroupsInFlightRef.current) return allMatchGroupsInFlightRef.current;

      const scopeKey = allMatchGroupsScopeKey;
      const requestSeq = ++allMatchGroupsRequestSeqRef.current;
      const run = (async () => {
        setAllMatchGroupsLoading(true);
        try {
          const mg: any = await listMatchGroups({
            businessId: selectedBusinessId,
            accountId: selectedAccountId,
            status: "all",
          });
          const items = mg?.items ?? [];
          setAllMatchGroups(items);
          setAllMatchGroupsLoadedScope(scopeKey);
          return items;
        } catch {
          setAllMatchGroups([]);
          setAllMatchGroupsLoadedScope("");
          return [];
        } finally {
          setAllMatchGroupsLoading(false);
          if (allMatchGroupsRequestSeqRef.current === requestSeq) allMatchGroupsInFlightRef.current = null;
        }
      })();

      allMatchGroupsInFlightRef.current = run;
      return run;
    },
    [
      selectedBusinessId,
      selectedAccountId,
      allMatchGroupsScopeKey,
      allMatchGroupsHydrated,
      allMatchGroups,
    ]
  );

  async function loadMoreBankTransactions() {
    if (!selectedBusinessId || !selectedAccountId) return;

    const status: BankTab = bankTab === "matched" ? "matched" : "unmatched";
    const cursor = bankNextCursorByStatus[status];
    if (!cursor) return;

    setBankLoadingMore(true);
    try {
      const res = await listBankTransactions({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        from: from || undefined,
        to: to || undefined,
        status,
        limit: BANK_TRANSACTION_PAGE_LIMIT,
        cursor,
      });

      const nextItems = res?.items ?? [];
      setBankTx((prev) => mergeBankTransactions(prev, tagBankTransactionsForStatus(nextItems, status)));
      setBankNextCursorByStatus((prev) => ({
        ...prev,
        [status]: res?.nextCursor ?? null,
      }));
    } finally {
      setBankLoadingMore(false);
    }
  }

  // PERF: previously this looped through up to 20 paginated requests (10k
  // rows each) just to count unmatched bank transactions for the badge.
  // The backend now returns totalCount directly on the list endpoint, so
  // a single 1-row request gives us the count and the latest item.
  //
  // If the backend hasn't been deployed yet (no totalCount field), we fall
  // back to reporting the loaded page size as a lower-bound estimate
  // marked capped=true, so the UI still shows something useful instead of
  // refusing to render.
  const countUnmatchedBankTransactionsForScope = useCallback(async (args: {
    businessId: string;
    accountId: string;
    from?: string;
    to?: string;
  }): Promise<CountProbeResult> => {
    const res = await listBankTransactions({
      businessId: args.businessId,
      accountId: args.accountId,
      from: args.from || undefined,
      to: args.to || undefined,
      status: "unmatched",
      limit: 1, // we only need the totalCount field, not actual rows
    });

    if (typeof res?.totalCount === "number") {
      return { count: res.totalCount, capped: false };
    }

    // Fallback for pre-deploy backends.
    const partial = Array.isArray(res?.items) ? res.items.length : 0;
    return { count: partial, capped: !!res?.nextCursor };
  }, []);

  useEffect(() => {
    if (!selectedBusinessId || !selectedAccountId) {
      setBankUnmatchedScopeCounts({
        scopeKey: "",
        allTime: null,
        dateRange: null,
        loading: false,
        error: null,
      });
      return;
    }

    const scopeKey = `${selectedBusinessId}:${selectedAccountId}:${from || ""}:${to || ""}`;
    let cancelled = false;

    setBankUnmatchedScopeCounts({
      scopeKey,
      allTime: null,
      dateRange: null,
      loading: true,
      error: null,
    });

    (async () => {
      try {
        const allTimePromise = countUnmatchedBankTransactionsForScope({
          businessId: selectedBusinessId,
          accountId: selectedAccountId,
        });

        const dateRangePromise =
          from || to
            ? countUnmatchedBankTransactionsForScope({
                businessId: selectedBusinessId,
                accountId: selectedAccountId,
                from,
                to,
              })
            : allTimePromise;

        const [allTime, dateRange] = await Promise.all([allTimePromise, dateRangePromise]);
        if (cancelled) return;

        setBankUnmatchedScopeCounts({
          scopeKey,
          allTime,
          dateRange,
          loading: false,
          error: null,
        });
      } catch (e: any) {
        if (cancelled) return;
        setBankUnmatchedScopeCounts({
          scopeKey,
          allTime: null,
          dateRange: null,
          loading: false,
          error: e?.message ?? "Unable to load unmatched count",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedBusinessId, selectedAccountId, from, to, bankCountRefreshSeq, countUnmatchedBankTransactionsForScope]);

  // One debounced refresh after any mutation (no storms)
  const [refreshBusy, setRefreshBusy] = useState(false);
  const refreshTimerRef = useRef<any>(null);

  // Post-sync/connect bounded confirmation refresh (event-driven only; no polling storms)
  const postConnectRefreshTimerRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (postConnectRefreshTimerRef.current) clearTimeout(postConnectRefreshTimerRef.current);
    };
  }, []);

  async function runBoundedPostSyncRefresh(opts?: { preserveOnEmpty?: boolean }) {
    // Guardrail: only called from user-initiated Sync or connect completion handlers
    if (!selectedBusinessId || !selectedAccountId) return;

    if (postConnectRefreshTimerRef.current) clearTimeout(postConnectRefreshTimerRef.current);

    const baselineBankSig = bankSignature(bankTx);
    const baselineGroupSig = matchGroupSignature(matchGroups);
    const baselineEntriesSig = entriesSignature(entriesData ?? []);

    const schedule = [0, 1200, 2500]; // bounded backoff (max 3 pulls including immediate)
    let stopped = false;

    await new Promise<void>((resolve) => {
      const tick = async (i: number) => {
        if (stopped) {
          resolve();
          return;
        }

        const { bank, matchGroups: nextGroups } = await refreshBankAndMatches({
          preserveOnEmpty: true,
          skipLegacyMatches: true,
          ...(opts ?? {}),
        } as any);

        const entriesRes: any = await entriesQ.refetch?.();
        const nextEntries = entriesRes?.data ?? entriesData ?? [];

        const nextBankSig = bankSignature(Array.isArray(bank) ? bank : []);
        const nextGroupSig = matchGroupSignature(Array.isArray(nextGroups) ? nextGroups : []);
        const nextEntriesSig = entriesSignature(Array.isArray(nextEntries) ? nextEntries : []);

        // Stop early once any visible reconcile surface changed
        if (
          nextBankSig !== baselineBankSig ||
          nextGroupSig !== baselineGroupSig ||
          nextEntriesSig !== baselineEntriesSig
        ) {
          stopped = true;
          resolve();
          return;
        }

        if (i + 1 >= schedule.length) {
          resolve();
          return;
        }

        postConnectRefreshTimerRef.current = setTimeout(() => {
          void tick(i + 1);
        }, schedule[i + 1]);
      };

      void tick(0);
    });
  }

  async function refreshTablesFully(
    opts?: {
      preserveOnEmpty?: boolean;
      confirmSettle?: boolean;
      skipLegacyMatches?: boolean;
      silent?: boolean;
    }
  ) {
    if (!opts?.silent) setRefreshBusy(true);
    try {
      // Visible reconcile settle should prioritize the real placement truth:
      // bank transactions + match groups + entries.
      const placementTruthRefresh = refreshBankAndMatches({
        preserveOnEmpty: true,
        skipLegacyMatches: opts?.skipLegacyMatches ?? true,
        ...(opts ?? {}),
      });

      const entriesRefresh = entriesQ.refetch ? entriesQ.refetch() : Promise.resolve(undefined);

      await Promise.all([placementTruthRefresh, entriesRefresh]);

      // Optional bounded confirmation pass only for connect flows where needed.
      if (opts?.confirmSettle) {
        await runBoundedPostSyncRefresh({ preserveOnEmpty: true });
      }
    } finally {
      if (!opts?.silent) setRefreshBusy(false);
    }
  }
  const refreshBankAndMatchesRef = useRef(refreshBankAndMatches);
  refreshBankAndMatchesRef.current = refreshBankAndMatches;
  const refreshTablesFullyRef = useRef(refreshTablesFully);
  refreshTablesFullyRef.current = refreshTablesFully;

  function issueScanStorageKey(businessId: string, accountId: string) {
    return `bynkbook:lastScanAt:${businessId}:${accountId}`;
  }

  function clearIssueScanThrottle(businessId: string, accountId: string) {
    try {
      localStorage.removeItem(issueScanStorageKey(businessId, accountId));
    } catch {
      // localStorage may be unavailable; issue freshness still proceeds via API/query invalidation.
    }
  }

  async function refreshIssuesAfterBankEntryCreate() {
    if (!selectedBusinessId || !selectedAccountId) return;

    const businessId = selectedBusinessId;
    const accountId = selectedAccountId;

    clearIssueScanThrottle(businessId, accountId);

    await Promise.all([
      qc.invalidateQueries({ queryKey: ["entryIssues", businessId, accountId], exact: false }),
      qc.invalidateQueries({ queryKey: issueCountKey(businessId, accountId, "OPEN"), exact: false }),
    ]);
  }

  function refreshAllDebounced() {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      void refreshTablesFully({ preserveOnEmpty: true, skipLegacyMatches: true });
    }, 150);
  }

  function settleReconcileInBackground(
    reason: string,
    afterRefresh?: () => void | Promise<void>
  ) {
    void (async () => {
      try {
        await refreshTablesFully({
          preserveOnEmpty: true,
          skipLegacyMatches: true,
          silent: true,
        });
        await afterRefresh?.();
      } catch (e: any) {
        applyMutationError(e, `Can't refresh ${reason}`);
      }
    })();
  }

  useEffect(() => {
    const onLedgerRefresh = () => {
      void refreshTablesFullyRef.current({ preserveOnEmpty: true, skipLegacyMatches: true });
    };

    window.addEventListener("bynk:ledger-refresh", onLedgerRefresh as any);
    return () => window.removeEventListener("bynk:ledger-refresh", onLedgerRefresh as any);
  }, [selectedBusinessId, selectedAccountId]);

  // Create-entry busy state per bank txn (instant UX)
  const [createEntryBusyByBankId, setCreateEntryBusyByBankId] = useState<Record<string, boolean>>({});
  const [createEntryErr, setCreateEntryErr] = useState<string | null>(null);
  const [optimisticHiddenBankTxnIds, setOptimisticHiddenBankTxnIds] = useState<Set<string>>(() => new Set());
  const [optimisticPendingEntryDrafts, setOptimisticPendingEntryDrafts] = useState<any[]>([]);

  const bankUpdating =
    plaidSyncing ||
    bankTxLoading ||
    matchGroupsLoading;

  const entriesUpdating =
    plaidSyncing ||
    entriesQ.isFetching ||
    entriesBackgroundLoading ||
    matchGroupsLoading;

  // Create-entry confirmation dialog
  const [openCreateEntry, setOpenCreateEntry] = useState(false);
  const [createEntryBankTxnId, setCreateEntryBankTxnId] = useState<string | null>(null);
  const [createEntryAutoMatch, setCreateEntryAutoMatch] = useState(true);
  const [createEntryDuplicateCandidates, setCreateEntryDuplicateCandidates] = useState<any[]>([]);
  const [createEntryDuplicateConfirm, setCreateEntryDuplicateConfirm] = useState("");

  // Overrides
  const [createEntryMemo, setCreateEntryMemo] = useState("");
  const [createEntryMethod, setCreateEntryMethod] = useState("OTHER");
  const [createEntryCategoryId, setCreateEntryCategoryId] = useState<string>("");
  const [createEntryCategoryName, setCreateEntryCategoryName] = useState<string>("");
  const [createEntryCategoryTouched, setCreateEntryCategoryTouched] = useState(false);

  // Bundle B: canonical category suggestions (suggestion-only; user must click)
  const [createEntrySugLoading, setCreateEntrySugLoading] = useState(false);
  const [createEntrySugErr, setCreateEntrySugErr] = useState<string | null>(null);
  const [createEntrySuggestions, setCreateEntrySuggestions] = useState<Array<any>>([]);

  // Categories (for dropdown suggestions)
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [categoryQuery, setCategoryQuery] = useState("");

  // Load categories only when Create Entry opens.
  useEffect(() => {
    if (!openCreateEntry) return;
    if (!selectedBusinessId) return;
    if (categories.length > 0) return;

    let cancelled = false;
    (async () => {
      setCategoriesLoading(true);
      try {
        const res: any = await listCategories(selectedBusinessId, { includeArchived: false });
        const raw = Array.isArray(res?.rows) ? res.rows : [];

        const items = raw
          .map((c: any) => {
            const id = String(c?.id ?? "");
            const name = String(c?.name ?? "").trim();
            const normalized_name = String(c?.normalized_name ?? c?.normalizedName ?? "").trim();
            return id && name ? { id, name, normalized_name } : null;
          })
          .filter(Boolean) as any[];

        if (!cancelled) setCategories(items);
      } catch {
        if (!cancelled) setCategories([]);
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openCreateEntry, selectedBusinessId, categories.length]);

  // Phase F1: fetch top 3 category suggestions when Create Entry dialog opens (single batch request)
  useEffect(() => {
    if (!openCreateEntry) return;
    if (!selectedBusinessId || !selectedAccountId) return;

    const bankId = createEntryBankTxnId ? String(createEntryBankTxnId) : "";
    if (!bankId) {
      setCreateEntrySuggestions([]);
      setCreateEntrySugErr(null);
      setCreateEntrySugLoading(false);
      return;
    }

    // IMPORTANT: bankTxSorted is declared later in this file; avoid TDZ by using bankTx (state) here.
    const t = (bankTx ?? []).find((x: any) => String(x.id) === bankId);
    const desc = (t?.name ?? "").toString().trim();

    let cancelled = false;

    (async () => {
      setCreateEntrySugLoading(true);
      setCreateEntrySugErr(null);

      try {
        const { getCategorySuggestions } = await import("@/lib/api/ai");
        const res: any = await getCategorySuggestions({
          businessId: selectedBusinessId,
          accountId: selectedAccountId,
          items: [
            {
              kind: "BANK_TXN",
              id: bankId,
              date: t?.posted_date ? String(t.posted_date).slice(0, 10) : undefined,
              amount_cents: t?.amount_cents,
              payee_or_name: desc,
              memo: "",
            },
          ],
          limitPerItem: 3,
          includeAiFallback: true,
        });

        const s = res?.suggestionsById?.[bankId] ?? [];
        if (!cancelled) setCreateEntrySuggestions(Array.isArray(s) ? s : []);
      } catch (e: any) {
        if (!cancelled) {
          setCreateEntrySuggestions([]);
          setCreateEntrySugErr(e?.message ?? "Failed to load suggestions");
        }
      } finally {
        if (!cancelled) setCreateEntrySugLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openCreateEntry, createEntryBankTxnId, selectedBusinessId, selectedAccountId, bankTx]);

  const createEntrySafeSuggestion = useMemo(
    () => safeTopCategorySuggestion(createEntrySuggestions as any),
    [createEntrySuggestions]
  );

  const createEntrySafeSuggestionId = useMemo(
    () => categorySuggestionId(createEntrySafeSuggestion as any),
    [createEntrySafeSuggestion]
  );

  const createEntrySafeSuggestionName = useMemo(
    () =>
      categorySuggestionName(createEntrySafeSuggestion as any) ||
      String(categories.find((c: any) => String(c?.id ?? "") === createEntrySafeSuggestionId)?.name ?? "").trim(),
    [createEntrySafeSuggestion, createEntrySafeSuggestionId, categories]
  );

  useEffect(() => {
    if (!openCreateEntry) return;
    if (createEntryCategoryTouched) return;
    if (createEntryCategoryId) return;
    if (!createEntrySafeSuggestionId) return;

    setCreateEntryCategoryId(createEntrySafeSuggestionId);
    setCreateEntryCategoryName(createEntrySafeSuggestionName);
    setCategoryQuery("");
  }, [
    openCreateEntry,
    createEntryCategoryTouched,
    createEntryCategoryId,
    createEntrySafeSuggestionId,
    createEntrySafeSuggestionName,
  ]);

  // Load bank txns + match groups for the current reconcile scope.
  useEffect(() => {
    if (!selectedBusinessId) return;
    if (!selectedAccountId) return;

    // Reset first-load truth hydration for the new scope before fetching.
    setBankTruthHydrated(false);
    setMatchGroupsTruthHydrated(false);
    setBankTx([]);
    setBankTruthSnapshot(null);
    setMatchGroups([]);
    setAllMatchGroups([]);
    setAllMatchGroupsLoadedScope("");
    setBankLoadedScopeByStatus({ unmatched: "", matched: "" });
    setBankLoadingByStatus({ unmatched: false, matched: false });
    setBankNextCursorByStatus({ all: null, unmatched: null, matched: null });

    // One targeted refresh on mount / scope change (prevents “needs manual refresh” after navigation)
    void qc.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === "entries" &&
        q.queryKey[1] === selectedBusinessId &&
        q.queryKey[2] === selectedAccountId,
    });

    void refreshBankAndMatchesRef.current({ preserveOnEmpty: true, skipLegacyMatches: true, statuses: ["unmatched"] });
  }, [qc, selectedBusinessId, selectedAccountId, from, to]);

  useEffect(() => {
    if (bankTab !== "matched") return;
    if (!selectedBusinessId || !selectedAccountId) return;
    if (bankStatusLoaded.matched || bankLoadingByStatus.matched) return;
    void refreshBankAndMatchesRef.current({ preserveOnEmpty: true, skipLegacyMatches: true, statuses: ["matched"] });
  }, [bankTab, selectedBusinessId, selectedAccountId, bankStatusLoaded.matched, bankLoadingByStatus.matched]);

  useEffect(() => {
    const needsAllMatchGroups = openReconciliationHistory || openIssuesList || openExportHub;
    if (!needsAllMatchGroups) return;
    void loadAllMatchGroups();
  }, [openReconciliationHistory, openIssuesList, openExportHub, loadAllMatchGroups]);

  useEffect(() => {
    if (!openExportHub) return;
    if (bankTab !== "matched") return;
    if (bankStatusLoaded.matched || bankLoadingByStatus.matched) return;
    void refreshBankAndMatchesRef.current({ preserveOnEmpty: true, skipLegacyMatches: true, statuses: ["matched"] });
  }, [openExportHub, bankTab, bankStatusLoaded.matched, bankLoadingByStatus.matched]);

  // Phase 6B: Load snapshot list when dialog opens
  useEffect(() => {
    if (!openSnapshots) return;
    if (!selectedBusinessId) return;
    if (!selectedAccountId) return;

    let cancelled = false;
    (async () => {
      setSnapshotsLoading(true);
      setSnapshotsError(null);
      try {
        const items = await listReconcileSnapshots(selectedBusinessId, selectedAccountId);
        if (!cancelled) {
          setSnapshots(items ?? []);
          setSelectedSnapshotId(null);
          setSnapshot(null);
          setSnapshotError(null);
        }
      } catch (e: any) {
        if (!cancelled) setSnapshotsError(e?.message ?? "Failed to load snapshots");
      } finally {
        if (!cancelled) setSnapshotsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openSnapshots, selectedBusinessId, selectedAccountId]);

  // Phase 6B: Load selected snapshot details
  useEffect(() => {
    if (!openSnapshots) return;
    if (!selectedBusinessId) return;
    if (!selectedAccountId) return;
    if (!selectedSnapshotId) return;

    let cancelled = false;
    (async () => {
      setSnapshotLoading(true);
      setSnapshotError(null);
      try {
        const s = await getReconcileSnapshot(selectedBusinessId, selectedAccountId, selectedSnapshotId);
        if (!cancelled) setSnapshot(s);
      } catch (e: any) {
        if (!cancelled) setSnapshotError(e?.message ?? "Failed to load snapshot");
      } finally {
        if (!cancelled) setSnapshotLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [openSnapshots, selectedBusinessId, selectedAccountId, selectedSnapshotId]);

  // -------------------------
  // Derived + sorting (oldest-first)
  // -------------------------
  const isAdjustedEntry = useCallback((e: any) => Boolean(e?.is_adjustment) || locallyAdjusted.has(e?.id), [locallyAdjusted]);

  const isOpeningLikeEntry = useCallback((e: any) => {
    const t = String(e?.type ?? "").toUpperCase();
    const payee = String(e?.payee ?? "").trim().toLowerCase();
    return t === "OPENING" || payee.startsWith("opening balance");
  }, []);

  const selectedAccountForReconcile = useMemo(
    () => (accountsQ.data ?? []).find((a: any) => String(a.id) === String(selectedAccountId)) ?? null,
    [accountsQ.data, selectedAccountId]
  );

  const isReconcileExemptEntry = useCallback((e: any) => {
    const t = String(e?.type ?? "").toUpperCase();

    if (isInactiveEntryRecord(e)) return true;
    if (isOpeningLikeEntry(e)) return true;
    if (t !== "INCOME" && t !== "EXPENSE") return true;
    if (String(selectedAccountForReconcile?.type ?? "").toUpperCase() === "CASH") return true;

    return false;
  }, [isOpeningLikeEntry, selectedAccountForReconcile]);

  // Keep raw entries; tab-level filtering decides visibility (Expected hides Adjusted-unmatched)
  const allEntries = useMemo(() => (entriesData ?? []).filter((entry: any) => !isInactiveEntryRecord(entry)), [entriesData]);
  const entriesLoadedCount = allEntries.length;
  const entriesHitApiLimit = !!((entriesData as any)?.meta?.hasMore);

  const allEntriesSorted = useMemo(() => {
    const arr = [...allEntries];
    arr.sort(compareEntryDateAsc);
    return arr;
  }, [allEntries]);

  const allEntriesNewestFirst = useMemo(() => {
    const arr = [...allEntriesSorted];
    arr.sort(compareEntryDateDesc);
    return arr;
  }, [allEntriesSorted]);

  const bankTxSorted = useMemo(() => {
    const arr = [...bankTx];
    arr.sort(compareBankDateAsc);
    return arr;
  }, [bankTx]);

  useEffect(() => {
    if (!selectedBusinessId || !selectedAccountId) return;
    if (bankTxLoading || entriesInitialLoading) return;

    const requestSeq = ++placementSummaryRequestSeqRef.current;
    const bankTransactionIds = bankTxSorted.map((row: any) => String(row?.id ?? "").trim()).filter(Boolean);
    const entryIds = allEntriesSorted.map((row: any) => String(row?.id ?? "").trim()).filter(Boolean);

    let cancelled = false;
    (async () => {
      setMatchGroupsLoading(true);
      try {
        const summary = await getChunkedMatchGroupPlacementSummary({
          businessId: selectedBusinessId,
          accountId: selectedAccountId,
          bankTransactionIds,
          entryIds,
          from: from || undefined,
          to: to || undefined,
        });

        if (cancelled || requestSeq !== placementSummaryRequestSeqRef.current) return;
        setMatchGroups(matchGroupsFromPlacementSummary(summary));
        setMatchGroupsTruthHydrated(true);
      } catch {
        if (cancelled || requestSeq !== placementSummaryRequestSeqRef.current) return;
        setMatchGroups([]);
        setMatchGroupsTruthHydrated(true);
      } finally {
        if (!cancelled && requestSeq === placementSummaryRequestSeqRef.current) {
          setMatchGroupsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    selectedBusinessId,
    selectedAccountId,
    bankTxLoading,
    entriesInitialLoading,
    bankTxSorted,
    allEntriesSorted,
    from,
    to,
  ]);

  const bankTxNewestFirst = useMemo(() => {
    const arr = [...bankTxSorted];
    arr.sort(compareBankDateDesc);
    return arr;
  }, [bankTxSorted]);

  const entryByIdFast = useMemo(() => {
    const m = new Map<string, any>();
    for (const e of allEntriesSorted ?? []) m.set(String(e.id), e);
    return m;
  }, [allEntriesSorted]);

  const bankByIdFast = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of bankTxSorted ?? []) m.set(String(t.id), t);
    return m;
  }, [bankTxSorted]);

  const selectedAccountName = useMemo(() => {
    const a = (accountsQ.data ?? []).find((row: any) => String(row.id) === String(selectedAccountId));
    return String(a?.name ?? "");
  }, [accountsQ.data, selectedAccountId]);

  const selectedAccountOpeningDate = useMemo(() => {
    const raw = String(selectedAccountForReconcile?.opening_balance_date ?? "").slice(0, 10);
    return raw || new Date().toISOString().slice(0, 10);
  }, [selectedAccountForReconcile]);

  const selectedBusinessName = useMemo(() => {
    const b = (businessesQ.data ?? []).find((row: any) => String(row.id) === String(selectedBusinessId));
    return String(b?.name ?? "Business");
  }, [businessesQ.data, selectedBusinessId]);

  // MatchGroups lookup maps (read-only for now; used in next step to flip matched state)
  const matchGroupHasAdjustment = (g: any): boolean => {
    const entries = Array.isArray(g?.entries) ? g.entries : [];
    for (const e of entries) {
      // Deterministic: show Adjustment if any entry in the group is marked is_adjustment (or equivalent).
      if (Boolean(e?.is_adjustment)) return true;
      if (Boolean(e?.entry?.is_adjustment)) return true;
      if (Boolean((e as any)?.entry_is_adjustment)) return true;
    }
    return false;
  };

  const activeGroupByBankTxnId = useMemo(() => {
    const map = new Map<string, any>();
    for (const g of matchGroups ?? []) {
      if (String(g?.status ?? "").toUpperCase() !== "ACTIVE") continue;
      for (const b of g?.banks ?? []) {
        const id = String(b?.bank_transaction_id ?? "");
        if (id) map.set(id, g);
      }
    }
    return map;
  }, [matchGroups]);

  const activeGroupByEntryId = useMemo(() => {
    const map = new Map<string, any>();
    for (const g of matchGroups ?? []) {
      if (String(g?.status ?? "").toUpperCase() !== "ACTIVE") continue;
      for (const e of g?.entries ?? []) {
        const id = String(e?.entry_id ?? "");
        if (id) map.set(id, g);
      }
    }
    return map;
  }, [matchGroups]);

  // Treat voided matches as inactive (UI-only safety; listMatches may already exclude them)
  const isActiveMatch = useCallback((x: any) => {
    if (!x) return false;
    if (x.voided_at) return false;
    if (x.voidedAt) return false;
    if (x.is_voided) return false;
    if (x.isVoided) return false;
    return true;
  }, []);

  // Legacy v1 active matches (export-only; Reconcile UI uses MatchGroups)
  const activeMatches = useMemo(() => {
    return (matches ?? []).filter((x: any) => isActiveMatch(x));
  }, [matches, isActiveMatch]);

  const activeLegacyMatchByBankTxnId = useMemo(() => {
    const m = new Map<string, any>();
    for (const x of activeMatches ?? []) {
      const id = String(x?.bank_transaction_id ?? "");
      if (id) m.set(id, x);
    }
    return m;
  }, [activeMatches]);

  const activeLegacyMatchedAbsByBankTxnId = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const x of activeMatches ?? []) {
      const id = String(x?.bank_transaction_id ?? "");
      if (!id) continue;
      const matchedAbs = absBig(toBigIntSafe(x?.matched_amount_cents));
      m.set(id, (m.get(id) ?? 0n) + matchedAbs);
    }
    return m;
  }, [activeMatches]);

  const isBankTxnFullyMatched = useCallback((bankTxn: any) => {
    const id = String(bankTxn?.id ?? "");
    if (!id) return false;
    if (activeGroupByBankTxnId.has(id)) return true;

    const legacyAbs = activeLegacyMatchedAbsByBankTxnId.get(id) ?? 0n;
    if (legacyAbs <= 0n) return activeLegacyMatchByBankTxnId.has(id);

    const bankAbs = absBig(toBigIntSafe(bankTxn?.amount_cents));
    return bankAbs > 0n && legacyAbs >= bankAbs;
  }, [activeGroupByBankTxnId, activeLegacyMatchedAbsByBankTxnId, activeLegacyMatchByBankTxnId]);

  // (removed legacy matches-based revert marker; MatchGroups-based version is below)

  // Quick-match helper for the "Auto-match" badge on bank rows.
  // Performs the same createMatchGroupsBatch call the Match dialog uses,
  // but in-place — no dialog open/close cycle. Used only for high-confidence
  // unambiguous candidates surfaced by bankAutoMatchCandidateById.
  async function quickMatchAt(bankTxnId: string, entryId: string) {
    if (!selectedBusinessId || !selectedAccountId) return;
    if (!bankTxnId || !entryId) return;

    clearMutErr();
    markPending(bankTxnId);
    markPending(entryId);

    try {
      const res: any = await createMatchGroupsBatch({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        items: [
          {
            client_id: `auto:${bankTxnId}:${Date.now()}`,
            bankTransactionIds: [bankTxnId],
            entryIds: [entryId],
          },
        ],
      });

      const results = Array.isArray(res?.results) ? res.results : [];
      const first = results[0];
      if (!first?.ok) {
        setMutErrTitle("Can't auto-match");
        setMutErr(String(first?.error ?? "Match failed"));
        return;
      }

      const createdGroup =
        (first as any)?.match_group ??
        (first as any)?.matchGroup ??
        (first as any)?.group ??
        (first as any)?.item ??
        null;

      if (createdGroup?.id) {
        setMatchGroups((prev) => upsertMatchGroup(prev, createdGroup));
        if (allMatchGroupsHydrated) {
          setAllMatchGroups((prev) => upsertMatchGroup(prev, createdGroup));
        }
      }

      clearMutErr();
      settleReconcileInBackground("auto-match");
    } catch (e: any) {
      const r = applyMutationError(e, "Can't auto-match");
      if (r.isClosed) {
        // CLOSED_PERIOD banner is handled by applyMutationError; no extra UI here.
      }
    } finally {
      clearPending(bankTxnId);
      clearPending(entryId);
    }
  }

  // MatchGroups (FULL match only): entry is matched iff it appears in an ACTIVE group
  const matchedEntryIdSet = useMemo(() => {
    return new Set<string>(Array.from(activeGroupByEntryId.keys()));
  }, [activeGroupByEntryId]);

  // Legacy v1 map retained only for history/audit fallback UI paths (do not use for matched state)
  const matchByEntryId = useMemo(() => {
    const m = new Map<string, any>();
    for (const x of matches ?? []) {
      if (!isActiveMatch(x)) continue;
      if (!x?.entry_id) continue;
      m.set(x.entry_id, x);
    }
    return m;
  }, [matches, isActiveMatch]);

  // MatchGroups (FULL match only): matchedAbs is either 0 or full abs(bank.amount_cents); remainingAbs is either full or 0.
  const matchedAbsByBankTxnId = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const t of bankTxSorted ?? []) {
      const id = String(t.id);
      if (!id) continue;
      const legacyMatch = activeLegacyMatchByBankTxnId.get(id);
      const legacyAbs = activeLegacyMatchedAbsByBankTxnId.get(id) ?? 0n;
      if (!activeGroupByBankTxnId.has(id) && !legacyMatch) continue;
      const bankAbs = absBig(toBigIntSafe(t.amount_cents));
      if (bankAbs > 0n) m.set(id, legacyAbs > 0n ? legacyAbs : bankAbs);
    }
    return m;
  }, [bankTxSorted, activeGroupByBankTxnId, activeLegacyMatchByBankTxnId, activeLegacyMatchedAbsByBankTxnId]);

  const remainingAbsByBankTxnId = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const t of bankTxSorted ?? []) {
      const id = String(t.id);
      if (!id) continue;
      const bankAbs = absBig(toBigIntSafe(t.amount_cents));
      if (activeGroupByBankTxnId.has(id)) {
        m.set(id, 0n);
        continue;
      }
      const legacyAbs = activeLegacyMatchedAbsByBankTxnId.get(id) ?? 0n;
      const remaining = legacyAbs > 0n ? bankAbs - legacyAbs : bankAbs;
      m.set(id, remaining > 0n ? remaining : 0n);
    }
    return m;
  }, [bankTxSorted, activeGroupByBankTxnId, activeLegacyMatchedAbsByBankTxnId]);

  function getCreateEntryActionBlockReason(bankId: string) {
    const id = String(bankId ?? "").trim();
    if (!id) return matchedOrPendingCreateEntryMessage;
    if (pendingById[id] || createEntryBusyByBankId[id]) return matchedOrPendingCreateEntryMessage;

    const bank = bankByIdFast.get(id);
    if (!bank) return "Refresh the bank transaction list before trying again.";
    if (bank?.is_pending) return "Pending transaction. Actions unlock once it posts.";
    if (isBankTxnFullyMatched(bank) || (remainingAbsByBankTxnId.get(id) ?? 0n) === 0n) {
      return matchedOrPendingCreateEntryMessage;
    }

    return null;
  }

    function buildBankAiCandidates(bank: any) {
    const bankAmt = toBigIntSafe(bank?.amount_cents);
    const bankSign = bankAmt < 0n ? -1n : 1n;

    return allEntriesSorted
      .filter((e: any) => {
        if (matchByEntryId.has(e.id)) return false;
        const entryAmt = toBigIntSafe(e.amount_cents);
        const entrySign = entryAmt < 0n ? -1n : 1n;
        return entrySign === bankSign;
      })
      .map((e: any) => {
        const meta = scoreEntryCandidate(bank, e);
        return {
          e,
          meta,
          payload: {
            entryId: String(e.id),
            date: String(e.date ?? "").slice(0, 10),
            amount_cents: String(e.amount_cents ?? 0),
            payee: String(e.payee ?? ""),
            amount_delta_cents: meta.diff.toString(),
            date_delta_days: meta.dtDays,
            text_similarity: meta.overlap,
            exact_amount: meta.exactAmount,
            heuristic_score: meta.score,
          },
        };
      })
      .sort((a: any, b: any) => a.meta.score - b.meta.score)
      .slice(0, 12);
  }

  function buildEntryAiCandidates(entry: any) {
    const entryAmt = toBigIntSafe(entry.amount_cents);
    const entrySign = entryAmt < 0n ? -1n : 1n;

    return bankTxSorted
      .filter((t: any) => {
        const remaining = remainingAbsByBankTxnId.get(t.id) ?? 0n;
        if (remaining <= 0n) return false;

        const bankAmt = toBigIntSafe(t.amount_cents);
        const bankSign = bankAmt < 0n ? -1n : 1n;
        return bankSign === entrySign;
      })
      .map((t: any) => {
        const meta = scoreBankCandidate(entry, t);
        return {
          t,
          meta,
          payload: {
            bankTransactionId: String(t.id),
            posted_date: String(t.posted_date ?? "").slice(0, 10),
            amount_cents: String(t.amount_cents ?? 0),
            name: String(t.name ?? ""),
            amount_delta_cents: meta.diff.toString(),
            date_delta_days: meta.dtDays,
            text_similarity: meta.overlap,
            exact_amount: meta.exactAmount,
            heuristic_score: meta.score,
          },
        };
      })
      .sort((a: any, b: any) => a.meta.score - b.meta.score)
      .slice(0, 12);
  }

  async function runAiSuggestForBank(bank: any) {
    if (!selectedBusinessId) return;

    setMatchAiSuggestions([]);
    setMatchSuggestError(null);
    setMatchSuggestLoading(true);

    try {
      const ranked = buildBankAiCandidates(bank);
      const best = ranked[0]?.e ?? null;

      if (!ranked.length) {
        setMatchSelectedEntryIds(new Set());
        setMatchAiSuggestions([]);
        return;
      }

      const res: any = await aiSuggestReconcileBank({
        businessId: selectedBusinessId,
        bankTransaction: {
          id: String(bank.id),
          posted_date: String(bank.posted_date ?? "").slice(0, 10),
          amount_cents: String(bank.amount_cents ?? 0),
          name: String(bank.name ?? ""),
        },
        candidates: ranked.map((x: any) => x.payload),
      });

      const suggestions = Array.isArray(res?.suggestions) ? res.suggestions.slice(0, 3) : [];
      setMatchAiSuggestions(suggestions);

      const selectedId = String(suggestions[0]?.entryId ?? best?.id ?? "").trim();
      setMatchSelectedEntryIds(() => {
        const s = new Set<string>();
        if (selectedId) s.add(selectedId);
        return s;
      });
    } catch (e: any) {
      setMatchSuggestError(
        aiUiMessage(e, "Smart suggestions are unavailable right now. Review the top candidates below.")
      );
      const ranked = buildBankAiCandidates(bank);
      const best = ranked[0]?.e ?? null;
      setMatchAiSuggestions([]);
      setMatchSelectedEntryIds(() => {
        const s = new Set<string>();
        if (best?.id) s.add(String(best.id));
        return s;
      });
    } finally {
      setMatchSuggestLoading(false);
    }
  }

  async function runAiSuggestForEntry(entry: any) {
    if (!selectedBusinessId) return;

    setEntryAiSuggestions([]);
    setEntrySuggestError(null);
    setEntrySuggestLoading(true);

    try {
      const ranked = buildEntryAiCandidates(entry);
      const best = ranked[0]?.t ?? null;

      if (!ranked.length) {
        setEntryMatchSelectedBankTxnIds(new Set());
        setEntryAiSuggestions([]);
        return;
      }

      const res: any = await aiSuggestReconcileEntry({
        businessId: selectedBusinessId,
        entry: {
          id: String(entry.id),
          date: String(entry.date ?? "").slice(0, 10),
          amount_cents: String(entry.amount_cents ?? 0),
          payee: String(entry.payee ?? ""),
        },
        candidates: ranked.map((x: any) => x.payload),
      });

      const suggestions = Array.isArray(res?.suggestions) ? res.suggestions.slice(0, 3) : [];
      setEntryAiSuggestions(suggestions);

      const selectedId = String(suggestions[0]?.bankTransactionId ?? best?.id ?? "").trim();
      setEntryMatchSelectedBankTxnIds(() => {
        const s = new Set<string>();
        if (selectedId) s.add(selectedId);
        return s;
      });
    } catch (e: any) {
      setEntrySuggestError(
        aiUiMessage(e, "Smart suggestions are unavailable right now. Review the top candidates below.")
      );
      const ranked = buildEntryAiCandidates(entry);
      const best = ranked[0]?.t ?? null;
      setEntryAiSuggestions([]);
      setEntryMatchSelectedBankTxnIds(() => {
        const s = new Set<string>();
        if (best?.id) s.add(String(best.id));
        return s;
      });
    } finally {
      setEntrySuggestLoading(false);
    }
  }

  // -------------------------
  // -------------------------
  // Phase 5C: Issues (read-only, derived from loaded data)
  // -------------------------
  // NOTE: Use local maps declared BEFORE the Issues memos to avoid TDZ ("used before initialization").
  const bankTxnByIdForIssues = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of bankTxSorted ?? []) m.set(String(t.id), t);
    return m;
  }, [bankTxSorted]);

  const entryByIdForIssues = useMemo(() => {
    const m = new Map<string, any>();
    for (const e of allEntriesSorted ?? []) m.set(String(e.id), e);
    return m;
  }, [allEntriesSorted]);

  // -------------------------
  // Issues (MatchGroups-only; full-match only)
  // -------------------------
  const activeGroups = useMemo(() => {
    const source = allMatchGroupsHydrated ? allMatchGroups : matchGroups;
    return (source ?? []).filter((g: any) => String(g?.status ?? "").toUpperCase() === "ACTIVE");
  }, [allMatchGroups, allMatchGroupsHydrated, matchGroups]);

  const voidedGroups = useMemo(() => {
    if (!allMatchGroupsHydrated) return [];
    return (allMatchGroups ?? []).filter((g: any) => !!g?.voided_at);
  }, [allMatchGroups, allMatchGroupsHydrated]);

  // Issues threshold (tunable)
  const VOID_HEAVY_THRESHOLD = 3;

  const voidCountByBankTxnId = useMemo(() => {
    // count voided groups per bank txn id (each voided group counts once for each bank txn in it)
    const m = new Map<string, number>();
    for (const g of voidedGroups) {
      for (const b of (g?.banks ?? [])) {
        const bt = String(b?.bank_transaction_id ?? "");
        if (!bt) continue;
        m.set(bt, (m.get(bt) ?? 0) + 1);
      }
    }
    return m;
  }, [voidedGroups]);

  // Has any revert for this bank txn (used for the RotateCcw icon)
  const hasVoidByBankTxnId = useMemo(() => {
    const s = new Set<string>();
    for (const [bt, n] of voidCountByBankTxnId.entries()) {
      if (n > 0) s.add(bt);
    }
    return s;
  }, [voidCountByBankTxnId]);

  type IssueRow = {
    kind: "notInView" | "voidHeavy";
    bankTxnId?: string | null;
    entryId?: string | null;
    groupId?: string | null;
    title: string;
    detail: string;
  };

  const issuesNotInView = useMemo((): IssueRow[] => {
    // NotInView: ACTIVE groups referencing bank/entry ids not present in current loaded lists
    const out: IssueRow[] = [];

    for (const g of activeGroups) {
      const gid = String(g?.id ?? "");
      const bankTxnIds = (g?.banks ?? []).map((b: any) => String(b?.bank_transaction_id ?? "")).filter(Boolean);
      const entryIds = (g?.entries ?? []).map((e: any) => String(e?.entry_id ?? "")).filter(Boolean);

      const missingBank = bankTxnIds.find((id: string) => !bankTxnByIdForIssues.has(id)) ?? null;
      const missingEntry = entryIds.find((id: string) => !entryByIdForIssues.has(id)) ?? null;

      if (missingBank || missingEntry) {
        out.push({
          kind: "notInView",
          bankTxnId: missingBank ?? (bankTxnIds[0] ?? null),
          entryId: missingEntry ?? (entryIds[0] ?? null),
          groupId: gid,
          title: `Group ${shortId(gid)}`,
          detail:
            `${missingBank ? `Bank: ${shortId(missingBank)} (not in current view)` : "Bank: in view"} • ` +
            `${missingEntry ? `Entry: ${shortId(missingEntry)} (not in current view)` : "Entry: in view"}`,
        });
      }
    }

    return out;
  }, [activeGroups, bankTxnByIdForIssues, entryByIdForIssues]);

  const issuesVoidHeavy = useMemo((): IssueRow[] => {
    const out: IssueRow[] = [];
    for (const [bt, n] of voidCountByBankTxnId.entries()) {
      if (n < VOID_HEAVY_THRESHOLD) continue;

      const bank = bankTxnByIdForIssues.get(bt) ?? null;
      const title = bank
        ? `${isoToYmd(String(bank.posted_date ?? ""))} • ${String(bank.name ?? "").trim() || "—"}`
        : `${shortId(bt)} (not in current view)`;

      out.push({
        kind: "voidHeavy",
        bankTxnId: bt,
        groupId: null,
        title,
        detail: `${n} reverts recorded`,
      });
    }
    return out;
  }, [voidCountByBankTxnId, bankTxnByIdForIssues]);

  const issuesCounts = useMemo(() => {
    const notInView = issuesNotInView.length;
    const voidHeavy = issuesVoidHeavy.length;
    return {
      notInView,
      voidHeavy,
      total: notInView + voidHeavy,
      conflicts: 0, // full-match groups + one-active-group-per-item => conflicts should not exist
    };
  }, [issuesNotInView.length, issuesVoidHeavy.length]);

  // -------------------------
  // Phase 5A: Reconciliation history (audit)
  // Derived from MatchGroups (CPA-clean, full-match only)
  // -------------------------
  function shortId(id: any) {
    const s = String(id ?? "");
    if (s.length <= 10) return s;
    return `${s.slice(0, 6)}…${s.slice(-4)}`;
  }

  function auditUserLabel(userId: any) {
    const s = String(userId ?? "").trim();
    if (!s) return "System";
    const email = teamEmailByUserId.get(s);
    return email ? email : "Unknown user";
  }

  const bankTxnById = useMemo(() => {
    const m = new Map<string, any>();
    for (const t of bankTxSorted ?? []) m.set(String(t.id), t);
    return m;
  }, [bankTxSorted]);

  const entryById = useMemo(() => {
    const m = new Map<string, any>();
    for (const e of allEntriesSorted ?? []) m.set(String(e.id), e);
    return m;
  }, [allEntriesSorted]);

  type ReconAuditEvent = {
    groupId: string;
    kind: "MATCH_GROUP_CREATED" | "MATCH_GROUP_VOIDED";
    at: string; // ISO
    by: string | null;
    bankTxnIds: string[];
    entryIds: string[];
    amountAbsCents: bigint; // positive
  };

  const buildReconAuditEvents = useCallback((groups: any[]) => {
    const out: ReconAuditEvent[] = [];

    for (const g of groups ?? []) {
      if (!g?.id) continue;

      const gid = String(g.id);
      const banks = Array.isArray(g?.banks) ? g.banks : [];
      const entries = Array.isArray(g?.entries) ? g.entries : [];

      const bankTxnIds = banks.map((b: any) => String(b?.bank_transaction_id ?? "")).filter(Boolean);
      const entryIds = entries.map((e: any) => String(e?.entry_id ?? "")).filter(Boolean);

      const bankSum = banks.reduce((acc: bigint, b: any) => acc + absBig(toBigIntSafe(b?.matched_amount_cents)), 0n);

      if (g?.created_at) {
        out.push({
          groupId: gid,
          kind: "MATCH_GROUP_CREATED",
          at: String(g.created_at),
          by: g.created_by_user_id ? String(g.created_by_user_id) : null,
          bankTxnIds,
          entryIds,
          amountAbsCents: bankSum,
        });
      }

      if (g?.voided_at) {
        out.push({
          groupId: gid,
          kind: "MATCH_GROUP_VOIDED",
          at: String(g.voided_at),
          by: g.voided_by_user_id ? String(g.voided_by_user_id) : null,
          bankTxnIds,
          entryIds,
          amountAbsCents: bankSum,
        });
      }
    }

    // newest-first, then deterministic tiebreak
    out.sort((a, b) => {
      const ta = new Date(a.at).getTime();
      const tb = new Date(b.at).getTime();
      if (ta !== tb) return tb - ta;
      if (a.kind !== b.kind) return a.kind === "MATCH_GROUP_VOIDED" ? -1 : 1;
      return a.groupId.localeCompare(b.groupId);
    });

    return out.slice(0, 500);
  }, []);

  const reconAuditAll = useMemo(() => {
    if (!allMatchGroupsHydrated) return [] as ReconAuditEvent[];
    return buildReconAuditEvents(allMatchGroups);
  }, [allMatchGroups, allMatchGroupsHydrated, buildReconAuditEvents]);

  const reconAuditCounts = useMemo(() => {
    let matchN = 0;
    let voidN = 0;
    for (const e of reconAuditAll) {
      if (e.kind === "MATCH_GROUP_CREATED") matchN++;
      else voidN++;
    }
    return { all: reconAuditAll.length, match: matchN, void: voidN };
  }, [reconAuditAll]);

  const reconAuditVisible = useMemo(() => {
    let base =
      reconHistoryFilter === "match"
        ? reconAuditAll.filter((e) => e.kind === "MATCH_GROUP_CREATED")
        : reconHistoryFilter === "void"
          ? reconAuditAll.filter((e) => e.kind === "MATCH_GROUP_VOIDED")
          : reconAuditAll;

    if (reconHistoryBankTxnFilterId) {
      base = base.filter((e) => e.bankTxnIds.some((id) => String(id) === String(reconHistoryBankTxnFilterId)));
    }

    const q = reconHistorySearch.trim().toLowerCase();
    if (q) {
      base = base.filter((e) => {
        if (e.groupId.toLowerCase().includes(q)) return true;
        if (e.bankTxnIds.some((id) => id.toLowerCase().includes(q))) return true;
        if (e.entryIds.some((id) => id.toLowerCase().includes(q))) return true;

        const bank0 = e.bankTxnIds[0] ? bankTxnById.get(String(e.bankTxnIds[0])) : null;
        const entry0 = e.entryIds[0] ? entryById.get(String(e.entryIds[0])) : null;

        const bankText = String(bank0?.name ?? "").toLowerCase();
        const entryText = String(entry0?.payee ?? "").toLowerCase();

        return bankText.includes(q) || entryText.includes(q);
      });
    }

    return base;
  }, [reconAuditAll, reconHistoryFilter, reconHistoryBankTxnFilterId, reconHistorySearch, bankTxnById, entryById]);
  // (removed legacy v1 BankMatch-based history block; MatchGroups history above is the source of truth)

  // -------------------------
  // Phase 5D: Export helpers (frontend-only, safe CSV)
  // -------------------------
  const csvCell = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const toCsv = (headers: string[], rows: Record<string, any>[]) => {
    const head = headers.map(csvCell).join(",");
    const lines = rows.map((r) => headers.map((h) => csvCell(r[h])).join(","));
    return [head, ...lines].join("\r\n");
  };

  const downloadCsv = (filename: string, csvText: string) => {
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportBankCsv = () => {
    if (!selectedBusinessId || !selectedAccountId) return;

    const list = bankTab === "unmatched" ? bankUnmatchedList : bankMatchedList;

    // Newest-first: posted_date DESC, then id
    const ordered = [...list].sort((a: any, b: any) => {
      const da = new Date(a.posted_date).getTime();
      const db = new Date(b.posted_date).getTime();
      if (da !== db) return db - da;
      return String(a.id).localeCompare(String(b.id));
    });

    const rows = ordered.map((t: any) => {
      const bankAbs = absBig(toBigIntSafe(t.amount_cents));
      const matchedAbsCents = matchedAbsByBankTxnId.get(t.id) ?? 0n;
      const remainingAbsCents = remainingAbsByBankTxnId.get(t.id) ?? bankAbs;

      const status = matchedAbsCents === 0n ? "UNMATCHED" : "MATCHED";

      const voidCount = voidCountByBankTxnId.get(String(t.id)) ?? 0;

      return {
        business_id: selectedBusinessId,
        account_id: selectedAccountId,
        bank_transaction_id: String(t.id),
        posted_date: String(t.posted_date ?? ""),
        description: String(t.name ?? ""),
        source: String(t.source ?? ""),
        amount_cents: String(t.amount_cents ?? ""),
        amount: formatUsdFromCents(toBigIntSafe(t.amount_cents)),
        status,
        matched_abs_cents: String(matchedAbsCents),
        matched_abs_amount: formatUsdFromCents(matchedAbsCents),
        remaining_abs_cents: String(remainingAbsCents),
        remaining_abs_amount: formatUsdFromCents(remainingAbsCents),
        void_count: String(voidCount),
      };
    });

    const headers = [
      "business_id",
      "account_id",
      "bank_transaction_id",
      "posted_date",
      "description",
      "source",
      "amount_cents",
      "amount",
      "status",
      "matched_abs_cents",
      "matched_abs_amount",
      "remaining_abs_cents",
      "remaining_abs_amount",
      "void_count",
    ];

    downloadCsv("reconcile_bank_transactions.csv", toCsv(headers, rows));
  };

  const exportAuditEventsCsv = () => {
    if (!selectedBusinessId || !selectedAccountId) return;

    // reconAuditVisible already respects:
    // - newest 500 cap (via reconAuditAll)
    // - filter pills (All/Match/Voids)
    // - bankTxn filter
    // - local search
    const rows = reconAuditVisible.map((ev: any) => {
      const bank0 = Array.isArray(ev?.bankTxnIds) && ev.bankTxnIds[0] ? String(ev.bankTxnIds[0]) : "";
      const entry0 = Array.isArray(ev?.entryIds) && ev.entryIds[0] ? String(ev.entryIds[0]) : "";

      return {
        business_id: selectedBusinessId,
        account_id: selectedAccountId,
        event_type: ev.kind === "MATCH_GROUP_CREATED" ? "MATCH" : "REVERT",
        event_at: String(ev.at ?? ""),
        event_by_user_id: String(ev.by ?? ""),
        match_group_id: String(ev.groupId ?? ""),
        bank_transaction_id: bank0,
        entry_id: entry0,
        matched_amount_abs_cents: String(ev.amountAbsCents ?? ""),
        match_type: "FULL",
      };
    });

    const headers = [
      "business_id",
      "account_id",
      "event_type",
      "event_at",
      "event_by_user_id",
      "match_group_id",
      "bank_transaction_id",
      "entry_id",
      "matched_amount_abs_cents",
      "match_type",
    ];

    downloadCsv("reconcile_audit_events.csv", toCsv(headers, rows));
  };

  // Local search (filters visible rows only; instant-fast)
  const searchQ = useMemo(() => search.trim().toLowerCase(), [search]);

  // Phase 2 Performance: when tab/search changes, reset visible limits (so we don't render thousands immediately)
  useEffect(() => {
    setExpectedVisibleN(PAGE_CHUNK);
    setMatchedVisibleN(PAGE_CHUNK);
  }, [expectedTab, searchQ]);

  useEffect(() => {
    setBankUnmatchedVisibleN(PAGE_CHUNK);
    setBankMatchedVisibleN(PAGE_CHUNK);
  }, [bankTab, searchQ]);

  const matchesRowSearch = useCallback((hay: string) => {
    if (!searchQ) return true;
    return (hay ?? "").toLowerCase().includes(searchQ);
  }, [searchQ]);

  // Tabs: Expected Entries. Keep the full filtered lists available for matching,
  // counts, and reconciliation truth. Slice only the rendered rows.
  const entriesExpectedAllList = useMemo(() => {
    const out: any[] = [];
    const orderedEntries = [...optimisticPendingEntryDrafts, ...allEntriesSorted].sort(compareEntryDateAsc);

    for (const e of orderedEntries) {
      if (matchedEntryIdSet.has(e.id)) continue;
      if (isAdjustedEntry(e)) continue;
      if (isReconcileExemptEntry(e)) continue;

      const hay = `${String(e.date ?? "")} ${String(e.payee ?? "")} ${String(e.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;

      out.push(e);
    }
    return out;
  }, [optimisticPendingEntryDrafts, allEntriesSorted, matchedEntryIdSet, matchesRowSearch, isAdjustedEntry, isReconcileExemptEntry]);

  const entriesMatchedAllList = useMemo(() => {
    const out: any[] = [];
    for (const e of allEntriesNewestFirst) {
      if (!matchedEntryIdSet.has(e.id)) continue;
      if (isReconcileExemptEntry(e)) continue;

      const hay = `${String(e.date ?? "")} ${String(e.payee ?? "")} ${String(e.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;

      out.push(e);
    }
    return out;
  }, [allEntriesNewestFirst, matchedEntryIdSet, matchesRowSearch, isReconcileExemptEntry]);

  const entriesExpectedList = useMemo(
    () => entriesExpectedAllList.slice(0, expectedVisibleN),
    [entriesExpectedAllList, expectedVisibleN]
  );

  const entriesMatchedList = useMemo(
    () => entriesMatchedAllList.slice(0, matchedVisibleN),
    [entriesMatchedAllList, matchedVisibleN]
  );

  const expectedCount = entriesExpectedAllList.length;
  const matchedCount = entriesMatchedAllList.length;

  // Tabs: Bank Transactions (Phase 2: cap rendered rows for instant tab switches)
  const bankUnmatchedList = useMemo(() => {
    const out: any[] = [];
    for (const t of bankTxSorted) {
      const hay = `${String(t.posted_date ?? "")} ${String(t.name ?? "")} ${String(t.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;

      const id = String(t.id ?? "");
      if (!id) continue;
      if (optimisticHiddenBankTxnIds.has(id)) continue;
      if (isBankTxnFullyMatched(t)) continue;

      out.push(t);
      if (out.length >= bankUnmatchedVisibleN) break;
    }
    return out;
  }, [bankTxSorted, optimisticHiddenBankTxnIds, isBankTxnFullyMatched, matchesRowSearch, bankUnmatchedVisibleN]);

  useEffect(() => {
    setSelectedBankTxnIds(new Set());
  }, [bankTab, selectedBusinessId, selectedAccountId]);

  const bankMatchedList = useMemo(() => {
    const out: any[] = [];
    for (const t of bankTxNewestFirst) {
      const hay = `${String(t.posted_date ?? "")} ${String(t.name ?? "")} ${String(t.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;

      const id = String(t.id ?? "");
      if (!id) continue;
      if (!isBankTxnFullyMatched(t)) continue;

      out.push(t);
      if (out.length >= bankMatchedVisibleN) break;
    }
    return out;
  }, [bankTxNewestFirst, isBankTxnFullyMatched, matchesRowSearch, bankMatchedVisibleN]);

  const bankPendingUnmatchedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const t of bankTxSorted) {
      const id = String(t.id ?? "");
      if (!id) continue;
      if (!t?.is_pending) continue;
      if (optimisticHiddenBankTxnIds.has(id)) continue;
      if (isBankTxnFullyMatched(t)) continue;
      ids.add(id);
    }
    return ids;
  }, [bankTxSorted, optimisticHiddenBankTxnIds, isBankTxnFullyMatched]);

  useEffect(() => {
    if (bankPendingUnmatchedIds.size === 0) return;
    setSelectedBankTxnIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of bankPendingUnmatchedIds) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [bankPendingUnmatchedIds]);

  const selectedActionableBankTxnIds = useMemo(() => {
    return Array.from(selectedBankTxnIds).filter((id) => {
      const bankId = String(id);
      const bank = bankByIdFast.get(bankId);
      if (!bank) return false;
      if (bankPendingUnmatchedIds.has(bankId)) return false;
      if (pendingById[bankId] || createEntryBusyByBankId[bankId]) return false;
      if (isBankTxnFullyMatched(bank)) return false;
      if ((remainingAbsByBankTxnId.get(bankId) ?? 0n) === 0n) return false;
      return true;
    });
  }, [
    selectedBankTxnIds,
    bankByIdFast,
    bankPendingUnmatchedIds,
    pendingById,
    createEntryBusyByBankId,
    isBankTxnFullyMatched,
    remainingAbsByBankTxnId,
  ]);

  const bankUnmatchedLoadedRowsNoSearch = useMemo(() => {
    let count = 0;
    for (const t of bankTxSorted) {
      const id = String(t.id ?? "");
      if (!id) continue;
      if (optimisticHiddenBankTxnIds.has(id)) continue;
      if (isBankTxnFullyMatched(t)) continue;
      count++;
    }
    return count;
  }, [bankTxSorted, optimisticHiddenBankTxnIds, isBankTxnFullyMatched]);

  const bankMatchedLoadedRowsNoSearch = useMemo(() => {
    let count = 0;
    for (const t of bankTxSorted) {
      const id = String(t.id ?? "");
      if (!id) continue;
      if (isBankTxnFullyMatched(t)) count++;
    }
    return count;
  }, [bankTxSorted, isBankTxnFullyMatched]);

  // Counts (uncapped) for tab labels
  const { bankUnmatchedCount, bankMatchedCount, bankPendingUnmatchedCount } = useMemo(() => {
    let u = 0;
    let m = 0;
    let pending = 0;
    for (const t of bankTxSorted) {
      const hay = `${String(t.posted_date ?? "")} ${String(t.name ?? "")} ${String(t.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;

      const id = String(t.id ?? "");
      if (!id) continue;

      if (isBankTxnFullyMatched(t)) {
        m++;
      } else if (!optimisticHiddenBankTxnIds.has(id)) {
        u++;
        if (t?.is_pending) pending++;
      }
    }
    return { bankUnmatchedCount: u, bankMatchedCount: m, bankPendingUnmatchedCount: pending };
  }, [bankTxSorted, optimisticHiddenBankTxnIds, isBankTxnFullyMatched, matchesRowSearch]);

  const entriesTruthReady =
    !entriesInitialLoading &&
    matchGroupsTruthHydrated &&
    !matchGroupsLoading;

  const activeBankStatusLoaded = bankStatusLoaded[bankTab];
  const activeBankStatusLoading = bankLoadingByStatus[bankTab];

  const bankTruthReady =
    bankTruthHydrated &&
    activeBankStatusLoaded &&
    matchGroupsTruthHydrated &&
    !bankTxLoading &&
    !matchGroupsLoading;

  useEffect(() => {
    if (!entriesTruthReady) return;
    setEntriesTruthSnapshot({
      expectedList: entriesExpectedList,
      matchedList: entriesMatchedList,
      expectedCount,
      matchedCount,
    });
  }, [entriesTruthReady, entriesExpectedList, entriesMatchedList, expectedCount, matchedCount]);

  useEffect(() => {
    if (!bankTruthReady) return;
    setBankTruthSnapshot({
      unmatchedList: bankUnmatchedList,
      matchedList: bankMatchedList,
      unmatchedCount: bankUnmatchedCount,
      matchedCount: bankMatchedCount,
    });
  }, [bankTruthReady, bankUnmatchedList, bankMatchedList, bankUnmatchedCount, bankMatchedCount]);

  const entriesTruthSettling = !entriesTruthReady && !!entriesTruthSnapshot;
  const bankTruthSettling = !bankTruthReady && !!bankTruthSnapshot;

  const entriesTruthBlocking = !entriesTruthReady && !entriesTruthSnapshot;
  const bankTruthBlocking = !bankTruthReady && !bankTruthSnapshot;

  const displayEntriesExpectedList = useMemo(
    () => entriesTruthReady ? entriesExpectedList : (entriesTruthSnapshot?.expectedList ?? []),
    [entriesTruthReady, entriesExpectedList, entriesTruthSnapshot?.expectedList]
  );
  const displayEntriesMatchedList = useMemo(
    () => entriesTruthReady ? entriesMatchedList : (entriesTruthSnapshot?.matchedList ?? []),
    [entriesTruthReady, entriesMatchedList, entriesTruthSnapshot?.matchedList]
  );
  const displayExpectedCount = entriesTruthReady
    ? expectedCount
    : (entriesTruthSnapshot?.expectedCount ?? 0);
  const displayMatchedCount = entriesTruthReady
    ? matchedCount
    : (entriesTruthSnapshot?.matchedCount ?? 0);

  const displayBankUnmatchedList = useMemo(
    () => bankStatusLoaded.unmatched && bankTruthReady
      ? bankUnmatchedList
      : bankStatusLoaded.unmatched
        ? (bankTruthSnapshot?.unmatchedList ?? [])
        : [],
    [bankStatusLoaded.unmatched, bankTruthReady, bankUnmatchedList, bankTruthSnapshot?.unmatchedList]
  );
  const displayBankMatchedList = useMemo(
    () => bankStatusLoaded.matched && bankTruthReady
      ? bankMatchedList
      : bankStatusLoaded.matched
        ? (bankTruthSnapshot?.matchedList ?? [])
        : [],
    [bankStatusLoaded.matched, bankTruthReady, bankMatchedList, bankTruthSnapshot?.matchedList]
  );
  const displayBankUnmatchedCount = bankStatusLoaded.unmatched && bankTruthReady
    ? bankUnmatchedCount
    : bankStatusLoaded.unmatched
      ? (bankTruthSnapshot?.unmatchedCount ?? 0)
      : 0;
  const displayBankMatchedCount = bankStatusLoaded.matched && bankTruthReady
    ? bankMatchedCount
    : bankStatusLoaded.matched
      ? (bankTruthSnapshot?.matchedCount ?? 0)
      : 0;

const displayEntriesActiveList = useMemo(() => {
  return expectedTab === "expected"
    ? displayEntriesExpectedList
    : displayEntriesMatchedList;
}, [expectedTab, displayEntriesExpectedList, displayEntriesMatchedList]);
const displayBankActiveList = useMemo(() => {
  return bankTab === "unmatched"
    ? displayBankUnmatchedList
    : displayBankMatchedList;
}, [bankTab, displayBankUnmatchedList, displayBankMatchedList]);

  // Auto-match badge: for each unmatched bank txn, find an unambiguous
  // candidate entry — exact same amount, same direction, near date, and
  // enough payee/reference/date signal to feel safe as a one-click action.
  // More ambiguous suggestions stay in the review dialog.
  //
  // This is deterministic (no AI cost, no async). The dialog stays
  // available for ambiguous cases.
  const bankAutoMatchCandidateById = useMemo(() => {
    const out = new Map<string, string>();
    if (bankTab !== "unmatched") return out;
    if (!Array.isArray(displayBankActiveList) || displayBankActiveList.length === 0) return out;
    if (!Array.isArray(entriesExpectedList) || entriesExpectedList.length === 0) return out;

    for (const t of displayBankActiveList) {
      const txnId = String(t?.id ?? "");
      if (!txnId) continue;
      // Skip pending bank txns — they can't be matched.
      if (t?.is_pending) continue;
      // Skip already-matched (defensive — unmatched tab should never include these).
      if (isBankTxnFullyMatched(t)) continue;

      const bankAbs = absBig(toBigIntSafe(t.amount_cents));
      if (bankAbs === 0n) continue;
      const bankIsOutflow = toBigIntSafe(t.amount_cents) < 0n;

      let onlyMatchId: string | null = null;
      let count = 0;
      let onlyRefMatchId: string | null = null;
      let refMatchCount = 0;
      let onlyStrongMatchId: string | null = null;

      for (const e of entriesExpectedAllList) {
        const entryId = String(e?.id ?? "");
        if (!entryId) continue;
        // Optimistic-pending entries are not stable candidates.
        if (e?.__optimistic_pending) continue;

        const entryAmt = toBigIntSafe(e?.amount_cents);
        const entryAbs = absBig(entryAmt);
        if (entryAbs !== bankAbs) continue; // exact amount only

        // Same direction: bank outflow ⇔ entry expense (negative).
        const entryIsOutflow = entryAmt < 0n;
        if (entryIsOutflow !== bankIsOutflow) continue;

        // Within 3 days of bank posted date.
        const meta = scoreEntryCandidate(t, { ...e, date: String(e?.date ?? "").slice(0, 10) });
        const dtDays = Number(meta.dtDays ?? 9999);
        if (dtDays > 3) continue;

        count++;
        if (checkRefsMatch(t, e)) {
          refMatchCount++;
          if (refMatchCount === 1) onlyRefMatchId = entryId;
          else onlyRefMatchId = null;
        }
        const hasStrongSignal = checkRefsMatch(t, e) || Number(meta.overlap ?? 0) > 0 || dtDays <= 1;
        if (hasStrongSignal) {
          if (onlyStrongMatchId === null) onlyStrongMatchId = entryId;
          else onlyStrongMatchId = "";
        }
        if (count > 1) {
          // Ambiguous by amount/date; a unique check-number match below can
          // still safely disambiguate.
          onlyMatchId = null;
          continue;
        }
        onlyMatchId = entryId;
      }

      if (refMatchCount === 1 && onlyRefMatchId) out.set(txnId, onlyRefMatchId);
      else if (count === 1 && onlyMatchId && onlyStrongMatchId === onlyMatchId) out.set(txnId, onlyMatchId);
    }
    return out;
  }, [bankTab, displayBankActiveList, entriesExpectedAllList, entriesExpectedList, isBankTxnFullyMatched]);

  // Row virtualization for the two reconcile tables. Both can grow large
  // (no pagination), so windowing the rendered <tr> set keeps scroll smooth
  // and reduces React work per render. The data arrays are unchanged —
  // virtualization only affects which rows are rendered to the DOM.
  const entriesScrollRef = useRef<HTMLDivElement | null>(null);
  const bankScrollRef = useRef<HTMLDivElement | null>(null);

  const RECONCILE_ROW_HEIGHT_ESTIMATE = 30;
  const RECONCILE_VIRTUALIZE_THRESHOLD = 80;

  const entriesVirtualizer = useVirtualizer({
    count: displayEntriesActiveList.length,
    getScrollElement: () => entriesScrollRef.current,
    estimateSize: () => RECONCILE_ROW_HEIGHT_ESTIMATE,
    overscan: 12,
  });

  const bankVirtualizer = useVirtualizer({
    count: displayBankActiveList.length,
    getScrollElement: () => bankScrollRef.current,
    estimateSize: () => RECONCILE_ROW_HEIGHT_ESTIMATE,
    overscan: 12,
  });

  // Only virtualize when the list is meaningfully large. Below the threshold
  // direct rendering is faster (no overhead, no scroll-anchor risk on tiny lists).
  const entriesShouldVirtualize = displayEntriesActiveList.length >= RECONCILE_VIRTUALIZE_THRESHOLD;
  const bankShouldVirtualize = displayBankActiveList.length >= RECONCILE_VIRTUALIZE_THRESHOLD;

  const activeBankNextCursor = bankNextCursorByStatus[bankTab] ?? null;

  const bankPanelHasRows = displayBankActiveList.length > 0;
  const bankPanelHasSettledSnapshot = !!bankTruthSnapshot && (bankTruthHydrated || matchGroupsTruthHydrated);
  const bankPanelShowInitialLoading =
    (!activeBankStatusLoaded && activeBankStatusLoading) ||
    bankTruthBlocking ||
    (!bankTruthReady && !bankPanelHasRows && !bankPanelHasSettledSnapshot) ||
    (bankUpdating && !bankPanelHasRows && !bankPanelHasSettledSnapshot);
  const bankPanelShowDeferredLoad =
    !activeBankStatusLoaded &&
    !activeBankStatusLoading &&
    !bankPanelHasRows &&
    bankTab === "matched";
  const bankPanelShowEmpty =
    !bankPanelShowDeferredLoad &&
    (bankTruthReady || bankPanelHasSettledSnapshot) &&
    !bankPanelHasRows &&
    !bankTruthBlocking;
  const bankPanelShowRows = bankPanelHasRows;
  const bankPanelShowStatusWhileRows =
    (bankPanelShowRows || bankPanelShowEmpty) && (bankTruthSettling || bankUpdating);

  const dateRangeActive = !!(from || to);
  const dateRangeText = dateRangeActive ? `${from || "start"} to ${to || "today"}` : "All dates";
  const bankScopeCountsReady =
    bankUnmatchedScopeCounts.scopeKey === bankScopeKey &&
    !bankUnmatchedScopeCounts.loading &&
    !bankUnmatchedScopeCounts.error;
  const bankScopeCountsLoading =
    bankUnmatchedScopeCounts.scopeKey === bankScopeKey &&
    bankUnmatchedScopeCounts.loading;
  const formatProbeCount = (probe: CountProbeResult | null) => {
    if (bankUnmatchedScopeCounts.loading && bankUnmatchedScopeCounts.scopeKey === bankScopeKey) return "Loading";
    if (!probe || bankUnmatchedScopeCounts.scopeKey !== bankScopeKey) return "Not loaded yet";
    return `${probe.count}${probe.capped ? "+" : ""}`;
  };
  const bankAllTimeUnmatchedLabel = formatProbeCount(bankUnmatchedScopeCounts.allTime);
  const bankRangeUnmatchedLabel = formatProbeCount(bankUnmatchedScopeCounts.dateRange);
  const bankUnmatchedOutsideDateRange =
    dateRangeActive && bankScopeCountsReady && bankUnmatchedScopeCounts.allTime && bankUnmatchedScopeCounts.dateRange
      ? Math.max(0, bankUnmatchedScopeCounts.allTime.count - bankUnmatchedScopeCounts.dateRange.count)
      : null;
  const activeBankLoadedRowsCount =
    bankTab === "unmatched" ? bankUnmatchedLoadedRowsNoSearch : bankMatchedLoadedRowsNoSearch;
  const activeBankLoadedRowsLabel = activeBankStatusLoaded
    ? `${activeBankLoadedRowsCount}${activeBankNextCursor ? "+" : ""}`
    : activeBankStatusLoading
      ? "Loading"
      : "Not loaded yet";
  const activeBankVisibleFilteredLabel = activeBankStatusLoaded
    ? String(bankTab === "unmatched" ? displayBankUnmatchedCount : displayBankMatchedCount)
    : activeBankStatusLoading
      ? "Loading"
      : "Not loaded yet";
  const bankScopeCountsNote = bankScopeCountsLoading
    ? "Loading counts..."
    : "Counts loading.";
  const bankScopeRowsCopy = activeBankStatusLoaded
    ? `Loaded ${activeBankLoadedRowsLabel} • Visible ${activeBankVisibleFilteredLabel}`
    : activeBankStatusLoading
      ? "Rows loading."
      : "Rows not loaded.";
  const bankScopeCopy = bankTab === "unmatched" && bankScopeCountsReady
    ? `All-time ${bankAllTimeUnmatchedLabel} • Range ${bankRangeUnmatchedLabel} (${dateRangeText}) • ${bankScopeRowsCopy}`
    : bankTab === "unmatched"
      ? `${bankScopeRowsCopy} • ${bankScopeCountsNote}`
      : `${bankScopeRowsCopy} • Unmatched has full-account counts.`;
  const bankPendingCopy =
    bankTab === "unmatched" && bankPendingUnmatchedCount > 0
      ? `${bankPendingUnmatchedCount} pending shown read-only until posted.`
      : null;
  const entriesHistoryLoading = entriesBackgroundLoading || (entriesQ.isFetching && entriesLoadedCount > 0);
  const entriesScopeCopy = `Ledger ${entriesLoadedCount}${entriesHitApiLimit ? "+" : ""} loaded${entriesHistoryLoading ? " • Loading older history" : ""} • Showing ${expectedTab === "expected" ? displayEntriesExpectedList.length : displayEntriesMatchedList.length} of ${expectedTab === "expected" ? displayExpectedCount : displayMatchedCount}`;
  const activeBankHiddenBySearch =
    searchQ && activeBankStatusLoaded
      ? Math.max(0, activeBankLoadedRowsCount - (bankTab === "unmatched" ? displayBankUnmatchedCount : displayBankMatchedCount))
      : 0;
  const bankUnmatchedTabLabel = bankStatusLoaded.unmatched
    ? `Unmatched (${displayBankUnmatchedCount})`
    : bankLoadingByStatus.unmatched
      ? "Unmatched (loading)"
      : "Unmatched (Not loaded yet)";
  const bankMatchedTabLabel = bankStatusLoaded.matched
    ? `Matched (${displayBankMatchedCount})`
    : bankLoadingByStatus.matched
      ? "Matched (loading)"
      : "Matched (Not loaded yet)";
  const bankEmptyStateLabel = (() => {
    if (bankTab === "matched" && !bankStatusLoaded.matched) {
      return "No matched bank transactions.";
    }

    if (bankTab === "matched") {
      if (activeBankHiddenBySearch > 0) {
        return `${activeBankHiddenBySearch} matched bank transactions are hidden by search. Clear search to see them.`;
      }
      return dateRangeActive
        ? "No matched bank transactions in this date range."
        : "No matched bank transactions for this account.";
    }

    if (!bankStatusLoaded.unmatched) return bankScopeCountsLoading ? "Checking for bank transactions..." : "Not loaded yet.";

    if (activeBankHiddenBySearch > 0) {
      return `${activeBankHiddenBySearch} unmatched bank transactions exist outside this search. Clear search to see them.`;
    }

    if (bankScopeCountsLoading) {
      return "Checking for bank transactions...";
    }

    if (dateRangeActive && bankUnmatchedOutsideDateRange != null && bankUnmatchedOutsideDateRange > 0) {
      return `${bankUnmatchedOutsideDateRange}${bankUnmatchedScopeCounts.allTime?.capped ? "+" : ""} unmatched bank transactions exist outside this filter. Clear filters or widen date range.`;
    }

    if (bankScopeCountsReady && bankUnmatchedScopeCounts.dateRange?.count === 0) {
      return "No unmatched bank transactions match the current filters.";
    }

    if (activeBankNextCursor) {
      return "More unmatched bank transactions are available in this date range. Load more bank transactions.";
    }

    return dateRangeActive
      ? "No unmatched bank transactions in this date range."
      : "No unmatched bank transactions for this account.";
  })();
  const expectedTabLabel = entriesTruthReady
    ? `Expected (${displayExpectedCount})`
    : entriesTruthSnapshot
      ? `Expected (${displayExpectedCount})`
      : entriesInitialLoading
        ? "Expected (loading)"
        : "Expected (Not loaded yet)";
  const matchedEntriesTabLabel = entriesTruthReady
    ? `Matched (${displayMatchedCount})`
    : entriesTruthSnapshot
      ? `Matched (${displayMatchedCount})`
      : entriesInitialLoading
        ? "Matched (loading)"
        : "Matched (Not loaded yet)";
  const entriesEmptyStateLabel =
    expectedTab === "expected"
      ? (dateRangeActive ? "No expected entries in this date range." : "No expected entries for this account.")
      : (dateRangeActive ? "No matched entries in this date range." : "No matched entries for this account.");

  // -------------------------
  // Phase 5E: State summary (read-only, instant-fast)
  // -------------------------
  const bankStateSummary = useMemo(() => {
    let unmatchedN = 0;
    let matchedN = 0;
    let remainingAbsTotal = 0n;

    for (const t of bankTxSorted ?? []) {
      const bankAbs = absBig(toBigIntSafe(t.amount_cents));
      const isMatched = (remainingAbsByBankTxnId.get(t.id) ?? bankAbs) === 0n;

      if (isMatched) {
        matchedN++;
      } else {
        unmatchedN++;
        remainingAbsTotal += bankAbs;
      }
    }

    // Full-match only: partial doesn't exist
    return { unmatchedN, partialN: 0, matchedN, remainingAbsTotal };
  }, [bankTxSorted, remainingAbsByBankTxnId]);

  const entryStateSummary = useMemo(() => {
    return {
      expectedN: displayExpectedCount,
      matchedN: displayMatchedCount,
    };
  }, [displayExpectedCount, displayMatchedCount]);

  const entriesSummarySettling =
    entriesTruthBlocking ||
    entriesTruthSettling ||
    entriesUpdating;

  const issuesVoidHeavyLabel = allMatchGroupsHydrated
    ? String(issuesCounts.voidHeavy)
    : allMatchGroupsLoading
      ? "Loading"
      : "Deferred";

  const opts = (accountsQ.data ?? [])
    .filter((a) => !a.archived_at && String(a.type ?? "").toUpperCase() !== "CASH")
    .map((a) => ({ value: a.id, label: a.name }));

  const accountCapsule = (
    <div className="h-6 px-1.5 rounded-lg border border-primary/20 bg-primary/10 flex items-center">
      <CapsuleSelect
        variant="flat"
        loading={accountsQ.isLoading}
        value={selectedAccountId || (opts[0]?.value ?? "")}
        onValueChange={(v) => router.replace(`/reconcile?businessId=${selectedBusinessId}&accountId=${v}`)}
        options={opts}
        placeholder="Select account"
      />
    </div>
  );

  const disabledBtn =
    "h-7 px-2 text-xs rounded-md border border-bb-border bg-bb-surface-card opacity-50 cursor-not-allowed inline-flex items-center gap-1";

  const headerRight = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <HintWrap
        disabled={!canWriteReconcileEffective}
        reason={!canWriteReconcileEffective ? (reconcileWriteReason ?? noPermTitle) : null}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canWriteReconcileEffective || !bankTruthReady || !entriesTruthReady || displayBankUnmatchedList.length === 0 || displayEntriesExpectedList.length === 0}
          title={
            !canWriteReconcileEffective
              ? (reconcileWriteReason ?? noPermTitle)
              : !bankTruthReady || !entriesTruthReady
                ? "Loading placement"
              : displayBankUnmatchedList.length === 0
                ? "No unmatched bank transactions"
              : displayEntriesExpectedList.length === 0
                  ? "No expected entries"
                  : "Review match suggestions"
          }
          onClick={() => {
            if (!canWriteReconcileEffective) return;
            setOpenAutoReconcile(true);
          }}
        >
          <Sparkles className="h-3.5 w-3.5" /> Auto-match
        </Button>
      </HintWrap>

      <AppActionMenu
        label="More"
        title="Reconcile tools"
        items={[
          {
            label: "Snapshots",
            description: "Save or restore this reconciliation view.",
            icon: FileText,
            onSelect: () => setOpenSnapshots(true),
          },
          {
            label: "Export CSV",
            description: canWriteReconcileEffective ? "Bank transactions and audit events." : (reconcileWriteReason ?? noPermTitle),
            icon: Download,
            disabled: !canWriteReconcileEffective,
            onSelect: () => setOpenExportHub(true),
          },
          {
            label: "Statement history",
            description: "Imported bank statements for this account.",
            icon: FileText,
            onSelect: () => setOpenStatementHistory(true),
          },
          {
            label: "Reconciliation history",
            description: "Matches, reverts, and audit details.",
            icon: ClipboardList,
            onSelect: () => setOpenReconciliationHistory(true),
          },
          {
            label: `Not in view (${issuesCounts.notInView})`,
            description: "Active matches hidden by current filters.",
            icon: AlertCircle,
            onSelect: () => {
              setIssuesKind("notInView");
              setIssuesSearch("");
              setOpenIssuesList(true);
            },
          },
          {
            label: `Reverts (${issuesVoidHeavyLabel})`,
            description: `${VOID_HEAVY_THRESHOLD}+ reverts on a bank transaction.`,
            icon: RotateCcw,
            onSelect: () => {
              setIssuesKind("voidHeavy");
              setIssuesSearch("");
              setOpenIssuesList(true);
            },
          },
        ]}
      />
    </div>
  );

  const inputClass = inputH7;

  // Plaid balance display (must be declared before differenceBar usage)
  const balanceText = useMemo(() => {
    const bal = plaid?.lastKnownBalanceCents ? toBigIntSafe(plaid.lastKnownBalanceCents) : null;
    return bal !== null ? formatUsdFromCents(bal) : "—";
  }, [plaid?.lastKnownBalanceCents]);
  const plaidNeedsAttention = !!plaid?.needsAttention;
  const plaidHealthyConnected = !!plaid?.connected && !plaidNeedsAttention;
  const plaidHasConnection = plaidHealthyConnected || plaidNeedsAttention || !!plaid?.institutionName;
  const transactionSyncText = plaid?.lastSyncAt ? new Date(plaid.lastSyncAt).toLocaleString() : "";
  const bankUpdatesAvailable =
    plaidHealthyConnected &&
    !!plaid?.hasNewTransactions &&
    !plaidSyncing;

  const filterLeft = (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="w-[170px]">
        <AppDatePicker value={from} onChange={setFrom} ariaLabel="From date" />
      </div>
      <div className="w-[170px]">
        <AppDatePicker value={to} onChange={setTo} ariaLabel="To date" />
      </div>
      <div className="w-[220px]">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} placeholder="Search…" aria-label="Search transactions" />
      </div>
      <button
        type="button"
        className="h-7 px-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-md"
        onClick={() => {
          setFrom("");
          setTo("");
          setSearch("");
        }}
      >
        Reset
      </button>
    </div>
  );

  const differenceBar = (
    <div className="px-3 pb-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-bb-border bg-bb-surface-soft px-2 py-1 text-[11px] leading-4">
        <span className="inline-flex items-center gap-1 text-bb-text-muted">
          Remaining <span className="font-semibold text-bb-text tabular-nums">{formatUsdFromCents(bankStateSummary.remainingAbsTotal)}</span>
          {refreshBusy ? <TinySpinner /> : null}
        </span>
        <span className="text-bb-text-muted">
          Bank <span className="font-semibold text-bb-text">{displayBankUnmatchedCount} unmatched</span>
        </span>
        <span className="inline-flex items-center gap-1 text-bb-text-muted">
          Entries <span className="font-semibold text-bb-text">Expected {entryStateSummary.expectedN} • Matched {entryStateSummary.matchedN}</span>
          {entriesSummarySettling ? <TinySpinner /> : null}
        </span>
        {plaidHasConnection ? (
          <span className="text-bb-text-muted">
            Balance <span className="font-semibold text-bb-text tabular-nums">{balanceText}</span>
          </span>
        ) : null}
        {plaidHasConnection && transactionSyncText ? (
          <span className="text-bb-text-muted">
            Sync <span className="font-semibold text-bb-text">{transactionSyncText}</span>
          </span>
        ) : null}
      </div>
    </div>
  );

  const thClass = "px-1.5 py-0 align-middle text-[11px] font-semibold uppercase tracking-wide text-bb-text-muted text-left";
  const tdClass = "px-1.5 py-0.5 align-middle text-xs text-bb-text";
  const trClass = "h-[23px] border-b border-bb-border-muted";
  const stickyActionHeaderClass = "sticky right-0 z-20 bg-bb-table-header border-l border-bb-border shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]";
  const stickyActionCellClass = "sticky right-0 z-[5] border-l border-bb-border shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]";
  const reconcileTextClampClass = "block min-w-0 max-w-[22rem] overflow-hidden text-ellipsis whitespace-nowrap xl:max-w-[30rem] xl:whitespace-normal xl:[display:-webkit-box] xl:[-webkit-line-clamp:2] xl:[-webkit-box-orient:vertical]";

  function EmptyState({ label }: { label: string }) {
    return (
      <div className="h-full min-h-[240px] flex items-center justify-center">
        <div className="text-center text-xs text-bb-text-muted">
          <div className="mx-auto mb-2 h-10 w-10 rounded-full border border-bb-border bg-bb-surface-card flex items-center justify-center">
            <GitMerge className="h-4 w-4 text-bb-text-subtle" />
          </div>
          {label}
        </div>
      </div>
    );
  }

  const connectedPill = (
    <span
      className={`inline-flex items-center px-2 h-5 rounded-full border text-[11px] font-medium whitespace-nowrap leading-none ${plaidNeedsAttention
        ? "bg-bb-status-warning-bg text-bb-status-warning-fg border-bb-status-warning-border"
        : plaidHealthyConnected
          ? "bg-bb-table-header text-bb-text border-bb-border"
          : "bg-bb-surface-card text-bb-text-muted border-bb-border"
        }`}
    >
      {plaidLoading ? "Loading…" : plaidNeedsAttention ? "Needs attention" : plaidHealthyConnected ? "Connected" : "Not connected"}
    </span>
  );

  // Auth handled by AppShell
  // Phase 2: targeted retry (prevents full router.refresh storms)
  async function retryReconcileSurfaces() {
    await refreshBankAndMatches({ preserveOnEmpty: true });
    await entriesQ.refetch?.();
  }

  return (
    <div className="flex flex-col gap-1.5 overflow-hidden" style={containerStyle}>
      <div className="bb-page-command-surface rounded-xl overflow-visible">
        <div className="px-3 py-1.5">
          <PageHeader
            icon={<GitMerge className="h-4 w-4" />}
            title="Reconcile"
            afterTitle={
              <AccountingScopePills
                businessName={selectedBusinessName}
                businessLoading={businessesQ.isLoading}
                accountControl={accountCapsule}
              />
            }
            right={headerRight}
          />
        </div>

        <div className="h-px bg-bb-border" />

        <div className="px-3 py-1.5">
          <FilterBar left={filterLeft} right={null} />
        </div>

        {(bannerMsg || mutErr) ? (
          <div className="px-3 pb-2">
            {bannerMsg ? (
              <InlineBanner title="Can’t load reconcile" message={bannerMsg} onRetry={() => retryReconcileSurfaces()} />
            ) : (
              <InlineBanner
                title={mutErrTitle || "Can’t update reconcile"}
                message={mutErr}
                actionLabel={mutErrIsClosed ? "Go to Close Periods" : null}
                actionHref={
                  mutErrIsClosed
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
              secondary={{ label: "Reload", onClick: () => retryReconcileSurfaces() }}
            />
          </div>
        ) : null}

        {selectedBusinessId && !accountsQ.isLoading && (accountsQ.data ?? []).length === 0 ? (
          <div className="px-3 pb-2">
            <EmptyStateCard
              title="No accounts yet"
              description="Add an account to start importing and categorizing transactions."
              primary={{ label: "Add account", href: "/settings?tab=accounts" }}
              secondary={{ label: "Reload", onClick: () => retryReconcileSurfaces() }}
            />
          </div>
        ) : null}

        <div className="h-px bg-bb-border" />

        {differenceBar}
        {createEntryErr ? (
          <div className="px-3 pb-2">
            <div className="text-xs text-bb-status-danger-fg">{createEntryErr}</div>
          </div>
        ) : null}

        {/* Create entry confirmation dialog */}
        <AppDialog
          open={openCreateEntry}
          onClose={() => {
            setOpenCreateEntry(false);
            setCreateEntryBankTxnId(null);
            setCreateEntryAutoMatch(true);
            setCreateEntryDuplicateCandidates([]);
            setCreateEntryDuplicateConfirm("");
            setCreateEntryCategoryTouched(false);
          }}
          title={createEntryDuplicateCandidates.length ? "Possible duplicate ledger entry" : "Create entry"}
          size="lg"
          bodyClassName="overflow-hidden sm:overflow-hidden"
          footer={openCreateEntry ? (
            <DialogFooter
              left={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-bb-text-muted whitespace-nowrap">Auto-match</span>
                  <PillToggle
                    checked={createEntryAutoMatch}
                    onCheckedChange={(next) => setCreateEntryAutoMatch(next)}
                    disabled={
                      !canWriteReconcileEffective ||
                      !!(createEntryBankTxnId && getCreateEntryActionBlockReason(String(createEntryBankTxnId)))
                    }
                  />
                </div>
              }
              right={
                <>
                  {createEntryDuplicateCandidates.length ? (
                    <BusyButton
                      variant="primary"
                      size="md"
                      onClick={() => {
                        const bankId = createEntryBankTxnId ? String(createEntryBankTxnId) : "";
                        const bank = bankId ? bankTxSorted.find((x: any) => String(x.id) === bankId) : null;
                        const firstCandidateId = String(
                          createEntryDuplicateCandidates[0]?.entry_id ??
                            createEntryDuplicateCandidates[0]?.id ??
                            ""
                        );
                        setOpenCreateEntry(false);
                        setCreateEntryBankTxnId(null);
                        setCreateEntryDuplicateCandidates([]);
                        setCreateEntryDuplicateConfirm("");
                        if (!bankId) return;
                        setMatchBankTxnId(bankId);
                        setMatchSearch("");
                        setMatchSelectedEntryIds(firstCandidateId ? new Set([firstCandidateId]) : new Set());
                        setMatchError(null);
                        setMatchAiSuggestions([]);
                        setMatchSuggestError(null);
                        setOpenMatch(true);
                        if (bank) void runAiSuggestForBank(bank);
                      }}
                      disabled={
                        !!(createEntryBankTxnId &&
                          (createEntryBusyByBankId[String(createEntryBankTxnId)] ||
                            getCreateEntryActionBlockReason(String(createEntryBankTxnId))))
                      }
                    >
                      Review / Match existing entry
                    </BusyButton>
                  ) : null}

                  <BusyButton
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      setOpenCreateEntry(false);
                      setCreateEntryDuplicateCandidates([]);
                      setCreateEntryDuplicateConfirm("");
                    }}
                    disabled={!!(createEntryBankTxnId && createEntryBusyByBankId[String(createEntryBankTxnId)])}
                  >
                    Cancel
                  </BusyButton>

                  <HintWrap
                    disabled={!canWriteReconcileEffective}
                    reason={!canWriteReconcileEffective ? (reconcileWriteReason ?? noPermTitle) : null}
                  >
                    <BusyButton
                      variant={createEntryDuplicateCandidates.length ? "secondary" : "primary"}
                      size="md"
                      busy={!!(createEntryBankTxnId && createEntryBusyByBankId[String(createEntryBankTxnId)])}
                      busyLabel="Creating…"
                      disabled={
                        !canWriteReconcileEffective ||
                        !createEntryBankTxnId ||
                        !!(createEntryBankTxnId && getCreateEntryActionBlockReason(String(createEntryBankTxnId))) ||
                        (createEntryDuplicateCandidates.length > 0 &&
                          createEntryDuplicateConfirm.trim() !== "Create a separate ledger entry")
                      }
                      onClick={async () => {
                        if (!selectedBusinessId || !selectedAccountId) return;
                        if (!canWriteReconcileEffective) return;

                        const bankId = createEntryBankTxnId ? String(createEntryBankTxnId) : "";
                        if (!bankId) return;
                        const blockedReason = getCreateEntryActionBlockReason(bankId);
                        if (blockedReason) {
                          setCreateEntryErr(blockedReason);
                          return;
                        }

                        const bankTxn = bankTxSorted.find((x: any) => String(x.id) === bankId) ?? null;
                        const optimisticEntryId = `optimistic-entry:${bankId}`;

                        setCreateEntryErr(null);
                        clearMutErr();
                        setCreateEntryBusyByBankId((m) => ({ ...m, [bankId]: true }));

                        // Instant UX: hide bank row and show pending expected entry immediately.
                        markPending(bankId);
                        setOptimisticHiddenBankTxnIds((prev) => {
                          const next = new Set(prev);
                          next.add(bankId);
                          return next;
                        });

                        if (bankTxn) {
                          setOptimisticPendingEntryDrafts((prev) => {
                            const next = prev.filter((x: any) => String(x?.id) !== optimisticEntryId);
                            next.unshift({
                              id: optimisticEntryId,
                              date: bankTxn?.posted_date ? String(bankTxn.posted_date).slice(0, 10) : "",
                              payee: String(bankTxn?.name ?? "").trim() || "Bank transaction",
                              amount_cents: bankTxn?.amount_cents ?? 0,
                              __optimistic_pending: true,
                              __source_bank_txn_id: bankId,
                            });
                            return next;
                          });
                        }

                        try {
                          const topSuggestion = createEntrySuggestions[0] ?? null;
                          const suggestedCategoryId = categorySuggestionId(topSuggestion as any);
                          const safeSuggestionId = categorySuggestionId(createEntrySafeSuggestion as any);
                          const categoryIdFinal = createEntryCategoryId.trim() || safeSuggestionId || "";

                          await createEntryFromBankTransaction({
                            businessId: selectedBusinessId,
                            accountId: selectedAccountId,
                            bankTransactionId: bankId,
                            autoMatch: !!createEntryAutoMatch,
                            memo: createEntryMemo,
                            method: createEntryMethod,
                            category_id: categoryIdFinal,
                            suggested_category_id: suggestedCategoryId || "",
                            allowPossibleDuplicate: createEntryDuplicateCandidates.length > 0,
                          });

                          clearMutErr();
                          setOpenCreateEntry(false);
                          setCreateEntryBankTxnId(null);
                          setCreateEntryDuplicateCandidates([]);
                          setCreateEntryDuplicateConfirm("");
                          setCreateEntryCategoryTouched(false);
                          settleReconcileInBackground("created entry", async () => {
                            await refreshIssuesAfterBankEntryCreate();
                            setOptimisticPendingEntryDrafts((prev) =>
                              prev.filter((x: any) => String(x?.__source_bank_txn_id ?? "") !== bankId)
                            );
                            setOptimisticHiddenBankTxnIds((prev) => {
                              const next = new Set(prev);
                              next.delete(bankId);
                              return next;
                            });
                          });
                        } catch (e: any) {
                          setOptimisticPendingEntryDrafts((prev) =>
                            prev.filter((x: any) => String(x?.__source_bank_txn_id ?? "") !== bankId)
                          );
                          setOptimisticHiddenBankTxnIds((prev) => {
                            const next = new Set(prev);
                            next.delete(bankId);
                            return next;
                          });

                          const duplicateMessage = possibleDuplicateCreateEntryMessage(e);
                          if (duplicateMessage) {
                            const payload = possibleDuplicateCreateEntryPayload(e);
                            clearMutErr();
                            setCreateEntryErr(duplicateMessage);
                            setCreateEntryDuplicateCandidates(
                              Array.isArray(payload?.possible_duplicate_candidates)
                                ? payload.possible_duplicate_candidates
                                : []
                            );
                            setCreateEntryDuplicateConfirm("");
                            return;
                          }

                          applyMutationError(e, "Can’t create entry");
                          setCreateEntryErr(null);
                          setCreateEntryDuplicateCandidates([]);
                          setCreateEntryDuplicateConfirm("");
                        } finally {
                          clearPending(bankId);
                          setCreateEntryBusyByBankId((m) => ({ ...m, [bankId]: false }));
                        }
                      }}
                    >
                      {createEntryDuplicateCandidates.length ? "Create separate entry" : "Create entry"}
                    </BusyButton>
                  </HintWrap>
                </>
              }
            />
          ) : null}
        >
          {openCreateEntry ? (() => {
            const bankId = createEntryBankTxnId ? String(createEntryBankTxnId) : "";
            const t = bankId ? bankTxSorted.find((x: any) => String(x.id) === bankId) : null;

            const amt = t ? toBigIntSafe(t.amount_cents) : 0n;
            const dateStr = t?.posted_date ? isoToYmd(String(t.posted_date)) : "—";
            const desc = (t?.name ?? "").toString().trim() || "—";
            const bankAccount = accountLabelFor(t, selectedAccountName);
            const extractedRef = t ? extractCheckRefFromBankTransaction(t) : "";
            const suggestedMethod = t ? inferMethodFromBankTransaction(t) : "OTHER";
            const selectedCategoryLabel =
              createEntryCategoryName ||
              compactText(categories.find((c: any) => String(c?.id ?? "") === createEntryCategoryId)?.name ?? "", "");
            const newEntryPreview = {
              date: dateStr,
              payee: desc,
              amount_cents: amt,
              method: createEntryMethod || "OTHER",
              suggestedMethod,
              category: selectedCategoryLabel || "None selected",
              suggestedCategory:
                String(createEntrySuggestions?.[0]?.category_name ?? createEntrySuggestions?.[0]?.categoryName ?? "").trim() ||
                "None",
              ref: extractedRef,
            };

            const createEntryBlockReason = bankId ? getCreateEntryActionBlockReason(bankId) : null;

            return (
              <div className="flex h-[min(68vh,680px)] min-h-0 flex-col">
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-1">
                  <div className="text-xs text-bb-text-muted">
                    {createEntryDuplicateCandidates.length
                      ? "A likely existing ledger entry was found. Match the existing entry first unless this bank transaction is truly a separate event."
                      : createEntryAutoMatch
                        ? createEntryAndMatchConfirmationCopy
                        : "This will create a new ledger entry from this bank transaction. Review the category, amount, and date before continuing."}
                  </div>

                  {createEntryBlockReason ? (
                    <div className="mt-3 rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-3 py-2 text-xs text-bb-status-warning-fg">
                      {createEntryBlockReason}
                    </div>
                  ) : null}

                  <div className={`mt-3 grid grid-cols-1 gap-3 ${createEntryDuplicateCandidates.length ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
                    <div className="rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2 text-xs">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-bb-text-muted">Bank transaction</div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="text-bb-text-muted">Date</div>
                        <div className="font-semibold text-bb-text">{dateStr}</div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <div className="text-bb-text-muted">Description</div>
                        <div className="font-semibold text-bb-text truncate max-w-[220px]" title={desc}>
                          {desc}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <div className="text-bb-text-muted">Amount</div>
                        <div className={`font-semibold tabular-nums ${amt < 0n ? "!text-bb-amount-negative" : "text-bb-text"}`}>
                          {formatUsdFromCents(amt)}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <div className="text-bb-text-muted">Account</div>
                        <div className="font-semibold text-bb-text truncate max-w-[220px]" title={bankAccount}>
                          {bankAccount}
                        </div>
                      </div>
                    </div>

                    {createEntryDuplicateCandidates.length ? (
                      <div className="rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2 text-xs">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-bb-text-muted">Possible existing ledger entry</div>
                        <div className="mt-2 flex flex-col gap-2">
                          {createEntryDuplicateCandidates.slice(0, 3).map((candidate: any) => {
                            const id = String(candidate?.entry_id ?? candidate?.id ?? "");
                            const localEntry = id ? entryByIdFast.get(id) : null;
                            const entryForDisplay = { ...(candidate ?? {}), ...(localEntry ?? {}) };
                            const cDate = ymdFromUnknownDate(entryForDisplay?.date ?? candidate?.date) || "—";
                            const cPayee = compactText(entryForDisplay?.payee ?? entryForDisplay?.memo ?? "");
                            const cAmount = toBigIntSafe(entryForDisplay?.amount_cents ?? candidate?.amount_cents);
                            const cRef = compactText(entryForDisplay?.ref ?? candidate?.ref ?? "", "");
                            const cCategory = compactText(
                              entryCategoryLabel(entryForDisplay) !== "—"
                                ? entryCategoryLabel(entryForDisplay)
                                : categories.find((cat: any) => String(cat?.id ?? "") === String(entryForDisplay?.category_id ?? ""))?.name,
                              ""
                            );
                            const matched = Boolean(
                              (id && activeGroupByEntryId.has(id)) ||
                                (id && matchByEntryId.has(id))
                            );
                            const matchStatus = matched ? "Matched" : "Unmatched";
                            return (
                              <div key={id || `${cDate}-${cPayee}-${cAmount}`} className="rounded border border-bb-border bg-bb-surface-card px-2 py-1.5 text-bb-text">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold truncate" title={cPayee}>{cPayee}</span>
                                  <span className={`tabular-nums whitespace-nowrap ${cAmount < 0n ? "text-bb-amount-negative" : "text-bb-text"}`}>
                                    {formatUsdFromCents(cAmount)}
                                  </span>
                                </div>
                                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-bb-text-muted">
                                  <span>Date: {cDate}</span>
                                  <span>Status: {matchStatus}</span>
                                  <span className="truncate" title={cCategory}>Category: {cCategory || "—"}</span>
                                  <span className="truncate" title={cRef}>Ref: {cRef || "—"}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2 text-xs">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-bb-text-muted">New entry preview</div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="text-bb-text-muted">Date</div>
                        <div className="font-semibold text-bb-text">{newEntryPreview.date}</div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <div className="text-bb-text-muted">Payee</div>
                        <div className="font-semibold text-bb-text truncate max-w-[220px]" title={newEntryPreview.payee}>{newEntryPreview.payee}</div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <div className="text-bb-text-muted">Amount</div>
                        <div className={`font-semibold tabular-nums ${amt < 0n ? "!text-bb-amount-negative" : "text-bb-text"}`}>
                          {formatUsdFromCents(newEntryPreview.amount_cents)}
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <div className="text-bb-text-muted">Method</div>
                        <div className="font-semibold text-bb-text">{newEntryPreview.method}</div>
                      </div>
                      {newEntryPreview.suggestedMethod &&
                        String(newEntryPreview.suggestedMethod).trim() !== "" &&
                        String(newEntryPreview.suggestedMethod) !== String(newEntryPreview.method) ? (
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <div className="text-bb-text-muted">Suggested method</div>
                          <div className="font-semibold text-bb-text">{newEntryPreview.suggestedMethod}</div>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <div className="text-bb-text-muted">Category</div>
                        <div className="font-semibold text-bb-text truncate max-w-[220px]" title={newEntryPreview.category}>
                          {newEntryPreview.category}
                        </div>
                      </div>
                      {newEntryPreview.suggestedCategory &&
                        String(newEntryPreview.suggestedCategory).trim() !== "" &&
                        String(newEntryPreview.suggestedCategory) !== String(newEntryPreview.category) ? (
                        <div className="flex items-center justify-between gap-2 mt-1">
                          <div className="text-bb-text-muted">Suggested category</div>
                          <div className="font-semibold text-bb-text truncate max-w-[220px]" title={newEntryPreview.suggestedCategory}>
                            {newEntryPreview.suggestedCategory}
                          </div>
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <div className="text-bb-text-muted">Ref</div>
                        <div className="font-semibold text-bb-text truncate max-w-[220px]" title={newEntryPreview.ref || "—"}>
                          {newEntryPreview.ref || "—"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {createEntryDuplicateCandidates.length ? (
                    <div className="mt-3 rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-3 py-2 text-xs text-bb-status-warning-fg">
                      <div className="font-semibold text-bb-text">Suggested existing match</div>
                      <div className="mt-1 text-bb-text-muted">
                        Match an existing entry when it represents this bank transaction. Create a separate entry only when these are truly separate transactions.
                      </div>
                      <div className="mt-1 text-bb-text-muted">
                        Duplication is suspected because the candidate has the same amount, a nearby date, a similar payee, or a generic bank description that commonly hides customer names.
                      </div>
                      <div className="mt-2 flex flex-col gap-2">
                        {createEntryDuplicateCandidates.slice(0, 5).map((candidate: any) => {
                          const id = String(candidate?.entry_id ?? candidate?.id ?? "");
                          const localEntry = id ? entryByIdFast.get(id) : null;
                          const entryForDisplay = { ...(candidate ?? {}), ...(localEntry ?? {}) };
                          const cDate = ymdFromUnknownDate(entryForDisplay?.date ?? candidate?.date) || "—";
                          const cPayee = compactText(entryForDisplay?.payee ?? entryForDisplay?.memo ?? "");
                          const cAmountValue = toBigIntSafe(entryForDisplay?.amount_cents ?? candidate?.amount_cents);
                          const cAmount = formatUsdFromCents(cAmountValue);
                          const cRef = compactText(entryForDisplay?.ref ?? candidate?.ref ?? "", "");
                          const cCategory = compactText(
                            entryCategoryLabel(entryForDisplay) !== "—"
                              ? entryCategoryLabel(entryForDisplay)
                              : categories.find((cat: any) => String(cat?.id ?? "") === String(entryForDisplay?.category_id ?? ""))?.name,
                            ""
                          );
                          const matched = Boolean(
                            (id && activeGroupByEntryId.has(id)) ||
                              (id && matchByEntryId.has(id))
                          );
                          const chips = t ? duplicateReasonChips(t, entryForDisplay, matched ? "Matched" : "Unmatched") : [];
                          return (
                            <div key={id || `${cDate}-${cPayee}-${cAmount}`} className="rounded border border-bb-border bg-bb-surface-card px-2 py-1.5 text-bb-text">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium truncate">{cPayee}</span>
                                <span className="tabular-nums whitespace-nowrap">{cAmount}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                {chips.map((chip) => (
                                  <MatchSignalChip key={`${id}-${chip.label}`} {...chip} />
                                ))}
                              </div>
                              <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-bb-text-muted">
                                <span>{cDate}</span>
                                <span>{directionLabel(cAmountValue)}</span>
                                {cCategory ? <span>Category: {cCategory}</span> : null}
                                <span>Ref: {cRef || "—"}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 flex items-start gap-2 rounded-md border border-bb-border bg-bb-surface-card px-2 py-2">
                        <input
                          id="reconcile-create-entry-allow-duplicate"
                          type="checkbox"
                          className="bb-checkbox mt-0.5"
                          checked={createEntryDuplicateConfirm === "Create a separate ledger entry"}
                          onChange={(e) =>
                            setCreateEntryDuplicateConfirm(
                              e.target.checked ? "Create a separate ledger entry" : ""
                            )
                          }
                        />
                        <label htmlFor="reconcile-create-entry-allow-duplicate" className="text-[11px] leading-4 text-bb-text">
                          I&apos;m sure this is a separate transaction. Common case: recurring charges
                          (bank fees, NTTA tolls, subscriptions) that look similar to a prior entry but
                          are a new real-world event. Check this box, then click <b>Create separate entry</b>.
                        </label>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] font-semibold text-bb-text-muted mb-1">Method</div>
                      <select
                        className={[
                          "h-8 w-full px-2 text-xs rounded-md border border-bb-border bg-bb-surface-card",
                          ringFocus,
                        ].join(" ")}
                        value={createEntryMethod}
                        onChange={(e) => setCreateEntryMethod(e.target.value)}
                      >
                        <option value="OTHER">Other</option>
                        <option value="CASH">Cash</option>
                        <option value="CARD">Card</option>
                        <option value="ACH">ACH</option>
                        <option value="WIRE">Wire</option>
                        <option value="CHECK">Check</option>
                        <option value="DIRECT_DEPOSIT">Direct Deposit</option>
                        <option value="ZELLE">Zelle</option>
                        <option value="TRANSFER">Transfer</option>
                      </select>
                    </div>

                    <div>
                      <div className="text-[11px] font-semibold text-bb-text-muted mb-1">Category</div>

                      {/* Phase F1: suggestion-only category chips (top 3) */}
                      <div className="mb-2">
                        {createEntrySugLoading ? (
                          <div className="flex flex-wrap gap-2">
                            <div className="h-6 w-24 rounded-full bg-bb-border-muted animate-pulse" />
                            <div className="h-6 w-28 rounded-full bg-bb-border-muted animate-pulse" />
                            <div className="h-6 w-20 rounded-full bg-bb-border-muted animate-pulse" />
                          </div>
                        ) : createEntrySuggestions.length ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap gap-2">
                              {createEntrySuggestions.slice(0, 3).map((s: any, idx: number) => {
                                const id = String(s?.category_id ?? s?.categoryId ?? "");
                                const name = String(s?.category_name ?? s?.categoryName ?? "—");
                                const conf = categorySuggestionConfidence(s?.confidence);
                                const confLabel = String(s?.confidence_label ?? s?.confidenceLabel ?? "").trim();
                                const tierLabel = categorySuggestionTierLabel(s?.confidence_tier);
                                const sourceLabel = categorySuggestionSourceLabel(s?.source);
                                const reasonText = String(s?.reason ?? "").trim();
                                const warningText = String(s?.warning ?? "").trim();
                                const requiresReview = categorySuggestionRequiresReview(s);
                                const selected = createEntryCategoryId && createEntryCategoryId === id;
                                const safeSuggestion = isBulkSafeCategorySuggestion(s, idx);
                                const autoSelected = selected && safeSuggestion && !createEntryCategoryTouched;

                                return (
                                  <button
                                    key={id || name}
                                    type="button"
                                    title={[tierLabel, sourceLabel, confLabel ? `Confidence: ${confLabel}` : "", reasonText, warningText, "Requires review before saving"].filter(Boolean).join(" • ")}
                                    className={[
                                      "h-7 px-2.5 rounded-full border text-[11px] inline-flex items-center gap-2",
                                      selected
                                        ? "border-primary/20 bg-primary/10 text-primary"
                                        : requiresReview
                                          ? "border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg hover:bg-bb-status-warning-bg"
                                          : idx === 0
                                          ? "border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
                                          : "border-bb-border bg-bb-surface-card text-bb-text hover:bg-bb-table-row-hover",
                                      ringFocus,
                                    ].join(" ")}
                                    onClick={() => {
                                      if (!id) return;
                                      setCreateEntryCategoryId(id);
                                      setCreateEntryCategoryName(name);
                                      setCreateEntryCategoryTouched(true);
                                      setCategoryQuery("");
                                    }}
                                    >
                                      <span className="font-medium truncate max-w-[150px]">{name}</span>
                                      {autoSelected ? (
                                        <span className="rounded-full border border-primary/20 bg-primary/10 px-1 text-[9px] font-semibold">
                                          Auto
                                        </span>
                                      ) : safeSuggestion ? (
                                        <span className="rounded-full border border-primary/20 bg-background/40 px-1 text-[9px] font-semibold">
                                          Safe
                                        </span>
                                      ) : null}
                                      <span
                                        className={[
                                          "inline-flex h-4 items-center rounded-full px-1.5 text-[10px] font-semibold",
                                          selected ? "bg-primary/10 text-primary" : "bg-bb-border-muted text-bb-text-muted",
                                      ].join(" ")}
                                    >
                                      {confLabel || `${conf}%`}
                                    </span>
                                    {requiresReview ? (
                                      <span className="rounded-full border border-bb-status-warning-border bg-background/40 px-1 text-[9px] font-semibold">
                                        Review
                                      </span>
                                    ) : null}
                                  </button>
                                );
                              })}
                            </div>

                            <div className="text-[11px] text-bb-text-muted">
                              {categorySuggestionTierLabel(createEntrySuggestions?.[0]?.confidence_tier)}
                              {" • "}
                              {categorySuggestionSourceLabel(createEntrySuggestions?.[0]?.source)}
                              {" • "}
                              {String(createEntrySuggestions?.[0]?.confidence_label ?? "").trim() ||
                                `${categorySuggestionConfidence(createEntrySuggestions?.[0]?.confidence)}%`}
                            </div>

                            <div
                              className="text-[11px] text-bb-text-muted truncate"
                              title={[
                                String(createEntrySuggestions?.[0]?.reason ?? "Review this entry before saving"),
                                String(createEntrySuggestions?.[0]?.warning ?? ""),
                              ].filter(Boolean).join(" • ")}
                            >
                              {String(createEntrySuggestions?.[0]?.warning ?? "").trim() ||
                                (String(createEntrySuggestions?.[0]?.reason ?? "").trim()
                                  ? String(createEntrySuggestions?.[0]?.reason ?? "")
                                  : "Review this entry before saving")}
                            </div>
                          </div>
                        ) : createEntrySugErr ? (
                          <div className="text-[11px] text-bb-text-muted">Suggestions unavailable</div>
                        ) : (
                          <div className="text-[11px] text-bb-text-muted">No safe suggestion yet. You can still choose a category below.</div>
                        )}
                      </div>

                      <CategoryCombobox
                        options={categories}
                        value={categoryQuery || createEntryCategoryName}
                        categoryId={createEntryCategoryId || null}
                        placeholder={categoriesLoading ? "Loading categories…" : "Search categories…"}
                        inputClassName={[
                          "h-8 w-full px-2 text-xs rounded-md border border-bb-border bg-bb-surface-card text-bb-text placeholder:text-bb-text-muted",
                          ringFocus,
                        ].join(" ")}
                        onChange={(value, option) => {
                          if (option) {
                            setCreateEntryCategoryId(option.id ?? "");
                            setCreateEntryCategoryName(option.name);
                            setCreateEntryCategoryTouched(true);
                            setCategoryQuery("");
                            return;
                          }

                          setCreateEntryCategoryId("");
                          setCreateEntryCategoryName("");
                          setCreateEntryCategoryTouched(true);
                          setCategoryQuery(value);
                        }}
                      />

                      {createEntryCategoryName ? (
                        <div className="mt-1 text-[11px] text-bb-text-muted">
                          Selected: <span className="font-medium">{createEntryCategoryName}</span>{" "}
                          <button
                            type="button"
                            className="ml-2 text-primary hover:text-primary"
                            onClick={() => {
                              setCreateEntryCategoryId("");
                              setCreateEntryCategoryName("");
                              setCreateEntryCategoryTouched(true);
                              setCategoryQuery("");
                            }}
                          >
                            Clear
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="text-[11px] font-semibold text-bb-text-muted mb-1">Memo</div>
                    <textarea
                      className={[
                        "min-h-[70px] w-full px-2 py-1 text-xs rounded-md border border-bb-border bg-bb-surface-card",
                        ringFocus,
                      ].join(" ")}
                      value={createEntryMemo}
                      onChange={(e) => setCreateEntryMemo(e.target.value)}
                    />
                  </div>

                </div>

                {null}
              </div>
            );
          })() : null}
        </AppDialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 flex-1 min-h-0 overflow-hidden">
        {/* Expected Entries */}
        <div className="bb-spreadsheet-shell flex flex-col min-h-0 overflow-hidden rounded-lg">
          <div className="px-3 py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-bb-text">Ledger entries</div>
                <StatusChip label="Source: Ledger" tone="info" />
                <div className="hidden sm:block text-[11px] text-bb-text-muted">Entered first, waiting for bank match</div>
              </div>
              <div className="text-[11px] text-bb-text-muted min-h-[16px]">
                {entriesTruthSettling || entriesUpdating ? (
                  <span className="inline-flex items-center gap-1.5">
                    <TinySpinner />
                    <span>{plaidSyncing ? "Syncing bank data…" : "Saving changes…"}</span>
                  </span>
                ) : "\u00A0"}
              </div>
            </div>
          </div>

          <div className="px-3 pb-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${expectedTab === "expected" ? "border-bb-border bg-bb-surface-card text-bb-text" : "border-transparent text-bb-text-muted hover:bg-bb-table-row-hover"
                  }`}
                onClick={() => setExpectedTab("expected")}
              >
                {expectedTabLabel}
              </button>
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${expectedTab === "matched" ? "border-bb-border bg-bb-surface-card text-bb-text" : "border-transparent text-bb-text-muted hover:bg-bb-table-row-hover"
                  }`}
                onClick={() => setExpectedTab("matched")}
              >
                {matchedEntriesTabLabel}
              </button>
              <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-bb-border bg-bb-surface-soft px-2 py-1 text-[11px] leading-4 text-bb-text-muted">
                <span className="font-semibold text-bb-text">Ledger:</span>
                <span className="truncate">{entriesScopeCopy}</span>
              </div>
            </div>

            {bankTab === "unmatched" && selectedBankTxnIds.size > 0 ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-bb-border bg-bb-surface-card px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-bb-text">
                    {selectedActionableBankTxnIds.length} of {selectedBankTxnIds.size} selected
                  </span>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-bb-text-muted whitespace-nowrap">Auto-match</span>
                    <PillToggle
                      checked={bulkCreateAutoMatch}
                      onCheckedChange={(next) => setBulkCreateAutoMatch(next)}
                      disabled={!canWriteReconcileEffective}
                    />
                  </div>
                </div>

                <HintWrap
                  disabled={!canWriteReconcileEffective}
                  reason={!canWriteReconcileEffective ? (reconcileWriteReason ?? noPermTitle) : null}
                >
                  <BusyButton
                    variant="primary"
                    size="sm"
                    busy={bulkCreateBusy}
                    busyLabel="Creating…"
                    disabled={
                      bulkCreateBusy ||
                      !canWriteReconcileEffective ||
                      selectedBusinessId == null ||
                      selectedAccountId == null ||
                      selectedActionableBankTxnIds.length === 0
                    }
                    title={
                      !canWriteReconcileEffective
                        ? (reconcileWriteReason ?? noPermTitle)
                        : selectedActionableBankTxnIds.length === 0
                          ? matchedOrPendingCreateEntryMessage
                        : "Create entries from selected bank transactions"
                    }
                    onClick={async () => {
                      if (!selectedBusinessId || !selectedAccountId) return;
                      if (!canWriteReconcileEffective) return;

                      clearMutErr();
                      setCreateEntryErr(null);

                      const ids = selectedActionableBankTxnIds;
                      if (ids.length === 0) {
                        setCreateEntryErr(matchedOrPendingCreateEntryMessage);
                        return;
                      }
                      for (const id of ids) markPending(String(id));

                      // Clear previous results for selected ids
                      setBulkCreateResultByBankTxnId((m) => {
                        const next = { ...m };
                        for (const id of ids) delete next[String(id)];
                        return next;
                      });

                      try {
                        setBulkCreateBusy(true);

                        const payload = {
                          items: ids.map((id) => ({
                            bank_transaction_id: id,
                            autoMatch: bulkCreateAutoMatch === true,
                          })),
                        };

                        const res: any = await apiFetch(
                          `/v1/businesses/${selectedBusinessId}/accounts/${selectedAccountId}/bank-transactions/create-entries-batch`,
                          { method: "POST", body: JSON.stringify(payload) }
                        );

                        const list = Array.isArray(res?.results) ? res.results : [];
                        const hasPossibleDuplicate = list.some(
                          (r: any) => String(r?.code ?? "") === "POSSIBLE_DUPLICATE_ENTRY"
                        );
                        setCreateEntryErr(hasPossibleDuplicate ? possibleDuplicateEntryMessage : null);

                        setBulkCreateResultByBankTxnId((m) => {
                          const next = { ...m };
                          for (const r of list) {
                            const bid = String(r?.bank_transaction_id ?? "");
                            if (!bid) continue;
                            next[bid] = r;
                          }
                          return next;
                        });

                        // Keep selection (user may want to retry failed), but clear ids that succeeded/skip
                        const createdIds: string[] = [];
                        setSelectedBankTxnIds((prev) => {
                          const next = new Set(prev);
                          for (const r of list) {
                            const bid = String(r?.bank_transaction_id ?? "");
                            const st = String(r?.status ?? "");
                            if (!bid) continue;
                            if (st === "CREATED") createdIds.push(bid);
                            if (st === "CREATED" || st === "SKIPPED") next.delete(bid);
                          }
                          return next;
                        });
                        if (createdIds.length > 0) {
                          setOptimisticHiddenBankTxnIds((prev) => {
                            const next = new Set(prev);
                            for (const id of createdIds) next.add(id);
                            return next;
                          });
                        }
                        settleReconcileInBackground("bulk-created entries", async () => {
                          if (createdIds.length > 0) await refreshIssuesAfterBankEntryCreate();
                          setOptimisticHiddenBankTxnIds((prev) => {
                            const next = new Set(prev);
                            for (const id of createdIds) next.delete(id);
                            return next;
                          });
                        });
                      } catch (e: any) {
                        applyMutationError(e, "Can’t create entries");
                      } finally {
                        setBulkCreateBusy(false);

                        for (const id of ids) clearPending(String(id));
                      }
                    }}
                  >
                    Create entries
                  </BusyButton>
                </HintWrap>
              </div>
            ) : null}
          </div>

          <div className="h-px bg-bb-border" />

          <div className="relative flex-1 min-h-0 overflow-hidden">
            <div ref={entriesScrollRef} className="h-full min-h-0 overflow-y-auto overflow-x-auto">
              {entriesTruthBlocking ? (
                <div className="p-3">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : displayEntriesActiveList.length === 0 ? (
                <EmptyState label={entriesEmptyStateLabel} />
              ) : (
                <>
                  <table className="bb-spreadsheet-table w-full min-w-[656px] table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: 84 }} />
                    <col />
                    <col style={{ width: 96 }} />
                    <col style={{ width: 108 }} />
                    <col style={{ width: 104 }} />
                  </colgroup>

                  <thead className="sticky top-0 z-10 bg-bb-table-header border-b border-bb-border">
                    <tr className="h-[24px]">
                      <th className={thClass}>DATE</th>
                      <th className={thClass}>PAYEE</th>
                      <th className={`${thClass} text-right pr-2`}>AMOUNT</th>
                      <th className={`${thClass} text-right pr-2`}>STATUS</th>
                      <th className={`${thClass} ${stickyActionHeaderClass} text-right pr-2`}>ACTIONS</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(() => {
                    const renderEntryRow = (e: any) => {
                      const amt = toBigIntSafe(e.amount_cents);
                      const payee = (e.payee ?? "").trim();
                      const isOptimisticPending = Boolean(e?.__optimistic_pending);

                      const isMatched = !isOptimisticPending && matchedEntryIdSet.has(e.id);
                      const isPostDated = String(e?.date ?? "") > new Date().toISOString().slice(0, 10);

                      const g = !isOptimisticPending ? (activeGroupByEntryId.get(String(e.id)) ?? null) : null;
                      const hasAdjustment = g ? matchGroupHasAdjustment(g) : false;

                      const rowTone = isMatched
                        ? " bg-primary/10"
                        : isOptimisticPending
                          ? " bg-bb-status-warning-bg"
                          : expectedTab === "expected"
                            ? " bg-primary/5"
                            : "";
                      const actionCellBg = isMatched
                        ? "bg-primary/10"
                        : isOptimisticPending
                          ? "bg-bb-status-warning-bg"
                          : expectedTab === "expected"
                            ? "bg-primary/5"
                            : "bg-bb-surface-card";

                      const deEmphasis = expectedTab === "matched" ? " text-bb-text-muted" : "";

                      const openAuditForEntry = () => {
                        const ev0 = (reconAuditAll ?? []).find((ev: any) =>
                          Array.isArray(ev.entryIds) && ev.entryIds.some((id: any) => String(id) === String(e.id))
                        );
                        if (ev0) {
                          setSelectedReconAudit(ev0);
                          setOpenReconAuditDetail(true);
                          return;
                        }

                        // Fallback: open history (no filter)
                        setOpenReconciliationHistory(true);
                      };

                      return (
                        <tr
                          key={e.id}
                          className={
                            trClass +
                            rowTone +
                            (expectedTab === "matched" ? " opacity-[0.96] cursor-pointer hover:bg-bb-table-row-hover" : "")
                          }
                          onClick={expectedTab === "matched" ? openAuditForEntry : undefined}
                          title={expectedTab === "matched" ? "View audit detail" : undefined}
                        >
                          <td className={`${tdClass} text-center${deEmphasis}`}>{e.date}</td>
                          <td className={`${tdClass} font-medium min-w-0${deEmphasis}`} title={payee}>
                            <span className={reconcileTextClampClass}>{payee}</span>
                          </td>
                          <td className={`${tdClass} text-right pr-2 tabular-nums ${amt < 0n ? "!text-bb-amount-negative" : "text-bb-text"}${deEmphasis}`}>{formatUsdFromCents(amt)}</td>
                          <td className={`${tdClass} text-right pr-2 overflow-hidden${deEmphasis}`}>
                            <div className="inline-flex max-w-full items-center justify-end gap-1.5">
                              <StatusChip
                                label={isOptimisticPending ? "Saving" : isMatched ? "Matched" : isPostDated ? "Post-dated" : "No bank tx"}
                                tone={isOptimisticPending ? "warning" : isMatched ? "success" : isPostDated ? "info" : "default"}
                              />
                              {hasAdjustment ? <StatusChip label="Adjustment" tone="info" /> : null}
                            </div>
                          </td>
                          <td className={`${tdClass} ${stickyActionCellClass} ${actionCellBg} text-right pr-2 overflow-hidden`}>
                            <div className="flex min-w-0 items-center justify-end gap-1">
                              {pendingById[String(e.id)] || isOptimisticPending ? <TinySpinner /> : null}

                              {isOptimisticPending ? null : expectedTab === "matched" ? (
                                <button
                                  type="button"
                                  className={["h-7 w-7 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover", ringFocus].join(" ")}
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    openAuditForEntry();
                                  }}
                                  title="Revert (view audit)"
                                  aria-label="Revert (view audit)"
                                >
                                  <Undo2 className="h-4 w-4 text-bb-text" />
                                </button>
                              ) : (
                                <>
                                  <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? reconcileWriteReason : null}>
                                    <button
                                      type="button"
                                      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card ${ringFocus} ${canWriteReconcileEffective ? "hover:bg-bb-table-row-hover" : "opacity-50 cursor-not-allowed"}`}
                                      disabled={!canWriteReconcileEffective}
                                      title={canWriteReconcileEffective ? "Review match suggestions for this ledger entry" : (reconcileWriteReason ?? noPermTitle)}
                                      aria-label="Match entry"
                                      onClick={() => {
                                        if (!canWriteReconcileEffective) return;
                                        setEntryMatchEntryId(e.id);
                                        setEntryMatchSelectedBankTxnIds(new Set());
                                        setEntryMatchSearch("");
                                        setEntryMatchError(null);
                                        setEntryAiSuggestions([]);
                                        setEntrySuggestError(null);
                                        setOpenEntryMatch(true);
                                        void runAiSuggestForEntry(e);
                                      }}
                                    >
                                      <GitMerge className="h-4 w-4 text-bb-text" />
                                    </button>
                                  </HintWrap>
                                  
                                  <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? reconcileWriteReason : null}>
                                    <button
                                      type="button"
                                      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card ${ringFocus} ${canWriteReconcileEffective ? "hover:bg-bb-table-row-hover" : "opacity-50 cursor-not-allowed"
                                        }`}
                                      disabled={!canWriteReconcileEffective}
                                      onClick={() => {
                                        if (!canWriteReconcileEffective) return;
                                        setAdjustEntryId(e.id);
                                        setAdjustReason("");
                                        setAdjustError(null);
                                        setOpenAdjust(true);
                                      }}
                                      title={canWriteReconcileEffective ? "Mark adjustment (ledger-only)" : (reconcileWriteReason ?? noPermTitle)}
                                      aria-label="Mark adjustment"
                                    >
                                      <Wrench className="h-4 w-4 text-bb-text" />
                                    </button>
                                  </HintWrap>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    };

                    if (!entriesShouldVirtualize) {
                      return displayEntriesActiveList.map((e: any) => renderEntryRow(e));
                    }

                    const items = entriesVirtualizer.getVirtualItems();
                    const totalSize = entriesVirtualizer.getTotalSize();
                    const startPad = items.length > 0 ? items[0].start : 0;
                    const endPad =
                      items.length > 0 ? totalSize - items[items.length - 1].end : 0;

                    return (
                      <>
                        {startPad > 0 ? (
                          <tr style={{ height: startPad }}><td colSpan={5} /></tr>
                        ) : null}
                        {items.map((v) => renderEntryRow(displayEntriesActiveList[v.index]))}
                        {endPad > 0 ? (
                          <tr style={{ height: endPad }}><td colSpan={5} /></tr>
                        ) : null}
                      </>
                    );
                    })()}
                  </tbody>
                </table>

                {/* Phase 2 Performance: load more (keeps initial render bounded) */}
                {expectedTab === "expected" && displayExpectedCount > displayEntriesExpectedList.length ? (
                  <div className="p-2 flex justify-center">
                    <button
                      type="button"
                      className="h-7 px-3 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover"
                      onClick={() => setExpectedVisibleN((n) => n + PAGE_CHUNK)}
                    >
                      Load more
                    </button>
                  </div>
                ) : expectedTab === "matched" && displayMatchedCount > displayEntriesMatchedList.length ? (
                  <div className="p-2 flex justify-center">
                    <button
                      type="button"
                      className="h-7 px-3 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover"
                      onClick={() => setMatchedVisibleN((n) => n + PAGE_CHUNK)}
                    >
                      Load more
                    </button>
                  </div>
                ) : null}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Bank Transactions */}
        <div className="bb-spreadsheet-shell flex flex-col min-h-0 overflow-hidden rounded-lg">
          <div className="px-3 py-1.5">
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="min-w-0 flex items-center gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold text-bb-text">Bank transactions</div>
                  <StatusChip label="Source: Bank" tone="info" />
                  {connectedPill}
                </div>
                <div className="hidden xl:block text-[11px] text-bb-text-muted min-w-0 truncate whitespace-nowrap">
                  {plaidHasConnection ? (
                    <>
                      {plaid?.institutionName ? <span className="text-bb-text">{plaid.institutionName}</span> : <span>—</span>}
                      {plaidNeedsAttention && plaid?.errorMessage ? <span className="text-bb-text-subtle"> • </span> : null}
                      {plaidNeedsAttention && plaid?.errorMessage ? <span className="text-bb-status-warning-fg">{plaid.errorMessage}</span> : null}
                      {bankUpdatesAvailable ? <span className="text-bb-text-subtle"> • </span> : null}
                      {bankUpdatesAvailable ? <span className="text-bb-status-warning-fg">Bank reports new activity; sync to refresh transactions.</span> : null}
                      {syncMsg ? <span className="text-bb-text-subtle"> • </span> : null}
                      {syncMsg ? <span className="truncate">{syncMsg}</span> : null}
                      {pendingMsg ? <span className="text-bb-text-subtle"> • </span> : null}
                      {pendingMsg ? <span className="text-bb-status-warning-fg truncate">{pendingMsg}</span> : null}
                    </>
                  ) : (
                    "Imported from bank or CSV"
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
                {!plaidHealthyConnected ? (
                  <button
                    type="button"
                    className="h-7 px-2 text-xs rounded-md border border-bb-border bg-bb-surface-card inline-flex items-center gap-1 hover:bg-bb-table-row-hover"
                    onClick={() => setOpenUpload(true)}
                  >
                    <Download className="h-3.5 w-3.5" /> Upload CSV
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="h-7 px-2 text-xs rounded-md border border-bb-border bg-bb-surface-card inline-flex items-center gap-1 hover:bg-bb-table-row-hover"
                      onClick={() => setOpenUpload(true)}
                    >
                      <Download className="h-3.5 w-3.5" /> Upload CSV
                    </button>

                    <button
                      type="button"
                      className="h-7 px-2 text-xs rounded-md border border-bb-border bg-bb-surface-card inline-flex items-center gap-1 hover:bg-bb-table-row-hover"
                      disabled={plaidSyncing}
                      onClick={async () => {
                        if (!selectedBusinessId || !selectedAccountId) return;

                        setPlaidSyncing(true);
                        setSyncMsg("Checking bank for latest transactions...");
                        setPendingMsg(null);

                        try {
                          const res = await plaidSync(selectedBusinessId, selectedAccountId, { refresh: true });
                          const newCount = Number(res?.newCount ?? 0);
                          const upgradedCount = Number(res?.upgradedCount ?? 0);
                          const pendingCount = Number(res?.pendingCount ?? 0);
                          const refreshRequested = Boolean(res?.refreshRequested);
                          const refreshSucceeded = Boolean(res?.refreshSucceeded);
                          const refreshErrorCode = String(res?.refreshErrorCode ?? "").trim();

                          const syncParts = [`Transactions refreshed: ${newCount} new`];
                          if (upgradedCount > 0) syncParts.push(`${upgradedCount} posted`);
                          if (pendingCount > 0) syncParts.push(`${pendingCount} pending`);
                          if (refreshRequested) {
                            syncParts.push(refreshSucceeded ? "fresh check requested" : "fresh check unavailable");
                          }

                          setSyncMsg(syncParts.join(" • "));
                          if (pendingCount > 0) {
                            setPendingMsg("Pending shown read-only until posted.");
                          } else if (refreshSucceeded) {
                            setPendingMsg("No pending transactions available from Plaid yet.");
                          } else if (refreshErrorCode) {
                            setPendingMsg("Plaid fresh check unavailable; showing latest synced data.");
                          }

                          const st = await plaidStatus(selectedBusinessId, selectedAccountId);
                          setPlaid(st);

                          settleReconcileInBackground("bank sync", () => {
                            setBankCountRefreshSeq((n) => n + 1);
                          });
                        } catch (e: any) {
                          setSyncMsg(e?.message ?? "Unable to refresh transactions");
                          setPendingMsg("Keeping the current transaction list until sync succeeds.");
                          try {
                            const st = await plaidStatus(selectedBusinessId, selectedAccountId);
                            setPlaid(st);
                          } catch {
                            // Keep the existing status if the follow-up status check also fails.
                          }
                        } finally {
                          setPlaidSyncing(false);
                        }
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> {plaidSyncing ? "Syncing…" : "Sync"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {!plaidHealthyConnected ? (
            <div className="mx-3 mb-3 rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-bb-text">
                    {plaidNeedsAttention ? "Reconnect bank feed" : "Bank connection settings"}
                  </div>
                  <div className="mt-1 text-[11px] text-bb-text-muted">
                    {plaidNeedsAttention
                      ? "Reconnect through Plaid to refresh transactions for this account."
                      : "Connect a live bank feed via Plaid only for the selected business and account."}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                    <span className="text-bb-text-muted">
                      Business: <span className="font-medium text-bb-text">{selectedBusinessName || "Select business"}</span>
                    </span>
                    <span className="text-bb-text-muted">
                      Account: <span className="font-medium text-bb-text">{selectedAccountName || "Select account"}</span>
                    </span>
                  </div>
                  {!selectedAccountId ? (
                    <div className="mt-1 text-[11px] text-bb-status-warning-fg">
                      Select an account before connecting a bank feed.
                    </div>
                  ) : null}
                </div>

                <PlaidConnectButton
                  businessId={selectedBusinessId ?? ""}
                  accountId={selectedAccountId ?? ""}
                  businessName={selectedBusinessName}
                  accountName={selectedAccountName}
                  effectiveStartDate={selectedAccountOpeningDate}
                  disabled={plaidSyncing || !selectedBusinessId || !selectedAccountId}
                  disabledClassName={disabledBtn}
                  buttonClassName="h-8 px-3 text-xs rounded-md border border-bb-border bg-bb-surface-card inline-flex items-center gap-1 hover:bg-bb-table-row-hover"
                  onConnected={async (syncResult?: any) => {
                    if (!selectedBusinessId || !selectedAccountId) return;

                    const initialSyncFailed = !!syncResult?.syncFailed || syncResult?.ok === false;
                    if (initialSyncFailed) {
                      setSyncMsg(`Initial transaction sync failed: ${syncResult?.error ?? "Unable to refresh transactions"}`);
                      setPendingMsg("Connected bank, but the transaction list may be stale. Try Sync.");
                    } else if (syncResult) {
                      const newCount = Number(syncResult?.newCount ?? 0);
                      const upgradedCount = Number(syncResult?.upgradedCount ?? 0);
                      const pendingCount = Number(syncResult?.pendingCount ?? 0);
                      const syncParts = [`Transactions refreshed: ${newCount} new`];
                      if (upgradedCount > 0) syncParts.push(`${upgradedCount} posted`);
                      if (pendingCount > 0) syncParts.push(`${pendingCount} pending`);
                      setSyncMsg(syncParts.join(" • "));
                      setPendingMsg(pendingCount > 0 ? "Pending shown read-only until posted." : null);
                    } else {
                      setSyncMsg(null);
                      setPendingMsg(null);
                    }
                    setPlaidLoading(true);
                    try {
                      const res = await plaidStatus(selectedBusinessId, selectedAccountId);
                      setPlaid(res);

                      settleReconcileInBackground("bank connection", () => {
                        setBankCountRefreshSeq((n) => n + 1);
                      });
                    } finally {
                      setPlaidLoading(false);
                    }
                  }}
                />
              </div>
            </div>
          ) : null}

          <div className="px-3 pb-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {bankPanelShowStatusWhileRows ? (
                <span className="text-[11px] text-bb-text-muted inline-flex items-center gap-1.5">
                  <TinySpinner />
                  <span>{plaidSyncing ? "Syncing bank data…" : matchGroupsLoading ? "Loading placement…" : "Saving changes…"}</span>
                </span>
              ) : null}
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${bankTab === "unmatched" ? "border-bb-border bg-bb-surface-card text-bb-text" : "border-transparent text-bb-text-muted hover:bg-bb-table-row-hover"
                  }`}
                onClick={() => setBankTab("unmatched")}
              >
                {bankUnmatchedTabLabel}
              </button>
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${bankTab === "matched" ? "border-bb-border bg-bb-surface-card text-bb-text" : "border-transparent text-bb-text-muted hover:bg-bb-table-row-hover"
                  }`}
                onClick={() => {
                  setBankTab("matched");
                  if (!bankStatusLoaded.matched && !bankLoadingByStatus.matched) {
                    void refreshBankAndMatches({ preserveOnEmpty: true, skipLegacyMatches: true, statuses: ["matched"] });
                  }
                }}
              >
                {bankMatchedTabLabel}
              </button>
              {(bankTab === "unmatched" || activeBankStatusLoaded || activeBankStatusLoading) ? (
                <div className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-bb-border bg-bb-surface-soft px-2 py-1 text-[11px] leading-4 text-bb-text-muted">
                  <span className="font-semibold text-bb-text">Bank:</span>
                  <span className="truncate">
                    {bankScopeCopy}
                    {bankPendingCopy ? ` • ${bankPendingCopy}` : ""}
                    {activeBankHiddenBySearch > 0 ? ` • ${activeBankHiddenBySearch} hidden by search` : ""}
                    {bankTab === "unmatched" && bankUnmatchedOutsideDateRange != null && bankUnmatchedOutsideDateRange > 0
                      ? ` • ${bankUnmatchedOutsideDateRange}${bankUnmatchedScopeCounts.allTime?.capped ? "+" : ""} outside date range`
                      : ""}
                  </span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="h-px bg-bb-border" />

          <div className="relative flex-1 min-h-0 overflow-hidden">
            <div ref={bankScrollRef} className="h-full min-h-0 overflow-y-auto overflow-x-auto">
              {bankPanelShowInitialLoading ? (
                <div className="p-3">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : bankPanelShowEmpty ? (
                <EmptyState
                  label={bankEmptyStateLabel}
                />
              ) : bankPanelShowDeferredLoad ? (
                <div className="h-full min-h-[240px] flex items-center justify-center">
                  <div className="text-center">
                    <button
                      type="button"
                      className="h-7 px-3 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover"
                      onClick={() => void refreshBankAndMatches({ preserveOnEmpty: true, skipLegacyMatches: true, statuses: ["matched"] })}
                    >
                      Load matched transactions
                    </button>
                  </div>
                </div>
              ) : bankPanelShowRows ? (
                <>
                  <table className="bb-spreadsheet-table w-full min-w-[640px] table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: 30 }} />
                    <col style={{ width: 84 }} />
                    <col />
                    <col style={{ width: 116 }} />
                    <col style={{ width: 112 }} />
                  </colgroup>

                  <thead className="sticky top-0 z-10 bg-bb-table-header border-b border-bb-border">
                    <tr className="h-[24px]">
                      <th className={thClass}>
                        {bankTab === "unmatched" ? (
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={
                              displayBankUnmatchedList.length > 0 &&
                              selectedBankTxnIds.size === displayBankUnmatchedList.length
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedBankTxnIds(new Set(
                                  displayBankUnmatchedList
                                    .filter((x: any) => {
                                      const id = String(x?.id ?? "");
                                      return id && !x?.is_pending && !pendingById[id] && !isBankTxnFullyMatched(x);
                                    })
                                    .map((x: any) => String(x.id))
                                ));
                              } else {
                                setSelectedBankTxnIds(new Set());
                              }
                            }}
                            aria-label="Select all unmatched bank transactions"
                          />
                        ) : null}
                      </th>
                      <th className={thClass}>DATE</th>
                      <th className={thClass}>DESCRIPTION</th>
                      <th className={`${thClass} text-right pr-2`}>AMOUNT</th>
                      <th className={`${thClass} ${stickyActionHeaderClass} text-right pr-2`}>ACTIONS</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(() => {
                    const renderBankRow = (t: any) => {

                      const txnId = String(t.id ?? "");
                      const isSelected = txnId ? selectedBankTxnIds.has(txnId) : false;

                      const amt = toBigIntSafe(t.amount_cents);
                      const dateStr = (() => {
                        try {
                          const d = new Date(t.posted_date);
                          return d.toISOString().slice(0, 10);
                        } catch {
                          return String(t.posted_date ?? "");
                        }
                      })();

                      const isMatched = isBankTxnFullyMatched(t);
                      const isPendingBankTxn = Boolean(t?.is_pending);
                      const isRowPending = !!pendingById[txnId] || !!createEntryBusyByBankId[txnId];
                      const pendingActionReason = "Pending transaction. Actions unlock once it posts.";
                      const rowBusyReason = matchedOrPendingCreateEntryMessage;
                      const createEntryActionBlockReason = getCreateEntryActionBlockReason(txnId);
                      const rowTone = isPendingBankTxn ? " bg-bb-status-warning-bg" : isMatched ? " bg-primary/10" : "";
                      const actionCellBg = isPendingBankTxn ? "bg-bb-status-warning-bg" : isMatched ? "bg-primary/10" : "bg-bb-surface-card";

                      const deEmphasis = bankTab === "matched" ? " text-bb-text-muted" : "";

                      const openAuditForBankTxn = async () => {
                        let auditEvents = reconAuditAll ?? [];
                        if (!allMatchGroupsHydrated) {
                          const groups = await loadAllMatchGroups();
                          auditEvents = buildReconAuditEvents(groups);
                        }

                        const ev0 = (auditEvents ?? []).find((e: any) =>
                          Array.isArray(e.bankTxnIds) && e.bankTxnIds.some((id: any) => String(id) === String(t.id))
                        );
                        if (ev0) {
                          setSelectedReconAudit(ev0);
                          setRevertError(null);
                          setOpenReconAuditDetail(true);
                          return;
                        }
                        // Fallback: open history filtered to this bank txn
                        setReconHistoryBankTxnFilterId(String(t.id));
                        setReconHistoryFilter("all");
                        setOpenReconciliationHistory(true);
                      };

                      return (
                        <tr
                          key={t.id}
                          className={
                            trClass +
                            rowTone +
                            (bankTab === "matched" ? " opacity-[0.96] cursor-pointer hover:bg-bb-table-row-hover" : "")
                          }
                          onClick={bankTab === "matched" && isMatched ? () => void openAuditForBankTxn() : undefined}
                          title={bankTab === "matched" ? "View audit detail" : undefined}
                        >
                          <td className={tdClass}>
                            {bankTab === "unmatched" ? (
                              <input
                                type="checkbox"
                                className="h-3 w-3"
                                checked={!isPendingBankTxn && !isRowPending && isSelected}
                                disabled={isPendingBankTxn || isRowPending}
                                title={isPendingBankTxn ? pendingActionReason : isRowPending ? rowBusyReason : "Select bank transaction"}
                                onChange={(e) => {
                                  if (isPendingBankTxn || isRowPending) return;
                                  const checked = e.target.checked;
                                  setSelectedBankTxnIds((prev) => {
                                    const next = new Set(prev);
                                    if (!txnId) return next;
                                    if (checked) next.add(txnId);
                                    else next.delete(txnId);
                                    return next;
                                  });
                                }}
                                onClick={(ev) => ev.stopPropagation()}
                                aria-label="Select bank transaction"
                              />
                            ) : null}
                          </td>

                          <td className={`${tdClass} text-center${deEmphasis}`}>{dateStr}</td>
                          <td className={`${tdClass} font-medium min-w-0${deEmphasis}`} title={String(t.name ?? "")}>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={reconcileTextClampClass}>{t.name}</span>

                              {hasVoidByBankTxnId.has(String(t.id)) ? (
                                <button
                                  type="button"
                                  className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-md hover:bg-bb-table-row-hover"
                                  title="Reverted previously (view history)"
                                  aria-label="Reverted previously (view history)"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setReconHistoryBankTxnFilterId(String(t.id));
                                    setReconHistoryFilter("all");
                                    setOpenReconciliationHistory(true);
                                  }}
                                >
                                  <RotateCcw className="h-3.5 w-3.5 text-bb-text-muted" />
                                </button>
                              ) : null}

                              {isPendingBankTxn ? (
                                <span className="shrink-0">
                                  <StatusChip label="Pending" tone="warning" />
                                </span>
                              ) : null}

                              {t.source ? (
                                <span className="shrink-0">
                                  <StatusChip label={String(t.source)} tone="default" />
                                </span>
                              ) : null}

                              {!isMatched && !isPendingBankTxn && bankTab === "unmatched" ? (
                                <span className="shrink-0">
                                  <StatusChip
                                    label={bankAutoMatchCandidateById.get(txnId) ? "Match found" : "No ledger entry"}
                                    tone={bankAutoMatchCandidateById.get(txnId) ? "success" : "default"}
                                  />
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className={`${tdClass} text-right pr-2 tabular-nums ${amt < 0n ? "!text-bb-amount-negative" : "text-bb-text"}${deEmphasis}`}>
                            {formatUsdFromCents(amt)}
                          </td>

                          <td className={`${tdClass} ${stickyActionCellClass} ${actionCellBg} text-right pr-2 overflow-hidden`}>
                            <div className="flex min-w-0 items-center justify-end gap-1">
                              {pendingById[String(t.id)] ? <TinySpinner /> : null}

                              {bulkCreateResultByBankTxnId[String(t.id)] ? (() => {
                                const bulkRes = bulkCreateResultByBankTxnId[String(t.id)];
                                const bulkStatus = String(bulkRes?.status ?? "");
                                const bulkCode = String(bulkRes?.code ?? "");
                                const isPossibleDup =
                                  bulkStatus === "SKIPPED" && bulkCode === "POSSIBLE_DUPLICATE_ENTRY";
                                return (
                                  <>
                                    <span
                                      className="max-w-[96px] truncate text-[11px] px-2 py-0.5 rounded-full border border-bb-border text-bb-text"
                                      title={String(
                                        bulkRes?.error ??
                                          (isPossibleDup
                                            ? "An existing entry near this date looks similar. Click 'Create anyway' if this is a separate recurring charge (NTTA, bank fee, subscription)."
                                            : "")
                                      )}
                                    >
                                      {isPossibleDup ? "Skipped (possible duplicate)" : bulkStatus}
                                    </span>
                                    {isPossibleDup ? (
                                      <button
                                        type="button"
                                        className={`max-w-[92px] truncate text-[11px] px-2 py-0.5 rounded-md border border-bb-border bg-bb-surface-card text-bb-text hover:bg-bb-table-row-hover disabled:opacity-50 disabled:cursor-not-allowed ${ringFocus}`}
                                        disabled={pendingById[String(t.id)] === true}
                                        title="Create separate entry anyway (use for recurring charges)"
                                        onClick={async (ev) => {
                                          ev.stopPropagation();
                                          if (!selectedBusinessId || !selectedAccountId) return;
                                          const bid = String(t.id);
                                          markPending(bid);
                                          try {
                                            await createEntryFromBankTransaction({
                                              businessId: selectedBusinessId,
                                              accountId: selectedAccountId,
                                              bankTransactionId: bid,
                                              autoMatch: bulkCreateAutoMatch === true,
                                              memo: "",
                                              method: "",
                                              category_id: "",
                                              suggested_category_id: "",
                                              allowPossibleDuplicate: true,
                                            });
                                            setBulkCreateResultByBankTxnId((m) => {
                                              const next = { ...m };
                                              next[bid] = { ...next[bid], status: "CREATED", code: "" };
                                              return next;
                                            });
                                            setOptimisticHiddenBankTxnIds((prev) => {
                                              const next = new Set(prev);
                                              next.add(bid);
                                              return next;
                                            });
                                            settleReconcileInBackground("created entry", async () => {
                                              await refreshIssuesAfterBankEntryCreate();
                                              setOptimisticHiddenBankTxnIds((prev) => {
                                                const next = new Set(prev);
                                                next.delete(bid);
                                                return next;
                                              });
                                            });
                                          } catch (err: any) {
                                            applyMutationError(err, "Can’t create entry");
                                          } finally {
                                            clearPending(bid);
                                          }
                                        }}
                                      >
                                        Create anyway
                                      </button>
                                    ) : null}
                                  </>
                                );
                              })() : null}

                              {bankTab === "matched" ? (
                                <button
                                  type="button"
                                  className={["h-7 w-7 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card disabled:opacity-50 disabled:cursor-not-allowed", !isRowPending && !revertBusy ? "hover:bg-bb-table-row-hover" : "", ringFocus].join(" ")}
                                  disabled={isRowPending || revertBusy}
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    if (isRowPending || revertBusy) return;
                                    void openAuditForBankTxn();
                                  }}
                                  title={isRowPending || revertBusy ? rowBusyReason : "Revert (view audit)"}
                                  aria-label="Revert (view audit)"
                                >
                                  <Undo2 className="h-4 w-4 text-bb-text" />
                                </button>
                              ) : (
                                <>
                                  {(() => {
                                    const autoCandidateEntryId = bankAutoMatchCandidateById.get(txnId);
                                    if (!autoCandidateEntryId) return null;
                                    if (!canWriteReconcileEffective) return null;
                                    if (isPendingBankTxn || isRowPending) return null;
                                    return (
                                      <AppTooltip content="Match with the only strong ledger entry candidate" side="left">
                                        <button
                                          type="button"
                                          className={`h-7 w-7 shrink-0 inline-flex items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary ${ringFocus} hover:bg-primary/15`}
                                          aria-label="Auto-match bank transaction"
                                          onClick={(ev) => {
                                            ev.stopPropagation();
                                            void quickMatchAt(txnId, autoCandidateEntryId);
                                          }}
                                        >
                                          <Sparkles className="h-4 w-4" />
                                        </button>
                                      </AppTooltip>
                                    );
                                  })()}

                                  <HintWrap
                                     disabled={!canWriteReconcileEffective || isPendingBankTxn || isRowPending}
                                    reason={
                                      isPendingBankTxn
                                        ? pendingActionReason
                                        : isRowPending
                                          ? rowBusyReason
                                        : !canWriteReconcileEffective
                                          ? reconcileWriteReason
                                          : null
                                    }
                                  >
                                    <button
                                      type="button"
                                      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card ${ringFocus} ${canWriteReconcileEffective && !isPendingBankTxn && !isRowPending ? "hover:bg-bb-table-row-hover" : "opacity-50 cursor-not-allowed"}`}
                                      disabled={!canWriteReconcileEffective || isPendingBankTxn || isRowPending}
                                      title={
                                        isPendingBankTxn
                                          ? pendingActionReason
                                          : isRowPending
                                            ? rowBusyReason
                                          : canWriteReconcileEffective
                                            ? "Review match suggestions for this bank transaction"
                                            : (reconcileWriteReason ?? noPermTitle)
                                      }
                                      aria-label="Match bank transaction"
                                      onClick={() => {
                                        if (isPendingBankTxn || isRowPending) return;
                                        if (!canWriteReconcileEffective) return;
                                        setMatchBankTxnId(t.id);
                                        setMatchSearch("");
                                        setMatchSelectedEntryIds(new Set());
                                        setMatchError(null);
                                        setMatchAiSuggestions([]);
                                        setMatchSuggestError(null);
                                        setOpenMatch(true);
                                        void runAiSuggestForBank(t);
                                      }}
                                    >
                                      <GitMerge className="h-4 w-4 text-bb-text" />
                                    </button>
                                  </HintWrap>
                                </>
                              )}

                              <HintWrap
                                disabled={!canWriteReconcileEffective || isPendingBankTxn}
                                reason={
                                  isPendingBankTxn
                                    ? pendingActionReason
                                    : !canWriteReconcileEffective
                                      ? reconcileWriteReason
                                      : null
                                }
                              >
                                <button
                                  type="button"
                                  className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card ${ringFocus} ${canWriteReconcileEffective && !isPendingBankTxn ? "hover:bg-bb-table-row-hover" : "opacity-50 cursor-not-allowed"
                                    }`}
                                  disabled={
                                    !canWriteReconcileEffective ||
                                    !!createEntryActionBlockReason
                                  }
                                  title={
                                    isPendingBankTxn
                                      ? pendingActionReason
                                      : !canWriteReconcileEffective
                                      ? (reconcileWriteReason ?? noPermTitle)
                                      : createEntryActionBlockReason
                                        ? createEntryActionBlockReason
                                      : (remainingAbsByBankTxnId.get(t.id) ?? 0n) === 0n
                                        ? "Already fully matched"
                                        : "Create entry from this bank transaction"
                                  }
                                  aria-label="Create entry"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    if (createEntryActionBlockReason) {
                                      setCreateEntryErr(createEntryActionBlockReason);
                                      return;
                                    }
                                    if (!canWriteReconcileEffective) return;

                                    const bankId = String(t.id);
                                    const remaining = remainingAbsByBankTxnId.get(t.id) ?? 0n;
                                    if (remaining === 0n) return;

                                    setCreateEntryErr(null);
                                    setCreateEntryDuplicateCandidates([]);
                                    setCreateEntryDuplicateConfirm("");
                                    setCreateEntryBankTxnId(bankId);
                                    setCreateEntryAutoMatch(true);

                                    // Prefill overrides
                                    const defaultDesc = (t?.name ?? "").toString().trim() || "—";
                                    setCreateEntryMemo(`Bank txn: ${defaultDesc} • ${bankId}`);
                                    setCreateEntryMethod(inferMethodFromBankTransaction(t));
                                    setCreateEntryCategoryId("");
                                    setCreateEntryCategoryName("");
                                    setCreateEntryCategoryTouched(false);
                                    setCategoryQuery("");

                                    setOpenCreateEntry(true);
                                  }}
                                >
                                  {createEntryBusyByBankId[String(t.id)] ? (
                                    <TinySpinner />
                                  ) : (
                                    <Plus className="h-4 w-4 text-bb-text" />
                                  )}
                                </button>
                              </HintWrap>

                              {bankTab !== "matched"
                                ? (() => {
                                  const matchedAbs = matchedAbsByBankTxnId.get(t.id) ?? 0n;
                                  const bankAbs = absBig(toBigIntSafe(t.amount_cents));
                                  const isMatched = matchedAbs === bankAbs && bankAbs > 0n;
                                  const isPartial = matchedAbs > 0n && matchedAbs < bankAbs;
                                  if (!isMatched && !isPartial) return null;

                                  return (
                                    <button
                                      type="button"
                                      className={["h-7 w-7 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card disabled:opacity-50 disabled:cursor-not-allowed", !isRowPending && !revertBusy ? "hover:bg-bb-table-row-hover" : "", ringFocus].join(" ")}
                                      disabled={isRowPending || revertBusy}
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        if (isRowPending || revertBusy) return;
                                        void openAuditForBankTxn();
                                      }}
                                      title={isRowPending || revertBusy ? rowBusyReason : "Revert (view audit)"}
                                      aria-label="Revert (view audit)"
                                    >
                                      <Undo2 className="h-4 w-4 text-bb-text" />
                                    </button>
                                  );
                                })()
                                : null}
                            </div>
                          </td>
                        </tr>
                      );
                    };

                    if (!bankShouldVirtualize) {
                      return displayBankActiveList.map((t: any) => renderBankRow(t));
                    }

                    const items = bankVirtualizer.getVirtualItems();
                    const totalSize = bankVirtualizer.getTotalSize();
                    const startPad = items.length > 0 ? items[0].start : 0;
                    const endPad =
                      items.length > 0 ? totalSize - items[items.length - 1].end : 0;

                    return (
                      <>
                        {startPad > 0 ? (
                          <tr style={{ height: startPad }}><td colSpan={5} /></tr>
                        ) : null}
                        {items.map((v) => renderBankRow(displayBankActiveList[v.index]))}
                        {endPad > 0 ? (
                          <tr style={{ height: endPad }}><td colSpan={5} /></tr>
                        ) : null}
                      </>
                    );
                    })()}
                  </tbody>
                </table>

                {/* Phase 2 Performance: load more (keeps initial render bounded) */}
                {bankTab === "unmatched" && displayBankUnmatchedCount > displayBankUnmatchedList.length ? (
                  <div className="p-2 flex justify-center">
                    <button
                      type="button"
                      className="h-7 px-3 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover"
                      onClick={() => setBankUnmatchedVisibleN((n) => n + PAGE_CHUNK)}
                    >
                      Load more
                    </button>
                  </div>
                ) : bankTab === "matched" && displayBankMatchedCount > displayBankMatchedList.length ? (
                  <div className="p-2 flex justify-center">
                    <button
                      type="button"
                      className="h-7 px-3 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover"
                      onClick={() => setBankMatchedVisibleN((n) => n + PAGE_CHUNK)}
                    >
                      Load more
                    </button>
                  </div>
                ) : activeBankNextCursor ? (
                  <div className="p-2 flex justify-center">
                    <button
                      type="button"
                      className="h-7 px-3 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={bankLoadingMore}
                      onClick={() => void loadMoreBankTransactions()}
                    >
                      {bankLoadingMore ? "Loading…" : "Load more bank transactions"}
                    </button>
                  </div>
                ) : null}
                </>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Phase 6B: Snapshots dialog */}
      <AppDialog
        open={openSnapshots}
        onClose={() => {
          setOpenSnapshots(false);
        }}
        title="Snapshots"
        size="sm"
        footer={openSnapshots ? (
          <DialogFooter
            left={
              <BusyButton
                variant="secondary"
                size="md"
                onClick={() => setOpenSnapshots(false)}
              >
                Close
              </BusyButton>
            }
            right={null}
          />
        ) : null}
      >
        {openSnapshots ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: list */}
          <div className="rounded-md border border-bb-border overflow-hidden">
            <div className="px-3 py-2 border-b border-bb-border bg-bb-surface-soft">
              <div className="text-xs font-semibold text-bb-text">Snapshot history</div>
              <div className="text-[11px] text-bb-text-muted">Most recent first</div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {snapshotsLoading ? (
                <div className="p-3">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : snapshotsError ? (
                <div className="p-3 text-xs text-bb-status-danger-fg">{snapshotsError}</div>
              ) : snapshots.length === 0 ? (
                <div className="p-3 text-xs text-bb-text-muted">No snapshots yet for this account.</div>
              ) : (
                <div className="flex flex-col">
                  {snapshots.map((s) => {
                    const selected = selectedSnapshotId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`w-full text-left px-3 py-2 border-b border-bb-border-muted hover:bg-bb-table-row-hover ${selected ? "bg-bb-table-row-selected" : "bg-bb-surface-card"
                          }`}
                        onClick={() => setSelectedSnapshotId(s.id)}
                        title="View snapshot"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-bb-text truncate">{s.month}</div>
                            <div className="text-[11px] text-bb-text-muted truncate">
                              Created {new Date(s.created_at).toLocaleString()}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[11px] text-bb-text-muted">Remaining</div>
                            <div className="text-xs font-semibold text-bb-text tabular-nums">
                              {formatUsdFromCents(toBigIntSafe(s.remaining_abs_cents))}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right: create + details */}
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-bb-border overflow-hidden">
              <div className="px-3 py-2 border-b border-bb-border bg-bb-surface-soft">
                <div className="text-xs font-semibold text-bb-text">Create snapshot</div>
                <div className="text-[11px] text-bb-text-muted">
                  Snapshots reflect reconciliation state as of creation time for bank transactions posted in the selected month.
                </div>
              </div>

              <div className="p-3">
                <div className="flex items-center gap-2">
                  <div className="w-[170px]">
                    <AppDatePicker
                      value={snapshotMonth ? `${snapshotMonth}-01` : ""}
                      onChange={(next) => setSnapshotMonth(next ? next.slice(0, 7) : "")}
                      placeholder="Select month"
                      allowClear={false}
                    />
                  </div>

                  <HintWrap
                    disabled={!canWriteSnapshotsEffective}
                    reason={!canWriteSnapshotsEffective ? (snapshotWriteReason ?? noPermTitle) : null}
                  >
                    <BusyButton
                      variant="primary"
                      size="md"
                      busy={snapshotCreateBusy}
                      busyLabel="Creating…"
                      disabled={!canWriteSnapshotsEffective || monthAlreadyExists}
                      title={
                        !canWriteSnapshotsEffective
                          ? (snapshotWriteReason ?? noPermTitle)
                          : monthAlreadyExists
                            ? "Snapshot already exists for that month"
                            : "Create snapshot"
                      }
                      onClick={async () => {
                        if (!canWriteSnapshotsEffective) return;
                        if (!selectedBusinessId || !selectedAccountId) return;

                        // If month exists, no API call — just select and show details
                        if (monthAlreadyExists && existingSnapshotForMonth?.id) {
                          setSelectedSnapshotId(existingSnapshotForMonth.id);
                          setSnapshotExistsInfo({ month: snapshotMonth, snapshotId: existingSnapshotForMonth.id });
                          return;
                        }

                        setSnapshotCreateBusy(true);
                        setSnapshotCreateError(null);
                        setSnapshotExistsInfo(null);

                        try {
                          const created = await createReconcileSnapshot(selectedBusinessId, selectedAccountId, snapshotMonth);
                          const items = await listReconcileSnapshots(selectedBusinessId, selectedAccountId);
                          setSnapshots(items ?? []);
                          if (created?.id) setSelectedSnapshotId(created.id);
                        } catch (e: any) {
                          const msg = e?.message ?? "Failed to create snapshot";

                          // 409 is expected: set neutral info + auto-select existing snapshot id
                          let existingId: string | null = null;
                          try {
                            if (typeof msg === "string") {
                              // apiFetch often throws "API 409: { ...json... }"
                              const m = msg.match(/\bAPI\s+409:\s*(\{.*\})\s*$/s);
                              if (m?.[1]) {
                                const payload = JSON.parse(m[1]);
                                existingId = payload?.snapshot?.id ?? null;
                              }
                            }
                          } catch {
                            // ignore parse errors
                          }

                          // Fallback: use list-derived id for the current month (if present)
                          if (!existingId) existingId = existingSnapshotForMonth?.id ?? null;

                          if (typeof msg === "string" && msg.includes("409")) {
                            if (existingId) setSelectedSnapshotId(existingId);
                            setSnapshotExistsInfo({ month: snapshotMonth, snapshotId: existingId ?? "" });
                          } else {
                            setSnapshotCreateError(msg);
                          }
                        } finally {
                          setSnapshotCreateBusy(false);
                        }
                      }}
                    >
                      {monthAlreadyExists ? "Exists" : snapshotCreateBusy ? "Creating…" : "Create"}
                    </BusyButton>
                  </HintWrap>
                </div>

                {/* Neutral info banner when snapshot exists */}
                {monthAlreadyExists || snapshotExistsInfo ? (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-bb-border bg-bb-surface-soft px-2 py-2">
                    <div className="text-xs text-bb-text">
                      Snapshot already exists for <span className="font-semibold">{snapshotMonth}</span>.
                    </div>

                    <button
                      type="button"
                      className="h-7 px-2 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover"
                      title="View snapshot"
                      onClick={() => {
                        const id = (snapshotExistsInfo?.snapshotId || existingSnapshotForMonth?.id || "").trim();
                        if (!id) return;
                        setSelectedSnapshotId(id);
                      }}
                      disabled={!((snapshotExistsInfo?.snapshotId || existingSnapshotForMonth?.id || "").trim())}
                    >
                      View
                    </button>
                  </div>
                ) : null}

                {snapshotCreateError ? <div className="mt-2 text-xs text-bb-status-danger-fg">{snapshotCreateError}</div> : null}
              </div>
            </div>

            <div className="rounded-md border border-bb-border overflow-hidden flex-1">
              <div className="px-3 py-2 border-b border-bb-border bg-bb-surface-soft">
                <div className="text-xs font-semibold text-bb-text">Snapshot details</div>
                <div className="text-[11px] text-bb-text-muted">Downloads are restricted to write roles.</div>
              </div>

              <div className="p-3">
                {snapshotLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : snapshotError ? (
                  <div className="text-xs text-bb-status-danger-fg">{snapshotError}</div>
                ) : !snapshot ? (
                  <div className="text-xs text-bb-text-muted">Select a snapshot from the left.</div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-bb-text-muted">Month</div>
                        <div className="font-semibold text-bb-text">{snapshot.month}</div>
                      </div>
                      <div>
                        <div className="text-bb-text-muted">Remaining</div>
                        <div className="font-semibold text-bb-text tabular-nums">
                          {formatUsdFromCents(toBigIntSafe(snapshot.remaining_abs_cents))}
                        </div>
                      </div>
                      <div>
                        <div className="text-bb-text-muted">Bank status</div>
                        <div className="text-bb-text">
                          U {snapshot.bank_unmatched_count} • P {snapshot.bank_partial_count} • M {snapshot.bank_matched_count}
                        </div>
                      </div>
                      <div>
                        <div className="text-bb-text-muted">Entries</div>
                        <div className="text-bb-text">
                          Expected {snapshot.entries_expected_count} • Matched {snapshot.entries_matched_count}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {(["bank", "matches", "audit"] as const).map((k) => {
                        const label = k === "bank" ? "Bank CSV" : k === "matches" ? "Matches CSV" : "Audit CSV";
                        return (
                          <HintWrap
                            key={k}
                            disabled={!canWriteSnapshotsEffective}
                            reason={!canWriteSnapshotsEffective ? (snapshotWriteReason ?? noPermTitle) : null}
                          >
                            {(() => {
                              const busyKey = snapshot?.id ? `${snapshot.id}:${k}` : `none:${k}`;
                              const dlBusy = !!snapshotDownloadBusyByKey[busyKey];

                              return (
                                <BusyButton
                                  variant="secondary"
                                  size="md"
                                  busy={dlBusy}
                                  busyLabel="Downloading…"
                                  disabled={!canWriteSnapshotsEffective || !snapshot?.id}
                                  title={!canWriteSnapshotsEffective ? (snapshotWriteReason ?? noPermTitle) : "Download"}
                                  onClick={async () => {
                                    if (!selectedBusinessId || !selectedAccountId || !snapshot?.id) return;

                                    const key = `${snapshot.id}:${k}`;
                                    setSnapshotDownloadBusyByKey((m) => ({ ...m, [key]: true }));
                                    try {
                                      const res = await getReconcileSnapshotExportUrl(
                                        selectedBusinessId,
                                        selectedAccountId,
                                        snapshot.id,
                                        k
                                      );
                                      if (res?.url) window.open(res.url, "_blank", "noopener,noreferrer");
                                    } catch {
                                      // ignore
                                    } finally {
                                      setSnapshotDownloadBusyByKey((m) => ({ ...m, [key]: false }));
                                    }
                                  }}
                                >
                                  {label}
                                </BusyButton>
                              );
                            })()}
                          </HintWrap>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        ) : null}
      </AppDialog>

      {/* Phase 4D: Match dialog (Bank txn → many entries) */}
      <AppDialog
        open={openMatch}
        onClose={() => {
          setOpenMatch(false);
          setMatchError(null);
          setMatchBusy(false);
          setMatchSearch("");
          setMatchSelectedEntryIds(new Set());
          setMatchBankTxnId(null);
          setMatchSuggestLoading(false);
          setMatchAiSuggestions([]);
          setMatchSuggestError(null);
        }}
        title="Match bank transaction"
        size="lg"
        bodyClassName="overflow-hidden sm:overflow-hidden"
        footer={openMatch ? (
          <DialogFooter
            left={null}
            right={
              <>
                <BusyButton
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    setOpenMatch(false);
                    setMatchError(null);
                    setMatchBusy(false);
                    setMatchSearch("");
                    setMatchSelectedEntryIds(new Set());
                    setMatchBankTxnId(null);
                    setMatchSuggestLoading(false);
                  }}
                  disabled={matchBusy}
                >
                  Cancel
                </BusyButton>

                <HintWrap
                  disabled={!canWriteReconcileEffective}
                  reason={!canWriteReconcileEffective ? (reconcileWriteReason ?? noPermTitle) : null}
                >
                  <BusyButton
                    variant="primary"
                    size="md"
                    busy={matchBusy}
                    busyLabel="Matching…"
                    disabled={(() => {
                      if (!canWriteReconcileEffective) return true;
                      if (matchBusy) return true;
                      if (!matchBankTxnId) return true;
                      if (matchSelectedEntryIds.size === 0) return true;

                      const bank = bankTxSorted.find((x: any) => x.id === matchBankTxnId);
                      const bankAbs = absBig(bank ? toBigIntSafe(bank.amount_cents) : 0n);

                      let selectedAbs = 0n;
                      for (const id of matchSelectedEntryIds) {
                        const e = allEntriesSorted.find((x: any) => x.id === id);
                        if (!e) continue;
                        selectedAbs += absBig(toBigIntSafe(e.amount_cents));
                      }
                      return bankAbs !== selectedAbs;
                    })()}
                    onClick={async () => {
                      if (!canWriteReconcileEffective) return;
                      if (!selectedBusinessId || !selectedAccountId) return;
                      if (!matchBankTxnId) return;

                      const bank = bankTxSorted.find((x: any) => x.id === matchBankTxnId);
                      const bankAmt = bank ? toBigIntSafe(bank.amount_cents) : 0n;
                      const bankAbs = absBig(bankAmt);

                      let selectedAbs = 0n;
                      for (const id of matchSelectedEntryIds) {
                        const e = allEntriesSorted.find((x: any) => x.id === id);
                        if (!e) continue;
                        selectedAbs += absBig(toBigIntSafe(e.amount_cents));
                      }
                      if (selectedAbs !== bankAbs) {
                        setMatchError("Select entries until Remaining Δ is exactly 0.");
                        return;
                      }

                      setMatchBusy(true);
                      setMatchError(null);
                      clearMutErr();

                      const pendingIds = [String(matchBankTxnId), ...Array.from(matchSelectedEntryIds).map(String)];
                      for (const id of pendingIds) markPending(id);

                      try {
                        const payloadItems = [
                          {
                            client_id: `manual:${matchBankTxnId}:${Date.now()}`,
                            bankTransactionIds: [matchBankTxnId],
                            entryIds: Array.from(matchSelectedEntryIds),
                          },
                        ];

                        const res: any = await createMatchGroupsBatch({
                          businessId: selectedBusinessId,
                          accountId: selectedAccountId,
                          items: payloadItems,
                        });

                        const results = Array.isArray(res?.results) ? res.results : [];
                        const first = results[0];

                        if (!first?.ok) {
                          setMatchError(String(first?.error ?? "Match failed"));
                          return;
                        }

                        const createdGroup =
                          (first as any)?.match_group ??
                          (first as any)?.matchGroup ??
                          (first as any)?.group ??
                          (first as any)?.item ??
                          null;

                        if (createdGroup?.id) {
                          setMatchGroups((prev) => upsertMatchGroup(prev, createdGroup));
                          if (allMatchGroupsHydrated) {
                            setAllMatchGroups((prev) => upsertMatchGroup(prev, createdGroup));
                          }
                        }

                        clearMutErr();
                        setOpenMatch(false);
                        setMatchBankTxnId(null);
                        setMatchSearch("");
                        setMatchSelectedEntryIds(new Set());
                        setMatchAiSuggestions([]);
                        setMatchSuggestError(null);
                        settleReconcileInBackground("matched transactions");
                      } catch (e: any) {
                        const r = applyMutationError(e, "Can’t match transactions");
                        if (!r.isClosed) setMatchError(r.msg);
                        else setMatchError(null);
                      } finally {
                        const pendingIds = [String(matchBankTxnId), ...Array.from(matchSelectedEntryIds).map(String)];
                        for (const id of pendingIds) clearPending(id);
                        setMatchBusy(false);
                      }
                    }}
                    title={matchBusy ? "Matching…" : matchSelectedEntryIds.size === 1 ? "Match these two records" : "Match selected entries (exact sum required)"}
                    aria-label={matchSelectedEntryIds.size === 1 ? "Match these two" : "Match selected entries"}
                  >
                    {matchBusy
                      ? "Matching…"
                      : matchSelectedEntryIds.size === 1
                        ? "Match these two"
                        : `Match ${matchSelectedEntryIds.size} entries`}
                  </BusyButton>
                </HintWrap>
              </>
            }
          />
        ) : null}
      >
        {openMatch ? (
        <div className="flex h-[min(72vh,720px)] min-h-0 flex-col gap-2">
          <div className="shrink-0 space-y-2">
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-bb-text-muted">
              Pick matching ledger entries. The ready bar turns green when the selected amount equals the bank transaction.
            </div>

            <div>
              <input
                className="h-8 w-full rounded-md border border-bb-border bg-bb-surface-card px-2 text-xs"
                placeholder="Search entries…"
                aria-label="Search ledger entries"
                value={matchSearch}
                onChange={(e) => setMatchSearch(e.target.value)}
              />
            </div>

            {(() => {
              const bank = matchBankTxnId ? (bankByIdFast.get(String(matchBankTxnId)) ?? null) : null;
              if (!bank) return null;
              const selectedEntries = Array.from(matchSelectedEntryIds)
                .map((id) => entryByIdFast.get(String(id)) ?? null)
                .filter(Boolean) as any[];
              const bankAmt = toBigIntSafe(bank.amount_cents);
              const bankSign = bankAmt < 0n ? -1n : 1n;
              const similarCandidateCount = allEntriesSorted
                .filter((e: any) => {
                  if (matchByEntryId.has(e.id)) return false;
                  const entryAmt = toBigIntSafe(e.amount_cents);
                  const entrySign = entryAmt < 0n ? -1n : 1n;
                  return entrySign === bankSign;
                })
                .map((e: any) => scoreEntryCandidate(bank, e))
                .filter((meta: any) => meta.exactAmount && Number(meta.dtDays ?? 9999) <= 3)
                .length;
              const selectedEntryId = selectedEntries.length === 1 ? String(selectedEntries[0]?.id ?? "") : "";
              const aiConfidence = selectedEntryId
                ? matchAiSuggestions.find((s) => String(s.entryId) === selectedEntryId)?.confidence ?? null
                : null;

              return (
                <MatchPairPreview
                  bank={bank}
                  entries={selectedEntries}
                  accountName={selectedAccountName}
                  direction="bankToEntry"
                  similarCandidateCount={similarCandidateCount}
                  aiConfidence={aiConfidence}
                />
              );
            })()}

            {(() => {
              const bank = matchBankTxnId ? (bankByIdFast.get(String(matchBankTxnId)) ?? null) : null;
              const bankAmt = bank ? toBigIntSafe(bank.amount_cents) : 0n;
              const bankAbs = absBig(bankAmt);

              let selectedAbs = 0n;
              for (const id of matchSelectedEntryIds) {
                const e = entryByIdFast.get(String(id)) ?? null;
                if (!e) continue;
                selectedAbs += absBig(toBigIntSafe(e.amount_cents));
              }

              const deltaAbs = bankAbs - selectedAbs;

              return (
                <div className={`mb-3 rounded-md border px-3 py-2 transition-colors ${deltaAbs === 0n ? "border-bb-status-success-border bg-bb-status-success-bg" : "border-bb-border bg-bb-surface-soft"}`}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-bb-text-muted">Bank</span>
                      <span className={`tabular-nums font-medium ${bankAmt < 0n ? "text-bb-amount-negative" : "text-bb-text"}`}>{formatUsdFromCents(bankAmt)}</span>
                      <span className="text-bb-text-muted">Selected</span>
                      <span className="tabular-nums font-medium text-bb-text">{formatUsdFromCents(selectedAbs)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-bb-text-muted">Remaining</span>
                      <span className={`tabular-nums font-semibold ${deltaAbs === 0n ? "text-bb-status-success-fg" : "text-bb-status-warning-fg"}`}>
                        {deltaAbs === 0n ? "✓ Ready" : formatUsdFromCents(deltaAbs)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {matchError ? <div className="text-xs text-bb-status-danger-fg">{matchError}</div> : null}

            {/* Match suggestions (AI rerank when available; deterministic fallback otherwise) */}
            {(() => {
              const bank = bankTxSorted.find((x: any) => x.id === matchBankTxnId);
              if (!bank) return null;

              const q = matchSearch.trim().toLowerCase();

              const ranked = allEntriesSorted
                .filter((e: any) => {
                  if (matchByEntryId.has(e.id)) return false;
                  const entryAmt = toBigIntSafe(e.amount_cents);
                  const bankAmt = toBigIntSafe(bank.amount_cents);
                  const entrySign = entryAmt < 0n ? -1n : 1n;
                  const bankSign = bankAmt < 0n ? -1n : 1n;
                  if (entrySign !== bankSign) return false;

                  if (!q) return true;
                  const payee = String(e.payee ?? "").toLowerCase();
                  const date = String(e.date ?? "").toLowerCase();
                  return payee.includes(q) || date.includes(q);
                })
                .map((e: any) => ({ e, meta: scoreEntryCandidate(bank, e) }))
                .sort((a: any, b: any) => a.meta.score - b.meta.score)
                .slice(0, 3);

              if (matchSuggestLoading) {
                return (
                  <div className="mb-3 rounded-md border border-bb-border bg-bb-surface-soft p-2">
                    <div className="text-[11px] font-semibold text-primary mb-2">Finding match suggestions</div>
                    <div className="space-y-2">
                      <div className="h-10 w-full rounded bg-bb-border animate-pulse" />
                      <div className="h-10 w-full rounded bg-bb-border animate-pulse" />
                    </div>
                  </div>
                );
              }

              const aiRows = matchAiSuggestions
                .map((s) => {
                  const e = allEntriesSorted.find((row: any) => String(row.id) === String(s.entryId));
                  if (!e) return null;
                  return { e, meta: scoreEntryCandidate(bank, e), ai: s };
                })
                .filter(Boolean) as Array<{ e: any; meta: any; ai: ReconcileBankSuggestion }>;

              const rows = aiRows.length > 0 ? aiRows : ranked.map(({ e, meta }: any) => ({ e, meta, ai: null }));
              const hasAiSuggestions = aiRows.length > 0;

              if (rows.length === 0) {
                return (
                  <div className="mb-3 rounded-md border border-bb-border bg-bb-surface-soft p-2">
                    <div className="text-[11px] font-semibold text-primary">Match suggestions</div>
                    <div className="mt-1 text-[11px] text-bb-text-muted">
                      No eligible suggestions found for this bank transaction.
                    </div>
                  </div>
                );
              }

              return (
                <div className="mb-3 rounded-md border border-bb-border bg-bb-surface-soft p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold text-primary">
                      {hasAiSuggestions ? "AI reranked suggestions" : "Match suggestions"}
                    </div>
                    <div className="text-[11px] text-bb-text-muted">
                      {hasAiSuggestions ? "AI rerank" : "Rule-ranked candidates"} • full-match only
                    </div>
                  </div>

                  {matchSuggestError ? (
                    <div className="mt-2 rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-2 py-1.5 text-[11px] text-bb-status-warning-fg">
                      {matchSuggestError}
                    </div>
                  ) : null}

                  <div className="mt-2 flex flex-col gap-1">
                    {rows.map(({ e, meta, ai }, idx: number) => {
                      const amt = toBigIntSafe(e.amount_cents);
                      const selected = matchSelectedEntryIds.has(e.id);
                      const rankLabel = idx === 0 ? "Best match" : `${idx + 1} Alternative`;
                      const fullReason =
                        ai?.reason || `Amount Δ ${formatUsdFromCents(meta.diff)} • Δdays ${meta.dtDays} • Text similarity ${meta.overlap}`;
                      const reason = truncateAiReason(fullReason);

                      return (
                        <button
                          key={e.id}
                          type="button"
                          className={`w-full text-left min-h-[46px] px-2.5 py-1.5 rounded-md border ${selected ? "border-primary/20 bg-primary/10" : "border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover"} flex items-center justify-between gap-3`}
                          onClick={() => {
                            setMatchSelectedEntryIds(() => {
                              const s = new Set<string>();
                              s.add(String(e.id));
                              return s;
                            });
                          }}
                          title={fullReason}
                        >
                          <span className="min-w-0 flex flex-col">
                            <span className="truncate text-xs font-medium text-bb-text">
                              <span className={idx === 0 ? "text-primary" : "text-bb-text-muted"}>{rankLabel}</span>
                              <span className="text-bb-text-subtle"> • </span>
                              {e.payee}
                            </span>
                            <span className="truncate max-w-[420px] text-[11px] text-bb-text-muted" title={fullReason}>{reason}</span>
                          </span>
                          <span className="shrink-0 flex items-center gap-2">
                            {ai ? (
                              <span className="inline-flex h-5 items-center rounded-full border border-primary/20 bg-primary/10 px-2 text-[11px] font-semibold text-primary">
                                {pctConfidence(ai.confidence)}
                              </span>
                            ) : null}
                            <span className={`text-xs tabular-nums ${amt < 0n ? "!text-bb-amount-negative" : "text-bb-text"}`}>
                              {formatUsdFromCents(amt)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

          </div>

          <div className="min-h-0 flex-1 rounded-md border border-bb-border overflow-hidden">
            <div className="h-full overflow-y-auto overflow-x-auto">
                <table className="w-full min-w-[520px] table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: 110 }} />
                    <col />
                    <col style={{ width: 140 }} />
                  </colgroup>
                  <thead className="sticky top-0 bg-bb-table-header border-b border-bb-border">
                    <tr className="h-[28px]">
                      <th className="px-2 text-xs font-semibold text-bb-text-muted text-left">DATE</th>
                      <th className="px-2 text-xs font-semibold text-bb-text-muted text-left">PAYEE</th>
                      <th className="px-2 text-xs font-semibold text-bb-text-muted text-right">AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const bank = matchBankTxnId ? (bankByIdFast.get(String(matchBankTxnId)) ?? null) : null;
                      if (!bank) return null;

                      const bankAmt = toBigIntSafe(bank.amount_cents);
                      const bankSign = bankAmt < 0n ? -1n : 1n;

                      return allEntriesSorted
                        .filter((e: any) => {
                          const q = matchSearch.trim().toLowerCase();
                          if (q) {
                            const payee = (e.payee ?? "").toString().toLowerCase();
                            const date = (e.date ?? "").toString().toLowerCase();
                            if (!payee.includes(q) && !date.includes(q)) return false;
                          }

                          if (matchByEntryId.has(e.id)) return false;

                          const entryAmt = toBigIntSafe(e.amount_cents);
                          const entrySign = entryAmt < 0n ? -1n : 1n;
                          return entrySign === bankSign;
                        })
                        .slice(0, 200)
                        .map((e: any) => {
                          const amt = toBigIntSafe(e.amount_cents);
                          const selected = matchSelectedEntryIds.has(e.id);

                          return (
                            <tr
                              key={e.id}
                              className={`h-[30px] border-b border-bb-border-muted cursor-pointer ${selected ? "bg-primary/10" : "hover:bg-bb-table-row-hover"}`}
                              onClick={() => {
                                setMatchSelectedEntryIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(e.id)) next.delete(e.id);
                                  else next.add(e.id);
                                  return next;
                                });
                              }}
                            >
                              <td className="px-2 text-xs text-bb-text">{e.date}</td>
                              <td className="px-2 text-xs text-bb-text font-medium truncate">{e.payee}</td>
                              <td className={`px-2 text-xs text-right tabular-nums ${amt < 0n ? "!text-bb-amount-negative" : "text-bb-text"}`}>{formatUsdFromCents(amt)}</td>
                            </tr>
                          );
                        });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </AppDialog>

      {/* Adjustment dialog */}
      <AppDialog
        open={openAdjust}
        onClose={() => {
          setOpenAdjust(false);
          setAdjustBusy(false);
          setAdjustError(null);
          setAdjustReason("");
          setAdjustEntryId(null);
        }}
        title="Mark adjustment"
        size="xs"
        footer={
          <DialogFooter
            left={
              <BusyButton
                variant="secondary"
                size="md"
                onClick={() => setOpenAdjust(false)}
                disabled={adjustBusy}
              >
                Cancel
              </BusyButton>
            }
            right={
              <HintWrap
                disabled={!canWriteReconcileEffective}
                reason={!canWriteReconcileEffective ? (reconcileWriteReason ?? noPermTitle) : null}
              >
                <BusyButton
                  variant="danger"
                  size="md"
                  busy={adjustBusy}
                  busyLabel="Saving…"
                  disabled={!canWriteReconcileEffective || !adjustEntryId || !adjustReason.trim()}
                  onClick={async () => {
                    if (!canWriteReconcileEffective) return;
                    if (!selectedBusinessId || !selectedAccountId) return;
                    if (!adjustEntryId) return;

                    // Optimistic: mark adjusted + close dialog immediately.
                    // markEntryAdjustment only flips a flag on the entry — it
                    // doesn't change amount_cents — so the rollback is just
                    // removing the id from the locallyAdjusted set.
                    const optimisticEntryId = adjustEntryId;
                    setAdjustError(null);
                    clearMutErr();
                    markPending(String(optimisticEntryId));
                    setLocallyAdjusted((prev) => {
                      const next = new Set(prev);
                      next.add(optimisticEntryId);
                      return next;
                    });
                    setOpenAdjust(false);

                    try {
                      await markEntryAdjustment({
                        businessId: selectedBusinessId,
                        accountId: selectedAccountId,
                        entryId: optimisticEntryId,
                        reason: adjustReason.trim(),
                      });

                      refreshAllDebounced();
                      clearMutErr();
                    } catch (e: any) {
                      // Rollback: remove from locallyAdjusted, surface the error,
                      // and reopen the dialog so the user sees what happened.
                      setLocallyAdjusted((prev) => {
                        const next = new Set(prev);
                        next.delete(optimisticEntryId);
                        return next;
                      });
                      const r = applyMutationError(e, "Can’t update adjustment");
                      if (!r.isClosed) setAdjustError(r.msg);
                      else setAdjustError(null);
                      setOpenAdjust(true);
                    } finally {
                      clearPending(String(optimisticEntryId));
                    }
                  }}
                >
                  Mark adjustment
                </BusyButton>
              </HintWrap>
            }
          />
        }
      >
        <div className="flex flex-col max-h-[55vh]">
          <div className="flex-1 overflow-y-auto">
            <div className="text-xs text-bb-text-muted mb-2">
              Marking an entry as an adjustment is ledger-only and reversible later.
            </div>

            <div className="mb-2">
              <label className="text-xs text-bb-text-muted">Reason (required)</label>
              <textarea
                className={[
                  "mt-1 w-full min-h-[90px] p-2 text-xs border border-bb-border rounded-md bg-bb-surface-card",
                  ringFocus,
                ].join(" ")}
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
              />
            </div>

            {adjustError ? <div className="text-xs text-bb-status-danger-fg mb-2">{adjustError}</div> : null}
          </div>
        </div>
      </AppDialog>

      {/* Entry → Bank match dialog */}
      <AppDialog
        open={openEntryMatch}
        onClose={() => {
          setOpenEntryMatch(false);
          setEntryMatchBusy(false);
          setEntryMatchError(null);
          setEntryMatchSearch("");
          setEntryMatchEntryId(null);
          setEntryMatchSelectedBankTxnIds(new Set());
          setEntrySuggestLoading(false);
          setEntryAiSuggestions([]);
          setEntrySuggestError(null);
        }}
        title="Match entry"
        size="lg"
        bodyClassName="overflow-hidden sm:overflow-hidden"
        footer={openEntryMatch ? (
          <DialogFooter
            left={null}
            right={
              <>
                <BusyButton
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    setOpenEntryMatch(false);
                    setEntryMatchBusy(false);
                    setEntryMatchError(null);
                    setEntryMatchSearch("");
                    setEntryMatchEntryId(null);
                    setEntryMatchSelectedBankTxnIds(new Set());
                  }}
                  disabled={entryMatchBusy}
                >
                  Cancel
                </BusyButton>

                <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? reconcileWriteReason : null}>
                  <BusyButton
                    variant="primary"
                    size="md"
                    busy={entryMatchBusy}
                    busyLabel="Saving…"
                    disabled={(() => {
                      if (!canWriteReconcileEffective) return true;
                      if (entryMatchBusy) return true;
                      if (!entryMatchEntryId) return true;
                      if (entryMatchSelectedBankTxnIds.size === 0) return true;

                      const entry = allEntriesSorted.find((x: any) => x.id === entryMatchEntryId);
                      const entryAbs = absBig(entry ? toBigIntSafe(entry.amount_cents) : 0n);

                      let selectedAbs = 0n;
                      for (const id of entryMatchSelectedBankTxnIds) {
                        const t = bankByIdFast.get(String(id)) ?? null;
                        if (!t) continue;
                        selectedAbs += absBig(toBigIntSafe(t.amount_cents));
                      }
                      return selectedAbs !== entryAbs;
                    })()}
                    title={entryMatchSelectedBankTxnIds.size === 1 ? "Match these two records" : "Create combine match (exact sum required)"}
                    aria-label={entryMatchSelectedBankTxnIds.size === 1 ? "Match these two" : "Create combine match"}
                    onClick={async () => {
                      if (!selectedBusinessId || !selectedAccountId) return;
                      if (!canWriteReconcileEffective) return;
                      if (!entryMatchEntryId) return;

                      const entry = allEntriesSorted.find((x: any) => x.id === entryMatchEntryId);
                      const entryAbs = absBig(entry ? toBigIntSafe(entry.amount_cents) : 0n);

                      let selectedAbs = 0n;
                      for (const id of entryMatchSelectedBankTxnIds) {
                        const t = bankByIdFast.get(String(id)) ?? null;
                        if (!t) continue;
                        selectedAbs += absBig(toBigIntSafe(t.amount_cents));
                      }

                      if (selectedAbs !== entryAbs) {
                        setEntryMatchError("Select bank transactions until Remaining Δ is exactly 0.");
                        return;
                      }

                      setEntryMatchBusy(true);
                      setEntryMatchError(null);
                      clearMutErr();

                      const pendingIds = [String(entryMatchEntryId), ...Array.from(entryMatchSelectedBankTxnIds).map(String)];
                      for (const id of pendingIds) markPending(id);

                      try {
                        const payloadItems = [
                          {
                            client_id: `combine:${entryMatchEntryId}:${Date.now()}`,
                            bankTransactionIds: Array.from(entryMatchSelectedBankTxnIds).map(String),
                            entryIds: [entryMatchEntryId],
                          },
                        ];

                        const res: any = await createMatchGroupsBatch({
                          businessId: selectedBusinessId,
                          accountId: selectedAccountId,
                          items: payloadItems,
                        });

                        const first = (Array.isArray(res?.results) ? res.results : [])[0];
                        if (!first?.ok) {
                          setEntryMatchError(String(first?.error ?? "Combine match failed"));
                          return;
                        }

                        // Optimistic: inject created group so rows move instantly.
                        const createdGroup =
                          (first as any)?.match_group ??
                          (first as any)?.matchGroup ??
                          (first as any)?.group ??
                          (first as any)?.item ??
                          null;

                        if (createdGroup?.id) {
                          setMatchGroups((prev) => upsertMatchGroup(prev, createdGroup));
                          if (allMatchGroupsHydrated) {
                            setAllMatchGroups((prev) => upsertMatchGroup(prev, createdGroup));
                          }
                        }

                        clearMutErr();
                        setOpenEntryMatch(false);
                        setEntryMatchEntryId(null);
                        setEntryMatchSearch("");
                        setEntryMatchSelectedBankTxnIds(new Set());
                        setEntryAiSuggestions([]);
                        setEntrySuggestError(null);
                        settleReconcileInBackground("matched entry");
                      } catch (e: any) {
                        const r = applyMutationError(e, "Can’t create match");
                        if (!r.isClosed) setEntryMatchError(r.msg);
                        else setEntryMatchError(null);
                      } finally {
                        const pendingIds = [String(entryMatchEntryId), ...Array.from(entryMatchSelectedBankTxnIds).map(String)];
                        for (const id of pendingIds) clearPending(id);
                        setEntryMatchBusy(false);
                      }
                    }}
                  >
                    {entryMatchBusy
                      ? "Saving…"
                      : entryMatchSelectedBankTxnIds.size === 1
                        ? "Match these two"
                        : "Create match"}
                  </BusyButton>
                </HintWrap>
              </>
            }
          />
        ) : null}
      >
        {openEntryMatch ? (
        <div className="flex h-[min(72vh,720px)] min-h-0 flex-col gap-2">
          <div className="shrink-0 space-y-2">
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-bb-text-muted">
              Pick matching bank transactions. The ready bar turns green when selected transactions equal the ledger entry.
            </div>

            <div>
              <input
                className="h-8 w-full rounded-md border border-bb-border bg-bb-surface-card px-2 text-xs"
                placeholder="Search bank transactions…"
                aria-label="Search bank transactions"
                value={entryMatchSearch}
                onChange={(e) => setEntryMatchSearch(e.target.value)}
              />
            </div>

            {(() => {
              const entry = entryMatchEntryId ? (entryByIdFast.get(String(entryMatchEntryId)) ?? null) : null;
              if (!entry) return null;
              const selectedBanks = Array.from(entryMatchSelectedBankTxnIds)
                .map((id) => bankByIdFast.get(String(id)) ?? null)
                .filter(Boolean) as any[];
              const entryAmt = toBigIntSafe(entry.amount_cents);
              const entrySign = entryAmt < 0n ? -1n : 1n;
              const similarCandidateCount = bankTxSorted
                .filter((t: any) => {
                  const remaining = remainingAbsByBankTxnId.get(t.id) ?? 0n;
                  if (remaining <= 0n) return false;
                  const bankAmt = toBigIntSafe(t.amount_cents);
                  const bankSign = bankAmt < 0n ? -1n : 1n;
                  return bankSign === entrySign;
                })
                .map((t: any) => scoreBankCandidate(entry, t))
                .filter((meta: any) => meta.exactAmount && Number(meta.dtDays ?? 9999) <= 3)
                .length;
              const selectedBankId = selectedBanks.length === 1 ? String(selectedBanks[0]?.id ?? "") : "";
              const aiConfidence = selectedBankId
                ? entryAiSuggestions.find((s) => String(s.bankTransactionId) === selectedBankId)?.confidence ?? null
                : null;

              return (
                <MatchPairPreview
                  bank={null}
                  bankTxns={selectedBanks}
                  entries={[entry]}
                  accountName={selectedAccountName}
                  direction="entryToBank"
                  similarCandidateCount={similarCandidateCount}
                  aiConfidence={aiConfidence}
                />
              );
            })()}

            {entryMatchError ? <div className="text-xs text-bb-status-danger-fg">{entryMatchError}</div> : null}

            {/* Match suggestions (AI rerank when available; deterministic fallback otherwise) */}
            {(() => {
              const entry = allEntriesSorted.find((x: any) => x.id === entryMatchEntryId);
              if (!entry) return null;

              const q = entryMatchSearch.trim().toLowerCase();

              const ranked = bankTxSorted
                .filter((t: any) => {
                  const remaining = remainingAbsByBankTxnId.get(t.id) ?? 0n;
                  if (remaining <= 0n) return false;

                  const bankAmt = toBigIntSafe(t.amount_cents);
                  const entryAmt = toBigIntSafe(entry.amount_cents);
                  const bankSign = bankAmt < 0n ? -1n : 1n;
                  const entrySign = entryAmt < 0n ? -1n : 1n;
                  if (bankSign !== entrySign) return false;

                  if (!q) return true;
                  const name = String(t.name ?? "").toLowerCase();
                  const date = String(t.posted_date ?? "").toLowerCase();
                  return name.includes(q) || date.includes(q);
                })
                .map((t: any) => ({ t, meta: scoreBankCandidate(entry, t) }))
                .sort((a: any, b: any) => a.meta.score - b.meta.score)
                .slice(0, 3);

              if (entrySuggestLoading) {
                return (
                  <div className="mb-3 rounded-md border border-bb-border bg-bb-surface-soft p-2">
                    <div className="text-[11px] font-semibold text-primary mb-2">Finding match suggestions</div>
                    <div className="space-y-2">
                      <div className="h-10 w-full rounded bg-bb-border animate-pulse" />
                      <div className="h-10 w-full rounded bg-bb-border animate-pulse" />
                    </div>
                  </div>
                );
              }

              const aiRows = entryAiSuggestions
                .map((s) => {
                  const t = bankTxSorted.find((row: any) => String(row.id) === String(s.bankTransactionId));
                  if (!t) return null;
                  return { t, meta: scoreBankCandidate(entry, t), ai: s };
                })
                .filter(Boolean) as Array<{ t: any; meta: any; ai: ReconcileEntrySuggestion }>;

              const rows = aiRows.length > 0 ? aiRows : ranked.map(({ t, meta }: any) => ({ t, meta, ai: null }));
              const hasAiSuggestions = aiRows.length > 0;

              if (rows.length === 0) {
                return (
                  <div className="mb-3 rounded-md border border-bb-border bg-bb-surface-soft p-2">
                    <div className="text-[11px] font-semibold text-primary">Match suggestions</div>
                    <div className="mt-1 text-[11px] text-bb-text-muted">
                      No eligible suggestions found for this entry.
                    </div>
                  </div>
                );
              }

              return (
                <div className="mb-3 rounded-md border border-bb-border bg-bb-surface-soft p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold text-primary">
                      {hasAiSuggestions ? "AI reranked suggestions" : "Match suggestions"}
                    </div>
                    <div className="text-[11px] text-bb-text-muted">
                      {hasAiSuggestions ? "AI rerank" : "Rule-ranked candidates"} • full-match only
                    </div>
                  </div>

                  {entrySuggestError ? (
                    <div className="mt-2 rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-2 py-1.5 text-[11px] text-bb-status-warning-fg">
                      {entrySuggestError}
                    </div>
                  ) : null}

                  <div className="mt-2 flex flex-col gap-1">
                    {rows.map(({ t, meta, ai }, idx: number) => {
                      const amt = toBigIntSafe(t.amount_cents);
                      const selected = entryMatchSelectedBankTxnIds.has(String(t.id));
                      const rankLabel = idx === 0 ? "Best match" : `${idx + 1} Alternative`;
                      const fullReason =
                        ai?.reason || `Amount Δ ${formatUsdFromCents(meta.diff)} • Δdays ${meta.dtDays} • Text similarity ${meta.overlap}`;
                      const reason = truncateAiReason(fullReason);

                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={`w-full text-left min-h-[46px] px-2.5 py-1.5 rounded-md border ${selected ? "border-primary/20 bg-primary/10" : "border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover"} flex items-center justify-between gap-3`}
                          onClick={() => {
                            setEntryMatchSelectedBankTxnIds(() => {
                              const s = new Set<string>();
                              s.add(String(t.id));
                              return s;
                            });
                          }}
                          title={fullReason}
                        >
                          <span className="min-w-0 flex flex-col">
                            <span className="truncate text-xs font-medium text-bb-text">
                              <span className={idx === 0 ? "text-primary" : "text-bb-text-muted"}>{rankLabel}</span>
                              <span className="text-bb-text-subtle"> • </span>
                              {t.name}
                            </span>
                            <span className="truncate max-w-[420px] text-[11px] text-bb-text-muted" title={fullReason}>{reason}</span>
                          </span>
                          <span className="shrink-0 flex items-center gap-2">
                            {ai ? (
                              <span className="inline-flex h-5 items-center rounded-full border border-primary/20 bg-primary/10 px-2 text-[11px] font-semibold text-primary">
                                {pctConfidence(ai.confidence)}
                              </span>
                            ) : null}
                            <span className={`text-xs tabular-nums ${amt < 0n ? "!text-bb-amount-negative" : "text-bb-text"}`}>
                              {formatUsdFromCents(amt)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* COMBINE summary */}
            {(() => {
              const entry = allEntriesSorted.find((x: any) => x.id === entryMatchEntryId);
              if (!entry) return null;

              const entryAmt = toBigIntSafe(entry.amount_cents);
              const entryAbs = absBig(entryAmt);

              let selectedAbs = 0n;
              for (const id of entryMatchSelectedBankTxnIds) {
                const t = bankByIdFast.get(String(id)) ?? null;
                if (!t) continue;
                selectedAbs += absBig(toBigIntSafe(t.amount_cents));
              }

              const deltaAbs = entryAbs - selectedAbs;

              return (
                <div className={`mb-3 rounded-md border px-3 py-2 transition-colors ${deltaAbs === 0n ? "border-bb-status-success-border bg-bb-status-success-bg" : "border-bb-border bg-bb-surface-soft"}`}>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-bb-text-muted">Entry</span>
                      <span className={`tabular-nums font-medium ${entryAmt < 0n ? "text-bb-amount-negative" : "text-bb-text"}`}>{formatUsdFromCents(entryAmt)}</span>
                      <span className="text-bb-text-muted">Selected</span>
                      <span className="tabular-nums font-medium text-bb-text">{formatUsdFromCents(selectedAbs)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-bb-text-muted">Remaining</span>
                      <span className={`tabular-nums font-semibold ${deltaAbs === 0n ? "text-bb-status-success-fg" : "text-bb-status-warning-fg"}`}>
                        {deltaAbs === 0n ? "✓ Ready" : formatUsdFromCents(deltaAbs)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* (removed duplicate combine summary block) */}

            {/* (removed stray pasted code) */}

          </div>

          <div className="min-h-0 flex-1 rounded-md border border-bb-border overflow-hidden">
            <div className="h-full overflow-y-auto overflow-x-auto">
                <table className="w-full min-w-[520px] table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: 110 }} />
                    <col />
                    <col style={{ width: 140 }} />
                  </colgroup>
                  <thead className="sticky top-0 bg-bb-table-header border-b border-bb-border">
                    <tr className="h-[28px]">
                      <th className="px-2 text-xs font-semibold text-bb-text-muted text-left">DATE</th>
                      <th className="px-2 text-xs font-semibold text-bb-text-muted text-left">DESCRIPTION</th>
                      <th className="px-2 text-xs font-semibold text-bb-text-muted text-right">AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const entry = allEntriesSorted.find((x: any) => x.id === entryMatchEntryId);
                      if (!entry) return null;

                      const entryAmt = toBigIntSafe(entry.amount_cents);
                      const entrySign = entryAmt < 0n ? -1n : 1n;

                      return bankTxSorted
                        .filter((t: any) => {
                          const q = entryMatchSearch.trim().toLowerCase();
                          if (q) {
                            const name = (t.name ?? "").toString().toLowerCase();
                            const date = (t.posted_date ?? "").toString().toLowerCase();
                            if (!name.includes(q) && !date.includes(q)) return false;
                          }

                          const bankAmt = toBigIntSafe(t.amount_cents);
                          const bankSign = bankAmt < 0n ? -1n : 1n;
                          if (bankSign !== entrySign) return false;

                          const remaining = remainingAbsByBankTxnId.get(t.id) ?? 0n;
                          return remaining > 0n;
                        })
                        .slice(0, 200)
                        .map((t: any) => {
                          const amt = toBigIntSafe(t.amount_cents);
                          const selected = entryMatchSelectedBankTxnIds.has(String(t.id));
                          const dateStr = (() => {
                            try {
                              const d = new Date(t.posted_date);
                              return d.toISOString().slice(0, 10);
                            } catch {
                              return String(t.posted_date ?? "");
                            }
                          })();

                          return (
                            <tr
                              key={t.id}
                              className={`h-[30px] border-b border-bb-border-muted cursor-pointer ${selected ? "bg-primary/10" : "hover:bg-bb-table-row-hover"}`}
                              onClick={() => {
                                setEntryMatchSelectedBankTxnIds((prev) => {
                                  const next = new Set(prev);
                                  const id = String(t.id);
                                  if (next.has(id)) next.delete(id);
                                  else next.add(id);
                                  return next;
                                });
                              }}
                            >
                              <td className="px-2 text-xs text-bb-text">{dateStr}</td>
                              <td className="px-2 text-xs text-bb-text font-medium truncate">{t.name}</td>
                              <td className={`px-2 text-xs text-right tabular-nums ${amt < 0n ? "!text-bb-amount-negative" : "text-bb-text"}`}>{formatUsdFromCents(amt)}</td>
                            </tr>
                          );
                        });
                    })()}
                  </tbody>
                </table>
            </div>
          </div>
          {null}
        </div>
        ) : null}
      </AppDialog>

      {/* Reconciliation history dialog (Phase 5A, read-only) */}
      <AppDialog
        open={openReconciliationHistory}
        onClose={() => setOpenReconciliationHistory(false)}
        title="Reconciliation history"
        size="lg"
      >
        <div className="px-3 pb-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2 min-w-0">
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${reconHistoryFilter === "all" ? "border-bb-border bg-bb-surface-card text-bb-text" : "border-transparent text-bb-text-muted hover:bg-bb-table-row-hover"
                  }`}
                onClick={() => setReconHistoryFilter("all")}
              >
                All ({reconAuditCounts.all})
              </button>
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${reconHistoryFilter === "match" ? "border-bb-border bg-bb-surface-card text-bb-text" : "border-transparent text-bb-text-muted hover:bg-bb-table-row-hover"
                  }`}
                onClick={() => setReconHistoryFilter("match")}
              >
                Matches ({reconAuditCounts.match})
              </button>
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${reconHistoryFilter === "void" ? "border-bb-border bg-bb-surface-card text-bb-text" : "border-transparent text-bb-text-muted hover:bg-bb-table-row-hover"
                  }`}
                onClick={() => setReconHistoryFilter("void")}
              >
                Voids ({reconAuditCounts.void})
              </button>

              <input
                className={["h-7 w-[200px] px-2 text-xs border border-bb-border rounded-md bg-bb-surface-card", ringFocus].join(" ")}
                placeholder="Search history…"
                aria-label="Search reconciliation history"
                value={reconHistorySearch}
                onChange={(e) => setReconHistorySearch(e.target.value)}
                title="Search bank description, entry payee, or IDs"
              />
            </div>

            {reconHistoryBankTxnFilterId ? (
              <div className="text-xs text-bb-text-muted flex items-center gap-2">
                <span className="whitespace-nowrap">
                  Filtered: <span className="font-medium">{shortId(reconHistoryBankTxnFilterId)}</span>
                </span>
                <button
                  type="button"
                  className="h-7 px-2 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover"
                  onClick={() => setReconHistoryBankTxnFilterId(null)}
                  title="Clear filter"
                >
                  Clear
                </button>
              </div>
            ) : (
              <div />
            )}
          </div>

          <div className="h-px bg-bb-border" />

          <div className="mt-2 max-h-[64vh] overflow-y-auto overflow-x-auto">
            {matchesLoading || allMatchGroupsLoading || !allMatchGroupsHydrated ? (
              <div className="p-2">
                <div className="mb-2 text-[11px] text-bb-text-muted">
                  Reconciliation history loads when opened.
                </div>
                <Skeleton className="h-24 w-full" />
              </div>
            ) : reconAuditVisible.length === 0 ? (
              <EmptyState label="No reconciliation history in this period" />
            ) : (
              <div className="mt-2 min-w-[1190px] rounded-xl border border-bb-border bg-bb-surface-card overflow-hidden">
                <table className="w-full min-w-[1190px] table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: 190 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 320 }} />
                    <col style={{ width: 260 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 170 }} />
                  </colgroup>

                  <thead className="sticky top-0 z-10 bg-bb-table-header border-b border-bb-border">
                    <tr className="h-[30px]">
                      <th className="px-2 text-xs font-semibold text-bb-text-muted text-left whitespace-nowrap">WHEN</th>
                      <th className="px-2 text-xs font-semibold text-bb-text-muted text-left whitespace-nowrap">ACTION</th>
                      <th className="px-2 text-xs font-semibold text-bb-text-muted text-left whitespace-nowrap">BANK TRANSACTION</th>
                      <th className="px-2 text-xs font-semibold text-bb-text-muted text-left whitespace-nowrap">ENTRY</th>
                      <th className="px-2 text-xs font-semibold text-bb-text-muted text-right whitespace-nowrap">AMOUNT</th>
                      <th className="px-2 text-xs font-semibold text-bb-text-muted text-left whitespace-nowrap">BY</th>
                    </tr>
                  </thead>

                  <tbody>
                    {reconAuditVisible.map((ev, idx) => {
                      const bank = ev.bankTxnIds?.[0] ? bankTxnById.get(String(ev.bankTxnIds[0])) : null;
                      const entry = ev.entryIds?.[0] ? entryById.get(String(ev.entryIds[0])) : null;

                      const matchedAbs = absBig(toBigIntSafe(ev.amountAbsCents));

                      const whenFull = (() => {
                        try {
                          return new Date(ev.at).toLocaleString();
                        } catch {
                          return String(ev.at ?? "");
                        }
                      })();

                      const whenCompact = (() => {
                        try {
                          return new Date(ev.at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          });
                        } catch {
                          return whenFull;
                        }
                      })();

                      const bankLabel = bank
                        ? `${(() => {
                          try {
                            const d = new Date(bank.posted_date);
                            return d.toISOString().slice(0, 10);
                          } catch {
                            return String(bank.posted_date ?? "");
                          }
                        })()} • ${String(bank.name ?? "").trim() || "—"}${(ev.bankTxnIds?.length ?? 0) > 1 ? ` (+${(ev.bankTxnIds.length - 1)} more)` : ""}`
                        : ev.bankTxnIds?.[0]
                          ? `${shortId(ev.bankTxnIds[0])} (not in current view)${(ev.bankTxnIds?.length ?? 0) > 1 ? ` (+${(ev.bankTxnIds.length - 1)} more)` : ""}`
                          : "—";

                      const entryLabel = entry
                        ? `${String(entry.date ?? "")} • ${String(entry.payee ?? "").trim() || "—"}${(ev.entryIds?.length ?? 0) > 1 ? ` (+${(ev.entryIds.length - 1)} more)` : ""}`
                        : ev.entryIds?.[0]
                          ? `${shortId(ev.entryIds[0])} (not in current view)${(ev.entryIds?.length ?? 0) > 1 ? ` (+${(ev.entryIds.length - 1)} more)` : ""}`
                          : "—";

                      const rowTone = ev.kind === "MATCH_GROUP_VOIDED" ? " text-bb-text-muted" : "";
                      const chipTone = ev.kind === "MATCH_GROUP_CREATED" ? "success" : "default";

                      return (
                        <tr
                          key={`${ev.kind}-${ev.at}-${idx}`}
                          className={`h-[30px] border-b border-bb-border-muted cursor-pointer hover:bg-bb-table-row-hover${rowTone}`}
                          onClick={() => {
                            setSelectedReconAudit(ev);
                            setRevertError(null);
                            setOpenReconAuditDetail(true);
                          }}
                          title="View audit detail"
                        >
                          <td className="px-2 text-xs text-bb-text" title={whenFull}>
                            {whenCompact}
                          </td>
                          <td className="px-2 text-xs">
                            <StatusChip label={ev.kind === "MATCH_GROUP_CREATED" ? "Matched" : "Reverted"} tone={chipTone as any} />
                          </td>
                          <td className="px-2 text-xs text-bb-text font-medium truncate" title={bankLabel}>
                            {bankLabel}
                          </td>
                          <td className="px-2 text-xs text-bb-text font-medium truncate" title={entryLabel}>
                            {entryLabel}
                          </td>
                          <td className="px-2 text-xs text-right tabular-nums text-bb-text">
                            {formatUsdFromCents(matchedAbs)}
                          </td>
                          <td className="px-2 text-xs text-bb-text">
                            {auditUserLabel(ev.by)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-2 text-[11px] text-bb-text-muted">
            Showing newest 500 events.
          </div>
        </div>
      </AppDialog>

      {/* Audit detail dialog (Phase 5A-2, read-only) */}
      <AppDialog
        open={openReconAuditDetail}
        onClose={() => {
          setOpenReconAuditDetail(false);
          setSelectedReconAudit(null);
          setRevertBusy(false);
          setRevertPreviewLoading(false);
          setRevertPreview(null);
          setRevertError(null);
        }}
        title="Audit detail"
        size="md"
        footer={openReconAuditDetail ?
          (() => {
            const ev = selectedReconAudit as any | null;
            const groupId = ev?.groupId ? String(ev.groupId) : null;
            const bankTxnId = ev?.bankTxnIds?.[0] ? String(ev.bankTxnIds[0]) : null;

            const canRevert = Boolean(canWriteReconcileEffective && selectedBusinessId && selectedAccountId && groupId && bankTxnId);

            return (
              <DialogFooter
                left={
                  <BusyButton
                    variant="secondary"
                    size="md"
                    onClick={() => {
                      setOpenReconAuditDetail(false);
                      setSelectedReconAudit(null);
                      setRevertBusy(false);
                      setRevertPreviewLoading(false);
                      setRevertPreview(null);
                      setRevertError(null);
                    }}
                    disabled={revertBusy}
                  >
                    Close
                  </BusyButton>
                }
                right={
                  <BusyButton
                    variant="danger"
                    size="md"
                    busy={revertBusy}
                    busyLabel="Reverting…"
                    disabled={!canRevert || revertPreviewLoading}
                    title={!canWriteReconcileEffective ? (reconcileWriteReason ?? noPermTitle) : "Preview generated-entry revert"}
                    aria-label="Revert bank match"
                    onClick={() => {
                      if (!selectedBusinessId || !selectedAccountId) return;
                      if (!bankTxnId) return;
                      void openGeneratedRevertPreview({ matchGroupId: String(groupId), bankTransactionId: bankTxnId });
                    }}
                  >
                    {revertPreviewLoading ? "Previewing…" : "Revert bank match"}
                  </BusyButton>
                }
              />
            );
          })() : null
        }
      >
        {openReconAuditDetail ? (
        <div className="p-3">
          {(() => {
            const ev = selectedReconAudit as any | null;

            const groupId = ev?.groupId ? String(ev.groupId) : null;
            const bankTxnId = ev?.bankTxnIds?.[0] ? String(ev.bankTxnIds[0]) : null;

            // v1 behavior: "Revert bank match" voids ALL active matches for this bank transaction.
            const isActiveGroup = !!groupId && activeGroupByBankTxnId.has(String(bankTxnId ?? ""));
            const alreadyVoided = !!groupId && !isActiveGroup;

            return (
              <div className="mb-2 text-[11px] text-bb-text-muted">
                {bankTxnId
                  ? alreadyVoided
                    ? "This match is already voided. Preview can still remove generated entries if they are safe."
                    : "Preview the revert before confirming. Generated entries can be removed only when the backend marks them safe."
                  : "Bank transaction id unavailable."}
              </div>
            );
          })()}

          {revertError ? <div className="mb-2 text-xs text-bb-status-danger-fg">{revertError}</div> : null}

          <div className="max-h-[60vh] overflow-y-auto">
            {(() => {
              const ev = selectedReconAudit as any | null;
              if (!ev) return <div className="text-xs text-bb-text-muted">No audit event selected.</div>;

              const groupId = ev?.groupId ? String(ev.groupId) : null;
              const bankTxnIds = Array.isArray(ev?.bankTxnIds) ? ev.bankTxnIds.map((x: any) => String(x)) : [];
              const entryIds = Array.isArray(ev?.entryIds) ? ev.entryIds.map((x: any) => String(x)) : [];

              const bank0Id = bankTxnIds[0] ?? null;
              const entry0Id = entryIds[0] ?? null;

              const bank = bank0Id ? bankTxnById.get(String(bank0Id)) : null;
              const entry = entry0Id ? entryById.get(String(entry0Id)) : null;

              const matchedAbs = absBig(toBigIntSafe(ev.amountAbsCents ?? 0n));

              const createdAt = ev?.kind === "MATCH_GROUP_CREATED" ? String(ev.at ?? "") : null;
              const createdBy = ev?.kind === "MATCH_GROUP_CREATED" ? String(ev.by ?? "") : null;
              const voidedAt = ev?.kind === "MATCH_GROUP_VOIDED" ? String(ev.at ?? "") : null;
              const voidedBy = ev?.kind === "MATCH_GROUP_VOIDED" ? String(ev.by ?? "") : null;

              const matchType = "FULL (group)"; // full-match only

              const fmt = (iso: string | null) => {
                if (!iso) return "—";
                try {
                  return new Date(iso).toLocaleString();
                } catch {
                  return iso;
                }
              };

              const bankSummary = bank
                ? `${isoToYmd(String(bank.posted_date ?? ""))} • ${(bank.name ?? "—").toString().trim()} • ${formatUsdFromCents(toBigIntSafe(bank.amount_cents))}`
                : bank0Id
                  ? `${bank0Id} (not in current view)`
                  : "—";

              const entrySummary = entry
                ? `${String(entry.date ?? "")} • ${(entry.payee ?? "—").toString().trim()} • ${formatUsdFromCents(toBigIntSafe(entry.amount_cents))}`
                : entry0Id
                  ? `${entry0Id} (not in current view)`
                  : "—";

              const Row = ({ label, value, mono }: { label: string; value: any; mono?: boolean }) => (
                <div className="grid grid-cols-[140px_1fr] gap-2 py-1">
                  <div className="text-[11px] font-semibold text-bb-text-muted">{label}</div>
                  <div className={`${mono ? "font-mono" : ""} text-xs text-bb-text break-all`}>{value}</div>
                </div>
              );

              return (
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-semibold text-bb-text-muted mb-1">IDs</div>
                    <div className="rounded-md border border-bb-border bg-bb-surface-card px-3 py-2">
                      <Row label="Match group ID" value={groupId ?? "—"} mono />
                      <Row
                        label="Bank txns"
                        value={
                          bankTxnIds.length
                            ? `${shortId(bankTxnIds[0])}${bankTxnIds.length > 1 ? ` (+${bankTxnIds.length - 1} more)` : ""}`
                            : "—"
                        }
                        mono
                      />
                      <Row
                        label="Entries"
                        value={
                          entryIds.length
                            ? `${shortId(entryIds[0])}${entryIds.length > 1 ? ` (+${entryIds.length - 1} more)` : ""}`
                            : "—"
                        }
                        mono
                      />
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-bb-text-muted mb-1">Context</div>
                    <div className="rounded-md border border-bb-border bg-bb-surface-card px-3 py-2">
                      <Row label="Bank txn" value={bankSummary} />
                      <Row label="Entry" value={entrySummary} />
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-bb-text-muted mb-1">Match</div>
                    <div className="rounded-md border border-bb-border bg-bb-surface-card px-3 py-2">
                      <Row label="Action clicked" value={ev.kind === "MATCH_GROUP_CREATED" ? "Matched" : "Reverted"} />
                      <Row label="Matched amount" value={formatUsdFromCents(matchedAbs)} />
                      <Row label="Match type" value={matchType} mono />
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-bb-text-muted mb-1">Lifecycle</div>
                    <div className="rounded-md border border-bb-border bg-bb-surface-card px-3 py-2">
                      <Row label="Created" value={fmt(createdAt)} />
                      <Row label="Created by" value={auditUserLabel(createdBy)} />
                      <Row label="Voided" value={fmt(voidedAt)} />
                      <Row label="Voided by" value={auditUserLabel(voidedBy)} />
                    </div>
                  </div>

                  {null}
                </div>
              );
            })()}
          </div>
        </div>
        ) : null}
      </AppDialog>

      <AppDialog
        open={revertConfirmOpen}
        onClose={() => {
          if (revertBusy) return;
          setRevertConfirmOpen(false);
          setRevertPreview(null);
          setRevertPreviewLoading(false);
        }}
        title="Revert bank match"
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRevertConfirmOpen(false);
                setRevertPreview(null);
                setRevertPreviewLoading(false);
              }}
              disabled={revertBusy}
            >
              Cancel
            </Button>

            <BusyButton
              variant="danger"
              size="md"
              busy={revertBusy}
              busyLabel="Reverting…"
              disabled={
                revertPreviewLoading ||
                !revertPreview ||
                revertPreview.blocked ||
                revertPreview.already_reverted
              }
              onClick={async () => {
                const ev = selectedReconAudit as any | null;
                const groupId = ev?.groupId ? String(ev.groupId) : null;
                const bankTxnId = ev?.bankTxnIds?.[0] ? String(ev.bankTxnIds[0]) : null;

                if (!selectedBusinessId || !selectedAccountId || !groupId || !bankTxnId || !revertPreview) return;

                setRevertBusy(true);
                setRevertError(null);
                clearMutErr();

                markPending(String(bankTxnId));
                markPending(String(groupId));

                try {
                  const willSoftDelete = (revertPreview.generated_entries_to_soft_delete ?? []).length > 0;

                  await confirmGeneratedEntryRevert({
                    businessId: selectedBusinessId,
                    accountId: selectedAccountId,
                    matchGroupId: groupId,
                    bankTransactionId: bankTxnId,
                    confirmSoftDelete: willSoftDelete,
                  });

                  const voidedAt = new Date().toISOString();
                  const voidedGroupPatch = (g: any) =>
                    String(g?.id ?? "") === groupId ? { ...g, status: "VOIDED", voided_at: voidedAt } : g;

                  setMatchGroups((prev) => (prev ?? []).map(voidedGroupPatch));
                  setAllMatchGroups((prev) => (prev ?? []).map(voidedGroupPatch));

                  clearMutErr();
                  setRevertConfirmOpen(false);
                  setRevertPreview(null);
                  setOpenReconAuditDetail(false);
                  setSelectedReconAudit(null);
                  settleReconcileInBackground("reverted match", async () => {
                    await loadAllMatchGroups({ force: true });
                  });
                } catch (e: any) {
                  const r = applyMutationError(e, "Can’t revert match");
                  if (!r.isClosed) setRevertError(r.msg);
                  else setRevertError(null);
                } finally {
                  clearPending(String(bankTxnId));
                  clearPending(String(groupId));
                  setRevertBusy(false);
                }
              }}
            >
              {(() => {
                const n = revertPreview?.generated_entries_to_soft_delete?.length ?? 0;
                if (n > 0) return `Confirm and remove ${n} generated ${n === 1 ? "entry" : "entries"}`;
                return "Confirm revert";
              })()}
            </BusyButton>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-bb-text">
          {revertPreviewLoading ? (
            <div className="flex items-center gap-2 text-xs text-bb-text-muted">
              <TinySpinner />
              <span>Checking generated entries and closed periods…</span>
            </div>
          ) : revertPreview ? (
            <>
              <div className="font-medium text-bb-text">
                {revertPreview.already_reverted ? "Already reverted" : "Review revert actions"}
              </div>
              <div className="text-xs text-bb-text-muted">
                {(revertPreview.generated_entries_to_soft_delete ?? []).length > 0
                  ? "This will undo the generated ledger entry created from this bank transaction. The bank transaction will remain available for review."
                  : "This will unlink the bank transaction from the ledger entry. The ledger entry will remain unless it was created only for this match."}
              </div>

              {revertPreview.blocked ? (
                <div className="rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-3 py-2 text-xs text-bb-status-warning-fg">
                  {revertPreview.closed_period_blocked
                    ? "This action is blocked by a closed period. Reopen the period to modify."
                    : `This action is blocked: ${revertPreview.block_reasons.join(", ")}`}
                </div>
              ) : null}

              <div className="rounded-md border border-bb-border bg-bb-surface-card px-3 py-2">
                <div className="text-[11px] font-semibold text-bb-text-muted">Bank transaction</div>
                <div className="mt-1 text-xs text-bb-text">
                  {revertPreview.bank_transaction
                    ? `${isoToYmd(String(revertPreview.bank_transaction.posted_date ?? ""))} • ${String(revertPreview.bank_transaction.name ?? "—")} • ${formatUsdFromCents(toBigIntSafe(revertPreview.bank_transaction.amount_cents))}`
                    : "Not found in scope"}
                </div>
              </div>

              <div className="rounded-md border border-bb-border bg-bb-surface-card overflow-hidden">
                <div className="grid grid-cols-[1fr_auto] gap-2 border-b border-bb-border-muted bg-bb-table-header px-3 py-2 text-[11px] font-semibold text-bb-text-muted">
                  <span>Ledger entry</span>
                  <span>Action</span>
                </div>
                <div className="max-h-56 overflow-y-auto">
                  {(revertPreview.ledger_entries ?? []).map((entry) => {
                    const actionLabel = entry.will_soft_delete
                      ? "Soft-delete generated"
                      : entry.closed_period_blocks_action
                        ? "Blocked by closed period"
                        : "Preserve";
                    const actionTone = entry.will_soft_delete
                      ? "text-bb-status-danger-fg"
                      : entry.closed_period_blocks_action
                        ? "text-bb-status-warning-fg"
                        : "text-bb-text-muted";

                    return (
                      <div key={entry.id} className="grid grid-cols-[1fr_auto] gap-2 border-b border-bb-border-muted px-3 py-2 last:border-b-0">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-bb-text">
                            {entry.date ?? "—"} • {entry.payee || "—"} • {formatUsdFromCents(toBigIntSafe(entry.amount_cents))}
                          </div>
                          <div className="mt-0.5 text-[11px] text-bb-text-muted">
                            {entry.will_soft_delete
                              ? "Generated from this bank transaction."
                              : entry.preserve_reasons.join(", ")}
                          </div>
                        </div>
                        <div className={`whitespace-nowrap text-[11px] font-semibold ${actionTone}`}>
                          {actionLabel}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2 text-xs text-bb-text">
                {(revertPreview.generated_entries_to_soft_delete ?? []).length > 0
                  ? "Destructive confirmation required: generated entries are soft-deleted, not hard-deleted; the bank transaction returns to review."
                  : "No generated ledger entry will be deleted. The match group will be voided when active, and the bank transaction returns to review."}
              </div>
            </>
          ) : (
            <div className="text-xs text-bb-text-muted">No revert preview loaded.</div>
          )}

          {revertError ? (
            <div className="rounded-md border border-bb-status-danger-border bg-bb-status-danger-bg px-3 py-2 text-xs text-bb-status-danger-fg">
              {revertError}
            </div>
          ) : null}
        </div>
      </AppDialog>

      {/* Issues List (Phase 5C, read-only) */}
      <AppDialog
        open={openIssuesList}
        onClose={() => setOpenIssuesList(false)}
        title={issuesKind === "notInView" ? "Issues: Not in current view" : "Issues: Reverts"}
        size="lg"
      >
        {(() => {
          const list = issuesKind === "notInView" ? issuesNotInView : issuesVoidHeavy;

          const q = issuesSearch.trim().toLowerCase();
          const visible = q
            ? list.filter((r) => (r.title + " " + r.detail + " " + String(r.bankTxnId ?? "") + " " + String(r.entryId ?? "")).toLowerCase().includes(q))
            : list;

          const openHistoryFor = (bankTxnId?: string | null) => {
            if (!bankTxnId) return;
            setReconHistoryBankTxnFilterId(String(bankTxnId));
            setReconHistoryFilter("all");
            setOpenReconciliationHistory(true);
          };

          return (
            <div className="p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-xs text-bb-text-muted">
                  {visible.length} shown
                </div>
                <input
                  className={["h-7 w-[240px] px-2 text-xs border border-bb-border rounded-md bg-bb-surface-card", ringFocus].join(" ")}
                  placeholder="Search issues…"
                  aria-label="Search issues"
                  value={issuesSearch}
                  onChange={(e) => setIssuesSearch(e.target.value)}
                  title="Local-only search"
                />
              </div>

              {visible.length === 0 ? (
                <EmptyState label="No issues found" />
              ) : (
                <div className="min-w-[820px] rounded-xl border border-bb-border bg-bb-surface-card overflow-hidden">
                  <div className="max-h-[64vh] overflow-y-auto overflow-x-auto">
                    <table className="w-full min-w-[820px] table-fixed border-collapse">
                      <colgroup>
                        <col style={{ width: 120 }} />
                        <col />
                        <col style={{ width: 420 }} />
                        <col style={{ width: 140 }} />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-bb-table-header border-b border-bb-border">
                        <tr className="h-[30px]">
                          <th className="px-2 text-xs font-semibold text-bb-text-muted text-left whitespace-nowrap">TYPE</th>
                          <th className="px-2 text-xs font-semibold text-bb-text-muted text-left whitespace-nowrap">ITEM</th>
                          <th className="px-2 text-xs font-semibold text-bb-text-muted text-left whitespace-nowrap">DETAIL</th>
                          <th className="px-2 text-xs font-semibold text-bb-text-muted text-right whitespace-nowrap">OPEN</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((r, idx) => {
                          const typeLabel = r.kind === "notInView" ? "Not in view" : "Reverts";

                          const handleRowClick = () => {
                            // Reverts-heavy → open History filtered to bankTxnId
                            if (r.kind === "voidHeavy") {
                              openHistoryFor(r.bankTxnId ?? null);
                              return;
                            }

                            // Not in view → open History if bankTxnId exists; else show limitation dialog
                            if (r.kind === "notInView") {
                              if (r.bankTxnId) {
                                openHistoryFor(r.bankTxnId);
                                return;
                              }
                              setIssuesInfoMsg(
                                "This issue refers to a match where the bank transaction is not available in the current view. " +
                                "Adjust filters/date range, or open Reconciliation history without a filter to browse events."
                              );
                              setOpenIssuesInfo(true);
                              return;
                            }

                            // no conflicts in MatchGroups full-match model
                          };

                          return (
                            <tr
                              key={`${r.kind}-${r.bankTxnId ?? ""}-${r.entryId ?? ""}-${idx}`}
                              className="h-[30px] border-b border-bb-border-muted hover:bg-bb-table-row-hover cursor-pointer"
                              onClick={handleRowClick}
                              title="Open related history"
                            >
                              <td className="px-2 text-xs">
                                <StatusChip label={typeLabel} tone="default" />
                              </td>
                              <td className="px-2 text-xs text-bb-text font-medium truncate" title={r.title}>
                                {r.title}
                              </td>
                              <td className="px-2 text-xs text-bb-text-muted truncate" title={r.detail}>
                                {r.detail}
                              </td>
                              <td className="px-2 text-xs text-right">
                                {r.bankTxnId ? (
                                  <button
                                    type="button"
                                    className="h-7 px-2 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover"
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      openHistoryFor(r.bankTxnId ?? null);
                                    }}
                                  >
                                    History
                                  </button>
                                ) : (
                                  <span className="text-xs text-bb-text-subtle">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </AppDialog>

      {/* Issues info (Phase 5C-2, read-only) */}
      <AppDialog
        open={openIssuesInfo}
        onClose={() => setOpenIssuesInfo(false)}
        title="Info"
        size="sm"
      >
        <div className="p-3">
          <div className="text-xs text-bb-text leading-relaxed">{issuesInfoMsg}</div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="h-7 px-2 text-xs rounded-md border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover"
              onClick={() => setOpenIssuesInfo(false)}
            >
              OK
            </button>
          </div>
        </div>
      </AppDialog>

      {/* Export Hub (Phase 5D, read-only) */}
      <AppDialog
        open={openExportHub}
        onClose={() => setOpenExportHub(false)}
        title="Export"
        size="sm"
      >
        <div className="p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? (reconcileWriteReason ?? noPermTitle) : null}>
              <button
                type="button"
                className={["h-20 w-full rounded-xl border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1.5 px-3 py-2", ringFocus].join(" ")}
                disabled={
                  !canWriteReconcileEffective ||
                  (bankTab === "matched" && (!bankStatusLoaded.matched || bankLoadingByStatus.matched)) ||
                  (bankTab === "unmatched" ? bankUnmatchedList : bankMatchedList).length === 0
                }
                title={
                  !canWriteReconcileEffective
                    ? (reconcileWriteReason ?? noPermTitle)
                    : bankTab === "matched" && (!bankStatusLoaded.matched || bankLoadingByStatus.matched)
                      ? "Matched transactions are loading"
                    : (bankTab === "unmatched" ? bankUnmatchedList : bankMatchedList).length === 0
                      ? "No bank transactions to export"
                      : "Export bank transactions (CSV)"
                }
                onClick={() => {
                  if (!canWriteReconcileEffective) return;
                  exportBankCsv();
                }}
              >
                <Download className="h-6 w-6 text-bb-text" />
                <span className="text-xs font-semibold text-bb-text whitespace-nowrap">Bank txns</span>
                <span className="text-[11px] text-bb-text-muted">
                  {bankTab === "matched" && !bankStatusLoaded.matched
                    ? bankLoadingByStatus.matched
                      ? "Loading"
                      : "Not loaded"
                    : (bankTab === "unmatched" ? bankUnmatchedList : bankMatchedList).length}
                </span>
              </button>
            </HintWrap>

            {null /* Legacy BankMatch export hidden — Reconcile now uses MatchGroups */}

            <button
              type="button"
              className={["h-20 rounded-xl border border-bb-border bg-bb-surface-card hover:bg-bb-table-row-hover disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1.5 px-3 py-2 sm:col-span-2", ringFocus].join(" ")}
              disabled={!allMatchGroupsHydrated || allMatchGroupsLoading || reconAuditVisible.length === 0}
              title={
                !allMatchGroupsHydrated || allMatchGroupsLoading
                  ? "Audit events load when Export opens"
                  : reconAuditVisible.length === 0
                    ? "No audit events to export"
                    : "Export audit events (CSV) — respects current filters"
              }
              onClick={() => exportAuditEventsCsv()}
            >
              <ClipboardList className="h-6 w-6 text-bb-text" />
              <span className="text-xs font-semibold text-bb-text whitespace-nowrap">Audit events</span>
              <span className="text-[11px] text-bb-text-muted">
                {allMatchGroupsHydrated ? reconAuditVisible.length : allMatchGroupsLoading ? "Loading" : "Not loaded"}
              </span>
            </button>
          </div>

          <div className="mt-2 text-[11px] text-bb-text-muted">
            CSV exports reflect current scope and loaded filters; audit history loads when Export opens.
          </div>
        </div>
      </AppDialog>

      {/* Statement history dialog */}
      {openStatementHistory ? (
        <AppDialog
          open={openStatementHistory}
          onClose={() => setOpenStatementHistory(false)}
          title="Statement history"
          size="lg"
        >
          <UploadsList
            title="Bank statement history"
            businessId={selectedBusinessId ?? ""}
            accountId={selectedAccountId ?? undefined}
            type="BANK_STATEMENT"
            limit={25}
            showStatementPeriod
            onImported={() => {
              setSyncMsg("Bank statement import finished; transaction list refreshed.");
              setPendingMsg(null);
              settleReconcileInBackground("statement import", () => {
                setBankCountRefreshSeq((n) => n + 1);
              });
            }}
          />
        </AppDialog>
      ) : null}

      {openAutoReconcile ? (
        <AutoReconcileDialog
          open={openAutoReconcile}
          onOpenChange={setOpenAutoReconcile}
          businessId={selectedBusinessId ?? ""}
          accountId={selectedAccountId ?? ""}
          bankTxns={bankUnmatchedList}
          expectedEntries={entriesExpectedList}
          // existing helpers/state
          canWrite={canWriteReconcileEffective}
          canWriteReason={reconcileWriteReason ?? noPermTitle}
          onApplied={async () => {
            refreshAllDebounced();
          }}
        />
      ) : null}

      {openUpload ? (
        <UploadPanel
          open={openUpload}
          onClose={() => setOpenUpload(false)}
          type="BANK_STATEMENT"
          ctx={{ businessId: selectedBusinessId ?? undefined, accountId: selectedAccountId ?? undefined }}
          allowMultiple={false}
        />
      ) : null}
    </div>
  );
}
