"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
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

  const [filterIssueType, setFilterIssueType] = useState<"ALL" | "DUPLICATE" | "STALE_CHECK">("ALL");
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
            includeMissingCategory: false,
            dryRun: false,
          }),
        }
      );

      // Targeted invalidation only
      void qc.invalidateQueries({
        queryKey: ["entryIssues", selectedBusinessId, selectedAccountId],
        exact: false,
      });
      void qc.invalidateQueries({
        queryKey: issueCountKey(selectedBusinessId, selectedAccountId, "OPEN"),
        exact: false,
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
    refetchOnWindowFocus: false,
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

  // Map API issues to UI rows (exclude missing category on Issues page)
  const issues = useMemo(() => {
    const apiIssues = loadedApiIssues;
    const out: IssueRow[] = [];

    for (const it of apiIssues) {
      const kind = (it.issue_type || "").toUpperCase() as IssueKind;
      if (kind === "MISSING_CATEGORY") continue; // Category Review owns it

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
          missing: false,
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
    return { openTotal, dup, stale };
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
    const dupEntryIds = new Set<string>();

    for (const r of filteredIssues) {
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
      if (kind !== "DUPLICATE" && kind !== "STALE_CHECK") continue;

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
    <div className="w-full max-w-full px-3 py-2">
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
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
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

        <FilterBar left={filterLeft} right={filterRight} />

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

        <div className="px-3 py-2 flex items-center gap-4 text-xs text-muted-foreground">
          <span>
            Loaded open: <span className="font-medium text-foreground">{kpi.openTotal}</span>
          </span>
          <span>
            Loaded duplicates: <span className="font-medium text-foreground">{kpi.dup}</span>
          </span>
          <span>
            Loaded stale: <span className="font-medium text-foreground">{kpi.stale}</span>
          </span>

          {scanErr ? <span className="text-bb-status-danger-fg ml-2">{scanErr}</span> : null}
        </div>
      </div>

      {selectedBusinessId && (accountsQ.data ?? []).length > 0 ? (
        <div className="flex-1 min-h-0 min-w-0 overflow-hidden rounded-lg border bg-card">
          <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
            <table className="w-full table-fixed border-collapse">
              <colgroup>
                <col style={{ width: 36 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 120 }} />
                <col />
                <col style={{ width: 110 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 120 }} />
              </colgroup>

              <thead className="sticky top-0 z-10 bg-muted/50 border-b border-border">
                <tr className="h-[28px]">
                  <th className="px-2 text-center text-xs font-medium text-muted-foreground">
                    <input
                      type="checkbox"
                      className={checkboxClass}
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="px-2 text-left text-xs font-medium text-muted-foreground">TYPE</th>
                  <th className="px-2 text-left text-xs font-medium text-muted-foreground">PAYEE</th>
                  <th className="px-2 text-right text-xs font-medium text-muted-foreground">AMOUNT</th>
                  <th className="px-2 text-left text-xs font-medium text-muted-foreground">DETAILS</th>
                  <th className="px-2 text-right text-xs font-medium text-muted-foreground">SEVERITY</th>
                  <th className="px-2 text-right text-xs font-medium text-muted-foreground">STATUS</th>
                  <th className="px-2 text-right text-xs font-medium text-muted-foreground">ACTIONS</th>
                </tr>
              </thead>

              <tbody>
                {issuesQ.isLoading ? (
                  <>
                    {Array.from({ length: 10 }).map((_, i) => (
                      <tr key={`sk-${i}`} className="h-[24px] border-b border-border">
                        <td className="px-2 py-0.5">
                          <div className="h-3 w-3 rounded bg-muted animate-pulse" />
                        </td>
                        <td className="px-2 py-0.5"><div className="h-3 w-24 rounded bg-muted animate-pulse" /></td>
                        <td className="px-2 py-0.5"><div className="h-3 w-40 rounded bg-muted animate-pulse" /></td>
                        <td className="px-2 py-0.5"><div className="h-3 w-20 ml-auto rounded bg-muted animate-pulse" /></td>
                        <td className="px-2 py-0.5"><div className="h-3 w-full rounded bg-muted animate-pulse" /></td>
                        <td className="px-2 py-0.5"><div className="h-3 w-20 ml-auto rounded bg-muted animate-pulse" /></td>
                        <td className="px-2 py-0.5"><div className="h-3 w-16 ml-auto rounded bg-muted animate-pulse" /></td>
                        <td className="px-2 py-0.5"><div className="h-3 w-16 ml-auto rounded bg-muted animate-pulse" /></td>
                      </tr>
                    ))}
                  </>
                ) : issuesQ.isError ? (
                  <tr>
                    <td colSpan={8} className="p-3 text-xs text-bb-status-danger-fg" role="alert">
                      <div className="flex items-center justify-between gap-3">
                        <span>
                          Failed to load issues: {appErrorMessageOrNull(issuesQ.error) ?? "Something went wrong."}
                        </span>
                        <button
                          type="button"
                          className="text-xs text-primary hover:underline"
                          onClick={() => void issuesQ.refetch()}
                        >
                          Retry
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : renderRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-3 text-xs text-muted-foreground">
                      {lastScanAt
                        ? `No open issues. Last scan: ${formatScanLabel(lastScanAt)}.`
                        : "No issues yet. Run Scan to generate issues."}
                    </td>
                  </tr>
                ) : null}

                {renderRows.map((row) => {
                  const pill =
                    "inline-flex items-center justify-center h-5 rounded-full border px-2 text-[11px] font-semibold leading-none";
                  const severityPill = pill + " border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg";
                  const statusPill = pill + " border-border bg-card text-foreground";

                  if (row.rowType === "GROUP") {
                    const g = row;
                    const head = g.head;

                    const typeLabel = `Duplicate (${g.count})`;
                    const severityLabel = "Warning";
                    const statusLabel = head.status === "RESOLVED" ? "Resolved" : "Open";

                    const isExpanded = !!expandedGroups[g.groupKey];
                    const actionLabel = String(head.details ?? "").toLowerCase().includes("matched")
                      ? "Review match"
                      : "Review";

                    return (
                      <tr key={`group|${g.groupKey}`} className="h-[24px] border-b border-border">
                        <td className="px-2 py-0.5 text-center">
                          <input
                            type="checkbox"
                            className={checkboxClass}
                            checked={g.members.every((m) => !!selectedIds[`${m.id}|${m.kind}`])}
                            onChange={() => toggleGroupSelection(g.groupKey, g.members)}
                            aria-label={`Select group: ${head.payee || "Unknown payee"} (${g.count} entries)`}
                          />
                        </td>

                        <td className="px-2 py-0.5 align-middle">
                          <div className="flex items-center gap-1 whitespace-nowrap">
                            <button
                              type="button"
                              className="h-5 w-5 rounded hover:bg-muted inline-flex items-center justify-center shrink-0"
                              onClick={() => toggleGroup(g.groupKey)}
                              aria-label={isExpanded ? "Collapse group" : "Expand group"}
                              title={isExpanded ? "Collapse" : "Expand"}
                            >
                              <span className="text-xs">{isExpanded ? "▾" : "▸"}</span>
                            </button>

                            <span className={pill + " border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg"}>{typeLabel}</span>

                            {g.hasStale ? (
                              <span className={pill + " border-bb-status-info-border bg-bb-status-info-bg text-bb-status-info-fg"}>Stale</span>
                            ) : null}
                          </div>
                        </td>

                        <td className="px-2 py-0.5 text-xs font-medium text-foreground truncate">{head.payee || "—"}</td>

                        <td className="px-2 py-0.5 text-xs text-right tabular-nums">
                          <span className={head.amountStr.startsWith("(") ? "text-bb-amount-negative" : "text-bb-amount-neutral"}>
                            {head.amountStr}
                          </span>
                        </td>

                        <td className="px-2 py-0.5 text-xs text-foreground truncate">
                          {head.details} • {g.count} entries • {head.date} • {head.methodDisplay || "—"}
                        </td>

                        <td className="px-2 py-0.5 text-right">
                          <span className={severityPill}>{severityLabel}</span>
                        </td>

                        <td className="px-2 py-0.5 text-right">
                          <span className={statusPill}>{statusLabel}</span>
                        </td>

                        <td className="px-2 py-0.5">
                          <div className="flex items-center justify-end">
                            <Button
                              className="h-6 px-4 text-xs min-w-[72px]"
                              onClick={() => {
                                setFixDialog({ id: head.id, kind: "DUPLICATE" });
                              }}
                            >
                              {actionLabel}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  const r = row.item;
                  const isDup = r.kind === "DUPLICATE";
                  const isStale = r.kind === "STALE_CHECK";
                  const typeLabel = isDup ? "Duplicate" : isStale ? "Stale check" : "Issue";
                  const severityLabel = "Warning";
                  const statusLabel = r.status === "RESOLVED" ? "Resolved" : "Open";
                  const rowKey = row.rowKey;
                  const actionLabel = isDup && String(r.details ?? "").toLowerCase().includes("matched")
                    ? "Review match"
                    : "Review";

                  return (
                    <tr key={rowKey} className="h-[24px] border-b border-border">
                      <td className="px-2 py-0.5 text-center">
                        <input
                          type="checkbox"
                          className={checkboxClass}
                          checked={!!selectedIds[rowKey]}
                          onChange={() => toggleRow(rowKey)}
                          aria-label={`Select row: ${r.payee || "Unknown payee"} (${typeLabel})`}
                        />
                      </td>

                      <td className={"px-2 py-0.5 align-middle " + (row.isChild ? "pl-8" : "")}>
                        <span
                          className={
                            pill +
                            " " +
                            (isDup
                              ? "border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg"
                              : isStale
                                ? "border-bb-status-info-border bg-bb-status-info-bg text-bb-status-info-fg"
                                : "border-border bg-card text-foreground")
                          }
                        >
                          {typeLabel}
                        </span>
                      </td>

                      <td className="px-2 py-0.5 text-xs font-medium text-foreground truncate">{r.payee || "—"}</td>

                      <td className="px-2 py-0.5 text-xs text-right tabular-nums">
                        <span className={r.amountStr.startsWith("(") ? "text-bb-amount-negative" : "text-bb-amount-neutral"}>
                          {r.amountStr}
                        </span>
                      </td>

                      <td className="px-2 py-0.5 text-xs text-foreground truncate">
                        {r.details} • {r.date} • {r.methodDisplay || "—"}
                      </td>

                      <td className="px-2 py-0.5 text-right">
                        <span className={severityPill}>{severityLabel}</span>
                      </td>

                      <td className="px-2 py-0.5 text-right">
                        <span className={statusPill}>{statusLabel}</span>
                      </td>

                      <td className="px-2 py-0.5">
                        <div className="flex items-center justify-end">
                          <Button
                            className="h-6 px-4 text-xs min-w-[72px]"
                            onClick={() => {
                              setFixDialog({ id: r.id, kind: isDup ? "DUPLICATE" : "STALE_CHECK" });
                            }}
                          >
                            {actionLabel}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {(issuesQ.hasNextPage || issuesQ.isFetchingNextPage) && !issuesQ.isLoading && !issuesQ.isError ? (
                  <tr>
                    <td colSpan={8} className="p-3 text-center">
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
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <AutoFixIssuesDialog
        open={autoFixDialogOpen}
        onOpenChange={setAutoFixDialogOpen}
        businessId={selectedBusinessId ?? ""}
        accountId={selectedAccountId ?? ""}
        issueIds={selectedIssueBackendIds}
        onDidApply={async () => {
          clearSelection();
          if (selectedBusinessId && selectedAccountId) {
            await Promise.all([
              qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false }),
              qc.invalidateQueries({ queryKey: issueCountKey(selectedBusinessId, selectedAccountId, "OPEN"), exact: false }),
              qc.invalidateQueries({ queryKey: ["entries", selectedBusinessId, selectedAccountId], exact: false }),
            ]);
          }
        }}
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
        onDidMutate={() => {
          clearSelection();
          if (selectedBusinessId && selectedAccountId) {
            void qc.invalidateQueries({ queryKey: ["entryIssues", selectedBusinessId, selectedAccountId], exact: false });
            void qc.invalidateQueries({ queryKey: issueCountKey(selectedBusinessId, selectedAccountId, "OPEN"), exact: false });
            void qc.invalidateQueries({ queryKey: ["entries", selectedBusinessId, selectedAccountId], exact: false });
          }
        }}
      />
    </div>
  );
}
