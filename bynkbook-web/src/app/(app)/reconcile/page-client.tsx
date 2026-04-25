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
import { AppDatePicker } from "@/components/primitives/AppDatePicker";
import { inputH7 } from "@/components/primitives/tokens";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadPanel } from "@/components/uploads/UploadPanel";
import { UploadsList } from "@/components/uploads/UploadsList";
import { AppDialog } from "@/components/primitives/AppDialog";
import { BusyButton } from "@/components/primitives/BusyButton";
import { DialogFooter } from "@/components/primitives/DialogFooter";
import { PillToggle } from "@/components/primitives/PillToggle";
import { Button } from "@/components/ui/button";
import { ringFocus } from "@/components/primitives/tokens";

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
import { getTeam } from "@/lib/api/team";
import { aiSuggestReconcileBank, aiSuggestReconcileEntry } from "@/lib/api/ai";

import { GitMerge, RefreshCw, Download, Sparkles, AlertCircle, Wrench, Undo2, Plus, ClipboardList, RotateCcw, FileText } from "lucide-react";
import { AutoReconcileDialog } from "@/components/reconcile/auto-reconcile-dialog";

function TinySpinner() {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border border-slate-400 border-t-transparent" />;
}

function UpdatingOverlay({ label = "Updating…" }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-white/55 backdrop-blur-[1px]">
      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
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
      ? "bg-primary/10 text-primary border-primary/20"
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

function scoreEntryCandidate(bank: any, entry: any) {
  const bankAmt = toBigIntSafe(bank?.amount_cents);
  const bankAbs = absBig(bankAmt);
  const bankTime = bank?.posted_date ? new Date(bank.posted_date).getTime() : 0;

  const entryAmt = toBigIntSafe(entry?.amount_cents);
  const entryAbs = absBig(entryAmt);

  const diff = entryAbs > bankAbs ? entryAbs - bankAbs : bankAbs - entryAbs;
  const dtMs = bankTime ? Math.abs(new Date(`${entry?.date}T00:00:00Z`).getTime() - bankTime) : 0;
  const dtDays = bankTime ? Math.floor(dtMs / 86_400_000) : 9999;

  const overlapRaw = tokenOverlap(String(bank?.name ?? ""), String(entry?.payee ?? ""));
  const overlap = Math.min(overlapRaw, 3);

  const diffN = Number(diff);
  const tokenBonus = diff === 0n && dtDays <= 3 ? overlap * 50_000 : 0;
  const score = diffN * 1_000_000 + dtDays * 10_000 - tokenBonus;

  return {
    score,
    diff,
    dtDays,
    overlap,
    exactAmount: diff === 0n,
  };
}

function scoreBankCandidate(entry: any, bank: any) {
  const entryAmt = toBigIntSafe(entry?.amount_cents);
  const entryAbs = absBig(entryAmt);
  const entryTime = entry?.date ? new Date(`${entry.date}T00:00:00Z`).getTime() : 0;

  const bankAmt = toBigIntSafe(bank?.amount_cents);
  const bankAbs = absBig(bankAmt);

  const diff = bankAbs > entryAbs ? bankAbs - entryAbs : entryAbs - bankAbs;
  const dtMs = entryTime ? Math.abs(new Date(bank?.posted_date).getTime() - entryTime) : 0;
  const dtDays = entryTime ? Math.floor(dtMs / 86_400_000) : 9999;

  const overlapRaw = tokenOverlap(String(entry?.payee ?? ""), String(bank?.name ?? ""));
  const overlap = Math.min(overlapRaw, 3);

  const diffN = Number(diff);
  const tokenBonus = diff === 0n && dtDays <= 3 ? overlap * 50_000 : 0;
  const score = diffN * 1_000_000 + dtDays * 10_000 - tokenBonus;

  return {
    score,
    diff,
    dtDays,
    overlap,
    exactAmount: diff === 0n,
  };
}

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

function pctConfidence(v: number) {
  const n = Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100);
  return `${n}%`;
}

function categorySuggestionConfidence(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
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

function aiUiMessage(err: any, fallback = "AI suggestions are unavailable right now.") {
  const status = Number(err?.status ?? err?.statusCode ?? err?.response?.status ?? NaN);
  const raw = String(
    err?.message ??
    err?.payload?.message ??
    err?.response?.data?.message ??
    ""
  ).toLowerCase();

  if (
    status === 429 ||
    raw.includes("quota") ||
    raw.includes("rate limit") ||
    raw.includes("too many requests")
  ) {
    return "AI quota reached. Try again in a little while.";
  }

  return fallback;
}

function truncateAiReason(reason: string, max = 120) {
  const s = String(reason ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

function bankSignature(items: any[]): string {
  const count = Array.isArray(items) ? items.length : 0;
  let newest = "";
  for (const t of items ?? []) {
    const d = String(t?.posted_date ?? "");
    if (d && d > newest) newest = d;
  }
  return `${count}|${newest}`;
}

function matchGroupSignature(items: any[]): string {
  const active = (items ?? [])
    .filter((g: any) => String(g?.status ?? "").toUpperCase() === "ACTIVE")
    .map((g: any) => String(g?.id ?? ""))
    .filter(Boolean)
    .sort();
  return active.join("|");
}

function entriesSignature(items: any[]): string {
  const arr = Array.isArray(items) ? items : [];
  return String(arr.length);
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

    if (accountIdFromUrl && !String(accountIdFromUrl).startsWith("temp_")) {
      const picked = list.find((a: any) => String(a.id) === String(accountIdFromUrl));
      if (picked && !picked.archived_at && String(picked.type ?? "").toUpperCase() !== "CASH") {
        return accountIdFromUrl;
      }
    }

    // Reconcile excludes temp_ and CASH accounts.
    const real = list.find(
      (a: any) =>
        !a.archived_at &&
        !String(a.id ?? "").startsWith("temp_") &&
        String(a.type ?? "").toUpperCase() !== "CASH"
    );
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
  const [bankTab, setBankTab] = useState<"unmatched" | "matched">("unmatched");

  // Phase 2 Performance: cap initial rows rendered to keep tab switches instant-fast
  const PAGE_CHUNK = 200;

  const [expectedVisibleN, setExpectedVisibleN] = useState(PAGE_CHUNK);
  const [matchedVisibleN, setMatchedVisibleN] = useState(PAGE_CHUNK);

  const [bankUnmatchedVisibleN, setBankUnmatchedVisibleN] = useState(PAGE_CHUNK);
  const [bankMatchedVisibleN, setBankMatchedVisibleN] = useState(PAGE_CHUNK);

  // B2: Bulk create entries from selected bank txns (unmatched tab)
  const [selectedBankTxnIds, setSelectedBankTxnIds] = useState<Set<string>>(new Set());
  const [bulkCreateAutoMatch, setBulkCreateAutoMatch] = useState(true);
  const [bulkCreateResultByBankTxnId, setBulkCreateResultByBankTxnId] = useState<Record<string, any>>({});
  const [bulkCreateBusy, setBulkCreateBusy] = useState(false);

  // -------------------------
  // Data queries
  // -------------------------
  const entriesQ = useEntries({ businessId: selectedBusinessId, accountId: selectedAccountId, limit: 1000 });

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
  const [revertConfirmOpen, setRevertConfirmOpen] = useState(false);

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
  const refreshQueuedOptsRef = useRef<{ preserveOnEmpty?: boolean } | null>(null);

  function newestPostedDate(items: any[]): string {
    let max = "";
    for (const t of items ?? []) {
      const d = String(t?.posted_date ?? "");
      if (d && d > max) max = d;
    }
    return max;
  }

  async function refreshBankAndMatches(opts?: { preserveOnEmpty?: boolean; skipLegacyMatches?: boolean }) {
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
      // -------------------------
      // Bank transactions
      // -------------------------
      if (myEpoch === refreshEpochRef.current) setBankTxLoading(true);
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

        if (myEpoch === refreshEpochRef.current) {
          setBankTx((prev) => {
            if (opts?.preserveOnEmpty && next.length === 0 && prev.length > 0) return prev;
            return next;
          });
        }
      } catch {
        if (myEpoch === refreshEpochRef.current) {
          setBankTx((prev) => (opts?.preserveOnEmpty ? prev : []));
        }
      } finally {
        if (myEpoch === refreshEpochRef.current) {
          setBankTxLoading(false);
          setBankTruthHydrated(true);
        }
      }

      // -------------------------
      // Legacy matches (read-only, used for export/history fallback)
      // Skip during bounded settle retries to avoid extra post-sync churn.
      // -------------------------
      if (!opts?.skipLegacyMatches) {
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
      }

      // -------------------------
      // MatchGroups (source of truth for matched state)
      // -------------------------
      if (myEpoch === refreshEpochRef.current) setMatchGroupsLoading(true);
      try {
        const mg: any = await listMatchGroups({
          businessId: selectedBusinessId,
          accountId: selectedAccountId,
          status: "all", // needed for History (includes voided groups)
        });
        matchGroupItems = mg?.items ?? [];
        if (myEpoch === refreshEpochRef.current) setMatchGroups(matchGroupItems);
      } catch {
        if (myEpoch === refreshEpochRef.current) setMatchGroups([]);
        matchGroupItems = [];
      } finally {
        if (myEpoch === refreshEpochRef.current) {
          setMatchGroupsLoading(false);
          setMatchGroupsTruthHydrated(true);
        }
      }

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
    const baselineEntriesSig = entriesSignature(entriesQ.data ?? []);

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
        const nextEntries = entriesRes?.data ?? entriesQ.data ?? [];

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
      await refreshBankAndMatches({
        preserveOnEmpty: true,
        skipLegacyMatches: opts?.skipLegacyMatches ?? true,
        ...(opts ?? {}),
      });

      await entriesQ.refetch?.();

      // Optional bounded confirmation pass only for connect flows where needed.
      if (opts?.confirmSettle) {
        await runBoundedPostSyncRefresh({ preserveOnEmpty: true });
      }
    } finally {
      if (!opts?.silent) setRefreshBusy(false);
    }
  }

  function refreshAllDebounced() {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      void refreshTablesFully({ preserveOnEmpty: true, skipLegacyMatches: true });
    }, 150);
  }
    useEffect(() => {
    const onLedgerRefresh = () => {
      void refreshTablesFully({ preserveOnEmpty: true, skipLegacyMatches: true });
    };

    window.addEventListener("bynk:ledger-refresh", onLedgerRefresh as any);
    return () => window.removeEventListener("bynk:ledger-refresh", onLedgerRefresh as any);
  }, [selectedBusinessId, selectedAccountId]);

  // Create-entry busy state per bank txn (instant UX)
  const [createEntryBusyByBankId, setCreateEntryBusyByBankId] = useState<Record<string, boolean>>({});
  const [createEntryErr, setCreateEntryErr] = useState<string | null>(null);
  const [optimisticHiddenBankTxnIds, setOptimisticHiddenBankTxnIds] = useState<Set<string>>(() => new Set());
  const [optimisticPendingEntryDrafts, setOptimisticPendingEntryDrafts] = useState<any[]>([]);

  const createEntryBusy = useMemo(
    () => Object.values(createEntryBusyByBankId).some(Boolean),
    [createEntryBusyByBankId]
  );

  const bankUpdating =
    plaidSyncing ||
    bankTxLoading ||
    matchGroupsLoading;

  const entriesUpdating =
    plaidSyncing ||
    entriesQ.isFetching ||
    matchGroupsLoading;

  // Create-entry confirmation dialog
  const [openCreateEntry, setOpenCreateEntry] = useState(false);
  const [createEntryBankTxnId, setCreateEntryBankTxnId] = useState<string | null>(null);
  const [createEntryAutoMatch, setCreateEntryAutoMatch] = useState(true);

  // Overrides
  const [createEntryMemo, setCreateEntryMemo] = useState("");
  const [createEntryMethod, setCreateEntryMethod] = useState("OTHER");
  const [createEntryCategoryId, setCreateEntryCategoryId] = useState<string>("");
  const [createEntryCategoryName, setCreateEntryCategoryName] = useState<string>("");

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

  // Load bank txns + match groups for the current reconcile scope.
  useEffect(() => {
    if (!selectedBusinessId) return;
    if (!selectedAccountId) return;

    // Reset first-load truth hydration for the new scope before fetching.
    setBankTruthHydrated(false);
    setMatchGroupsTruthHydrated(false);

    // One targeted refresh on mount / scope change (prevents “needs manual refresh” after navigation)
    void qc.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === "entries" &&
        q.queryKey[1] === selectedBusinessId &&
        q.queryKey[2] === selectedAccountId,
    });

    void refreshBankAndMatches({ preserveOnEmpty: true, skipLegacyMatches: true });
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

  const isOpeningLikeEntry = (e: any) => {
    const t = String(e?.type ?? "").toUpperCase();
    const payee = String(e?.payee ?? "").trim().toLowerCase();
    return t === "OPENING" || payee.startsWith("opening balance");
  };

const isReconcileExemptEntry = (e: any) => {
  const t = String(e?.type ?? "").toUpperCase();

  if (isOpeningLikeEntry(e)) return true;
  if (t === "ADJUSTMENT") return true;

  const account = (accountsQ.data ?? []).find(
    (a: any) => String(a.id) === String(selectedAccountId)
  );

  if (String(account?.type ?? "").toUpperCase() === "CASH") return true;

  return false;
};

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
        aiUiMessage(e, "AI suggestions are unavailable right now. Review the top candidates below.")
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
        aiUiMessage(e, "AI suggestions are unavailable right now. Review the top candidates below.")
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

  // Phase 2 Performance: when tab/search changes, reset visible limits (so we don't render thousands immediately)
  useEffect(() => {
    setExpectedVisibleN(PAGE_CHUNK);
    setMatchedVisibleN(PAGE_CHUNK);
  }, [expectedTab, searchQ]);

  useEffect(() => {
    setBankUnmatchedVisibleN(PAGE_CHUNK);
    setBankMatchedVisibleN(PAGE_CHUNK);
  }, [bankTab, searchQ]);

  const matchesRowSearch = (hay: string) => {
    if (!searchQ) return true;
    return (hay ?? "").toLowerCase().includes(searchQ);
  };

  // Tabs: Expected Entries (Phase 2: cap rendered rows for instant tab switches)
  const entriesExpectedList = useMemo(() => {
    const out: any[] = [];

    for (const e of optimisticPendingEntryDrafts) {
      const hay = `${String(e.date ?? "")} ${String(e.payee ?? "")} ${String(e.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;

      out.push(e);
      if (out.length >= expectedVisibleN) return out;
    }

    for (const e of allEntriesSorted) {
      if (matchedEntryIdSet.has(e.id)) continue;
      if (isAdjustedEntry(e)) continue;
      if (isReconcileExemptEntry(e)) continue;

      const hay = `${String(e.date ?? "")} ${String(e.payee ?? "")} ${String(e.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;

      out.push(e);
      if (out.length >= expectedVisibleN) break;
    }
    return out;
  }, [optimisticPendingEntryDrafts, allEntriesSorted, matchedEntryIdSet, searchQ, expectedVisibleN, accountsQ.data, selectedAccountId]);

  const entriesMatchedList = useMemo(() => {
    const out: any[] = [];
    for (const e of allEntriesSorted) {
      if (!matchedEntryIdSet.has(e.id)) continue;
      if (isReconcileExemptEntry(e)) continue;

      const hay = `${String(e.date ?? "")} ${String(e.payee ?? "")} ${String(e.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;

      out.push(e);
      if (out.length >= matchedVisibleN) break;
    }
    return out;
  }, [allEntriesSorted, matchedEntryIdSet, searchQ, matchedVisibleN, accountsQ.data, selectedAccountId]);

  // Counts (uncapped) for tab labels — computed cheaply in one pass
  const { expectedCount, matchedCount } = useMemo(() => {
    let exp = 0;
    let mat = 0;

    for (const e of optimisticPendingEntryDrafts) {
      const hay = `${String(e.date ?? "")} ${String(e.payee ?? "")} ${String(e.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;
      exp++;
    }

    for (const e of allEntriesSorted) {
      if (isReconcileExemptEntry(e)) continue;

      const isMat = matchedEntryIdSet.has(e.id);
      if (!isMat && isAdjustedEntry(e)) continue;

      const hay = `${String(e.date ?? "")} ${String(e.payee ?? "")} ${String(e.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;

      if (isMat) mat++;
      else exp++;
    }
    return { expectedCount: exp, matchedCount: mat };
  }, [optimisticPendingEntryDrafts, allEntriesSorted, matchedEntryIdSet, searchQ, accountsQ.data, selectedAccountId]);

  // Tabs: Bank Transactions (Phase 2: cap rendered rows for instant tab switches)
  const bankUnmatchedList = useMemo(() => {
    const out: any[] = [];
    for (const t of bankTxSorted) {
      const hay = `${String(t.posted_date ?? "")} ${String(t.name ?? "")} ${String(t.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;

      const id = String(t.id ?? "");
      if (!id) continue;
      if (optimisticHiddenBankTxnIds.has(id)) continue;
      if (activeGroupByBankTxnId.has(id)) continue;

      out.push(t);
      if (out.length >= bankUnmatchedVisibleN) break;
    }
    return out;
  }, [bankTxSorted, optimisticHiddenBankTxnIds, activeGroupByBankTxnId, searchQ, bankUnmatchedVisibleN]);

  useEffect(() => {
    setSelectedBankTxnIds(new Set());
  }, [bankTab, selectedBusinessId, selectedAccountId]);

  const bankMatchedList = useMemo(() => {
    const out: any[] = [];
    for (const t of bankTxSorted) {
      const hay = `${String(t.posted_date ?? "")} ${String(t.name ?? "")} ${String(t.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;

      const id = String(t.id ?? "");
      if (!id) continue;
      if (!activeGroupByBankTxnId.has(id)) continue;

      out.push(t);
      if (out.length >= bankMatchedVisibleN) break;
    }
    return out;
  }, [bankTxSorted, activeGroupByBankTxnId, searchQ, bankMatchedVisibleN]);

  // Counts (uncapped) for tab labels
  const { bankUnmatchedCount, bankMatchedCount } = useMemo(() => {
    let u = 0;
    let m = 0;
    for (const t of bankTxSorted) {
      const hay = `${String(t.posted_date ?? "")} ${String(t.name ?? "")} ${String(t.amount_cents ?? "")}`;
      if (!matchesRowSearch(hay)) continue;

      const id = String(t.id ?? "");
      if (!id) continue;

      if (activeGroupByBankTxnId.has(id)) m++;
      else if (!optimisticHiddenBankTxnIds.has(id)) u++;
    }
    return { bankUnmatchedCount: u, bankMatchedCount: m };
  }, [bankTxSorted, optimisticHiddenBankTxnIds, activeGroupByBankTxnId, searchQ]);

  const entriesTruthReady =
    !entriesQ.isLoading &&
    matchGroupsTruthHydrated &&
    !matchGroupsLoading;

  const bankTruthReady =
    bankTruthHydrated &&
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

  const displayEntriesExpectedList = entriesTruthReady
    ? entriesExpectedList
    : (entriesTruthSnapshot?.expectedList ?? []);
  const displayEntriesMatchedList = entriesTruthReady
    ? entriesMatchedList
    : (entriesTruthSnapshot?.matchedList ?? []);
  const displayExpectedCount = entriesTruthReady
    ? expectedCount
    : (entriesTruthSnapshot?.expectedCount ?? 0);
  const displayMatchedCount = entriesTruthReady
    ? matchedCount
    : (entriesTruthSnapshot?.matchedCount ?? 0);

  const displayBankUnmatchedList = bankTruthReady
    ? bankUnmatchedList
    : (bankTruthSnapshot?.unmatchedList ?? []);
  const displayBankMatchedList = bankTruthReady
    ? bankMatchedList
    : (bankTruthSnapshot?.matchedList ?? []);
  const displayBankUnmatchedCount = bankTruthReady
    ? bankUnmatchedCount
    : (bankTruthSnapshot?.unmatchedCount ?? 0);
  const displayBankMatchedCount = bankTruthReady
    ? bankMatchedCount
    : (bankTruthSnapshot?.matchedCount ?? 0);

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
                  : "Review AI suggestions"
          }
          onClick={() => {
            if (!canWriteReconcileEffective) return;
            setOpenAutoReconcile(true);
          }}
        >
          <Sparkles className="h-3.5 w-3.5" /> AI suggestions
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

  const inputClass = inputH7;

  // Plaid balance display (must be declared before differenceBar usage)
  const balanceText = useMemo(() => {
    const bal = plaid?.lastKnownBalanceCents ? toBigIntSafe(plaid.lastKnownBalanceCents) : null;
    return bal !== null ? formatUsdFromCents(bal) : "—";
  }, [plaid?.lastKnownBalanceCents]);

  const filterLeft = (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="w-[170px]">
        <AppDatePicker value={from} onChange={setFrom} ariaLabel="From date" />
      </div>
      <div className="w-[170px]">
        <AppDatePicker value={to} onChange={setTo} ariaLabel="To date" />
      </div>
      <div className="w-[220px]">
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} className={inputClass} placeholder="Search…" />
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
  // Phase 2: targeted retry (prevents full router.refresh storms)
  async function retryReconcileSurfaces() {
    await refreshBankAndMatches({ preserveOnEmpty: true });
    await entriesQ.refetch?.();
  }

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
            setCreateEntryAutoMatch(true);
          }}
          title="Create entry"
          size="md"
          footer={
            <DialogFooter
              left={
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 whitespace-nowrap">Auto-match</span>
                  <PillToggle
                    checked={createEntryAutoMatch}
                    onCheckedChange={(next) => setCreateEntryAutoMatch(next)}
                    disabled={!canWriteReconcileEffective}
                  />
                </div>
              }
              right={
                <>
                  <BusyButton
                    variant="secondary"
                    size="md"
                    onClick={() => setOpenCreateEntry(false)}
                    disabled={!!(createEntryBankTxnId && createEntryBusyByBankId[String(createEntryBankTxnId)])}
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
                      busy={!!(createEntryBankTxnId && createEntryBusyByBankId[String(createEntryBankTxnId)])}
                      busyLabel="Creating…"
                      disabled={!canWriteReconcileEffective || !createEntryBankTxnId}
                      onClick={async () => {
                        if (!selectedBusinessId || !selectedAccountId) return;
                        if (!canWriteReconcileEffective) return;

                        const bankId = createEntryBankTxnId ? String(createEntryBankTxnId) : "";
                        if (!bankId) return;

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
                          const suggestedCategoryId = String(
                            topSuggestion?.category_id ?? topSuggestion?.categoryId ?? ""
                          ).trim();

                          await createEntryFromBankTransaction({
                            businessId: selectedBusinessId,
                            accountId: selectedAccountId,
                            bankTransactionId: bankId,
                            autoMatch: !!createEntryAutoMatch,
                            memo: createEntryMemo,
                            method: createEntryMethod,
                            category_id: createEntryCategoryId.trim() || "",
                            suggested_category_id: suggestedCategoryId || "",
                          });

                          await refreshTablesFully({
                            preserveOnEmpty: true,
                            skipLegacyMatches: true,
                            silent: true,
                          });

                          setOptimisticPendingEntryDrafts((prev) =>
                            prev.filter((x: any) => String(x?.__source_bank_txn_id ?? "") !== bankId)
                          );
                          setOptimisticHiddenBankTxnIds((prev) => {
                            const next = new Set(prev);
                            next.delete(bankId);
                            return next;
                          });

                          clearMutErr();
                          setOpenCreateEntry(false);
                          setCreateEntryBankTxnId(null);
                        } catch (e: any) {
                          setOptimisticPendingEntryDrafts((prev) =>
                            prev.filter((x: any) => String(x?.__source_bank_txn_id ?? "") !== bankId)
                          );
                          setOptimisticHiddenBankTxnIds((prev) => {
                            const next = new Set(prev);
                            next.delete(bankId);
                            return next;
                          });

                          applyMutationError(e, "Can’t create entry");
                          setCreateEntryErr(null);
                        } finally {
                          clearPending(bankId);
                          setCreateEntryBusyByBankId((m) => ({ ...m, [bankId]: false }));
                        }
                      }}
                    >
                      Create entry
                    </BusyButton>
                  </HintWrap>
                </>
              }
            />
          }
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
                        className={[
                          "h-8 w-full px-2 text-xs rounded-md border border-slate-200 bg-white",
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
                      <div className="text-[11px] font-semibold text-slate-600 mb-1">Category</div>

                      {/* Phase F1: suggestion-only category chips (top 3) */}
                      <div className="mb-2">
                        {createEntrySugLoading ? (
                          <div className="flex flex-wrap gap-2">
                            <div className="h-6 w-24 rounded-full bg-slate-100 animate-pulse" />
                            <div className="h-6 w-28 rounded-full bg-slate-100 animate-pulse" />
                            <div className="h-6 w-20 rounded-full bg-slate-100 animate-pulse" />
                          </div>
                        ) : createEntrySuggestions.length ? (
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap gap-2">
                              {createEntrySuggestions.slice(0, 3).map((s: any, idx: number) => {
                                const id = String(s?.category_id ?? s?.categoryId ?? "");
                                const name = String(s?.category_name ?? s?.categoryName ?? "—");
                                const conf = categorySuggestionConfidence(s?.confidence);
                                const tierLabel = categorySuggestionTierLabel(s?.confidence_tier);
                                const sourceLabel = categorySuggestionSourceLabel(s?.source);
                                const reasonText = String(s?.reason ?? "").trim();
                                const selected = createEntryCategoryId && createEntryCategoryId === id;

                                return (
                                  <button
                                    key={id || name}
                                    type="button"
                                    title={[tierLabel, sourceLabel, reasonText].filter(Boolean).join(" • ")}
                                    className={[
                                      "h-7 px-2.5 rounded-full border text-[11px] inline-flex items-center gap-2",
                                      selected
                                        ? "border-primary/20 bg-primary/10 text-primary"
                                        : idx === 0
                                          ? "border-primary/20 bg-primary/5 text-primary hover:bg-primary/10"
                                          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                                      ringFocus,
                                    ].join(" ")}
                                    onClick={() => {
                                      if (!id) return;
                                      setCreateEntryCategoryId(id);
                                      setCreateEntryCategoryName(name);
                                      setCategoryQuery("");
                                    }}
                                  >
                                    <span className="font-medium truncate max-w-[150px]">{name}</span>
                                    <span
                                      className={[
                                        "inline-flex h-4 items-center rounded-full px-1.5 text-[10px] font-semibold",
                                        selected ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-600",
                                      ].join(" ")}
                                    >
                                      {conf}%
                                    </span>
                                  </button>
                                );
                              })}
                            </div>

                            <div className="text-[11px] text-slate-500">
                              {categorySuggestionTierLabel(createEntrySuggestions?.[0]?.confidence_tier)}
                              {" • "}
                              {categorySuggestionSourceLabel(createEntrySuggestions?.[0]?.source)}
                              {" • "}
                              {categorySuggestionConfidence(createEntrySuggestions?.[0]?.confidence)}%
                            </div>

                            <div
                              className="text-[11px] text-slate-500 truncate"
                              title={String(createEntrySuggestions?.[0]?.reason ?? "Review this entry before saving")}
                            >
                              {String(createEntrySuggestions?.[0]?.reason ?? "").trim()
                                ? String(createEntrySuggestions?.[0]?.reason ?? "")
                                : "Review this entry before saving"}
                            </div>
                          </div>
                        ) : createEntrySugErr ? (
                          <div className="text-[11px] text-slate-500">Suggestions unavailable</div>
                        ) : (
                          <div className="text-[11px] text-slate-500">No strong suggestion yet. You can still choose a category below.</div>
                        )}
                      </div>

                      <div className="relative overflow-visible">
                        <input
                          className={[
                            "h-8 w-full px-2 text-xs rounded-md border border-slate-200 bg-white",
                            ringFocus,
                          ].join(" ")}
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
                            className="ml-2 text-primary hover:text-primary"
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
                      className={[
                        "min-h-[70px] w-full px-2 py-1 text-xs rounded-md border border-slate-200 bg-white",
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
              <div className="text-[11px] text-slate-500 min-h-[16px]">
                {entriesTruthSettling || entriesUpdating ? (
                  <span className="inline-flex items-center gap-1.5">
                    <TinySpinner />
                    <span>{plaidSyncing ? "Syncing bank data…" : "Saving changes…"}</span>
                  </span>
                ) : "\u00A0"}
              </div>
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
                Expected ({displayExpectedCount})
              </button>
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${expectedTab === "matched" ? "border-slate-200 bg-white text-slate-900" : "border-transparent text-slate-500 hover:bg-slate-50"
                  }`}
                onClick={() => setExpectedTab("matched")}
              >
                Matched ({displayMatchedCount})
              </button>
            </div>

            {bankTab === "unmatched" && selectedBankTxnIds.size > 0 ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-900">
                    {selectedBankTxnIds.size} selected
                  </span>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 whitespace-nowrap">Auto-match</span>
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

                        await refreshTablesFully({
                          preserveOnEmpty: true,
                          skipLegacyMatches: true,
                          silent: true,
                        });

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
                    Create entries
                  </BusyButton>
                </HintWrap>
              </div>
            ) : null}
          </div>

          <div className="h-px bg-slate-200" />

          <div className="relative flex-1 min-h-0 overflow-hidden">
            <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
              {entriesTruthBlocking ? (
                <div className="p-3">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : displayEntriesActiveList.length === 0 ? (
                <EmptyState label={expectedTab === "expected" ? "No expected entries in this period" : "No matched entries in this period"} />
              ) : (
                <>
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
                    {displayEntriesActiveList.map((e: any) => {
                      const amt = toBigIntSafe(e.amount_cents);
                      const payee = (e.payee ?? "").trim();
                      const isOptimisticPending = Boolean(e?.__optimistic_pending);

                      const isMatched = !isOptimisticPending && matchedEntryIdSet.has(e.id);

                      const g = !isOptimisticPending ? (activeGroupByEntryId.get(String(e.id)) ?? null) : null;
                      const hasAdjustment = g ? matchGroupHasAdjustment(g) : false;

                      const rowTone = isMatched ? " bg-primary/10" : isOptimisticPending ? " bg-amber-50/70" : "";

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
                            <div className="inline-flex items-center justify-center gap-2">
                              <StatusChip
                                label={isOptimisticPending ? "Saving" : isMatched ? "Matched" : "Expected"}
                                tone={isOptimisticPending ? "warning" : isMatched ? "success" : "default"}
                              />
                              {hasAdjustment ? <StatusChip label="Adjustment" tone="info" /> : null}
                            </div>
                          </td>
                          <td className={`${tdClass} text-right`}>
                            <div className="flex items-center justify-end gap-2">
                              {pendingById[String(e.id)] || isOptimisticPending ? <TinySpinner /> : null}

                              {isOptimisticPending ? null : expectedTab === "matched" ? (
                                <button
                                  type="button"
                                  className={["h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50", ringFocus].join(" ")}
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
                                      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white ${ringFocus} ${canWriteReconcileEffective ? "hover:bg-slate-50" : "opacity-50 cursor-not-allowed"}`}
                                      disabled={!canWriteReconcileEffective}
                                      title={canWriteReconcileEffective ? "Match ledger entry (AI assisted)" : (reconcileWriteReason ?? noPermTitle)}
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
                                      <GitMerge className="h-4 w-4 text-slate-700" />
                                    </button>
                                  </HintWrap>
                                  
                                  <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? reconcileWriteReason : null}>
                                    <button
                                      type="button"
                                      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white ${ringFocus} ${canWriteReconcileEffective ? "hover:bg-slate-50" : "opacity-50 cursor-not-allowed"
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

                {/* Phase 2 Performance: load more (keeps initial render bounded) */}
                {expectedTab === "expected" && displayExpectedCount > displayEntriesExpectedList.length ? (
                  <div className="p-2 flex justify-center">
                    <button
                      type="button"
                      className="h-7 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
                      onClick={() => setExpectedVisibleN((n) => n + PAGE_CHUNK)}
                    >
                      Load more
                    </button>
                  </div>
                ) : expectedTab === "matched" && displayMatchedCount > displayEntriesMatchedList.length ? (
                  <div className="p-2 flex justify-center">
                    <button
                      type="button"
                      className="h-7 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
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

                          await refreshTablesFully({
                            preserveOnEmpty: true,
                            skipLegacyMatches: true,
                          });
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

                          await refreshTablesFully({
                            preserveOnEmpty: true,
                            skipLegacyMatches: true,
                            silent: true,
                          });
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
              {bankTruthSettling || bankUpdating ? (
                <span className="text-[11px] text-slate-500 inline-flex items-center gap-1.5">
                  <TinySpinner />
                  <span>{plaidSyncing ? "Syncing bank data…" : "Saving changes…"}</span>
                </span>
              ) : null}
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${bankTab === "unmatched" ? "border-slate-200 bg-white text-slate-900" : "border-transparent text-slate-500 hover:bg-slate-50"
                  }`}
                onClick={() => setBankTab("unmatched")}
              >
                Unmatched ({displayBankUnmatchedCount})
              </button>
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${bankTab === "matched" ? "border-slate-200 bg-white text-slate-900" : "border-transparent text-slate-500 hover:bg-slate-50"
                  }`}
                onClick={() => setBankTab("matched")}
              >
                Matched ({displayBankMatchedCount})
              </button>
            </div>
          </div>

          <div className="h-px bg-slate-200" />

          <div className="relative flex-1 min-h-0 overflow-hidden">
            <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
              {bankTruthBlocking ? (
                <div className="p-3">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : displayBankActiveList.length === 0 ? (
                <EmptyState
                  label={
                    bankTab === "unmatched"
                      ? "No bank transactions in this period"
                      : "No matched bank transactions in this period"
                  }
                />
              ) : (
                <>
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
                            className="h-4 w-4"
                            checked={
                              displayBankUnmatchedList.length > 0 &&
                              selectedBankTxnIds.size === displayBankUnmatchedList.length
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedBankTxnIds(new Set(displayBankUnmatchedList.map((x: any) => String(x.id))));
                              } else {
                                setSelectedBankTxnIds(new Set());
                              }
                            }}
                            aria-label="Select all unmatched bank transactions"
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
                    {displayBankActiveList.map((t: any) => {

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
                      const rowTone = isMatched ? " bg-primary/10" : "";

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
                                  className={["h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50", ringFocus].join(" ")}
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
                                <>
                                  <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? reconcileWriteReason : null}>
                                    <button
                                      type="button"
                                      className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white ${ringFocus} ${canWriteReconcileEffective ? "hover:bg-slate-50" : "opacity-50 cursor-not-allowed"}`}
                                      disabled={!canWriteReconcileEffective}
                                      title={canWriteReconcileEffective ? "Match bank transaction to entry (AI assisted)" : (reconcileWriteReason ?? noPermTitle)}
                                      aria-label="Match bank transaction"
                                      onClick={() => {
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
                                      <GitMerge className="h-4 w-4 text-slate-700" />
                                    </button>
                                  </HintWrap>
                                </>
                              )}

                              <HintWrap disabled={!canWriteReconcileEffective} reason={!canWriteReconcileEffective ? reconcileWriteReason : null}>
                                <button
                                  type="button"
                                  className={`h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white ${ringFocus} ${canWriteReconcileEffective ? "hover:bg-slate-50" : "opacity-50 cursor-not-allowed"
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
                                    setCreateEntryAutoMatch(true);

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
                                      className={["h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50", ringFocus].join(" ")}
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

                {/* Phase 2 Performance: load more (keeps initial render bounded) */}
                {bankTab === "unmatched" && displayBankUnmatchedCount > displayBankUnmatchedList.length ? (
                  <div className="p-2 flex justify-center">
                    <button
                      type="button"
                      className="h-7 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
                      onClick={() => setBankUnmatchedVisibleN((n) => n + PAGE_CHUNK)}
                    >
                      Load more
                    </button>
                  </div>
                ) : bankTab === "matched" && displayBankMatchedCount > displayBankMatchedList.length ? (
                  <div className="p-2 flex justify-center">
                    <button
                      type="button"
                      className="h-7 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
                      onClick={() => setBankMatchedVisibleN((n) => n + PAGE_CHUNK)}
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
      </div>

      {/* Phase 6B: Snapshots dialog */}
      <AppDialog
        open={openSnapshots}
        onClose={() => {
          setOpenSnapshots(false);
        }}
        title="Snapshots"
        size="sm"
        footer={
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
        }
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
                        className={`w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-slate-50 ${selected ? "bg-accent" : "bg-white"
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
                                      if (res?.url) window.open(res.url, "_blank");
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
        footer={
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
                          setMatchGroups((prev) => {
                            const next = Array.isArray(prev) ? prev.slice() : [];
                            const gid = String(createdGroup.id);
                            if (!next.some((g: any) => String(g?.id) === gid)) next.unshift(createdGroup);
                            return next;
                          });
                        }

                        await refreshTablesFully({
                          preserveOnEmpty: true,
                          skipLegacyMatches: true,
                          silent: true,
                        });

                        clearMutErr();
                        setOpenMatch(false);
                        setMatchBankTxnId(null);
                        setMatchSearch("");
                        setMatchSelectedEntryIds(new Set());
                        setMatchAiSuggestions([]);
                        setMatchSuggestError(null);
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
                    title={matchBusy ? "Matching…" : "Match selected entries (exact sum required)"}
                    aria-label="Match selected entries"
                  >
                    {matchBusy ? "Matching…" : `Match ${matchSelectedEntryIds.size} entr${matchSelectedEntryIds.size === 1 ? "y" : "ies"}`}
                  </BusyButton>
                </HintWrap>
              </>
            }
          />
        }
      >
        <div className="flex flex-col max-h-[70vh]">
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="text-xs text-slate-600 mb-2">Select ledger entries that sum exactly to the bank transaction amount.</div>

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

                  <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-xs">
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
                      <span className={`tabular-nums ${deltaAbs === 0n ? "text-primary" : "text-amber-700"}`}>
                        {deltaAbs === 0n ? "0.00" : formatUsdFromCents(deltaAbs)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-1 text-[11px] text-slate-500">Select multiple entries until Remaining Δ is exactly 0. No manual amount input.</div>
                </div>
              );
            })()}

            {matchError ? <div className="text-xs text-red-700 mb-2">{matchError}</div> : null}

            {/* AI suggestions (LLM rerank on deterministic candidate gate; full-match only) */}
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
                  <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="text-[11px] font-semibold text-primary mb-2">AI suggestions</div>
                    <div className="space-y-2">
                      <div className="h-10 w-full rounded bg-slate-200 animate-pulse" />
                      <div className="h-10 w-full rounded bg-slate-200 animate-pulse" />
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

              if (rows.length === 0) {
                return (
                  <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="text-[11px] font-semibold text-primary">AI suggestions</div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      No eligible suggestions found for this bank transaction.
                    </div>
                  </div>
                );
              }

              return (
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold text-primary">AI suggestions</div>
                    <div className="text-[11px] text-slate-500">LLM rerank • full-match only</div>
                  </div>

                  {matchSuggestError ? (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
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
                          className={`w-full text-left min-h-[46px] px-2.5 py-1.5 rounded-md border ${selected ? "border-primary/20 bg-primary/10" : "border-slate-200 bg-white hover:bg-slate-50"} flex items-center justify-between gap-3`}
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
                            <span className="truncate text-xs font-medium text-slate-800">
                              <span className={idx === 0 ? "text-primary" : "text-slate-500"}>{rankLabel}</span>
                              <span className="text-slate-400"> • </span>
                              {e.payee}
                            </span>
                            <span className="truncate max-w-[420px] text-[11px] text-slate-500" title={fullReason}>{reason}</span>
                          </span>
                          <span className="shrink-0 flex items-center gap-2">
                            {ai ? (
                              <span className="inline-flex h-5 items-center rounded-full border border-primary/20 bg-primary/10 px-2 text-[11px] font-semibold text-primary">
                                {pctConfidence(ai.confidence)}
                              </span>
                            ) : null}
                            <span className={`text-xs tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-800"}`}>
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
                      <th className="px-2 text-xs font-semibold text-slate-600 text-left">PAYEE</th>
                      <th className="px-2 text-xs font-semibold text-slate-600 text-right">AMOUNT</th>
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
                              className={`h-[30px] border-b border-slate-100 cursor-pointer ${selected ? "bg-primary/10" : "hover:bg-slate-50"}`}
                              onClick={() => {
                                setMatchSelectedEntryIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(e.id)) next.delete(e.id);
                                  else next.add(e.id);
                                  return next;
                                });
                              }}
                            >
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

                    setAdjustBusy(true);
                    setAdjustError(null);
                    clearMutErr();
                    markPending(String(adjustEntryId));

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
                      clearPending(String(adjustEntryId));
                      setAdjustBusy(false);
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
            <div className="text-xs text-slate-600 mb-2">
              Marking an entry as an adjustment is ledger-only and reversible later.
            </div>

            <div className="mb-2">
              <label className="text-xs text-slate-600">Reason (required)</label>
              <textarea
                className={[
                  "mt-1 w-full min-h-[90px] p-2 text-xs border border-slate-200 rounded-md bg-white",
                  ringFocus,
                ].join(" ")}
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
              />
            </div>

            {adjustError ? <div className="text-xs text-red-700 mb-2">{adjustError}</div> : null}
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
        footer={
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
                          setMatchGroups((prev) => {
                            const next = Array.isArray(prev) ? prev.slice() : [];
                            const gid = String(createdGroup.id);
                            if (!next.some((g: any) => String(g?.id) === gid)) next.unshift(createdGroup);
                            return next;
                          });
                        }

                        await refreshTablesFully({
                          preserveOnEmpty: true,
                          skipLegacyMatches: true,
                          silent: true,
                        });

                        clearMutErr();
                        setOpenEntryMatch(false);
                        setEntryMatchEntryId(null);
                        setEntryMatchSearch("");
                        setEntryMatchSelectedBankTxnIds(new Set());
                        setEntryAiSuggestions([]);
                        setEntrySuggestError(null);
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
                    {entryMatchBusy ? "Saving…" : "Create match"}
                  </BusyButton>
                </HintWrap>
              </>
            }
          />
        }
      >
        <div className="flex flex-col max-h-[70vh]">
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="text-xs text-slate-600 mb-2">
              Select bank transactions that sum exactly to the ledger entry amount.
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

            {/* AI suggestions */}
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
                  <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="text-[11px] font-semibold text-primary mb-2">AI suggestions</div>
                    <div className="space-y-2">
                      <div className="h-10 w-full rounded bg-slate-200 animate-pulse" />
                      <div className="h-10 w-full rounded bg-slate-200 animate-pulse" />
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

              if (rows.length === 0) {
                return (
                  <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="text-[11px] font-semibold text-primary">AI suggestions</div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      No eligible suggestions found for this entry.
                    </div>
                  </div>
                );
              }

              return (
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold text-primary">AI suggestions</div>
                    <div className="text-[11px] text-slate-500">LLM rerank • full-match only</div>
                  </div>

                  {entrySuggestError ? (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
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
                          className={`w-full text-left min-h-[46px] px-2.5 py-1.5 rounded-md border ${selected ? "border-primary/20 bg-primary/10" : "border-slate-200 bg-white hover:bg-slate-50"} flex items-center justify-between gap-3`}
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
                            <span className="truncate text-xs font-medium text-slate-800">
                              <span className={idx === 0 ? "text-primary" : "text-slate-500"}>{rankLabel}</span>
                              <span className="text-slate-400"> • </span>
                              {t.name}
                            </span>
                            <span className="truncate max-w-[420px] text-[11px] text-slate-500" title={fullReason}>{reason}</span>
                          </span>
                          <span className="shrink-0 flex items-center gap-2">
                            {ai ? (
                              <span className="inline-flex h-5 items-center rounded-full border border-primary/20 bg-primary/10 px-2 text-[11px] font-semibold text-primary">
                                {pctConfidence(ai.confidence)}
                              </span>
                            ) : null}
                            <span className={`text-xs tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-800"}`}>
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
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-slate-900">Combine Match Summary</div>
                    <div className="text-xs text-slate-500 tabular-nums">Δ {deltaAbs === 0n ? "0.00" : formatUsdFromCents(deltaAbs)}</div>
                  </div>

                  <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-xs">
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
                      <span className={`tabular-nums ${deltaAbs === 0n ? "text-primary" : "text-amber-700"}`}>
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
                              className={`h-[30px] border-b border-slate-100 cursor-pointer ${selected ? "bg-primary/10" : "hover:bg-slate-50"}`}
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

          {null}
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
                className={["h-7 w-[200px] px-2 text-xs border border-slate-200 rounded-md bg-white", ringFocus].join(" ")}
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
        footer={
          (() => {
            const ev = selectedReconAudit as any | null;
            const groupId = ev?.groupId ? String(ev.groupId) : null;
            const bankTxnId = ev?.bankTxnIds?.[0] ? String(ev.bankTxnIds[0]) : null;

            const isActiveGroup = !!groupId && activeGroupByBankTxnId.has(String(bankTxnId ?? ""));
            const canRevert = Boolean(canWrite && selectedBusinessId && selectedAccountId && groupId && isActiveGroup);

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
                    disabled={!canRevert}
                    title={!canWrite ? noPermTitle : "Revert bank match (void all active matches for this bank transaction)"}
                    aria-label="Revert bank match"
                    onClick={() => {
                      if (!selectedBusinessId || !selectedAccountId) return;
                      if (!bankTxnId) return;
                      setRevertConfirmOpen(true);
                    }}
                  >
                    Revert bank match
                  </BusyButton>
                }
              />
            );
          })()
        }
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
              <div className="mb-2 text-[11px] text-slate-500">
                {bankTxnId
                  ? alreadyVoided
                    ? "No active bank matches to revert."
                    : "Use “Revert bank match” below to void all active matches for this bank transaction."
                  : "Bank transaction id unavailable."}
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
      </AppDialog>

            <AppDialog
        open={revertConfirmOpen}
        onClose={() => {
          if (revertBusy) return;
          setRevertConfirmOpen(false);
        }}
        title="Revert bank match"
        size="xs"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setRevertConfirmOpen(false)}
              disabled={revertBusy}
            >
              Cancel
            </Button>

            <BusyButton
              variant="danger"
              size="md"
              busy={revertBusy}
              busyLabel="Reverting…"
              onClick={async () => {
                const ev = selectedReconAudit as any | null;
                const groupId = ev?.groupId ? String(ev.groupId) : null;
                const bankTxnId = ev?.bankTxnIds?.[0] ? String(ev.bankTxnIds[0]) : null;

                if (!selectedBusinessId || !selectedAccountId || !groupId || !bankTxnId) return;

                setRevertBusy(true);
                setRevertError(null);
                clearMutErr();

                markPending(String(bankTxnId));
                markPending(String(groupId));

                try {
                  await voidMatchGroup({
                    businessId: selectedBusinessId,
                    accountId: selectedAccountId,
                    matchGroupId: groupId,
                    reason: "User unmatch",
                  });

                  await refreshTablesFully({ preserveOnEmpty: true });

                  clearMutErr();
                  setRevertConfirmOpen(false);
                  setOpenReconAuditDetail(false);
                  setSelectedReconAudit(null);
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
              Revert match
            </BusyButton>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-slate-700">
          <div className="font-medium text-slate-900">Revert bank match?</div>
          <div className="text-xs text-slate-600">
            This will void all active matches for the selected bank transaction. The action is recorded in history and can be re-matched later.
          </div>

          {revertError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {revertError}
            </div>
          ) : null}
        </div>
      </AppDialog>

      {/* Issues Hub (Phase 5C, read-only) */}
      <AppDialog
        open={openIssuesHub}
        onClose={() => setOpenIssuesHub(false)}
        title="Issues"
        size="sm"
      >
        <div className="p-3">
          <div className="grid grid-cols-2 gap-3">
            {null /* Full-match only: no partial issues */}

            <button
              type="button"
              className={["h-24 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 flex flex-col items-center justify-center gap-2", ringFocus].join(" ")}
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
              className={["h-24 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 flex flex-col items-center justify-center gap-1", ringFocus].join(" ")}
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
                  className={["h-7 w-[240px] px-2 text-xs border border-slate-200 rounded-md bg-white", ringFocus].join(" ")}
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
      <AppDialog
        open={openIssuesInfo}
        onClose={() => setOpenIssuesInfo(false)}
        title="Info"
        size="sm"
      >
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
                className={["h-20 w-full rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1.5 px-3 py-2", ringFocus].join(" ")}
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
              className={["h-20 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1.5 px-3 py-2 sm:col-span-2", ringFocus].join(" ")}
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
      <AppDialog
        open={openHistoryHub}
        onClose={() => setOpenHistoryHub(false)}
        title="History"
        size="sm"
      >
        <div className="p-3">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className={["h-24 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 flex flex-col items-center justify-center gap-2", ringFocus].join(" ")}
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
              className={["h-24 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 flex flex-col items-center justify-center gap-2", ringFocus].join(" ")}
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
