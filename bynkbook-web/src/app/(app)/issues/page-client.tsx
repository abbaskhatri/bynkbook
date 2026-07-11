"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { attentionSummaryKey } from "@/lib/queries/attentionSummary";
import { issueCountKey } from "@/lib/queries/issueKeys";
import { usePreferredAccountId } from "@/lib/accountSelection";

import { apiFetch } from "@/lib/api/client";
import { listCategories, type CategoryRow } from "@/lib/api/categories";
import { listAccountIssues } from "@/lib/api/issues";

import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/primitives/FilterBar";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { FixIssueDialog } from "@/components/ledger/fix-issue-dialog";
import { AutoFixIssuesDialog } from "@/components/issues/auto-fix-issues-dialog";

import { InlineBanner } from "@/components/app/inline-banner";
import { EmptyStateCard } from "@/components/app/empty-state";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";

import { inputH7, selectTriggerClass } from "@/components/primitives/tokens";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { RotateCcw, AlertTriangle, Loader2 } from "lucide-react";

import { formatUsd, toBigIntSafe } from "@/lib/money";
import { extractEntryRef, statusLabel } from "@/lib/ledger/helpers";

const formatUsdFromCents = (cents: bigint) => formatUsd(cents);

function titleCase(s: string) {
  const t = String(s || "").toLowerCase();
  return t.length ? t[0].toUpperCase() + t.slice(1) : "";
}

type IssueKind = "DUPLICATE" | "MISSING_CATEGORY" | "STALE_CHECK";

type IssueRow = {
  id: string; // entry_id
  kind: IssueKind;

  // Stage B fields
  status: "OPEN" | "RESOLVED";
  groupKey?: string | null;

  // Display fields from the /issues entry snapshot
  date: string;
  payee: string;
  amountStr: string;
  amountCents: string;
  methodDisplay: string;
  rawMethod: string;
  category: string;
  details: string;

  // for dialog flags
  flags: { dup: boolean; stale: boolean; missing: boolean };
};

type ApiIssue = {
  id: string;
  entry_id: string;
  issue_type: string;
  status: string;
  severity: string;
  group_key: string | null;
  details: string;
  detected_at: string;
  entry_date?: string | null;
  entry_payee?: string | null;
  entry_memo?: string | null;
  entry_amount_cents?: string | null;
  entry_type?: string | null;
  entry_method?: string | null;
  entry_status?: string | null;
  entry_category_id?: string | null;
  entry_category_name?: string | null;
};

function QueueCard(props: {
  title: string;
  count: number;
  hint: string;
  tone?: "success" | "warning" | "info" | "danger";
  active?: boolean;
  actionLabel: string;
  onAction?: () => void;
  disabled?: boolean;
}) {
  const toneClass =
    props.tone === "success"
      ? "border-bb-status-success-border bg-bb-status-success-bg text-bb-status-success-fg"
      : props.tone === "danger"
        ? "border-bb-status-danger-border bg-bb-status-danger-bg text-bb-status-danger-fg"
        : props.tone === "info"
          ? "border-bb-status-info-border bg-bb-status-info-bg text-bb-status-info-fg"
          : "border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg";

  return (
    <div
      className={[
        "rounded-lg border bg-card p-3 transition-colors",
        props.active ? "border-primary/35 shadow-sm" : "border-border",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{props.title}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{props.hint}</div>
        </div>
        <div className={`inline-flex h-6 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold ${toneClass}`}>
          {props.count}
        </div>
      </div>

      <Button
        type="button"
        variant={props.tone === "success" ? "default" : "outline"}
        className="mt-3 h-7 px-3 text-xs"
        onClick={props.onAction}
        disabled={props.disabled}
      >
        {props.actionLabel}
      </Button>
    </div>
  );
}

export default function IssuesPageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const containerStyle = { height: "calc(100vh - 56px - 48px)" as const };

  // ================================
  // Auth is handled by AppShell
  // ================================

  // ================================
  // Business / Account selection
  // ================================
  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");
  const accountIdFromUrl = sp.get("accountId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const accountsQ = useAccounts(selectedBusinessId);

  const selectedAccountId = usePreferredAccountId({
    businessId: selectedBusinessId,
    accounts: accountsQ.data ?? [],
    accountIdFromUrl,
  });

  // ================================
  // Filters (UI-only, local)
  // ================================
  const [payeeQuery, setPayeeQuery] = useState("");
  const [debouncedPayee, setDebouncedPayee] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPayee(payeeQuery), 200);
    return () => clearTimeout(t);
  }, [payeeQuery]);

  const [filterIssueType, setFilterIssueType] = useState<"ALL" | "DUPLICATE" | "MISSING_CATEGORY" | "STALE_CHECK">("ALL");
  const [filterStatus, setFilterStatus] = useState<"OPEN" | "ALL">("OPEN");
  const [filterSeverity, setFilterSeverity] = useState<"ALL" | "WARNING">("ALL");

  function resetIssuesFilters() {
    setPayeeQuery("");
    setFilterIssueType("ALL");
    setFilterStatus("OPEN");
    setFilterSeverity("ALL");
  }

  // ================================
  // Stage B issue scan state
  // Rule: Issues page loads from GET /issues only. POST /issues/scan is manual.
  // ================================
  const scanKey = useMemo(() => {
    if (!selectedBusinessId || !selectedAccountId) return "";
    return `bynkbook:lastScanAt:${selectedBusinessId}:${selectedAccountId}`;
  }, [selectedBusinessId, selectedAccountId]);

  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  // Tracks which scanKey's localStorage value has actually been read, so the
  // auto-scan below doesn't fire against the initial null before we know the
  // real last-scan timestamp.
  const [lastScanLoadedFor, setLastScanLoadedFor] = useState<string>("");
  useEffect(() => {
    if (!scanKey) return;
    try {
      setLastScanAt(localStorage.getItem(scanKey));
    } catch {
      // ignore
    }
    setLastScanLoadedFor(scanKey);
  }, [scanKey]);

  const [scanBusy, setScanBusy] = useState(false);

  // Phase 1 Stabilization: epoch guard for scan workflows
  // - prevents stale scan completion from winning after scope change
  // - guarantees busy clears deterministically
  const scanEpochRef = useRef(0);

  useEffect(() => {
    // Scope change cancels any prior scan "epoch"
    scanEpochRef.current += 1;
    setScanBusy(false);
  }, [selectedBusinessId, selectedAccountId]);

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

  const [scanErr, setScanErr] = useState<string | null>(null);

  async function runManualScan() {
    if (scanBusy) return;
    if (!selectedBusinessId || !selectedAccountId) return;

    setScanErr(null);
    clearMutErr();
    const myEpoch = ++scanEpochRef.current;
    setScanBusy(true);

    try {
      await apiFetch(
        `/v1/businesses/${selectedBusinessId}/accounts/${selectedAccountId}/issues/scan`,
        {
          method: "POST",
          body: JSON.stringify({
            includeMissingCategory: true,
            dryRun: false,
          }),
        }
      );

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false }),
        qc.invalidateQueries({ queryKey: issueCountKey(selectedBusinessId, selectedAccountId, "OPEN"), exact: false }),
        qc.invalidateQueries({ queryKey: attentionSummaryKey(selectedBusinessId, selectedAccountId), exact: false }),
        qc.invalidateQueries({ queryKey: ["categoryReviewEntries", selectedBusinessId, selectedAccountId], exact: false }),
      ]);
      await qc.refetchQueries({
        queryKey: ["entryIssues", selectedBusinessId, selectedAccountId],
        exact: false,
        type: "active",
      });

      // Persist last scan timestamp (UI-only throttle)
      const nowIso = new Date().toISOString();
      if (scanKey) {
        try {
          localStorage.setItem(scanKey, nowIso);
        } catch {
          // ignore
        }
      }
      setLastScanAt(nowIso);
      window.dispatchEvent(
        new CustomEvent("bynkbook:issues-scanned", {
          detail: { businessId: selectedBusinessId, accountId: selectedAccountId, scannedAt: nowIso },
        })
      );
    } catch (e: any) {
      const r = applyMutationError(e, "Can’t scan issues");
      if (!r.isClosed) setScanErr(r.msg);
      else setScanErr(null);
    } finally {
      if (myEpoch === scanEpochRef.current) setScanBusy(false);
    }
  }

  // Auto-scan on first visit: detection of duplicates / stale checks used to
  // only run when the user manually clicked "Scan", so accounts that were
  // never scanned showed no issues even when duplicates existed. We now run
  // the scan automatically once per account when it has never been scanned in
  // this browser, or the last scan is older than the staleness window. The
  // visible "Scanning…" state comes from the shared scanBusy flag.
  const AUTO_SCAN_STALE_MS = 6 * 60 * 60 * 1000; // 6 hours
  const autoScanDoneRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!selectedBusinessId || !selectedAccountId || !scanKey) return;
    // Wait until localStorage has been read for THIS account.
    if (lastScanLoadedFor !== scanKey) return;
    if (autoScanDoneRef.current.has(scanKey)) return;
    if (scanBusy) return;

    const lastMs = lastScanAt ? Date.parse(lastScanAt) : NaN;
    const isStale = !Number.isFinite(lastMs) || Date.now() - lastMs > AUTO_SCAN_STALE_MS;
    if (!isStale) return;

    autoScanDoneRef.current.add(scanKey);
    void runManualScan();
    // runManualScan is a stable handler; deps intentionally exclude it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBusinessId, selectedAccountId, scanKey, lastScanLoadedFor, lastScanAt, scanBusy]);

  // Real categories (needed for FixIssueDialog: missing category fix)
  const categoriesQ = useQuery({
    queryKey: ["categories", selectedBusinessId],
    enabled: !!selectedBusinessId,
    queryFn: async () => {
      if (!selectedBusinessId) return { ok: true as const, rows: [] as CategoryRow[] };
      return listCategories(selectedBusinessId, { includeArchived: false });
    },
  });

  const categoryRows = categoriesQ.data?.rows ?? [];

  // ================================
  // Stage B issues query
  // ================================
  const issuesQ = useInfiniteQuery({
    queryKey: ["entryIssues", selectedBusinessId, selectedAccountId, filterStatus],
    enabled: !!selectedBusinessId && !!selectedAccountId,
    initialPageParam: null as string | null,
    staleTime: 10_000,
    refetchOnWindowFocus: "always",
    queryFn: async ({ pageParam }) => {
      const statusParam = filterStatus === "ALL" ? "ALL" : "OPEN";
      return listAccountIssues({
        businessId: selectedBusinessId as string,
        accountId: selectedAccountId as string,
        status: statusParam,
        limit: 50,
        cursor: pageParam,
      });
    },
    getNextPageParam: (lastPage) => (
      lastPage.hasMore && lastPage.nextCursor ? lastPage.nextCursor : undefined
    ),
  });

  useEffect(() => {
    if (!scanKey || !selectedBusinessId || !selectedAccountId) return;

    const refreshFromScan = (scannedAt: string | null) => {
      if (scannedAt) setLastScanAt(scannedAt);
      void Promise.all([
        qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false }),
        qc.invalidateQueries({ queryKey: issueCountKey(selectedBusinessId, selectedAccountId, "OPEN"), exact: false }),
        qc.invalidateQueries({ queryKey: attentionSummaryKey(selectedBusinessId, selectedAccountId), exact: false }),
      ]).then(() =>
        qc.refetchQueries({
          queryKey: ["entryIssues", selectedBusinessId, selectedAccountId],
          exact: false,
          type: "active",
        })
      );
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === scanKey) refreshFromScan(event.newValue);
    };
    const onScan = (event: Event) => {
      const detail = (event as CustomEvent<{ businessId?: string; accountId?: string; scannedAt?: string }>).detail;
      if (detail?.businessId !== selectedBusinessId || detail?.accountId !== selectedAccountId) return;
      refreshFromScan(detail.scannedAt ?? null);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("bynkbook:issues-scanned", onScan);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bynkbook:issues-scanned", onScan);
    };
  }, [qc, scanKey, selectedAccountId, selectedBusinessId]);

  async function refreshIssuesAfterMutation() {
    if (!selectedBusinessId || !selectedAccountId) return;

    clearSelection();
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false }),
      qc.invalidateQueries({ queryKey: issueCountKey(selectedBusinessId, selectedAccountId, "OPEN"), exact: false }),
      qc.invalidateQueries({ queryKey: attentionSummaryKey(selectedBusinessId, selectedAccountId), exact: false }),
      qc.invalidateQueries({ queryKey: ["entries", selectedBusinessId, selectedAccountId], exact: false }),
    ]);
    await issuesQ.refetch();
  }

  const bannerMsg =
    appErrorMessageOrNull(businessesQ.error) ||
    appErrorMessageOrNull(accountsQ.error) ||
    appErrorMessageOrNull(categoriesQ.error) ||
    appErrorMessageOrNull(issuesQ.error) ||
    null;

  // -------------------------
  // Mutation banner (single region; CLOSED_PERIOD consistency)
  // -------------------------
  const [mutErr, setMutErr] = useState<string | null>(null);
  const [mutErrTitle, setMutErrTitle] = useState<string>("");

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

  const loadedApiIssues = useMemo(() => {
    const out: ApiIssue[] = [];
    const seen = new Set<string>();
    for (const page of issuesQ.data?.pages ?? []) {
      for (const issue of page.issues ?? []) {
        const key = String(issue.id ?? "");
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(issue as ApiIssue);
      }
    }
    return out;
  }, [issuesQ.data]);

  const openIssues = loadedApiIssues.map((it) => ({
    id: it.id,
    business_id: selectedBusinessId ?? "",
    account_id: selectedAccountId ?? "",
    entry_id: it.entry_id,
    issue_type: it.issue_type,
    status: it.status,
    severity: it.severity,
    group_key: it.group_key,
    details: it.details,
    detected_at: it.detected_at,
  }));

  // Map every account issue to a visible row. Category Review remains the
  // specialized bulk workflow, while Issues provides the complete audit queue.
  const issues = useMemo(() => {
    const apiIssues = loadedApiIssues;
    const out: IssueRow[] = [];

    for (const it of apiIssues) {
      const kind = (it.issue_type || "").toUpperCase() as IssueKind;
      const entryId = it.entry_id;
      const rawMethod = (it.entry_method ?? "").toString();
      const amt = toBigIntSafe(it.entry_amount_cents);
      const amountCents = amt.toString();
      const amountStr = it.entry_amount_cents != null ? formatUsdFromCents(amt) : "—";

      out.push({
        id: entryId,
        kind,
        status: (it.status || "OPEN").toUpperCase() === "RESOLVED" ? "RESOLVED" : "OPEN",
        groupKey: it.group_key ?? null,

        date: it.entry_date ?? "",
        payee: it.entry_payee ?? "Entry unavailable",
        amountStr,
        amountCents,
        methodDisplay: titleCase(rawMethod),
        rawMethod,
        category: it.entry_category_name ?? it.entry_memo ?? "",
        details: it.details || "",
        flags: {
          dup: kind === "DUPLICATE",
          stale: kind === "STALE_CHECK",
          missing: kind === "MISSING_CATEGORY",
        },
      });
    }

    return out;
  }, [loadedApiIssues]);

  const filteredIssues = useMemo(() => {
    const q = debouncedPayee.trim().toLowerCase();
    return issues.filter((r) => {
      if (q) {
        const p = (r.payee || "").toLowerCase();
        if (!p.includes(q)) return false;
      }
      if (filterIssueType !== "ALL" && r.kind !== filterIssueType) return false;

      // Severity is WARNING-only right now; keep UI consistent
      if (filterSeverity !== "ALL" && filterSeverity !== "WARNING") return false;

      return true;
    });
  }, [issues, debouncedPayee, filterIssueType, filterSeverity]);

  const kpi = useMemo(() => {
    // KPI is computed from the loaded (already status-filtered) issues list.
    const openTotal = issues.length;
    const dup = issues.filter((x) => x.kind === "DUPLICATE").length;
    const stale = issues.filter((x) => x.kind === "STALE_CHECK").length;
    const missing = issues.filter((x) => x.kind === "MISSING_CATEGORY").length;
    return { openTotal, dup, missing, stale };
  }, [issues]);

  const selectedQueueLabel = useMemo(() => {
    if (filterIssueType === "DUPLICATE") return "Duplicate groups";
    if (filterIssueType === "MISSING_CATEGORY") return "Missing categories";
    if (filterIssueType === "STALE_CHECK") return "Stale checks";
    return "All issues";
  }, [filterIssueType]);

  const safeStaleCount = useMemo(() => {
    return issues.filter((x) => x.kind === "STALE_CHECK").length;
  }, [issues]);

  // ================================
  // Selection + bulk (UI-only)
  // ================================
  const checkboxClass =
    "h-4 w-4 rounded border border-input bg-card checked:bg-primary checked:border-primary";
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});

  function clearSelection() {
    setSelectedIds({});
  }

  // ================================
  // Group expand/collapse + render rows
  // ================================
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  function toggleGroup(groupKey: string) {
    setExpandedGroups((m) => ({ ...m, [groupKey]: !m[groupKey] }));
  }

  const renderRows = useMemo(() => {
    type GroupRow = {
      rowType: "GROUP";
      groupKey: string;
      count: number;
      head: IssueRow;
      members: IssueRow[];
      hasStale: boolean;
    };

    type ItemRow = {
      rowType: "ITEM";
      rowKey: string;
      item: IssueRow;
      isChild: boolean;
      groupKey?: string;
    };

    const out: Array<GroupRow | ItemRow> = [];

    const dupGroups = new Map<string, IssueRow[]>();
    const staleRows: IssueRow[] = [];
    const missingCategoryRows: IssueRow[] = [];
    const dupEntryIds = new Set<string>();

    for (const r of filteredIssues) {
      if (r.kind === "MISSING_CATEGORY") {
        missingCategoryRows.push(r);
        continue;
      }
      if (r.kind === "STALE_CHECK") {
        staleRows.push(r);
        continue;
      }
      if (r.kind !== "DUPLICATE") continue;

      dupEntryIds.add(r.id);

      const payeeKey = (r.payee || "").trim().toLowerCase();
      const methodUpper = (r.rawMethod || "").toString().toUpperCase();
      const bucket = methodUpper === "CHECK" ? "CHECK" : "NONCHECK";
      const key = r.groupKey ? r.groupKey : `${bucket}|${r.amountCents}|${payeeKey}`;

      const arr = dupGroups.get(key);
      if (arr) arr.push(r);
      else dupGroups.set(key, [r]);
    }

    // stale not duplicated: show separately
    const staleFiltered = staleRows.filter((s) => !dupEntryIds.has(s.id));

    const groupsSorted: GroupRow[] = Array.from(dupGroups.entries())
      .map(([groupKey, members]) => {
        const sorted = [...members];
        const hasStaleInGroup = filteredIssues.some(
          (x) => x.kind === "STALE_CHECK" && members.some((m) => m.id === x.id)
        );
        return {
          rowType: "GROUP" as const,
          groupKey,
          count: sorted.length,
          head: sorted[0],
          members: sorted,
          hasStale: hasStaleInGroup,
        };
      });

    for (const g of groupsSorted) {
      out.push(g);

      if (expandedGroups[g.groupKey]) {
        for (const m of g.members) {
          if (m.id === g.head.id) continue;
          out.push({
            rowType: "ITEM",
            rowKey: `${m.id}|${m.kind}`,
            item: m,
            isChild: true,
            groupKey: g.groupKey,
          });
        }
      }
    }

    for (const s of staleFiltered) {
      out.push({
        rowType: "ITEM",
        rowKey: `${s.id}|${s.kind}`,
        item: s,
        isChild: false,
      });
    }

    for (const missing of missingCategoryRows) {
      out.push({
        rowType: "ITEM",
        rowKey: `${missing.id}|${missing.kind}`,
        item: missing,
        isChild: false,
      });
    }

    return out;
  }, [filteredIssues, expandedGroups]);

  const allSelected = useMemo(() => {
    const keys = filteredIssues.map((r) => `${r.id}|${r.kind}`);
    if (keys.length === 0) return false;
    return keys.every((k) => !!selectedIds[k]);
  }, [filteredIssues, selectedIds]);

  const selectedItemKeys = useMemo(() => {
    const keys = filteredIssues.map((r) => `${r.id}|${r.kind}`);
    return keys.filter((k) => !!selectedIds[k]);
  }, [filteredIssues, selectedIds]);

  const selectedIssueBackendIds = useMemo(() => {
    if (!selectedItemKeys.length) return [] as string[];

    const selectedKeySet = new Set(selectedItemKeys);
    const ids = new Set<string>();

    for (const issue of openIssues) {
      const kind = String(issue.issue_type || "").toUpperCase();
      if (kind !== "DUPLICATE" && kind !== "MISSING_CATEGORY" && kind !== "STALE_CHECK") continue;

      const key = `${issue.entry_id}|${kind}`;
      if (!selectedKeySet.has(key)) continue;

      if (issue.id) ids.add(String(issue.id));
    }

    return Array.from(ids);
  }, [selectedItemKeys, openIssues]);

  const selectedCount = selectedItemKeys.length;

  function toggleRow(key: string) {
    setSelectedIds((m) => ({ ...m, [key]: !m[key] }));
  }

  function toggleAll() {
    const shouldSelect = !allSelected;
    const next: Record<string, boolean> = { ...selectedIds };
    for (const r of filteredIssues) next[`${r.id}|${r.kind}`] = shouldSelect;
    setSelectedIds(next);
  }

  function toggleGroupSelection(groupKey: string, members: IssueRow[]) {
    const keys = members.map((m) => `${m.id}|${m.kind}`);
    const shouldSelect = !keys.every((k) => !!selectedIds[k]);
    setSelectedIds((m) => {
      const next = { ...m };
      for (const k of keys) next[k] = shouldSelect;
      return next;
    });
  }

  // ================================
  // Fix dialog
  // ================================
  const [fixDialog, setFixDialog] = useState<
    | {
      id: string;
      kind: "DUPLICATE" | "MISSING_CATEGORY" | "STALE_CHECK";
    }
    | null
  >(null);

  const [autoFixDialogOpen, setAutoFixDialogOpen] = useState(false);

  const accountCapsuleEl = (
    <div className="h-6 px-1.5 rounded-lg border border-primary/20 bg-primary/10 flex items-center">
      <CapsuleSelect
        variant="flat"
        loading={accountsQ.isLoading}
        value={selectedAccountId || ""}
        onValueChange={(v) => {
          router.replace(`/issues?businessId=${selectedBusinessId}&accountId=${v}`);
        }}
        options={(accountsQ.data ?? [])
          .filter((a) => !a.archived_at)
          .map((a) => ({ value: a.id, label: a.name }))}
        placeholder="Select account"
      />
    </div>
  );

  const filterLeft = (
    <div className="w-full max-w-full">
      <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto whitespace-nowrap pr-2 py-1 pl-1">
        <div className="min-w-0 flex-1">
          <input
            value={payeeQuery}
            onChange={(e) => setPayeeQuery(e.target.value)}
            placeholder="Search payee..."
            aria-label="Search by payee"
            className={[inputH7, "w-[220px] min-w-0"].join(" ")}
          />
        </div>

        <Select value={filterIssueType} onValueChange={(v) => setFilterIssueType(v as any)}>
          <SelectTrigger className={[selectTriggerClass, "w-[140px]"].join(" ")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="bottom" align="start">
            <SelectItem value="ALL">All Types</SelectItem>
            <SelectItem value="DUPLICATE">Duplicate</SelectItem>
            <SelectItem value="MISSING_CATEGORY">Missing category</SelectItem>
            <SelectItem value="STALE_CHECK">Stale check</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as any)}>
          <SelectTrigger className={[selectTriggerClass, "w-[110px]"].join(" ")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="bottom" align="start">
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="ALL">All Status</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterSeverity} onValueChange={(v) => setFilterSeverity(v as any)}>
          <SelectTrigger className={[selectTriggerClass, "w-[130px]"].join(" ")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="bottom" align="start">
            <SelectItem value="ALL">All Severity</SelectItem>
            <SelectItem value="WARNING">Warning</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          className="h-7 px-1 text-xs font-medium shrink-0 inline-flex items-center gap-1"
          onClick={resetIssuesFilters}
          title="Reset filters"
        >
          <RotateCcw className="h-4 w-4" />
          Reset
        </Button>

        {selectedCount > 0 ? (
          <div className="ml-2 flex items-center gap-2 shrink-0">
            <Button
              className="h-7 px-2 text-xs"
              onClick={() => setAutoFixDialogOpen(true)}
              disabled={!selectedIssueBackendIds.length}
            >
              Auto Fix Issues
            </Button>

            <Button variant="outline" className="h-7 px-2 text-xs" onClick={clearSelection}>
              Clear selection
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );

  const filterRight = scanBusy ? (
    <div className="text-xs text-muted-foreground pr-3 whitespace-nowrap" role="status" aria-live="polite">
      Updating issues…
    </div>
  ) : null;

  // Phase 1: per-surface retry (no full-page collapse / no router.refresh storms)
  function retrySurfaceLoads() {
    void businessesQ.refetch?.();
    void accountsQ.refetch?.();
    void categoriesQ.refetch?.();
    void issuesQ.refetch();
  }

  // Auth handled by AppShell

  return (
    <div className="flex flex-col gap-2 overflow-hidden" style={containerStyle}>
      {/* Unified header + filters container (match Ledger) */}
      <div className="bb-page-command-surface rounded-xl overflow-visible">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Issues"
            afterTitle={accountCapsuleEl}
            right={
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  Last scan: <span className="font-medium text-foreground">{formatScanLabel(lastScanAt)}</span>
                </span>

                <Button
                  variant="outline"
                  className="h-7 px-2 text-xs inline-flex items-center gap-1"
                  onClick={runManualScan}
                  disabled={scanBusy}
                  title="Scan issues"
                >
                  {scanBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Scan
                </Button>
              </div>
            }
          />
        </div>

        <div className="mt-2 h-px bg-border" />

        <div className="px-3 py-2">
          <FilterBar left={filterLeft} right={filterRight} />
        </div>

        {(bannerMsg || mutErr) ? (
          <div className="px-3 py-2">
            {bannerMsg ? (
              <InlineBanner title="Can’t load issues" message={bannerMsg} onRetry={() => retrySurfaceLoads()} />
            ) : (
              <InlineBanner
                title={mutErrTitle || "Can’t update issues"}
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
              secondary={{ label: "Reload", onClick: () => retrySurfaceLoads() }}
            />
          </div>
        ) : null}

        {selectedBusinessId && !accountsQ.isLoading && (accountsQ.data ?? []).length === 0 ? (
          <div className="px-3 pb-2">
            <EmptyStateCard
              title="No accounts yet"
              description="Add an account to start importing and categorizing transactions."
              primary={{ label: "Add account", href: "/settings?tab=accounts" }}
              secondary={{ label: "Reload", onClick: () => retrySurfaceLoads() }}
            />
          </div>
        ) : null}

        <div className="h-px bg-border" />

        <div className="px-3 py-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            Open <span className="font-medium text-foreground">{kpi.openTotal}</span>
          </span>
          <span>
            Duplicates <span className="font-medium text-foreground">{kpi.dup}</span>
          </span>
          <span>
            Categories <span className="font-medium text-foreground">{kpi.missing}</span>
          </span>
          <span>
            Stale <span className="font-medium text-foreground">{kpi.stale}</span>
          </span>

          {scanErr ? <span className="text-bb-status-danger-fg ml-2">{scanErr}</span> : null}
        </div>
      </div>

      {selectedBusinessId && (accountsQ.data ?? []).length > 0 ? (
        <div className="grid min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="min-h-0 overflow-y-auto rounded-lg border border-border bg-card p-3">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              <QueueCard
                title="Safe stale checks"
                count={safeStaleCount}
                hint="Quick acknowledge"
                tone="success"
                active={filterIssueType === "STALE_CHECK"}
                actionLabel="Show stale"
                onAction={() => setFilterIssueType("STALE_CHECK")}
              />
              <QueueCard
                title="Duplicate groups"
                count={kpi.dup}
                hint="Compare before action"
                tone="warning"
                active={filterIssueType === "DUPLICATE"}
                actionLabel="Review groups"
                onAction={() => setFilterIssueType("DUPLICATE")}
              />
              <QueueCard
                title="Missing categories"
                count={kpi.missing}
                hint="Assign in Issues or Category Review"
                tone="info"
                active={filterIssueType === "MISSING_CATEGORY"}
                actionLabel="Review categories"
                onAction={() => setFilterIssueType("MISSING_CATEGORY")}
              />
              <QueueCard
                title="All open issues"
                count={kpi.openTotal}
                hint="Everything needing attention"
                tone="info"
                active={filterIssueType === "ALL"}
                actionLabel="Show all"
                onAction={() => setFilterIssueType("ALL")}
              />
              <QueueCard
                title="Selected fixes"
                count={selectedCount}
                hint="Preview deterministic bulk fixes"
                tone="success"
                actionLabel="Preview Auto Fix"
                onAction={() => setAutoFixDialogOpen(true)}
                disabled={!selectedIssueBackendIds.length}
              />
            </div>
          </div>

          <div className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card">
            <div className="shrink-0 border-b border-border px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-foreground">{selectedQueueLabel}</div>
                  <div className="text-xs text-muted-foreground">
                    Compare evidence here; destructive duplicate decisions still open the review dialog.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all loaded issues"
                    />
                    Select all
                  </label>
                  {selectedCount > 0 ? (
                    <Button variant="outline" className="h-7 px-2 text-xs" onClick={clearSelection}>
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {issuesQ.isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={`sk-${i}`} className="h-20 rounded-lg border border-border bg-muted/45 animate-pulse" />
                  ))}
                </div>
              ) : issuesQ.isError ? (
                <div className="rounded-lg border border-bb-status-danger-border bg-bb-status-danger-bg p-3 text-xs text-bb-status-danger-fg" role="alert">
                  <div className="flex items-center justify-between gap-3">
                    <span>Failed to load issues: {appErrorMessageOrNull(issuesQ.error) ?? "Something went wrong."}</span>
                    <button type="button" className="text-xs font-medium hover:underline" onClick={() => void issuesQ.refetch()}>
                      Retry
                    </button>
                  </div>
                </div>
              ) : renderRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/35 p-4 text-sm text-muted-foreground">
                  {lastScanAt
                    ? `No open issues. Last scan: ${formatScanLabel(lastScanAt)}.`
                    : "No issues yet. Run Scan to generate issues."}
                </div>
              ) : (
                <div className="space-y-2">
                  {renderRows.map((row) => {
                    const chip =
                      "inline-flex h-5 items-center rounded-md border px-1.5 text-[10px] font-semibold leading-none";

                    if (row.rowType === "GROUP") {
                      const g = row;
                      const head = g.head;
                      const isExpanded = !!expandedGroups[g.groupKey];
                      const groupSelected = g.members.every((m) => !!selectedIds[`${m.id}|${m.kind}`]);
                      const actionLabel = String(head.details ?? "").toLowerCase().includes("matched")
                        ? "Review match"
                        : "Compare";

                      return (
                        <div key={`group|${g.groupKey}`} className="rounded-lg border border-border bg-card p-3">
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              className={checkboxClass}
                              checked={groupSelected}
                              onChange={() => toggleGroupSelection(g.groupKey, g.members)}
                              aria-label={`Select group: ${head.payee || "Unknown payee"} (${g.count} entries)`}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  className="inline-flex min-w-0 items-center gap-1 text-sm font-semibold text-foreground hover:text-primary"
                                  onClick={() => toggleGroup(g.groupKey)}
                                >
                                  <span className="text-xs">{isExpanded ? "▾" : "▸"}</span>
                                  <span className="truncate">{head.payee || "Untitled payee"}</span>
                                </button>
                                <span className={`${chip} border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg`}>
                                  Duplicate group
                                </span>
                                <span className={`${chip} border-border bg-muted text-muted-foreground`}>
                                  {g.count} entries
                                </span>
                                {g.hasStale ? (
                                  <span className={`${chip} border-bb-status-info-border bg-bb-status-info-bg text-bb-status-info-fg`}>
                                    stale too
                                  </span>
                                ) : null}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {head.details} · {head.date || "No date"} · {head.methodDisplay || "No method"}
                              </div>

                              {isExpanded ? (
                                <div className="mt-3 space-y-2 border-t border-border pt-2">
                                  {g.members.map((m) => (
                                    <div key={`${m.id}|${m.kind}|child`} className="flex items-center justify-between gap-3 rounded-md bg-muted/35 px-2 py-1.5">
                                      <div className="min-w-0">
                                        <div className="truncate text-xs font-medium text-foreground">{m.payee || "Untitled payee"}</div>
                                        <div className="truncate text-[11px] text-muted-foreground">{m.date} · {m.methodDisplay || "No method"}</div>
                                      </div>
                                      <div className={`shrink-0 text-xs font-semibold tabular-nums ${m.amountStr.startsWith("(") ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                                        {m.amountStr}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            <div className="shrink-0 text-right">
                              <div className={`text-sm font-semibold tabular-nums ${head.amountStr.startsWith("(") ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                                {head.amountStr}
                              </div>
                              <Button
                                className="mt-2 h-7 px-3 text-xs"
                                onClick={() => setFixDialog({ id: head.id, kind: "DUPLICATE" })}
                              >
                                {actionLabel}
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    }

                    const r = row.item;
                    const isDup = r.kind === "DUPLICATE";
                    const isStale = r.kind === "STALE_CHECK";
                    const isMissing = r.kind === "MISSING_CATEGORY";
                    const rowKey = row.rowKey;
                    const actionLabel = isDup && String(r.details ?? "").toLowerCase().includes("matched")
                      ? "Review match"
                      : isStale
                        ? "Acknowledge"
                        : isMissing
                          ? "Choose category"
                        : "Review";

                    return (
                      <div key={rowKey} className="rounded-lg border border-border bg-card p-3">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={!!selectedIds[rowKey]}
                            onChange={() => toggleRow(rowKey)}
                            aria-label={`Select row: ${r.payee || "Unknown payee"}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-semibold text-foreground">{r.payee || "Untitled payee"}</span>
                              <span
                                className={`${chip} ${
                                  isDup
                                    ? "border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg"
                                    : isStale
                                      ? "border-bb-status-info-border bg-bb-status-info-bg text-bb-status-info-fg"
                                      : isMissing
                                        ? "border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg"
                                        : "border-border bg-muted text-muted-foreground"
                                }`}
                              >
                                {isDup ? "Duplicate" : isStale ? "Stale check" : isMissing ? "Missing category" : "Issue"}
                              </span>
                              <span className={`${chip} border-border bg-card text-muted-foreground`}>
                                {r.status === "RESOLVED" ? "Resolved" : "Open"}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {r.details} · {r.date || "No date"} · {r.methodDisplay || "No method"}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className={`text-sm font-semibold tabular-nums ${r.amountStr.startsWith("(") ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                              {r.amountStr}
                            </div>
                            <Button
                              className="mt-2 h-7 px-3 text-xs"
                              onClick={() => setFixDialog({ id: r.id, kind: isDup ? "DUPLICATE" : isMissing ? "MISSING_CATEGORY" : "STALE_CHECK" })}
                            >
                              {actionLabel}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {(issuesQ.hasNextPage || issuesQ.isFetchingNextPage) && !issuesQ.isLoading && !issuesQ.isError ? (
                    <div className="pt-2 text-center">
                      <Button
                        variant="outline"
                        className="h-8 px-3 text-xs"
                        onClick={() => void issuesQ.fetchNextPage()}
                        disabled={issuesQ.isFetchingNextPage}
                      >
                        {issuesQ.isFetchingNextPage ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Loading…
                          </span>
                        ) : (
                          "Load more"
                        )}
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <AutoFixIssuesDialog
        open={autoFixDialogOpen}
        onOpenChange={setAutoFixDialogOpen}
        businessId={selectedBusinessId ?? ""}
        accountId={selectedAccountId ?? ""}
        issueIds={selectedIssueBackendIds}
        onDidApply={refreshIssuesAfterMutation}
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
        issues={openIssues as any}
        rowsById={Object.fromEntries(
          loadedApiIssues.map((it) => {
            const amt = toBigIntSafe(it.entry_amount_cents);
            return [
              it.entry_id,
              {
                id: it.entry_id,
                date: it.entry_date ?? "",
                ref: extractEntryRef({ memo: it.entry_memo }),
                payee: it.entry_payee ?? "",
                amountStr: it.entry_amount_cents != null ? formatUsdFromCents(amt) : "—",
                methodDisplay: titleCase((it.entry_method ?? "").toString()),
                category: it.entry_category_name ?? "",
                categoryId: it.entry_category_id ?? null,
                status: statusLabel((it.entry_status ?? "EXPECTED").toString()),
                rawStatus: (it.entry_status ?? "EXPECTED").toString().trim().toUpperCase(),
              },
            ];
          })
        )}
        categories={categoryRows.map((c) => ({ id: c.id, name: c.name }))}
        onDidMutate={refreshIssuesAfterMutation}
      />
    </div>
  );
}
