"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
// Auth is handled by AppShell

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useEntries } from "@/lib/queries/useEntries";
import { apiFetch } from "@/lib/api/client";
import { listCategories } from "@/lib/api/categories";

import { PlaidConnectButton } from "@/components/plaid/PlaidConnectButton";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { FilterBar } from "@/components/primitives/FilterBar";
import { StatusChip } from "@/components/primitives/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadPanel } from "@/components/uploads/UploadPanel";
import { UploadsList } from "@/components/uploads/UploadsList";
import { AppDialog } from "@/components/primitives/AppDialog";

import { InlineBanner } from "@/components/app/inline-banner";
import { EmptyStateCard } from "@/components/app/empty-state";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";

import { plaidStatus, plaidSync } from "@/lib/api/plaid";
import { listBankTransactions, createEntryFromBankTransaction } from "@/lib/api/bankTransactions";
import { listMatches, createMatch, createMatchBatch, unmatchBankTransaction, markEntryAdjustment } from "@/lib/api/matches";
import { voidMatchGroup } from "@/lib/api/match-groups";
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

import { GitMerge, RefreshCw, Download, Sparkles, AlertCircle, Wrench, Undo2, Plus, ClipboardList, RotateCcw, FileText } from "lucide-react";
import { AutoReconcileDialog } from "@/components/reconcile/auto-reconcile-dialog";

function TinySpinner() {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border border-slate-400 border-t-transparent" />;
}

function getApiBaseFromEnv(): string {
  const v =
    (process.env.NEXT_PUBLIC_API_BASE_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.NEXT_PUBLIC_API_BASE ||
      "") as string;
  return String(v || "").trim();
}

function safeHost(u: string): string {
  const s = String(u || "").trim();
  if (!s) return "";
  try {
    return new URL(s).host;
  } catch {
    // allow raw host strings
    return s.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}

function EnvBadge({ label, tooltip }: { label: "DEV" | "PROD"; tooltip: string }) {
  const cls =
    label === "PROD"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : "bg-amber-50 text-amber-800 border-amber-200";

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center h-6 px-2 rounded-full border text-[11px] font-semibold tracking-wide select-none ${cls}`}
    >
      {label}
    </span>
  );
}

function toBigIntSafe(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  } catch { }
  return 0n;
}

function absBig(n: bigint) {
  return n < 0n ? -n : n;
}

function formatUsdFromCents(cents: bigint) {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const dollars = abs / 100n;
  const pennies = abs % 100n;
  const withCommas = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const core = `${withCommas}.${pennies.toString().padStart(2, "0")}`;
  return neg ? `(${core})` : core;
}

function ymdToTime(ymd: string): number {
  try {
    return new Date(`${ymd}T00:00:00Z`).getTime();
  } catch {
    return 0;
  }
}

function isoToYmd(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function normalizeDesc(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(des|desc|id|indn|trn|conf#|conf)\b/g, " ")
    .replace(/[0-9]/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s: string): Set<string> {
  const t = normalizeDesc(s);
  const parts = t.split(" ").filter(Boolean);
  return new Set(parts.filter((p) => p.length >= 3));
}

function tokenOverlap(a: string, b: string): number {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit;
}

export default function ReconcilePageClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const qc = useQueryClient();

  // ENV badge + API host tooltip (prevents “wrong backend” confusion)
  const apiBase = useMemo(() => getApiBaseFromEnv(), []);
  const apiHost = useMemo(() => safeHost(apiBase), [apiBase]);

  const envLabel = useMemo<"DEV" | "PROD">(() => {
    // Stable domains
    if (apiHost === "api.bynkbook.com") return "PROD";
    if (apiHost === "api-dev.bynkbook.com") return "DEV";

    // Known execute-api ids (your current stacks)
    if (apiHost.includes("actwy6st05")) return "PROD";
    if (apiHost.includes("1ozvddx28a")) return "DEV";
    if (apiHost.includes("lmvoixj337")) return "DEV";

    // If it’s an execute-api host and we don't recognize it, treat as DEV (safer)
    if (apiHost.includes("execute-api")) return "DEV";
    return "DEV";
  }, [apiHost]);

  const envTooltip = useMemo(() => {
    return `ENV: ${envLabel}\nAPI host: ${apiHost || "(unset)"}\nAPI base: ${apiBase || "(unset)"}`;
  }, [envLabel, apiHost, apiBase]);

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
  const CLOSED_PERIOD_MSG = "This period is closed. Reopen period to modify.";

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

  function isClosedPeriodError(e: any, msg: string | null): boolean {
    if (msg === CLOSED_PERIOD_MSG) return true;

    const code =
      String(e?.code ?? e?.payload?.code ?? e?.data?.code ?? e?.response?.data?.code ?? "").toUpperCase();

    if (code === "CLOSED_PERIOD") return true;

    const status =
      Number(e?.status ?? e?.statusCode ?? e?.response?.status ?? e?.payload?.status ?? NaN);

    if (status === 409 && msg === CLOSED_PERIOD_MSG) return true;

    return false;
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

  // -------------------------
  // Phase 6A: Permission guardrails (deny-by-default)
  // -------------------------
  const WRITE_ALLOWLIST = new Set(["OWNER", "ADMIN", "BOOKKEEPER", "ACCOUNTANT"]);
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

  const selectedAccountId = useMemo(() => {
    const list = accountsQ.data ?? [];
    if (accountIdFromUrl && !String(accountIdFromUrl).startsWith("temp_")) return accountIdFromUrl;

    // Never select temp_ accounts (optimistic UI ids) in reconcile.
    const real = list.find((a: any) => !a.archived_at && !String(a.id ?? "").startsWith("temp_"));
    return real?.id ?? "";
  }, [accountsQ.data, accountIdFromUrl]);

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
  const [rolePolicyLoaded, setRolePolicyLoaded] = useState(false);

  useEffect(() => {
    if (!selectedBusinessId) return;

    let cancelled = false;
    (async () => {
      try {
        const res: any = await getRolePolicies(selectedBusinessId);
        if (!cancelled) {
          setRolePolicyRows(res?.items ?? []);
          setRolePolicyLoaded(true);
        }
      } catch {
        // If we cannot load policies, do not block UI (fallback to allowlist only)
        if (!cancelled) {
          setRolePolicyRows([]);
          setRolePolicyLoaded(false);
        }
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

  // -------------------------
  // Tabs (Phase 4D polish)
  // -------------------------
  const [expectedTab, setExpectedTab] = useState<"expected" | "matched">("expected");
  const [bankTab, setBankTab] = useState<"unmatched" | "matched">("unmatched");

  // B2: Bulk create entries from selected bank txns (unmatched tab)
  const [selectedBankTxnIds, setSelectedBankTxnIds] = useState<Set<string>>(new Set());
  const [bulkCreateAutoMatch, setBulkCreateAutoMatch] = useState(false);
  const [bulkCreateResultByBankTxnId, setBulkCreateResultByBankTxnId] = useState<Record<string, any>>({});
  const [bulkCreateBusy, setBulkCreateBusy] = useState(false);

  // -------------------------
  // Data queries
  // -------------------------
  const entriesQ = useEntries({ businessId: selectedBusinessId, accountId: selectedAccountId, limit: 200 });

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

  // Plaid status + sync UI
  const [plaidLoading, setPlaidLoading] = useState(false);
  const [plaidSyncing, setPlaidSyncing] = useState(false);
  const [plaid, setPlaid] = useState<any>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);

  // Dialogs
  const [openUpload, setOpenUpload] = useState(false);
  const [openStatementHistory, setOpenStatementHistory] = useState(false);

  // Phase 5D: Export hub (read-only)
  const [openExportHub, setOpenExportHub] = useState(false);

  // Auto-reconcile v1 (suggestion-only)
  const [openAutoReconcile, setOpenAutoReconcile] = useState(false);

  // History Hub (keeps headers clean)
  const [openHistoryHub, setOpenHistoryHub] = useState(false);

  // Phase 5C: Issues (read-only)
  const [openIssuesHub, setOpenIssuesHub] = useState(false);
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

  // Phase 5B-1: Revert (void) from audit detail (voids ALL active matches for selected bank txn)
  const [revertBusy, setRevertBusy] = useState(false);
  const [revertError, setRevertError] = useState<string | null>(null);

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

  // Hide adjusted entries locally (until we refetch entries with adjustment status)
  const [locallyAdjusted, setLocallyAdjusted] = useState<Set<string>>(() => new Set());

  // Load Plaid status
  useEffect(() => {
    if (!selectedBusinessId) return;
    if (!selectedAccountId) return;

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

  function newestPostedDate(items: any[]): string {
    let max = "";
    for (const t of items ?? []) {
      const d = String(t?.posted_date ?? "");
      if (d && d > max) max = d;
    }
    return max;
  }

  async function refreshBankAndMatches(opts?: { preserveOnEmpty?: boolean }) {
    if (!selectedBusinessId || !selectedAccountId) return { bank: [] as any[], matches: [] as any[] };

    let bankItems: any[] = [];
    let matchItems: any[] = [];

    setBankTxLoading(true);
    try {
      const res = await listBankTransactions({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        from: from || undefined,
        to: to || undefined,
        limit: 500,
      });

      const next = res?.items ?? [];
      bankItems = next;

      setBankTx((prev) => {
        if (opts?.preserveOnEmpty && next.length === 0 && prev.length > 0) return prev;
        return next;
      });
    } catch {
      setBankTx((prev) => (opts?.preserveOnEmpty ? prev : []));
    } finally {
      setBankTxLoading(false);
    }

    setMatchesLoading(true);
    try {
      const m = await listMatches({ businessId: selectedBusinessId, accountId: selectedAccountId });
      matchItems = m?.items ?? [];
      setMatches(matchItems);
    } catch {
      setMatches([]);
    } finally {
      setMatchesLoading(false);
    }

    // Load active match groups (new model; additive only during migration)
    setMatchGroupsLoading(true);
    try {
      const mg: any = await listMatchGroups({
        businessId: selectedBusinessId,
        accountId: selectedAccountId,
        status: "all", // needed for History (includes voided groups)
      });
      setMatchGroups(mg?.items ?? []);
    } catch {
      setMatchGroups([]);
    } finally {
      setMatchGroupsLoading(false);
    }

    return { bank: bankItems, matches: matchItems };
  }

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

    const baselineCount = bankTxLenRef.current;
    const baselineNewest = newestPostedDate(bankTx);

    const schedule = [0, 1500, 3000, 6000]; // bounded backoff (max 4 pulls)
    let stopped = false;

    const tick = async (i: number) => {
      if (stopped) return;

      const { bank } = await refreshBankAndMatches({ preserveOnEmpty: true, ...(opts ?? {}) } as any);
      await entriesQ.refetch?.();

      const nextCount = Array.isArray(bank) ? bank.length : 0;
      const nextNewest = newestPostedDate(Array.isArray(bank) ? bank : []);

      // Stop early once bank list changes (count OR newest posted_date)
      if (nextCount !== baselineCount || (nextNewest && nextNewest !== baselineNewest)) {
        stopped = true;
        return;
      }

      if (i + 1 >= schedule.length) return;

      postConnectRefreshTimerRef.current = setTimeout(() => {
        void tick(i + 1);
      }, schedule[i + 1]);
    };

    // immediate tick (0ms), then backoff sequence
    void tick(0);
  }

  function refreshAllDebounced() {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(async () => {
      setRefreshBusy(true);
      try {
        await refreshBankAndMatches();
        await entriesQ.refetch?.();

        // Critical: ensure Ledger page refetches without manual refresh.
        // Ledger uses react-query cache keyed by ["entries", businessId, accountId, ...]
        if (selectedBusinessId && selectedAccountId) {
          void qc.invalidateQueries({
            predicate: (q) =>
              Array.isArray(q.queryKey) &&
              q.queryKey[0] === "entries" &&
              q.queryKey[1] === selectedBusinessId &&
              q.queryKey[2] === selectedAccountId,
          });
        }
      } finally {
        setRefreshBusy(false);
      }
    }, 150);
  }

  // Create-entry busy state per bank txn (instant UX)
  const [createEntryBusyByBankId, setCreateEntryBusyByBankId] = useState<Record<string, boolean>>({});
  const [createEntryErr, setCreateEntryErr] = useState<string | null>(null);

  // Create-entry confirmation dialog
  const [openCreateEntry, setOpenCreateEntry] = useState(false);
  const [createEntryBankTxnId, setCreateEntryBankTxnId] = useState<string | null>(null);
  const [createEntryAutoMatch, setCreateEntryAutoMatch] = useState(false);

  // Overrides
  const [createEntryMemo, setCreateEntryMemo] = useState("");
  const [createEntryMethod, setCreateEntryMethod] = useState("OTHER");
  const [createEntryCategoryId, setCreateEntryCategoryId] = useState<string>("");
  const [createEntryCategoryName, setCreateEntryCategoryName] = useState<string>("");

  // Categories (for dropdown suggestions)
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [categoryQuery, setCategoryQuery] = useState("");

  // Load categories once per business (used by create-entry dialog)
  useEffect(() => {
    if (!selectedBusinessId) return;

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
  }, [selectedBusinessId]);

  // Load bank txns + matches (single source of truth; no duplicate fetch)
  useEffect(() => {
    if (!selectedBusinessId) return;
    if (!selectedAccountId) return;

    // One targeted refresh on mount / scope change (prevents “needs manual refresh” after navigation)
    void qc.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === "entries" &&
        q.queryKey[1] === selectedBusinessId &&
        q.queryKey[2] === selectedAccountId,
    });

    void qc.invalidateQueries({ queryKey: ["categories", selectedBusinessId], exact: false });

    refreshBankAndMatches({ preserveOnEmpty: true });
  }, [selectedBusinessId, selectedAccountId, from, to]);

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
  const isAdjustedEntry = (e: any) => Boolean(e?.is_adjustment) || locallyAdjusted.has(e?.id);

  // Keep raw entries; tab-level filtering decides visibility (Expected hides Adjusted-unmatched)
  const allEntries = entriesQ.data ?? [];

  const allEntriesSorted = useMemo(() => {
    const arr = [...allEntries];
    arr.sort((a: any, b: any) => {
      const da = new Date(`${a.date}T00:00:00Z`).getTime();
      const db = new Date(`${b.date}T00:00:00Z`).getTime();
      if (da !== db) return da - db;
      return String(a.id).localeCompare(String(b.id));
    });
    return arr;
  }, [allEntries]);

  const bankTxSorted = useMemo(() => {
    const arr = [...bankTx];
    arr.sort((a: any, b: any) => {
      const da = new Date(a.posted_date).getTime();
      const db = new Date(b.posted_date).getTime();
      if (da !== db) return da - db;
      return String(a.id).localeCompare(String(b.id));
    });
    return arr;
  }, [bankTx]);

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

  // MatchGroups lookup maps (read-only for now; used in next step to flip matched state)
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
  const isActiveMatch = (x: any) => {
    if (!x) return false;
    if (x.voided_at) return false;
    if (x.voidedAt) return false;
    if (x.is_voided) return false;
    if (x.isVoided) return false;
    return true;
  };

  // Legacy helper (v1 BankMatch). Keep for CSV export + "Not in view" diagnostics only.
  function stableLegacyMatchId(x: any) {
    if (x?.id) return String(x.id);
    const bt = x?.bank_transaction_id ? String(x.bank_transaction_id) : "bt?";
    const en = x?.entry_id ? String(x.entry_id) : "e?";
    const ca = x?.created_at ? String(x.created_at) : "ca?";
    return `${bt}:${en}:${ca}`;
  }

  // Legacy v1 active matches (export-only; Reconcile UI uses MatchGroups)
  const activeMatches = useMemo(() => {
    return (matches ?? []).filter((x: any) => isActiveMatch(x));
  }, [matches, isActiveMatch]);

  // (removed legacy matches-based revert marker; MatchGroups-based version is below)

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
      if (!activeGroupByBankTxnId.has(id)) continue;
      const bankAbs = absBig(toBigIntSafe(t.amount_cents));
      if (bankAbs > 0n) m.set(id, bankAbs);
    }
    return m;
  }, [bankTxSorted, activeGroupByBankTxnId]);

  const remainingAbsByBankTxnId = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const t of bankTxSorted ?? []) {
      const id = String(t.id);
      if (!id) continue;
      const bankAbs = absBig(toBigIntSafe(t.amount_cents));
      const isMatched = activeGroupByBankTxnId.has(id);
      m.set(id, isMatched ? 0n : bankAbs);
    }
    return m;
  }, [bankTxSorted, activeGroupByBankTxnId]);

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
    return (matchGroups ?? []).filter((g: any) => String(g?.status ?? "").toUpperCase() === "ACTIVE");
  }, [matchGroups]);

  const voidedGroups = useMemo(() => {
    return (matchGroups ?? []).filter((g: any) => !!g?.voided_at);
  }, [matchGroups]);

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

  const reconAuditAll = useMemo(() => {
    const out: ReconAuditEvent[] = [];

    for (const g of matchGroups ?? []) {
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
  }, [matchGroups]);

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

  const exportActiveMatchesCsv = () => {
    if (!selectedBusinessId || !selectedAccountId) return;

    // Stable ordering: created_at ASC, then bankTxnId, then entryId
    const ordered = [...activeMatches].sort((a: any, b: any) => {
      const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
      if (ta !== tb) return ta - tb;
      const abt = String(a?.bank_transaction_id ?? "");
      const bbt = String(b?.bank_transaction_id ?? "");
      if (abt !== bbt) return abt.localeCompare(bbt);
      return String(a?.entry_id ?? "").localeCompare(String(b?.entry_id ?? ""));
    });

    const rows = ordered.map((x: any) => ({
      business_id: selectedBusinessId,
      account_id: selectedAccountId,
      match_id: stableLegacyMatchId(x),
      bank_transaction_id: String(x.bank_transaction_id ?? ""),
      entry_id: String(x.entry_id ?? ""),
      matched_amount_cents: String(x.matched_amount_cents ?? ""),
      match_type: String(x.match_type ?? ""),
      created_at: String(x.created_at ?? ""),
      created_by_user_id: String(x.created_by_user_id ?? ""),
    }));

    const headers = [
      "business_id",
      "account_id",
      "match_id",
      "bank_transaction_id",
      "entry_id",
      "matched_amount_cents",
      "match_type",
      "created_at",
      "created_by_user_id",
    ];

    downloadCsv("reconcile_active_matches.csv", toCsv(headers, rows));
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

  const matchesRowSearch = (hay: string) => {
    if (!searchQ) return true;
    return (hay ?? "").toLowerCase().includes(searchQ);
  };

  // Tabs: Expected Entries
  const entriesExpectedList = useMemo(() => {
    // Expected tab shows only: unmatched AND not adjusted
    return allEntriesSorted.filter((e: any) => {
      if (matchedEntryIdSet.has(e.id)) return false;
      if (isAdjustedEntry(e)) return false;

      // search: payee + date + amount
      const hay = `${String(e.date ?? "")} ${String(e.payee ?? "")} ${String(e.amount_cents ?? "")}`;
      return matchesRowSearch(hay);
    });
  }, [allEntriesSorted, matchedEntryIdSet, searchQ]);

  const entriesMatchedList = useMemo(() => {
    // Matched tab shows: matched (includes adjusted-if-matched)
    return allEntriesSorted.filter((e: any) => {
      if (!matchedEntryIdSet.has(e.id)) return false;

      const hay = `${String(e.date ?? "")} ${String(e.payee ?? "")} ${String(e.amount_cents ?? "")}`;
      return matchesRowSearch(hay);
    });
  }, [allEntriesSorted, matchedEntryIdSet, searchQ]);

  const expectedCount = entriesExpectedList.length;
  const matchedCount = entriesMatchedList.length;

  // Tabs: Bank Transactions
  const bankUnmatchedList = useMemo(() => {
    // FULL-match only: Unmatched tab = not in ACTIVE match group
    return bankTxSorted.filter((t: any) => {
      const hay = `${String(t.posted_date ?? "")} ${String(t.name ?? "")} ${String(t.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) return false;

      const id = String(t.id ?? "");
      if (!id) return false;
      return !activeGroupByBankTxnId.has(id);
    });
  }, [bankTxSorted, activeGroupByBankTxnId, searchQ]);

  useEffect(() => {
    setSelectedBankTxnIds(new Set());
  }, [bankTab, selectedBusinessId, selectedAccountId]);

  const bankMatchedList = useMemo(() => {
    // FULL-match only: Matched tab = in ACTIVE match group
    return bankTxSorted.filter((t: any) => {
      const hay = `${String(t.posted_date ?? "")} ${String(t.name ?? "")} ${String(t.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) return false;

      const id = String(t.id ?? "");
      if (!id) return false;
      return activeGroupByBankTxnId.has(id);
    });
  }, [bankTxSorted, activeGroupByBankTxnId, searchQ]);

  const bankUnmatchedCount = bankUnmatchedList.length;
  const bankMatchedCount = bankMatchedList.length;

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
      expectedN: entriesExpectedList.length,
      matchedN: entriesMatchedList.length,
    };
  }, [entriesExpectedList.length, entriesMatchedList.length]);

  const revertsInScope = voidedGroups.length;

  const opts = (accountsQ.data ?? [])
    .filter((a) => !a.archived_at)
    .map((a) => ({ value: a.id, label: a.name }));

  const accountCapsule = (
    <div className="h-6 px-1.5 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center">
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
    "h-7 px-2 text-xs rounded-md border border-slate-200 bg-white opacity-50 cursor-not-allowed inline-flex items-center gap-1";

  const headerRight = (
    <div className="flex items-center gap-2">
      <EnvBadge label={envLabel} tooltip={envTooltip} />
      <button
        type="button"
        className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white inline-flex items-center gap-1 hover:bg-slate-50"
        onClick={() => setOpenSnapshots(true)}
        title="Snapshots"
      >
        Snapshots
      </button>

      <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? reconcileWriteReason : null}>
        <button
          type="button"
          className={`h-7 px-2 text-xs rounded-md border border-slate-200 bg-white inline-flex items-center gap-1 ${canWriteReconcileEffective ? "hover:bg-slate-50" : "opacity-50 cursor-not-allowed"
            }`}
          onClick={() => {
            if (!canWriteReconcileEffective) return;
            setOpenExportHub(true);
          }}
          disabled={!canWriteReconcileEffective}
          title={canWriteReconcileEffective ? "Export (CSV)" : (reconcileWriteReason ?? noPermTitle)}
        >
          <Download className="h-3.5 w-3.5" /> Export
        </button>
      </HintWrap>
      <HintWrap
        disabled={!canWriteReconcileEffective}
        reason={!canWriteReconcileEffective ? (reconcileWriteReason ?? noPermTitle) : null}
      >
        <button
          type="button"
          className={`h-7 px-2 text-xs rounded-md border border-slate-200 bg-white inline-flex items-center gap-1 ${canWriteReconcileEffective ? "hover:bg-slate-50" : "opacity-50 cursor-not-allowed"
            }`}
          disabled={!canWriteReconcileEffective || bankUnmatchedList.length === 0 || entriesExpectedList.length === 0}
          title={
            !canWriteReconcileEffective
              ? (reconcileWriteReason ?? noPermTitle)
              : bankUnmatchedList.length === 0
                ? "No unmatched bank transactions"
                : entriesExpectedList.length === 0
                  ? "No expected entries"
                  : "Generate deterministic suggestions"
          }
          onClick={() => {
            if (!canWriteReconcileEffective) return;
            setOpenAutoReconcile(true);
          }}
        >
          <Sparkles className="h-3.5 w-3.5" /> Auto-reconcile
        </button>
      </HintWrap>

      <button
        type="button"
        className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white inline-flex items-center gap-1 hover:bg-slate-50"
        onClick={() => setOpenHistoryHub(true)}
        title="History"
      >
        <Download className="h-3.5 w-3.5" /> History
      </button>

      <button
        type="button"
        className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white inline-flex items-center gap-1 hover:bg-slate-50"
        onClick={() => {
          setIssuesSearch("");
          setOpenIssuesHub(true);
        }}
        title="Issues (read-only diagnostics)"
      >
        <AlertCircle className="h-3.5 w-3.5" /> <span className="font-semibold">{issuesCounts.total}</span> issues
      </button>
    </div>
  );

  const inputClass =
    "h-7 w-full px-2 py-0 text-xs leading-none bg-white border border-slate-200 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 focus-visible:ring-offset-0";

  // Plaid balance display (must be declared before differenceBar usage)
  const balanceText = useMemo(() => {
    const bal = plaid?.lastKnownBalanceCents ? toBigIntSafe(plaid.lastKnownBalanceCents) : null;
    return bal !== null ? formatUsdFromCents(bal) : "—";
  }, [plaid?.lastKnownBalanceCents]);

  const filterLeft = (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="w-[120px]">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
      </div>
      <div className="w-[120px]">
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
      </div>
      <div className="w-[220px]">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} placeholder="Search…" />
      </div>
      <button
        type="button"
        className="h-7 px-1.5 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 rounded-md"
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
    <div className="px-3 py-2">
      <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-x-6 gap-y-2 text-xs">
          <div className="leading-tight">
            <div className="text-slate-500">Remaining to reconcile</div>
            <div className="font-semibold text-slate-900 tabular-nums inline-flex items-center gap-2">
              {formatUsdFromCents(bankStateSummary.remainingAbsTotal)}
              {refreshBusy ? <TinySpinner /> : null}
            </div>
          </div>

          <div className="leading-tight">
            <div className="text-slate-500">Bank status</div>
            <div className="font-semibold text-slate-900">
              U {bankStateSummary.unmatchedN} • P {bankStateSummary.partialN} • M {bankStateSummary.matchedN}
            </div>
          </div>

          <div className="leading-tight">
            <div className="text-slate-500">Entries</div>
            <div className="font-semibold text-slate-900">
              Expected {entryStateSummary.expectedN} • Matched {entryStateSummary.matchedN}
            </div>
          </div>

          <div className="leading-tight">
            <div className="text-slate-500">Reverts</div>
            <div className="font-semibold text-slate-900">{revertsInScope}</div>
          </div>

          {plaid?.connected ? (
            <div className="leading-tight">
              <div className="text-slate-500">Current balance</div>
              <div className="font-semibold text-slate-900 tabular-nums">{balanceText}</div>
            </div>
          ) : null}

          {plaid?.connected && plaid?.lastSyncAt ? (
            <div className="leading-tight">
              <div className="text-slate-500">Last sync</div>
              <div className="font-semibold text-slate-900">{new Date(plaid.lastSyncAt).toLocaleString()}</div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  const thClass = "px-1.5 py-0.5 align-middle text-xs font-semibold uppercase tracking-wide text-slate-600 text-left";
  const tdClass = "px-1.5 py-0.5 align-middle text-xs text-slate-800";
  const trClass = "h-[24px] border-b border-slate-100";

  function EmptyState({ label }: { label: string }) {
    return (
      <div className="h-full min-h-[240px] flex items-center justify-center">
        <div className="text-center text-xs text-slate-500">
          <div className="mx-auto mb-2 h-10 w-10 rounded-full border border-slate-200 bg-white flex items-center justify-center">
            <GitMerge className="h-4 w-4 text-slate-400" />
          </div>
          {label}
        </div>
      </div>
    );
  }

  const connectedPill = (
    <span
      className={`inline-flex items-center px-2 h-5 rounded-full border text-[11px] font-medium whitespace-nowrap leading-none ${plaid?.connected ? "bg-slate-50 text-slate-700 border-slate-200" : "bg-white text-slate-500 border-slate-200"
        }`}
    >
      {plaidLoading ? "Loading…" : plaid?.connected ? "Connected" : "Not connected"}
    </span>
  );

  // Auth handled by AppShell

  return (
    <div className="flex flex-col gap-2 overflow-hidden" style={containerStyle}>
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader icon={<GitMerge className="h-4 w-4" />} title="Reconcile" afterTitle={accountCapsule} right={headerRight} />
        </div>

        <div className="mt-2 h-px bg-slate-200" />

        <div className="px-3 py-2">
          <FilterBar left={filterLeft} right={null} />
        </div>

        {(bannerMsg || mutErr) ? (
          <div className="px-3 pb-2">
            {bannerMsg ? (
              <InlineBanner title="Can’t load reconcile" message={bannerMsg} onRetry={() => router.refresh()} />
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
              secondary={{ label: "Reload", onClick: () => router.refresh() }}
            />
          </div>
        ) : null}

        {selectedBusinessId && !accountsQ.isLoading && (accountsQ.data ?? []).length === 0 ? (
          <div className="px-3 pb-2">
            <EmptyStateCard
              title="No accounts yet"
              description="Add an account to start importing and categorizing transactions."
              primary={{ label: "Add account", href: "/settings?tab=accounts" }}
              secondary={{ label: "Reload", onClick: () => router.refresh() }}
            />
          </div>
        ) : null}

        <div className="h-px bg-slate-200" />

        {differenceBar}
        {createEntryErr ? (
          <div className="px-3 pb-2">
            <div className="text-xs text-red-700">{createEntryErr}</div>
          </div>
        ) : null}

        {/* Create entry confirmation dialog */}
        <AppDialog
          open={openCreateEntry}
          onClose={() => {
            setOpenCreateEntry(false);
            setCreateEntryBankTxnId(null);
            setCreateEntryAutoMatch(false);
          }}
          title="Create entry"
          size="md"
        >
          {(() => {
            const bankId = createEntryBankTxnId ? String(createEntryBankTxnId) : "";
            const t = bankId ? bankTxSorted.find((x: any) => String(x.id) === bankId) : null;

            const amt = t ? toBigIntSafe(t.amount_cents) : 0n;
            const dateStr = t?.posted_date ? isoToYmd(String(t.posted_date)) : "—";
            const desc = (t?.name ?? "").toString().trim() || "—";

            const busy = bankId ? !!createEntryBusyByBankId[bankId] : false;

            return (
              <div className="flex flex-col max-h-[55vh]">
                <div className="flex-1 overflow-y-auto overflow-x-hidden">
                  <div className="text-xs text-slate-600">
                    This will create an entry from the selected bank transaction. Review method, category, and memo before creating.
                  </div>

                  <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-slate-500">Date</div>
                      <div className="font-semibold text-slate-900">{dateStr}</div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <div className="text-slate-500">Description</div>
                      <div className="font-semibold text-slate-900 truncate max-w-[260px]" title={desc}>
                        {desc}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <div className="text-slate-500">Amount</div>
                      <div className={`font-semibold tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-900"}`}>
                        {formatUsdFromCents(amt)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] font-semibold text-slate-600 mb-1">Method</div>
                      <select
                        className="h-8 w-full px-2 text-xs rounded-md border border-slate-200 bg-white focus:outline-none focus:border-emerald-500"
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
                      <div className="text-[11px] font-semibold text-slate-600 mb-1">Category</div>
                      {null}
                      <div className="relative overflow-visible">
                        <input
                          className="h-8 w-full px-2 text-xs rounded-md border border-slate-200 bg-white focus:outline-none focus:border-emerald-500"
                          placeholder={categoriesLoading ? "Loading categories…" : "Search categories…"}
                          value={categoryQuery || createEntryCategoryName}
                          onChange={(e) => {
                            // typing starts a new search
                            if (!categoryQuery && createEntryCategoryName) setCreateEntryCategoryName("");
                            setCategoryQuery(e.target.value);
                          }}
                        />

                        {/* Dropdown */}
                        {categoryQuery.trim() ? (
                          <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-sm">
                            {(() => {
                              const q = categoryQuery.trim().toLowerCase();
                              const base = categories ?? [];
                              if (base.length === 0) {
                                return <div className="px-2 py-2 text-xs text-slate-500">No categories loaded</div>;
                              }

                              const filtered = base
                                .filter((c: any) => {
                                  const name = String(c?.name ?? "").toLowerCase();
                                  const norm = String(c?.normalized_name ?? "").toLowerCase();
                                  return name.includes(q) || norm.includes(q);
                                })
                                .slice(0, 20);

                              if (filtered.length === 0) {
                                return <div className="px-2 py-2 text-xs text-slate-500">No matches</div>;
                              }

                              return filtered.map((c: any) => {
                                const id = String(c?.id ?? "");
                                const name = String(c?.name ?? "—");
                                return (
                                  <button
                                    key={id}
                                    type="button"
                                    className="w-full text-left px-2 py-2 hover:bg-slate-50 text-xs"
                                    onClick={() => {
                                      setCreateEntryCategoryId(id);
                                      setCreateEntryCategoryName(name);
                                      setCategoryQuery(""); // close dropdown
                                    }}
                                  >
                                    <div className="font-medium text-slate-900 truncate">{name}</div>
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        ) : null}
                      </div>

                      {createEntryCategoryName ? (
                        <div className="mt-1 text-[11px] text-slate-600">
                          Selected: <span className="font-medium">{createEntryCategoryName}</span>{" "}
                          <button
                            type="button"
                            className="ml-2 text-emerald-700 hover:text-emerald-800"
                            onClick={() => {
                              setCreateEntryCategoryId("");
                              setCreateEntryCategoryName("");
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
                    <div className="text-[11px] font-semibold text-slate-600 mb-1">Memo</div>
                    <textarea
                      className="min-h-[70px] w-full px-2 py-1 text-xs rounded-md border border-slate-200 bg-white focus:outline-none focus:border-emerald-500"
                      value={createEntryMemo}
                      onChange={(e) => setCreateEntryMemo(e.target.value)}
                    />
                  </div>

                </div>

                <div className="shrink-0 pt-3 flex items-center justify-between border-t border-slate-200 mt-3">
                  <label className="flex items-center gap-2 text-xs text-slate-700 select-none">
                    <input
                      type="checkbox"
                      checked={createEntryAutoMatch}
                      onChange={(e) => setCreateEntryAutoMatch(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Auto-match (FULL only)
                  </label>

                  <button
                    type="button"
                    className="h-8 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                    onClick={() => setOpenCreateEntry(false)}
                    disabled={busy}
                  >
                    Cancel
                  </button>

                  <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? (reconcileWriteReason ?? noPermTitle) : null}>
                    <button
                      type="button"
                      className="h-8 px-3 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 inline-flex items-center gap-2"
                      disabled={!canWriteReconcileEffective || !bankId || busy}
                      onClick={async () => {
                        if (!selectedBusinessId || !selectedAccountId) return;
                        if (!canWriteReconcileEffective) return;
                        if (!bankId) return;

                        setCreateEntryErr(null);
                        clearMutErr();
                        setCreateEntryBusyByBankId((m) => ({ ...m, [bankId]: true }));

                        try {
                          const created: any = await createEntryFromBankTransaction({
                            businessId: selectedBusinessId,
                            accountId: selectedAccountId,
                            bankTransactionId: bankId,
                            autoMatch: !!createEntryAutoMatch,
                            memo: createEntryMemo,
                            method: createEntryMethod,
                            category_id: createEntryCategoryId.trim() || "",
                          });

                          // Auto-match after create-entry is PARKED (A): do not run any match-group creation here.
                          // (We will revisit auto-match later.)

                          // Immediate refresh so matched state updates deterministically
                          await refreshBankAndMatches({ preserveOnEmpty: true });
                          await entriesQ.refetch?.();

                          clearMutErr();
                          setOpenCreateEntry(false);
                          setCreateEntryBankTxnId(null);
                        } catch (e: any) {
                          applyMutationError(e, "Can’t create entry");
                          setCreateEntryErr(null);
                        } finally {
                          setCreateEntryBusyByBankId((m) => ({ ...m, [bankId]: false }));
                        }
                      }}
                    >
                      {busy ? (
                        <>
                          <TinySpinner /> Creating…
                        </>
                      ) : (
                        "Create entry"
                      )}
                    </button>
                  </HintWrap>
                </div>
              </div>
            );
          })()}
        </AppDialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0 overflow-hidden">
        {/* Expected Entries */}
        <div className="flex flex-col min-h-0 overflow-hidden rounded-lg border bg-white">
          <div className="px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-slate-900">Expected Entries</div>
                <div className="text-xs text-slate-500">Ledger entries awaiting reconciliation</div>
              </div>
              <div className="text-xs text-slate-400">&nbsp;</div>
            </div>
          </div>

          <div className="px-3 pb-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${expectedTab === "expected" ? "border-slate-200 bg-white text-slate-900" : "border-transparent text-slate-500 hover:bg-slate-50"
                  }`}
                onClick={() => setExpectedTab("expected")}
              >
                Expected ({expectedCount})
              </button>
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${expectedTab === "matched" ? "border-slate-200 bg-white text-slate-900" : "border-transparent text-slate-500 hover:bg-slate-50"
                  }`}
                onClick={() => setExpectedTab("matched")}
              >
                Matched ({matchedCount})
              </button>
            </div>

            {bankTab === "unmatched" && selectedBankTxnIds.size > 0 ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-900">
                    {selectedBankTxnIds.size} selected
                  </span>

                  <label className="flex items-center gap-1.5 text-xs text-slate-600 select-none">
                    <input
                      type="checkbox"
                      className="h-3 w-3"
                      checked={bulkCreateAutoMatch}
                      onChange={(e) => setBulkCreateAutoMatch(e.target.checked)}
                      disabled={!canWriteReconcileEffective}
                      title={
                        !canWriteReconcileEffective
                          ? (reconcileWriteReason ?? noPermTitle)
                          : "Auto-match (FULL only)"
                      }
                    />
                    Auto-match
                  </label>
                </div>

                <button
                  type="button"
                  className="h-7 px-3 text-xs rounded-md border border-slate-200 bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={bulkCreateBusy || !canWriteReconcileEffective || selectedBusinessId == null || selectedAccountId == null}
                  title={
                    !canWriteReconcileEffective
                      ? (reconcileWriteReason ?? noPermTitle)
                      : "Create entries from selected bank transactions"
                  }
                  onClick={async () => {
                    if (!selectedBusinessId || !selectedAccountId) return;
                    if (!canWriteReconcileEffective) return;

                    clearMutErr();

                    const ids = Array.from(selectedBankTxnIds);
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
                      setBulkCreateResultByBankTxnId((m) => {
                        const next = { ...m };
                        for (const r of list) {
                          const bid = String(r?.bank_transaction_id ?? "");
                          if (!bid) continue;
                          next[bid] = r;
                        }
                        return next;
                      });

                      // One refresh only (no storms)
                      await refreshBankAndMatches({ preserveOnEmpty: true });
                      await entriesQ.refetch?.();

                      // Keep selection (user may want to retry failed), but clear ids that succeeded/skip
                      setSelectedBankTxnIds((prev) => {
                        const next = new Set(prev);
                        for (const r of list) {
                          const bid = String(r?.bank_transaction_id ?? "");
                          const st = String(r?.status ?? "");
                          if (!bid) continue;
                          if (st === "CREATED" || st === "SKIPPED") next.delete(bid);
                        }
                        return next;
                      });
                    } catch (e: any) {
                      applyMutationError(e, "Can’t create entries");
                    } finally {
                      setBulkCreateBusy(false);

                      const ids2 = Array.from(selectedBankTxnIds);
                      for (const id of ids2) clearPending(String(id));
                    }
                  }}
                >
                  <span className="inline-flex items-center gap-2">
                    {bulkCreateBusy ? <TinySpinner /> : null}
                    <span>{bulkCreateBusy ? "Creating…" : "Create entries"}</span>
                  </span>
                </button>
              </div>
            ) : null}
          </div>

          <div className="h-px bg-slate-200" />

          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
              {entriesQ.isLoading ? (
                <div className="p-3">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : (expectedTab === "expected" ? entriesExpectedList : entriesMatchedList).length === 0 ? (
                <EmptyState label={expectedTab === "expected" ? "No expected entries in this period" : "No matched entries in this period"} />
              ) : (
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: 110 }} />
                    <col />
                    <col style={{ width: 140 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 90 }} />
                  </colgroup>

                  <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                    <tr className="h-[28px]">
                      <th className={`${thClass} pl-8.5`}>DATE</th>
                      <th className={thClass}>PAYEE</th>
                      <th className={`${thClass} text-right pr-4`}>AMOUNT</th>
                      <th className={`${thClass} pl-8.5`}>STATUS</th>
                      <th className={`${thClass} text-right`}>ACTIONS</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(expectedTab === "expected" ? entriesExpectedList : entriesMatchedList).map((e: any) => {
                      const amt = toBigIntSafe(e.amount_cents);
                      const payee = (e.payee ?? "").trim();

                      const isMatched = matchedEntryIdSet.has(e.id);

                      const rowTone = isMatched ? " bg-emerald-50" : "";

                      const deEmphasis = expectedTab === "matched" ? " text-slate-600" : "";

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
                            (expectedTab === "matched" ? " opacity-[0.96] cursor-pointer hover:bg-slate-50" : "")
                          }
                          onClick={expectedTab === "matched" ? openAuditForEntry : undefined}
                          title={expectedTab === "matched" ? "View audit detail" : undefined}
                        >
                          <td className={`${tdClass} text-center${deEmphasis}`}>{e.date}</td>
                          <td className={`${tdClass} font-medium truncate${deEmphasis}`}>{payee}</td>
                          <td className={`${tdClass} text-right pr-4 tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-800"}${deEmphasis}`}>{formatUsdFromCents(amt)}</td>
                          <td className={`${tdClass} text-center pl-3${deEmphasis}`}>
                            <StatusChip label={isMatched ? "Matched" : "Expected"} tone={isMatched ? "success" : "default"} />
                          </td>
                          <td className={`${tdClass} text-right`}>
                            <div className="flex items-center justify-end gap-2">
                              {pendingById[String(e.id)] ? <TinySpinner /> : null}

                              {expectedTab === "matched" ? (
                                <button
                                  type="button"
                                  className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    openAuditForEntry();
                                  }}
                                  title="Revert (view audit)"
                                  aria-label="Revert (view audit)"
                                >
                                  <Undo2 className="h-4 w-4 text-slate-700" />
                                </button>
                              ) : (
                                <>
                                  <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? reconcileWriteReason : null}>
                                    <button
                                      type="button"
                                      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 ${canWriteReconcileEffective ? "hover:bg-slate-50" : "opacity-50 cursor-not-allowed"
                                        }`}
                                      disabled={!canWriteReconcileEffective}
                                      title={canWriteReconcileEffective ? "Match entry" : (reconcileWriteReason ?? noPermTitle)}
                                      aria-label="Match entry"
                                      onClick={() => {
                                        if (!canWriteReconcileEffective) return;
                                        setEntryMatchEntryId(e.id);
                                        setEntryMatchSelectedBankTxnIds(new Set());
                                        setEntryMatchSearch("");
                                        setEntryMatchError(null);
                                        setOpenEntryMatch(true);
                                      }}
                                    >
                                      <GitMerge className="h-4 w-4 text-slate-700" />
                                    </button>
                                  </HintWrap>

                                  <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? reconcileWriteReason : null}>
                                    <button
                                      type="button"
                                      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 ${canWriteReconcileEffective ? "hover:bg-slate-50" : "opacity-50 cursor-not-allowed"
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
                                      <Wrench className="h-4 w-4 text-slate-700" />
                                    </button>
                                  </HintWrap>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Bank Transactions */}
        <div className="flex flex-col min-h-0 overflow-hidden rounded-lg border bg-white">
          <div className="px-3 py-[7px]">
            <div className="flex items-start justify-between gap-2 min-w-0">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <div className="text-sm font-semibold text-slate-900">Bank Transactions</div>
                  {connectedPill}
                </div>

                <div className="mt-0 text-xs text-slate-500 min-w-0 truncate whitespace-nowrap">
                  {plaid?.connected ? (
                    <>
                      {plaid?.institutionName ? <span className="text-slate-700">{plaid.institutionName}</span> : <span>—</span>}
                      <span className="text-slate-400"> • </span>
                      <span className="tabular-nums">Balance: {balanceText}</span>
                      {plaid?.lastSyncAt ? <span className="text-slate-400"> • </span> : null}
                      {plaid?.lastSyncAt ? <span>Last sync: {new Date(plaid.lastSyncAt).toLocaleString()}</span> : null}
                      {syncMsg ? <span className="text-slate-400"> • </span> : null}
                      {syncMsg ? <span className="truncate">{syncMsg}</span> : null}
                      {pendingMsg ? <span className="text-slate-400"> • </span> : null}
                      {pendingMsg ? <span className="text-amber-700 truncate">{pendingMsg}</span> : null}
                    </>
                  ) : (
                    "Imported from bank or CSV"
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
                {!plaid?.connected ? (
                  <>
                    <button
                      type="button"
                      className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white inline-flex items-center gap-1 hover:bg-slate-50"
                      onClick={() => setOpenUpload(true)}
                    >
                      <Download className="h-3.5 w-3.5" /> Upload CSV
                    </button>

                    <PlaidConnectButton
                      businessId={selectedBusinessId ?? ""}
                      accountId={selectedAccountId ?? ""}
                      effectiveStartDate="2025-11-01"
                      disabledClassName={disabledBtn}
                      buttonClassName="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white inline-flex items-center gap-1 hover:bg-slate-50"
                      onConnected={async () => {
                        if (!selectedBusinessId || !selectedAccountId) return;

                        setSyncMsg(null);
                        setPendingMsg(null);
                        setPlaidLoading(true);
                        try {
                          const res = await plaidStatus(selectedBusinessId, selectedAccountId);
                          setPlaid(res);

                          // Immediate pull (but do NOT clobber populated table to empty while Plaid sync is catching up)
                          await refreshBankAndMatches({ preserveOnEmpty: true });
                          await entriesQ.refetch?.();

                          // Ensure Ledger page sees new entries without manual refresh
                          void qc.invalidateQueries({
                            predicate: (q) =>
                              Array.isArray(q.queryKey) &&
                              q.queryKey[0] === "entries" &&
                              q.queryKey[1] === selectedBusinessId &&
                              q.queryKey[2] === selectedAccountId,
                          });

                          // Bounded confirmation refresh (event-driven only; stop early on list change)
                          await runBoundedPostSyncRefresh({ preserveOnEmpty: true });
                        } finally {
                          setPlaidLoading(false);
                        }
                      }}
                    />
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white inline-flex items-center gap-1 hover:bg-slate-50"
                      onClick={() => setOpenUpload(true)}
                    >
                      <Download className="h-3.5 w-3.5" /> Upload CSV
                    </button>

                    <button
                      type="button"
                      className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white inline-flex items-center gap-1 hover:bg-slate-50"
                      disabled={plaidSyncing}
                      onClick={async () => {
                        if (!selectedBusinessId || !selectedAccountId) return;

                        setPlaidSyncing(true);
                        setSyncMsg(null);
                        setPendingMsg(null);

                        try {
                          const res = await plaidSync(selectedBusinessId, selectedAccountId);
                          const newCount = Number(res?.newCount ?? 0);
                          const pendingCount = Number(res?.pendingCount ?? 0);

                          setSyncMsg(`Synced: ${newCount} new`);
                          if (pendingCount > 0) setPendingMsg("Pending will appear once posted.");

                          const st = await plaidStatus(selectedBusinessId, selectedAccountId);
                          setPlaid(st);

                          // IMPORTANT: refresh the tables (not just balance/status)
                          await refreshBankAndMatches({ preserveOnEmpty: true });
                          await entriesQ.refetch?.();

                          // Bounded confirmation refresh (event-driven only; stop early on list change)
                          await runBoundedPostSyncRefresh({ preserveOnEmpty: true });
                        } catch (e: any) {
                          setSyncMsg(e?.message ?? "Sync failed");
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

          <div className="px-3 pb-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${bankTab === "unmatched" ? "border-slate-200 bg-white text-slate-900" : "border-transparent text-slate-500 hover:bg-slate-50"
                  }`}
                onClick={() => setBankTab("unmatched")}
              >
                Unmatched ({bankUnmatchedCount})
              </button>
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${bankTab === "matched" ? "border-slate-200 bg-white text-slate-900" : "border-transparent text-slate-500 hover:bg-slate-50"
                  }`}
                onClick={() => setBankTab("matched")}
              >
                Matched ({bankMatchedCount})
              </button>
            </div>
          </div>

          <div className="h-px bg-slate-200" />

          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
              {bankTxLoading ? (
                <div className="p-3">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : (bankTab === "unmatched" ? bankUnmatchedList : bankMatchedList).length === 0 ? (
                <EmptyState
                  label={
                    bankTab === "unmatched"
                      ? "No bank transactions in this period"
                      : "No matched bank transactions in this period"
                  }
                />
              ) : (
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: 36 }} />
                    <col style={{ width: 110 }} />
                    <col />
                    <col style={{ width: 140 }} />
                    <col style={{ width: 110 }} />
                  </colgroup>

                  <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                    <tr className="h-[28px]">
                      <th className={thClass}>
                        {bankTab === "unmatched" ? (
                          <input
                            type="checkbox"
                            className="h-3 w-3"
                            checked={
                              (bankTab === "unmatched" ? bankUnmatchedList : []).length > 0 &&
                              selectedBankTxnIds.size === bankUnmatchedList.length
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedBankTxnIds(new Set(bankUnmatchedList.map((x: any) => String(x.id))));
                              } else {
                                setSelectedBankTxnIds(new Set());
                              }
                            }}
                          />
                        ) : null}
                      </th>
                      <th className={`${thClass} pl-8.5`}>DATE</th>
                      <th className={thClass}>DESCRIPTION</th>
                      <th className={`${thClass} text-right pr-4`}>AMOUNT</th>
                      <th className={`${thClass} text-right`}>ACTIONS</th>
                    </tr>
                  </thead>

                  <tbody>
                    {(bankTab === "unmatched" ? bankUnmatchedList : bankMatchedList).map((t: any) => {

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

                      const isMatched = activeGroupByBankTxnId.has(String(t.id));
                      const rowTone = isMatched ? " bg-emerald-50" : "";

                      const deEmphasis = bankTab === "matched" ? " text-slate-600" : "";

                      const openAuditForBankTxn = () => {
                        const ev0 = (reconAuditAll ?? []).find((e: any) =>
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
                            (bankTab === "matched" ? " opacity-[0.96] cursor-pointer hover:bg-slate-50" : "")
                          }
                          onClick={bankTab === "matched" && isMatched ? openAuditForBankTxn : undefined}
                          title={bankTab === "matched" ? "View audit detail" : undefined}
                        >
                          <td className={tdClass}>
                            {bankTab === "unmatched" ? (
                              <input
                                type="checkbox"
                                className="h-3 w-3"
                                checked={isSelected}
                                onChange={(e) => {
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
                          <td className={`${tdClass} font-medium truncate${deEmphasis}`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="truncate">{t.name}</span>

                              {hasVoidByBankTxnId.has(String(t.id)) ? (
                                <button
                                  type="button"
                                  className="shrink-0 inline-flex items-center justify-center h-6 w-6 rounded-md hover:bg-slate-50"
                                  title="Reverted previously (view history)"
                                  aria-label="Reverted previously (view history)"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    setReconHistoryBankTxnFilterId(String(t.id));
                                    setReconHistoryFilter("all");
                                    setOpenReconciliationHistory(true);
                                  }}
                                >
                                  <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
                                </button>
                              ) : null}

                              {t.source ? (
                                <span className="shrink-0">
                                  <StatusChip label={String(t.source)} tone="default" />
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className={`${tdClass} text-right pr-4 tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-800"}${deEmphasis}`}>
                            {formatUsdFromCents(amt)}
                          </td>

                          <td className={`${tdClass} text-right`}>
                            <div className="flex items-center justify-end gap-2">
                              {pendingById[String(t.id)] ? <TinySpinner /> : null}

                              {bulkCreateResultByBankTxnId[String(t.id)] ? (
                                <span
                                  className="text-[11px] px-2 py-0.5 rounded-full border border-slate-200 text-slate-700"
                                  title={String(bulkCreateResultByBankTxnId[String(t.id)]?.error ?? "")}
                                >
                                  {String(bulkCreateResultByBankTxnId[String(t.id)]?.status ?? "")}
                                </span>
                              ) : null}

                              {bankTab === "matched" ? (
                                <button
                                  type="button"
                                  className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    openAuditForBankTxn();
                                  }}
                                  title="Revert (view audit)"
                                  aria-label="Revert (view audit)"
                                >
                                  <Undo2 className="h-4 w-4 text-slate-700" />
                                </button>
                              ) : (
                                <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? reconcileWriteReason : null}>
                                  <button
                                    type="button"
                                    className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 ${canWriteReconcileEffective ? "hover:bg-slate-50" : "opacity-50 cursor-not-allowed"
                                      }`}
                                    disabled={!canWriteReconcileEffective}
                                    title={canWriteReconcileEffective ? "Match this bank transaction" : (reconcileWriteReason ?? noPermTitle)}
                                    aria-label="Match bank transaction"
                                    onClick={() => {
                                      if (!canWriteReconcileEffective) return;
                                      setMatchBankTxnId(t.id);
                                      setMatchSearch("");
                                      setMatchSelectedEntryIds(new Set());
                                      setMatchError(null);

                                      // Best initial seed: closest abs amount, then closest date
                                      const bankAmt = toBigIntSafe(t.amount_cents);
                                      const bankAbs = absBig(bankAmt);
                                      const bankSign = bankAmt < 0n ? -1n : 1n;
                                      const bankDateYmd = isoToYmd(t.posted_date);
                                      const bankTime = bankDateYmd ? ymdToTime(bankDateYmd) : 0;

                                      const eligible = allEntriesSorted.filter((e: any) => {
                                        if (matchByEntryId.has(e.id)) return false;
                                        const entryAmt = toBigIntSafe(e.amount_cents);
                                        const entrySign = entryAmt < 0n ? -1n : 1n;
                                        if (entrySign !== bankSign) return false;
                                        return true;
                                      });

                                      let bestId: string | null = null;
                                      let bestScore = Number.POSITIVE_INFINITY;

                                      for (const e of eligible) {
                                        const entryAmt = toBigIntSafe(e.amount_cents);
                                        const entryAbs = absBig(entryAmt);
                                        const diff = entryAbs > bankAbs ? entryAbs - bankAbs : bankAbs - entryAbs;
                                        const dt = bankTime ? Math.abs(ymdToTime(e.date) - bankTime) : 0;
                                        const score = Number(diff) * 1_000_000 + dt;
                                        if (score < bestScore) {
                                          bestScore = score;
                                          bestId = e.id;
                                        }
                                      }

                                      setMatchSelectedEntryIds(() => {
                                        const s = new Set<string>();
                                        if (bestId) s.add(bestId);
                                        return s;
                                      });

                                      setOpenMatch(true);
                                    }}
                                  >
                                    <GitMerge className="h-4 w-4 text-slate-700" />
                                  </button>
                                </HintWrap>
                              )}

                              <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? reconcileWriteReason : null}>
                                <button
                                  type="button"
                                  className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 ${canWriteReconcileEffective ? "hover:bg-slate-50" : "opacity-50 cursor-not-allowed"
                                    }`}
                                  disabled={
                                    !canWriteReconcileEffective ||
                                    !!createEntryBusyByBankId[String(t.id)] ||
                                    (remainingAbsByBankTxnId.get(t.id) ?? 0n) === 0n
                                  }
                                  title={
                                    !canWriteReconcileEffective
                                      ? (reconcileWriteReason ?? noPermTitle)
                                      : (remainingAbsByBankTxnId.get(t.id) ?? 0n) === 0n
                                        ? "Already fully matched"
                                        : "Create entry from this bank transaction"
                                  }
                                  aria-label="Create entry"
                                  onClick={(ev) => {
                                    ev.stopPropagation();
                                    if (!canWriteReconcileEffective) return;

                                    const bankId = String(t.id);
                                    const remaining = remainingAbsByBankTxnId.get(t.id) ?? 0n;
                                    if (remaining === 0n) return;

                                    setCreateEntryErr(null);
                                    setCreateEntryBankTxnId(bankId);
                                    setCreateEntryAutoMatch(false);

                                    // Prefill overrides
                                    const defaultDesc = (t?.name ?? "").toString().trim() || "—";
                                    setCreateEntryMemo(`Bank txn: ${defaultDesc} • ${bankId}`);
                                    setCreateEntryMethod("OTHER");
                                    setCreateEntryCategoryId("");
                                    setCreateEntryCategoryName("");
                                    setCategoryQuery("");

                                    setOpenCreateEntry(true);
                                  }}
                                >
                                  {createEntryBusyByBankId[String(t.id)] ? (
                                    <TinySpinner />
                                  ) : (
                                    <Plus className="h-4 w-4 text-slate-700" />
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
                                      className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                                      onClick={(ev) => {
                                        ev.stopPropagation();
                                        openAuditForBankTxn();
                                      }}
                                      title="Revert (view audit)"
                                      aria-label="Revert (view audit)"
                                    >
                                      <Undo2 className="h-4 w-4 text-slate-700" />
                                    </button>
                                  );
                                })()
                                : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
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
        size="lg"
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: list */}
          <div className="rounded-md border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
              <div className="text-xs font-semibold text-slate-700">Snapshot history</div>
              <div className="text-[11px] text-slate-500">Most recent first</div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto">
              {snapshotsLoading ? (
                <div className="p-3">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : snapshotsError ? (
                <div className="p-3 text-xs text-red-700">{snapshotsError}</div>
              ) : snapshots.length === 0 ? (
                <div className="p-3 text-xs text-slate-500">No snapshots yet for this account.</div>
              ) : (
                <div className="flex flex-col">
                  {snapshots.map((s) => {
                    const selected = selectedSnapshotId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        className={`w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-50 ${selected ? "bg-emerald-50" : "bg-white"
                          }`}
                        onClick={() => setSelectedSnapshotId(s.id)}
                        title="View snapshot"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate">{s.month}</div>
                            <div className="text-[11px] text-slate-500 truncate">
                              Created {new Date(s.created_at).toLocaleString()}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="text-[11px] text-slate-500">Remaining</div>
                            <div className="text-xs font-semibold text-slate-900 tabular-nums">
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
            <div className="rounded-md border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
                <div className="text-xs font-semibold text-slate-700">Create snapshot</div>
                <div className="text-[11px] text-slate-500">
                  Snapshots reflect reconciliation state as of creation time for bank transactions posted in the selected month.
                </div>
              </div>

              <div className="p-3">
                <div className="flex items-center gap-2">
                  <input
                    type="month"
                    className="h-8 px-2 text-xs border border-slate-200 rounded-md bg-white"
                    value={snapshotMonth}
                    onChange={(e) => setSnapshotMonth(e.target.value)}
                  />

                  <HintWrap
                    disabled={!canWriteSnapshotsEffective}
                    reason={!canWriteSnapshotsEffective ? (snapshotWriteReason ?? noPermTitle) : null}
                  >
                    <button
                      type="button"
                      className={`h-8 px-3 text-xs rounded-md border ${canWriteSnapshotsEffective
                        ? "border-slate-200 bg-white hover:bg-slate-50"
                        : "border-slate-200 bg-white opacity-50 cursor-not-allowed"
                        }`}
                      disabled={!canWriteSnapshotsEffective || snapshotCreateBusy || monthAlreadyExists}
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
                    </button>
                  </HintWrap>
                </div>

                {/* Neutral info banner when snapshot exists */}
                {monthAlreadyExists || snapshotExistsInfo ? (
                  <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                    <div className="text-xs text-slate-700">
                      Snapshot already exists for <span className="font-semibold">{snapshotMonth}</span>.
                    </div>

                    <button
                      type="button"
                      className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
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

                {snapshotCreateError ? <div className="mt-2 text-xs text-red-700">{snapshotCreateError}</div> : null}
              </div>
            </div>

            <div className="rounded-md border border-slate-200 overflow-hidden flex-1">
              <div className="px-3 py-2 border-b border-slate-200 bg-slate-50">
                <div className="text-xs font-semibold text-slate-700">Snapshot details</div>
                <div className="text-[11px] text-slate-500">Downloads are restricted to write roles.</div>
              </div>

              <div className="p-3">
                {snapshotLoading ? (
                  <Skeleton className="h-24 w-full" />
                ) : snapshotError ? (
                  <div className="text-xs text-red-700">{snapshotError}</div>
                ) : !snapshot ? (
                  <div className="text-xs text-slate-500">Select a snapshot from the left.</div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-slate-500">Month</div>
                        <div className="font-semibold text-slate-900">{snapshot.month}</div>
                      </div>
                      <div>
                        <div className="text-slate-500">Remaining</div>
                        <div className="font-semibold text-slate-900 tabular-nums">
                          {formatUsdFromCents(toBigIntSafe(snapshot.remaining_abs_cents))}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Bank status</div>
                        <div className="text-slate-800">
                          U {snapshot.bank_unmatched_count} • P {snapshot.bank_partial_count} • M {snapshot.bank_matched_count}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500">Entries</div>
                        <div className="text-slate-800">
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
                            <button
                              type="button"
                              className={`h-8 px-3 text-xs rounded-md border ${canWriteSnapshotsEffective
                                ? "border-slate-200 bg-white hover:bg-slate-50"
                                : "border-slate-200 bg-white opacity-50 cursor-not-allowed"
                                }`}
                              disabled={!canWriteSnapshotsEffective}
                              title={!canWriteSnapshotsEffective ? (snapshotWriteReason ?? noPermTitle) : "Download"}
                              onClick={async () => {
                                if (!selectedBusinessId || !selectedAccountId || !snapshot?.id) return;
                                try {
                                  const res = await getReconcileSnapshotExportUrl(selectedBusinessId, selectedAccountId, snapshot.id, k);
                                  if (res?.url) window.open(res.url, "_blank");
                                } catch {
                                  // ignore
                                }
                              }}
                            >
                              {label}
                            </button>
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
        }}
        title="Match bank transaction"
        size="lg"
      >
        <div className="flex flex-col max-h-[70vh]">
          {/* Body (scroll only this area) */}
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="text-xs text-slate-600 mb-2">Select entries to match (same sign; full-match only).</div>

            <div className="mb-2">
              <input
                className="h-7 w-full px-2 text-xs border border-slate-200 rounded-md"
                placeholder="Search entries…"
                value={matchSearch}
                onChange={(e) => setMatchSearch(e.target.value)}
              />
            </div>

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
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-900">Combined Match Summary</div>
                    <div className="text-xs text-slate-500 tabular-nums">Δ {deltaAbs === 0n ? "0.00" : formatUsdFromCents(deltaAbs)}</div>
                  </div>

                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Bank transaction</span>
                      <span className={`tabular-nums ${bankAmt < 0n ? "text-red-700" : "text-slate-900"}`}>{formatUsdFromCents(bankAmt)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Selected entries</span>
                      <span className="tabular-nums text-slate-900">{formatUsdFromCents(selectedAbs)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Remaining Δ</span>
                      <span className={`tabular-nums ${deltaAbs === 0n ? "text-emerald-700" : "text-amber-700"}`}>
                        {deltaAbs === 0n ? "0.00" : formatUsdFromCents(deltaAbs)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-1 text-[11px] text-slate-500">Select multiple entries until Remaining Δ is exactly 0. No manual amount input.</div>
                </div>
              );
            })()}

            {matchError ? <div className="text-xs text-red-700 mb-2">{matchError}</div> : null}

            {/* Suggested (top candidates) */}
            {(() => {
              const bank = matchBankTxnId ? (bankByIdFast.get(String(matchBankTxnId)) ?? null) : null;
              if (!bank) return null;

              const bankAmt = toBigIntSafe(bank.amount_cents);
              const bankAbs = absBig(bankAmt);
              const bankSign = bankAmt < 0n ? -1n : 1n;
              const bankTime = bank?.posted_date ? new Date(bank.posted_date).getTime() : 0;

              const q = matchSearch.trim().toLowerCase();

              const ranked = allEntriesSorted
                .filter((e: any) => {
                  if (matchByEntryId.has(e.id)) return false;
                  const entryAmt = toBigIntSafe(e.amount_cents);
                  const entrySign = entryAmt < 0n ? -1n : 1n;
                  if (entrySign !== bankSign) return false;

                  if (!q) return true;
                  const payee = (e.payee ?? "").toString().toLowerCase();
                  const date = (e.date ?? "").toString().toLowerCase();
                  return payee.includes(q) || date.includes(q);
                })
                .map((e: any) => {
                  const entryAmt = toBigIntSafe(e.amount_cents);
                  const entryAbs = absBig(entryAmt);
                  const diff = entryAbs > bankAbs ? entryAbs - bankAbs : bankAbs - entryAbs;
                  const dt = bankTime ? Math.abs(new Date(`${e.date}T00:00:00Z`).getTime() - bankTime) : 0;
                  const overlapRaw = tokenOverlap(String(bank.name ?? ""), String(e.payee ?? ""));
                  const overlap = Math.min(overlapRaw, 3); // cap token influence

                  const dtDays = bankTime ? Math.floor(dt / 86_400_000) : 9999;
                  const diffN = Number(diff); // cents; safe here

                  // Deterministic scoring (tolerance=0):
                  // 1) Amount diff dominates always
                  // 2) Date dominates token overlap
                  // 3) Token overlap only helps when amount is exact AND date is close (<=3 days)
                  const tokenBonus = diff === 0n && dtDays <= 3 ? overlap * 50_000 : 0;
                  const score = diffN * 1_000_000 + dtDays * 10_000 - tokenBonus;

                  return { e, score };
                })
                .sort((a: any, b: any) => a.score - b.score)
                .map((x: any) => x.e);

              // Suggested = exact amount matches only (tolerance=0)
              const suggested = ranked
                .filter((e: any) => {
                  const entryAbs = absBig(toBigIntSafe(e.amount_cents));
                  return entryAbs === bankAbs;
                })
                .slice(0, 3);

              if (suggested.length === 0) return null;

              return (
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <div className="text-[11px] font-semibold text-slate-600 mb-1">Suggested</div>
                  <div className="flex flex-col gap-1">
                    {suggested.map((e: any) => {
                      const amt = toBigIntSafe(e.amount_cents);
                      const selected = matchSelectedEntryIds.has(e.id);
                      return (
                        <button
                          key={e.id}
                          type="button"
                          className={`w-full text-left h-10 px-2 rounded-md border ${selected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"
                            } flex items-center justify-between gap-2`}
                          onClick={() => {
                            setMatchSelectedEntryIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(e.id)) next.delete(e.id);
                              else next.add(e.id);
                              return next;
                            });
                          }}
                          title="Toggle suggested entry"
                        >
                          <span className="min-w-0 flex flex-col">
                            <span className="truncate text-xs font-medium text-slate-800">{e.payee}</span>
                            <span className="truncate text-[11px] text-slate-500">
                              {(() => {
                                const bankAbs = absBig(toBigIntSafe(bank.amount_cents));
                                const entryAbs = absBig(toBigIntSafe(e.amount_cents));
                                const diff = entryAbs > bankAbs ? entryAbs - bankAbs : bankAbs - entryAbs;
                                const overlap = Math.min(tokenOverlap(String(bank.name ?? ""), String(e.payee ?? "")), 3);
                                const dtDays = bank?.posted_date ? Math.abs(Math.round((new Date(`${e.date}T00:00:00Z`).getTime() - new Date(bank.posted_date).getTime()) / 86_400_000)) : 0;
                                return `Amount Δ ${formatUsdFromCents(diff)} • Δdays ${dtDays} • Text similarity ${overlap}`;
                              })()}
                            </span>
                          </span>
                          <span className={`shrink-0 text-xs tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-800"}`}>
                            {formatUsdFromCents(amt)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2 text-[11px] font-semibold text-slate-600">All eligible</div>
                </div>
              );
            })()}

            <div className="rounded-md border border-slate-200 overflow-hidden">
              <div className="max-h-[44vh] overflow-y-auto">
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: 36 }} />
                    <col style={{ width: 110 }} />
                    <col />
                    <col style={{ width: 140 }} />
                  </colgroup>
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                    <tr className="h-[28px]">
                      <th className="px-2 text-xs font-semibold text-slate-600 text-left"></th>
                      <th className="px-2 text-xs font-semibold text-slate-600 text-left">DATE</th>
                      <th className="px-2 text-xs font-semibold text-slate-600 text-left">PAYEE</th>
                      <th className="px-2 text-xs font-semibold text-slate-600 text-right">AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const bank = matchBankTxnId ? (bankByIdFast.get(String(matchBankTxnId)) ?? null) : null;
                      if (!bank) return null;

                      const bankAmt = toBigIntSafe(bank.amount_cents);
                      const bankAbs = absBig(bankAmt);
                      const bankSign = bankAmt < 0n ? -1n : 1n;
                      const bankTime = bank.posted_date ? new Date(bank.posted_date).getTime() : 0;

                      const q = matchSearch.trim().toLowerCase();

                      const eligible = allEntriesSorted
                        .filter((e: any) => {
                          if (matchByEntryId.has(e.id)) return false;
                          const entryAmt = toBigIntSafe(e.amount_cents);
                          const entrySign = entryAmt < 0n ? -1n : 1n;
                          if (entrySign !== bankSign) return false;

                          if (!q) return true;
                          const payee = (e.payee ?? "").toString().toLowerCase();
                          const date = (e.date ?? "").toString().toLowerCase();
                          return payee.includes(q) || date.includes(q);
                        })
                        .map((e: any) => {
                          const entryAmt = toBigIntSafe(e.amount_cents);
                          const entryAbs = absBig(entryAmt);
                          const diff = entryAbs > bankAbs ? entryAbs - bankAbs : bankAbs - entryAbs;

                          const dtMs = bankTime ? Math.abs(new Date(`${e.date}T00:00:00Z`).getTime() - bankTime) : 0;
                          const dtDays = bankTime ? Math.floor(dtMs / 86_400_000) : 9999;

                          const overlapRaw = tokenOverlap(String(bank.name ?? ""), String(e.payee ?? ""));
                          const overlap = Math.min(overlapRaw, 3);

                          const diffN = Number(diff); // cents

                          // Deterministic scoring (tolerance=0):
                          // - Amount diff dominates always
                          // - Date dominates token overlap
                          // - Token overlap only helps when amount is exact AND date is close (<=3 days)
                          const tokenBonus = diff === 0n && dtDays <= 3 ? overlap * 50_000 : 0;
                          const score = diffN * 1_000_000 + dtDays * 10_000 - tokenBonus;

                          return { e, score };
                        })
                        .sort((a: any, b: any) => a.score - b.score)
                        .slice(0, 200)
                        .map((x: any) => x.e);

                      return eligible.map((e: any) => {
                        const amt = toBigIntSafe(e.amount_cents);
                        const selected = matchSelectedEntryIds.has(e.id);

                        return (
                          <tr
                            key={e.id}
                            className={`h-[30px] border-b border-slate-100 cursor-pointer ${selected ? "bg-emerald-50" : "hover:bg-slate-50"}`}
                            onClick={() => {
                              setMatchSelectedEntryIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(e.id)) next.delete(e.id);
                                else next.add(e.id);
                                return next;
                              });
                            }}
                          >
                            <td className="px-2">
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => {
                                  setMatchSelectedEntryIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(e.id)) next.delete(e.id);
                                    else next.add(e.id);
                                    return next;
                                  });
                                }}
                                onClick={(ev) => ev.stopPropagation()}
                                aria-label="Select entry"
                                className="h-4 w-4"
                              />
                            </td>
                            <td className="px-2 text-xs text-slate-800">{e.date}</td>
                            <td className="px-2 text-xs text-slate-800 font-medium truncate">{e.payee}</td>
                            <td className={`px-2 text-xs text-right tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-800"}`}>{formatUsdFromCents(amt)}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Footer (fixed) */}
          <div className="shrink-0 pt-3 flex items-center justify-between border-t border-slate-200 mt-3">
            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
              onClick={() => setOpenMatch(false)}
              disabled={matchBusy}
              title="Cancel"
              aria-label="Cancel"
            >
              Cancel
            </button>

            <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? (reconcileWriteReason ?? noPermTitle) : null}>
              <button
                type="button"
                className="h-8 px-3 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
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

                  // Pending UI only (no logic change)
                  const pendingIds = [String(matchBankTxnId), ...Array.from(matchSelectedEntryIds).map(String)];
                  for (const id of pendingIds) markPending(id);

                  try {
                    const items = Array.from(matchSelectedEntryIds).map((entryId) => {
                      const entry = allEntriesSorted.find((x: any) => x.id === entryId);
                      return entry
                        ? {
                          client_id: `manual:${matchBankTxnId}:${entryId}`,
                          bankTransactionId: matchBankTxnId,
                          entryId,
                          matchType: "FULL" as const,
                          matchedAmountCents: String(entry.amount_cents),
                        }
                        : null;
                    }).filter(Boolean) as any[];

                    const payloadItems = [
                      {
                        client_id: `manual:${matchBankTxnId}:${Date.now()}`,
                        bankTransactionIds: [matchBankTxnId],
                        entryIds: Array.from(matchSelectedEntryIds),
                        // direction optional; backend derives from bank and validates if provided
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

                    // Refresh once (no storms)
                    await refreshBankAndMatches({ preserveOnEmpty: true });
                    await entriesQ.refetch?.();

                    clearMutErr();
                    setOpenMatch(false);

                  } catch (e: any) {
                    const r = applyMutationError(e, "Can’t match transactions");
                    if (!r.isClosed) setMatchError(r.msg);
                    else setMatchError(null);
                  } finally {
                    // Pending UI only
                    const pendingIds = [String(matchBankTxnId), ...Array.from(matchSelectedEntryIds).map(String)];
                    for (const id of pendingIds) clearPending(id);

                    setMatchBusy(false);
                  }
                }}
                title={matchBusy ? "Matching…" : "Match selected entries (exact sum required)"}
                aria-label="Match selected entries"
              >
                {matchBusy ? "Matching…" : `Match ${matchSelectedEntryIds.size} entr${matchSelectedEntryIds.size === 1 ? "y" : "ies"}`}
              </button>
            </HintWrap>
          </div>
        </div>
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
        size="md"
      >
        <div className="flex flex-col max-h-[55vh]">
          <div className="flex-1 overflow-y-auto">
            <div className="text-xs text-slate-600 mb-2">Marking an entry as an adjustment is ledger-only and reversible later.</div>

            <div className="mb-2">
              <label className="text-xs text-slate-600">Reason (required)</label>
              <textarea
                className="mt-1 w-full min-h-[90px] p-2 text-xs border border-slate-200 rounded-md"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
              />
            </div>

            {adjustError ? <div className="text-xs text-red-700 mb-2">{adjustError}</div> : null}
          </div>

          <div className="shrink-0 pt-3 flex items-center justify-between border-t border-slate-200 mt-3">
            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
              onClick={() => setOpenAdjust(false)}
              disabled={adjustBusy}
              title="Cancel"
              aria-label="Cancel"
            >
              Cancel
            </button>

            <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? (reconcileWriteReason ?? noPermTitle) : null}>
              <button
                type="button"
                className="h-8 px-3 text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                disabled={!canWriteReconcileEffective || adjustBusy || !adjustEntryId || !adjustReason.trim()}
                onClick={async () => {
                  if (!canWriteReconcileEffective) return;
                  if (!selectedBusinessId || !selectedAccountId) return;
                  if (!adjustEntryId) return;

                  setAdjustBusy(true);
                  setAdjustError(null);
                  clearMutErr();
                  try {
                    await markEntryAdjustment({
                      businessId: selectedBusinessId,
                      accountId: selectedAccountId,
                      entryId: adjustEntryId,
                      reason: adjustReason.trim(),
                    });

                    setLocallyAdjusted((prev) => {
                      const next = new Set(prev);
                      next.add(adjustEntryId);
                      return next;
                    });

                    refreshAllDebounced();

                    clearMutErr();
                    setOpenAdjust(false);
                  } catch (e: any) {
                    const r = applyMutationError(e, "Can’t update adjustment");
                    if (!r.isClosed) setAdjustError(r.msg);
                    else setAdjustError(null);
                  } finally {
                    setAdjustBusy(false);
                  }
                }}
                title={adjustBusy ? "Saving…" : "Mark adjustment"}
                aria-label="Mark adjustment"
              >
                {adjustBusy ? "Saving…" : "Mark adjustment"}
              </button>
            </HintWrap>
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
        }}
        title="Match entry"
        size="lg"
      >
        <div className="flex flex-col max-h-[70vh]">
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="text-xs text-slate-600 mb-2">
              Select multiple eligible bank transactions (same sign). Full-match only: the selected bank amounts must sum exactly to the entry amount.
            </div>

            <div className="mb-2">
              <input
                className="h-7 w-full px-2 text-xs border border-slate-200 rounded-md"
                placeholder="Search bank transactions…"
                value={entryMatchSearch}
                onChange={(e) => setEntryMatchSearch(e.target.value)}
              />
            </div>

            {entryMatchError ? <div className="text-xs text-red-700 mb-2">{entryMatchError}</div> : null}

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
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-900">Combine Match Summary</div>
                    <div className="text-xs text-slate-500 tabular-nums">Δ {deltaAbs === 0n ? "0.00" : formatUsdFromCents(deltaAbs)}</div>
                  </div>

                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Entry</span>
                      <span className={`tabular-nums ${entryAmt < 0n ? "text-red-700" : "text-slate-900"}`}>{formatUsdFromCents(entryAmt)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Selected bank txns</span>
                      <span className="tabular-nums text-slate-900">{formatUsdFromCents(selectedAbs)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Remaining Δ</span>
                      <span className={`tabular-nums ${deltaAbs === 0n ? "text-emerald-700" : "text-amber-700"}`}>
                        {deltaAbs === 0n ? "0.00" : formatUsdFromCents(deltaAbs)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-1 text-[11px] text-slate-500">Select multiple bank transactions until Remaining Δ is exactly 0. No manual amount input.</div>
                </div>
              );
            })()}

            {/* (removed duplicate combine summary block) */}

            {/* (removed stray pasted code) */}

            <div className="rounded-md border border-slate-200 overflow-hidden">
              <div className="max-h-[44vh] overflow-y-auto">
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: 110 }} />
                    <col />
                    <col style={{ width: 140 }} />
                  </colgroup>
                  <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
                    <tr className="h-[28px]">
                      <th className="px-2 text-xs font-semibold text-slate-600 text-left">DATE</th>
                      <th className="px-2 text-xs font-semibold text-slate-600 text-left">DESCRIPTION</th>
                      <th className="px-2 text-xs font-semibold text-slate-600 text-right">AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const entry = allEntriesSorted.find((x: any) => x.id === entryMatchEntryId);
                      if (!entry) return null;

                      const entryAmt = toBigIntSafe(entry.amount_cents);
                      const entryAbs = absBig(entryAmt);
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
                              className={`h-[30px] border-b border-slate-100 cursor-pointer ${selected ? "bg-emerald-50" : "hover:bg-slate-50"}`}
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
                              <td className="px-2 text-xs text-slate-800">{dateStr}</td>
                              <td className="px-2 text-xs text-slate-800 font-medium truncate">{t.name}</td>
                              <td className={`px-2 text-xs text-right tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-800"}`}>{formatUsdFromCents(amt)}</td>
                            </tr>
                          );
                        });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="shrink-0 pt-3 flex items-center justify-between border-t border-slate-200 mt-3">
            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
              onClick={() => setOpenEntryMatch(false)}
              disabled={entryMatchBusy}
              title="Cancel"
              aria-label="Cancel"
            >
              Cancel
            </button>

            <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? reconcileWriteReason : null}>
              <button
                type="button"
                className="h-8 px-3 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
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
                title="Create combine match (exact sum required)"
                aria-label="Create combine match"
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

                  // Pending UI only (no logic change)
                  const pendingIds = [String(entryMatchEntryId), ...Array.from(entryMatchSelectedBankTxnIds).map(String)];
                  for (const id of pendingIds) markPending(id);

                  try {
                    const payloadItems = [
                      {
                        client_id: `combine:${entryMatchEntryId}:${Date.now()}`,
                        bankTransactionIds: Array.from(entryMatchSelectedBankTxnIds),
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

                    await refreshBankAndMatches({ preserveOnEmpty: true });
                    await entriesQ.refetch?.();

                    clearMutErr();
                    setOpenEntryMatch(false);
                  } catch (e: any) {
                    const r = applyMutationError(e, "Can’t create match");
                    if (!r.isClosed) setEntryMatchError(r.msg);
                    else setEntryMatchError(null);
                  } finally {
                    // Pending UI only
                    const pendingIds = [String(entryMatchEntryId), ...Array.from(entryMatchSelectedBankTxnIds).map(String)];
                    for (const id of pendingIds) clearPending(id);

                    setEntryMatchBusy(false);
                  }
                }}
              >
                {entryMatchBusy ? "Saving…" : "Create match"}
              </button>
            </HintWrap>
          </div>
        </div>
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
                className={`h-7 px-3 text-xs rounded-md border ${reconHistoryFilter === "all" ? "border-slate-200 bg-white text-slate-900" : "border-transparent text-slate-500 hover:bg-slate-50"
                  }`}
                onClick={() => setReconHistoryFilter("all")}
              >
                All ({reconAuditCounts.all})
              </button>
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${reconHistoryFilter === "match" ? "border-slate-200 bg-white text-slate-900" : "border-transparent text-slate-500 hover:bg-slate-50"
                  }`}
                onClick={() => setReconHistoryFilter("match")}
              >
                Matches ({reconAuditCounts.match})
              </button>
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${reconHistoryFilter === "void" ? "border-slate-200 bg-white text-slate-900" : "border-transparent text-slate-500 hover:bg-slate-50"
                  }`}
                onClick={() => setReconHistoryFilter("void")}
              >
                Voids ({reconAuditCounts.void})
              </button>

              <input
                className="h-7 w-[200px] px-2 text-xs border border-slate-200 rounded-md bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                placeholder="Search history…"
                value={reconHistorySearch}
                onChange={(e) => setReconHistorySearch(e.target.value)}
                title="Search bank description, entry payee, or IDs"
              />
            </div>

            {reconHistoryBankTxnFilterId ? (
              <div className="text-xs text-slate-600 flex items-center gap-2">
                <span className="whitespace-nowrap">
                  Filtered: <span className="font-medium">{shortId(reconHistoryBankTxnFilterId)}</span>
                </span>
                <button
                  type="button"
                  className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
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

          <div className="h-px bg-slate-200" />

          <div className="mt-2 max-h-[64vh] overflow-y-auto overflow-x-hidden">
            {matchesLoading ? (
              <div className="p-2">
                <Skeleton className="h-24 w-full" />
              </div>
            ) : reconAuditVisible.length === 0 ? (
              <EmptyState label="No reconciliation history in this period" />
            ) : (
              <div className="mt-2 rounded-xl border border-slate-200 bg-white overflow-hidden">
                <table className="w-full table-fixed border-collapse">
                  <colgroup>
                    <col style={{ width: 190 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 320 }} />
                    <col style={{ width: 260 }} />
                    <col style={{ width: 130 }} />
                    <col style={{ width: 170 }} />
                  </colgroup>

                  <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                    <tr className="h-[30px]">
                      <th className="px-2 text-xs font-semibold text-slate-600 text-left whitespace-nowrap">WHEN</th>
                      <th className="px-2 text-xs font-semibold text-slate-600 text-left whitespace-nowrap">ACTION</th>
                      <th className="px-2 text-xs font-semibold text-slate-600 text-left whitespace-nowrap">BANK TRANSACTION</th>
                      <th className="px-2 text-xs font-semibold text-slate-600 text-left whitespace-nowrap">ENTRY</th>
                      <th className="px-2 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">AMOUNT</th>
                      <th className="px-2 text-xs font-semibold text-slate-600 text-left whitespace-nowrap">BY</th>
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

                      const rowTone = ev.kind === "MATCH_GROUP_VOIDED" ? " text-slate-600" : "";
                      const chipTone = ev.kind === "MATCH_GROUP_CREATED" ? "success" : "default";

                      return (
                        <tr
                          key={`${ev.kind}-${ev.at}-${idx}`}
                          className={`h-[30px] border-b border-slate-100 cursor-pointer hover:bg-slate-50${rowTone}`}
                          onClick={() => {
                            setSelectedReconAudit(ev);
                            setRevertError(null);
                            setOpenReconAuditDetail(true);
                          }}
                          title="View audit detail"
                        >
                          <td className="px-2 text-xs text-slate-800" title={whenFull}>
                            {whenCompact}
                          </td>
                          <td className="px-2 text-xs">
                            <StatusChip label={ev.kind === "MATCH_GROUP_CREATED" ? "Matched" : "Reverted"} tone={chipTone as any} />
                          </td>
                          <td className="px-2 text-xs text-slate-800 font-medium truncate" title={bankLabel}>
                            {bankLabel}
                          </td>
                          <td className="px-2 text-xs text-slate-800 font-medium truncate" title={entryLabel}>
                            {entryLabel}
                          </td>
                          <td className="px-2 text-xs text-right tabular-nums text-slate-800">
                            {formatUsdFromCents(matchedAbs)}
                          </td>
                          <td className="px-2 text-xs text-slate-700">
                            {ev.by ? shortId(ev.by) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-2 text-[11px] text-slate-500">
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
          setRevertError(null);
        }}
        title="Audit detail"
        size="md"
      >
        <div className="p-3">
          {(() => {
            const ev = selectedReconAudit as any | null;

            const groupId = ev?.groupId ? String(ev.groupId) : null;
            const bankTxnId = ev?.bankTxnIds?.[0] ? String(ev.bankTxnIds[0]) : null;

            // v1 behavior: "Revert bank match" voids ALL active matches for this bank transaction.
            const isActiveGroup = !!groupId && activeGroupByBankTxnId.has(String(bankTxnId ?? ""));
            const canRevert = Boolean(canWrite && selectedBusinessId && selectedAccountId && groupId && isActiveGroup);
            const alreadyVoided = !!groupId && !isActiveGroup;

            return (
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] text-slate-500">
                  {bankTxnId ? (
                    alreadyVoided ? "No active bank matches to revert." : "Revert will void all active matches for this bank transaction."
                  ) : (
                    "Bank transaction id unavailable."
                  )}
                </div>

                <button
                  type="button"
                  className="h-8 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 inline-flex items-center gap-1"
                  disabled={!canRevert || revertBusy}
                  title={!canWrite ? noPermTitle : "Revert bank match (void all active matches for this bank transaction)"}
                  onClick={async () => {
                    if (!selectedBusinessId || !selectedAccountId) return;
                    if (!bankTxnId) return;

                    const ok = window.confirm(
                      "Revert bank match?\n\nThis will VOID (unmatch) ALL active matches for this bank transaction.\nThis action is recorded in history and can be re-matched later."
                    );
                    if (!ok) return;

                    setRevertBusy(true);
                    setRevertError(null);
                    clearMutErr();

                    // Pending UI only (no logic change)
                    if (bankTxnId) markPending(String(bankTxnId));
                    if (groupId) markPending(String(groupId));

                    try {
                      if (!groupId) throw new Error("Match group id unavailable");

                      await voidMatchGroup({
                        businessId: selectedBusinessId,
                        accountId: selectedAccountId,
                        matchGroupId: groupId,
                        reason: "User unmatch",
                      });

                      await refreshBankAndMatches({ preserveOnEmpty: true });
                      await entriesQ.refetch?.();

                      // Close detail after success (clean, consistent)
                      clearMutErr();
                      setOpenReconAuditDetail(false);
                      setSelectedReconAudit(null);
                    } catch (e: any) {
                      const r = applyMutationError(e, "Can’t revert match");
                      if (!r.isClosed) setRevertError(r.msg);
                      else setRevertError(null);
                    } finally {
                      // Pending UI only
                      if (bankTxnId) clearPending(String(bankTxnId));
                      if (groupId) clearPending(String(groupId));

                      setRevertBusy(false);
                    }
                  }}
                  aria-label="Revert bank match"
                >
                  <Undo2 className="h-3.5 w-3.5 text-slate-700" />
                  {revertBusy ? "Reverting…" : "Revert bank match"}
                </button>
              </div>
            );
          })()}

          {revertError ? <div className="mb-2 text-xs text-red-700">{revertError}</div> : null}

          <div className="max-h-[60vh] overflow-y-auto">
            {(() => {
              const ev = selectedReconAudit as any | null;
              if (!ev) return <div className="text-xs text-slate-500">No audit event selected.</div>;

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
                  <div className="text-[11px] font-semibold text-slate-500">{label}</div>
                  <div className={`${mono ? "font-mono" : ""} text-xs text-slate-900 break-all`}>{value}</div>
                </div>
              );

              return (
                <div className="space-y-3">
                  <div>
                    <div className="text-[11px] font-semibold text-slate-600 mb-1">IDs</div>
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
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
                    <div className="text-[11px] font-semibold text-slate-600 mb-1">Context</div>
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                      <Row label="Bank txn" value={bankSummary} />
                      <Row label="Entry" value={entrySummary} />
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-600 mb-1">Match</div>
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                      <Row label="Action clicked" value={ev.kind === "MATCH_GROUP_CREATED" ? "Matched" : "Reverted"} />
                      <Row label="Matched amount" value={formatUsdFromCents(matchedAbs)} />
                      <Row label="Match type" value={matchType} mono />
                    </div>
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold text-slate-600 mb-1">Lifecycle</div>
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                      <Row label="Created" value={fmt(createdAt)} />
                      <Row label="Created by" value={createdBy ?? "—"} mono />
                      <Row label="Voided" value={fmt(voidedAt)} />
                      <Row label="Voided by" value={voidedBy ?? "—"} mono />
                    </div>
                  </div>

                  {null}
                </div>
              );
            })()}
          </div>
        </div>
      </AppDialog>

      {/* Issues Hub (Phase 5C, read-only) */}
      <AppDialog open={openIssuesHub} onClose={() => setOpenIssuesHub(false)} title="Issues" size="sm">
        <div className="p-3">
          <div className="grid grid-cols-2 gap-3">
            {null /* Full-match only: no partial issues */}

            <button
              type="button"
              className="h-24 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 flex flex-col items-center justify-center gap-2"
              onClick={() => {
                setOpenIssuesHub(false);
                setIssuesKind("notInView");
                setIssuesSearch("");
                setOpenIssuesList(true);
              }}
              title="Active matches referencing items not loaded by current filters"
            >
              <AlertCircle className="h-6 w-6 text-slate-700" />
              <span className="text-xs font-semibold text-slate-900 whitespace-nowrap">Not in view</span>
              <span className="text-[11px] text-slate-500">{issuesCounts.notInView}</span>
            </button>

            <button
              type="button"
              className="h-24 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 flex flex-col items-center justify-center gap-1"
              onClick={() => {
                setOpenIssuesHub(false);
                setIssuesKind("voidHeavy");
                setIssuesSearch("");
                setOpenIssuesList(true);
              }}
              title={`Bank transactions with ${VOID_HEAVY_THRESHOLD}+ reverts`}
            >
              <RotateCcw className="h-6 w-6 text-slate-700" />
              <span className="text-xs font-semibold text-slate-900 whitespace-nowrap">Reverts</span>
              <span className="text-[11px] text-slate-500">{VOID_HEAVY_THRESHOLD}+</span>
              <span className="text-[11px] text-slate-500">{issuesCounts.voidHeavy}</span>
            </button>

            {null /* Full-match MatchGroups: conflicts are not expected (one-active-group-per-item). */}
          </div>

          <div className="mt-2 text-[11px] text-slate-500">
            Read-only diagnostics derived from current view.
          </div>
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
                <div className="text-xs text-slate-500">
                  {visible.length} shown
                </div>
                <input
                  className="h-7 w-[240px] px-2 text-xs border border-slate-200 rounded-md bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                  placeholder="Search issues…"
                  value={issuesSearch}
                  onChange={(e) => setIssuesSearch(e.target.value)}
                  title="Local-only search"
                />
              </div>

              {visible.length === 0 ? (
                <EmptyState label="No issues found" />
              ) : (
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  <div className="max-h-[64vh] overflow-y-auto overflow-x-hidden">
                    <table className="w-full table-fixed border-collapse">
                      <colgroup>
                        <col style={{ width: 120 }} />
                        <col />
                        <col style={{ width: 420 }} />
                        <col style={{ width: 140 }} />
                      </colgroup>
                      <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                        <tr className="h-[30px]">
                          <th className="px-2 text-xs font-semibold text-slate-600 text-left whitespace-nowrap">TYPE</th>
                          <th className="px-2 text-xs font-semibold text-slate-600 text-left whitespace-nowrap">ITEM</th>
                          <th className="px-2 text-xs font-semibold text-slate-600 text-left whitespace-nowrap">DETAIL</th>
                          <th className="px-2 text-xs font-semibold text-slate-600 text-right whitespace-nowrap">OPEN</th>
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
                              className="h-[30px] border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                              onClick={handleRowClick}
                              title="Open related history"
                            >
                              <td className="px-2 text-xs">
                                <StatusChip label={typeLabel} tone="default" />
                              </td>
                              <td className="px-2 text-xs text-slate-900 font-medium truncate" title={r.title}>
                                {r.title}
                              </td>
                              <td className="px-2 text-xs text-slate-600 truncate" title={r.detail}>
                                {r.detail}
                              </td>
                              <td className="px-2 text-xs text-right">
                                {r.bankTxnId ? (
                                  <button
                                    type="button"
                                    className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      openHistoryFor(r.bankTxnId ?? null);
                                    }}
                                  >
                                    History
                                  </button>
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
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
      <AppDialog open={openIssuesInfo} onClose={() => setOpenIssuesInfo(false)} title="Info" size="sm">
        <div className="p-3">
          <div className="text-xs text-slate-700 leading-relaxed">{issuesInfoMsg}</div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="h-7 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
              onClick={() => setOpenIssuesInfo(false)}
            >
              OK
            </button>
          </div>
        </div>
      </AppDialog>

      {/* Export Hub (Phase 5D, read-only) */}
      <AppDialog open={openExportHub} onClose={() => setOpenExportHub(false)} title="Export" size="sm">
        <div className="p-3">
          <div className="grid grid-cols-2 gap-3">
            <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? (reconcileWriteReason ?? noPermTitle) : null}>
              <button
                type="button"
                className="h-24 w-full rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 flex flex-col items-center justify-center gap-2"
                disabled={
                  !canWriteReconcileEffective ||
                  (bankTab === "unmatched" ? bankUnmatchedList : bankMatchedList).length === 0
                }
                title={
                  !canWriteReconcileEffective
                    ? (reconcileWriteReason ?? noPermTitle)
                    : (bankTab === "unmatched" ? bankUnmatchedList : bankMatchedList).length === 0
                      ? "No bank transactions to export"
                      : "Export bank transactions (CSV)"
                }
                onClick={() => {
                  if (!canWriteReconcileEffective) return;
                  exportBankCsv();
                }}
              >
                <Download className="h-6 w-6 text-slate-700" />
                <span className="text-xs font-semibold text-slate-900 whitespace-nowrap">Bank txns</span>
                <span className="text-[11px] text-slate-500">
                  {(bankTab === "unmatched" ? bankUnmatchedList : bankMatchedList).length}
                </span>
              </button>
            </HintWrap>

            {null /* Legacy BankMatch export hidden — Reconcile now uses MatchGroups */}

            <button
              type="button"
              className="h-24 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 flex flex-col items-center justify-center gap-2 col-span-2"
              disabled={reconAuditVisible.length === 0}
              title={reconAuditVisible.length === 0 ? "No audit events to export" : "Export audit events (CSV) — respects current filters"}
              onClick={() => exportAuditEventsCsv()}
            >
              <ClipboardList className="h-6 w-6 text-slate-700" />
              <span className="text-xs font-semibold text-slate-900 whitespace-nowrap">Audit events</span>
              <span className="text-[11px] text-slate-500">{reconAuditVisible.length}</span>
            </button>
          </div>

          <div className="mt-2 text-[11px] text-slate-500">
            CSV exports reflect current account scope and active filters.
          </div>
        </div>
      </AppDialog>

      {/* History Hub (keeps Bank header clean) */}
      <AppDialog open={openHistoryHub} onClose={() => setOpenHistoryHub(false)} title="History" size="sm">
        <div className="p-3">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="h-24 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 flex flex-col items-center justify-center gap-2"
              onClick={() => {
                setOpenHistoryHub(false);
                setOpenStatementHistory(true);
              }}
            >
              <FileText className="h-6 w-6 text-slate-700" />
              <span className="text-xs font-semibold text-slate-900 whitespace-nowrap">Statement history</span>
            </button>

            <button
              type="button"
              className="h-24 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 flex flex-col items-center justify-center gap-2"
              onClick={() => {
                setOpenHistoryHub(false);
                setOpenReconciliationHistory(true);
              }}
            >
              <ClipboardList className="h-6 w-6 text-slate-700" />
              <span className="text-xs font-semibold text-slate-900 whitespace-nowrap">Reconciliation</span>
            </button>
          </div>
        </div>
      </AppDialog>

      {/* Statement history dialog */}
      <AppDialog open={openStatementHistory} onClose={() => setOpenStatementHistory(false)} title="Statement history" size="lg">
        <UploadsList
          title="Bank statement history"
          businessId={selectedBusinessId ?? ""}
          accountId={selectedAccountId ?? undefined}
          type="BANK_STATEMENT"
          limit={25}
          showStatementPeriod
        />
      </AppDialog>

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

      <UploadPanel
        open={openUpload}
        onClose={() => setOpenUpload(false)}
        type="BANK_STATEMENT"
        ctx={{ businessId: selectedBusinessId ?? undefined, accountId: selectedAccountId ?? undefined }}
        allowMultiple={false}
      />
    </div>
  );
}
