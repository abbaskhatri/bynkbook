"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser, fetchAuthSession } from "aws-amplify/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useEntries } from "@/lib/queries/useEntries";

import { updateEntry, type Entry } from "@/lib/api/entries";

import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/primitives/FilterBar";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { FixIssueDialog } from "@/components/ledger/fix-issue-dialog";

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

const ZERO = BigInt(0);

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

  const dollars = Number(abs / BigInt(100));
  const centsPart = Number(abs % BigInt(100));
  const value = dollars + centsPart / 100;

  const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const s = fmt.format(value);

  return neg ? `(${s})` : s;
}

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

  // Display fields (joined from entries)
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

export default function IssuesPageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const containerStyle = { height: "calc(100vh - 56px - 48px)" as const };

  // ================================
  // Auth
  // ================================
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

  const selectedAccountId = useMemo(() => {
    const list = accountsQ.data ?? [];
    if (accountIdFromUrl) return accountIdFromUrl;
    return list.find((a) => !a.archived_at)?.id ?? "";
  }, [accountsQ.data, accountIdFromUrl]);

  const selectedAccount = useMemo(() => {
    const list = accountsQ.data ?? [];
    return list.find((a) => a.id === selectedAccountId) ?? null;
  }, [accountsQ.data, selectedAccountId]);

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
  // Stage B background refresh (non-blocking)
  // Rule: Issues page loads from GET /issues immediately.
  // Then triggers POST /issues/scan only if last scan > 2 minutes ago (throttle).
  // ================================
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

  const [scanBusy, setScanBusy] = useState(false);

  function shouldRunScan(iso: string | null) {
    if (!iso) return true;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return true;
    return Date.now() - t > 15 * 60 * 1000; // 15 minutes
  }

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
        const text = await res.text().catch(() => "");
        throw new Error(`Scan failed: ${res.status} ${text}`.trim());
      }

      // Targeted invalidation only
      void qc.invalidateQueries({
        queryKey: ["entryIssues", selectedBusinessId, selectedAccountId],
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
      setScanErr(e?.message || "Scan failed");
    } finally {
      setScanBusy(false);
    }
  }

  async function runBackgroundScan() {
    if (scanBusy) return;
    if (!selectedBusinessId || !selectedAccountId) return;

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
        // Silent failure (no blocking/no toast). We keep the Issues list usable.
        // Still stop the busy indicator.
        return;
      }

      // Targeted invalidation only (no storms)
      void qc.invalidateQueries({
        queryKey: ["entryIssues", selectedBusinessId, selectedAccountId],
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
    } finally {
      setScanBusy(false);
    }
  }

  // Trigger background scan after initial render, but only when stale (>2 minutes).
  // IMPORTANT: Do not block initial GET /issues rendering.
  useEffect(() => {
    if (!authReady) return;
    if (!selectedBusinessId || !selectedAccountId) return;
    if (!scanKey) return;
    if (!shouldRunScan(lastScanAt)) return;

    const raf = requestAnimationFrame(() => {
      void runBackgroundScan();
    });
    return () => cancelAnimationFrame(raf);
  }, [authReady, selectedBusinessId, selectedAccountId, scanKey, lastScanAt]);

  // ================================
  // Entries (for display/join)
  // ================================
  const entriesQ = useEntries({
    businessId: selectedBusinessId,
    accountId: selectedAccountId,
    limit: 500,
    includeDeleted: false,
  });

  const entries = useMemo(() => (entriesQ.data ?? []) as Entry[], [entriesQ.data]);

  const entryById = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const e of entries) m.set(e.id, e);
    return m;
  }, [entries]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      const c = (e.memo || "").trim();
      if (c && c !== (selectedAccount?.name ?? "")) set.add(c);
    }
    return Array.from(set);
  }, [entries, selectedAccount?.name]);

  // ================================
  // Stage B issues query
  // ================================
  const issuesQ = useQuery({
    queryKey: ["entryIssues", selectedBusinessId, selectedAccountId, filterStatus],
    enabled: !!selectedBusinessId && !!selectedAccountId && authReady,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const session = await fetchAuthSession();
      const token = session.tokens?.accessToken?.toString();
      if (!token) throw new Error("Missing access token");

      const base =
        process.env.NEXT_PUBLIC_API_URL ||
        process.env.NEXT_PUBLIC_API_BASE_URL ||
        process.env.NEXT_PUBLIC_API_ENDPOINT ||
        "";

      if (!base) throw new Error("Missing API base URL (set NEXT_PUBLIC_API_URL)");

      const statusParam = filterStatus === "ALL" ? "ALL" : "OPEN";
      const url = `${base}/v1/businesses/${selectedBusinessId}/accounts/${selectedAccountId}/issues?status=${statusParam}`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Issues fetch failed: ${res.status} ${text}`);
      }

      return (await res.json()) as {
        ok: boolean;
        status: string;
        issues: Array<{
          entry_id: string;
          issue_type: string;
          status: string;
          severity: string;
          group_key: string | null;
          details: string;
          detected_at: string;
        }>;
      };
    },
  });

  // Map API issues to UI rows (exclude missing category on Issues page)
  const issues = useMemo(() => {
    const apiIssues = issuesQ.data?.issues ?? [];
    const out: IssueRow[] = [];

    for (const it of apiIssues) {
      const kind = (it.issue_type || "").toUpperCase() as IssueKind;
      if (kind === "MISSING_CATEGORY") continue; // Category Review owns it

      const entryId = it.entry_id;
      const e = entryById.get(entryId);

      const rawMethod = (e?.method ?? "").toString();
      const amt = toBigIntSafe(e?.amount_cents);
      const amountCents = amt.toString();
      const amountStr = e ? formatUsdFromCents(amt) : "—";

      out.push({
        id: entryId,
        kind,
        status: (it.status || "OPEN").toUpperCase() === "RESOLVED" ? "RESOLVED" : "OPEN",
        groupKey: it.group_key ?? null,

        date: e?.date ?? "",
        payee: e?.payee ?? "—",
        amountStr,
        amountCents,
        methodDisplay: titleCase(rawMethod),
        rawMethod,
        category: (e?.memo ?? "") || "",
        details: it.details || "",
        flags: {
          dup: kind === "DUPLICATE",
          stale: kind === "STALE_CHECK",
          missing: false,
        },
      });
    }

    // stable sort by date desc
    out.sort((a, b) => {
      if (a.date === b.date) return a.kind.localeCompare(b.kind);
      return a.date < b.date ? 1 : -1;
    });

    return out;
  }, [issuesQ.data, entryById]);

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
    "h-4 w-4 rounded border border-slate-300 bg-white checked:bg-slate-900 checked:border-slate-900";
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  function clearSelection() {
    setSelectedIds({});
    setBulkMsg(null);
  }

  function runBulkAction(label: string) {
    setBulkMsg(`${label} (not connected yet)`);
    setTimeout(() => setBulkMsg(null), 2200);
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
    staleFiltered.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));

    const groupsSorted: GroupRow[] = Array.from(dupGroups.entries())
      .map(([groupKey, members]) => {
        const sorted = [...members].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
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
      })
      .sort((a, b) => (a.head.date === b.head.date ? 0 : a.head.date < b.head.date ? 1 : -1));

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
  const [fixDialog, setFixDialog] = useState<{
    id: string;
    kind: "DUPLICATE" | "STALE_CHECK";
    flags: { dup: boolean; stale: boolean; missing: boolean };
    entry: { id: string; date: string; payee: string; amountStr: string; methodDisplay: string; category: string };
  } | null>(null);

  // kept (category quick fix on Issues page is not used anymore, but update mutation remains harmless)
  const updateMut = useMutation({
    mutationFn: async (vars: { entryId: string; memo: string | null }) => {
      if (!selectedBusinessId || !selectedAccountId) throw new Error("Missing business/account");
      return updateEntry({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        entryId: vars.entryId,
        updates: ({ memo: vars.memo } as any),
      });
    },
    onSuccess: async () => {
      void qc.invalidateQueries({ queryKey: ["entries", selectedBusinessId, selectedAccountId] });
    },
  });

  const accountCapsuleEl = (
    <div className="h-6 px-1.5 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center">
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
            <span className="text-xs text-slate-600 whitespace-nowrap">
              Selected: <span className="font-medium text-slate-900">{selectedCount}</span>
            </span>

            <Button
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => runBulkAction("Mark legitimate")}
            >
              Mark legitimate
            </Button>

            <Button
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={() => runBulkAction("Acknowledge stale")}
            >
              Acknowledge stale
            </Button>

            <Button variant="outline" className="h-7 px-2 text-xs" onClick={clearSelection}>
              Clear
            </Button>

            {bulkMsg ? <div className="text-xs text-slate-600 whitespace-nowrap">{bulkMsg}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );

  const filterRight = scanBusy ? (
    <div className="text-xs text-slate-500 pr-3 whitespace-nowrap" role="status" aria-live="polite">
      Updating issues…
    </div>
  ) : null;

  if (!authReady) return null;

  return (
    <div className="flex flex-col gap-2 overflow-hidden" style={containerStyle}>
      {/* Unified header + filters container (match Ledger) */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Issues"
            afterTitle={accountCapsuleEl}
            right={
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-600 whitespace-nowrap">
                  Last scan: <span className="font-medium text-slate-900">{formatScanLabel(lastScanAt)}</span>
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

        <div className="mt-2 h-px bg-slate-200" />

        <FilterBar left={filterLeft} right={filterRight} />

        <div className="h-px bg-slate-200" />

        <div className="px-3 py-2 flex items-center gap-4 text-xs text-slate-600">
          <span>
            Open: <span className="font-medium text-slate-900">{kpi.openTotal}</span>
          </span>
          <span>
            Duplicates: <span className="font-medium text-slate-900">{kpi.dup}</span>
          </span>
          <span>
            Stale: <span className="font-medium text-slate-900">{kpi.stale}</span>
          </span>

          {scanErr ? <span className="text-red-600 ml-2">{scanErr}</span> : null}
        </div>
      </div>

      <div className="flex-1 min-h-0 min-w-0 overflow-hidden rounded-lg border bg-white">
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

            <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
              <tr className="h-[28px]">
                <th className="px-2 text-center text-xs font-medium text-slate-600">
                  <input
                    type="checkbox"
                    className={checkboxClass}
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-2 text-left text-xs font-medium text-slate-600">TYPE</th>
                <th className="px-2 text-left text-xs font-medium text-slate-600">PAYEE</th>
                <th className="px-2 text-right text-xs font-medium text-slate-600">AMOUNT</th>
                <th className="px-2 text-left text-xs font-medium text-slate-600">DETAILS</th>
                <th className="px-2 text-right text-xs font-medium text-slate-600">SEVERITY</th>
                <th className="px-2 text-right text-xs font-medium text-slate-600">STATUS</th>
                <th className="px-2 text-right text-xs font-medium text-slate-600">ACTIONS</th>
              </tr>
            </thead>

            <tbody>
              {issuesQ.isError ? (
                <tr>
                  <td colSpan={8} className="p-3 text-xs text-red-600" role="alert">
                    Failed to load issues: {(issuesQ.error as any)?.message || "Unknown error"}
                  </td>
                </tr>
              ) : renderRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-3 text-xs text-slate-500">
                    {lastScanAt
                      ? `No open issues. Last scan: ${formatScanLabel(lastScanAt)}.`
                      : "No issues yet. Run Scan to generate issues."}
                  </td>
                </tr>
              ) : null}

              {renderRows.map((row) => {
                const pill =
                  "inline-flex items-center justify-center h-5 rounded-full border px-2 text-[11px] font-semibold leading-none";
                const severityPill = pill + " border-yellow-200 bg-yellow-50 text-yellow-800";
                const statusPill = pill + " border-slate-200 bg-white text-slate-700";

                if (row.rowType === "GROUP") {
                  const g = row;
                  const head = g.head;

                  const typeLabel = `Duplicate (${g.count})`;
                  const severityLabel = "Warning";
                  const statusLabel = head.status === "RESOLVED" ? "Resolved" : "Open";

                  const isExpanded = !!expandedGroups[g.groupKey];

                  return (
                    <tr key={`group|${g.groupKey}`} className="h-[24px] border-b border-slate-200">
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
                            className="h-5 w-5 rounded hover:bg-slate-100 inline-flex items-center justify-center shrink-0"
                            onClick={() => toggleGroup(g.groupKey)}
                            aria-label={isExpanded ? "Collapse group" : "Expand group"}
                            title={isExpanded ? "Collapse" : "Expand"}
                          >
                            <span className="text-xs">{isExpanded ? "▾" : "▸"}</span>
                          </button>

                          <span className={pill + " border-amber-200 bg-amber-50 text-amber-800"}>{typeLabel}</span>

                          {g.hasStale ? (
                            <span className={pill + " border-sky-200 bg-sky-50 text-sky-800"}>Stale</span>
                          ) : null}
                        </div>
                      </td>

                      <td className="px-2 py-0.5 text-xs font-medium text-slate-900 truncate">{head.payee || "—"}</td>

                      <td className="px-2 py-0.5 text-xs text-right tabular-nums">
                        <span className={head.amountStr.startsWith("(") ? "text-red-600" : "text-slate-900"}>
                          {head.amountStr}
                        </span>
                      </td>

                      <td className="px-2 py-0.5 text-xs text-slate-700 truncate">
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
                              setFixDialog({
                                id: head.id,
                                kind: "DUPLICATE",
                                flags: { dup: true, stale: false, missing: false },
                                entry: {
                                  id: head.id,
                                  date: head.date,
                                  payee: head.payee,
                                  amountStr: head.amountStr,
                                  methodDisplay: head.methodDisplay,
                                  category: head.category || "",
                                },
                              });
                            }}
                          >
                            Fix
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

                return (
                  <tr key={rowKey} className="h-[24px] border-b border-slate-200">
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
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : isStale
                              ? "border-sky-200 bg-sky-50 text-sky-800"
                              : "border-slate-200 bg-white text-slate-800")
                        }
                      >
                        {typeLabel}
                      </span>
                    </td>

                    <td className="px-2 py-0.5 text-xs font-medium text-slate-900 truncate">{r.payee || "—"}</td>

                    <td className="px-2 py-0.5 text-xs text-right tabular-nums">
                      <span className={r.amountStr.startsWith("(") ? "text-red-600" : "text-slate-900"}>
                        {r.amountStr}
                      </span>
                    </td>

                    <td className="px-2 py-0.5 text-xs text-slate-700 truncate">
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
                            setFixDialog({
                              id: r.id,
                              kind: isDup ? "DUPLICATE" : "STALE_CHECK",
                              flags: { dup: isDup, stale: isStale, missing: false },
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
                        >
                          Fix
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <FixIssueDialog
        open={!!fixDialog}
        onOpenChange={(open) => {
          if (!open) setFixDialog(null);
        }}
        entry={fixDialog?.entry ?? null}
        kind={fixDialog?.kind ?? null}
        flags={fixDialog?.flags ?? null}
        categoryOptions={categoryOptions}
      />
    </div>
  );
}
