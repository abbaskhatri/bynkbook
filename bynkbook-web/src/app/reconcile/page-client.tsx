"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useEntries } from "@/lib/queries/useEntries";

import { PlaidConnectButton } from "@/components/plaid/PlaidConnectButton";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { FilterBar } from "@/components/primitives/FilterBar";
import { StatusChip } from "@/components/primitives/StatusChip";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadPanel } from "@/components/uploads/UploadPanel";
import { UploadsList } from "@/components/uploads/UploadsList";
import { AppDialog } from "@/components/primitives/AppDialog";

import { plaidStatus, plaidSync } from "@/lib/api/plaid";
import { listBankTransactions } from "@/lib/api/bankTransactions";
import { listMatches, createMatch, unmatchBankTransaction, markEntryAdjustment } from "@/lib/api/matches";

import { GitMerge, RefreshCw, Download, Sparkles, AlertCircle, Wrench, Undo2, Plus } from "lucide-react";

function toBigIntSafe(v: unknown): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  } catch {}
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

  // Layout: keep only table bodies scrolling
  const containerStyle = { height: "calc(100vh - 56px - 48px)" as const };

  // -------------------------
  // Auth gate (must not return early before hooks)
  // -------------------------
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

  const selectedAccountId = useMemo(() => {
    const list = accountsQ.data ?? [];
    if (accountIdFromUrl) return accountIdFromUrl;
    return list.find((a) => !a.archived_at)?.id ?? "";
  }, [accountsQ.data, accountIdFromUrl]);

  useEffect(() => {
    if (!authReady) return;
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
    authReady,
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
  // Data queries
  // -------------------------
  const entriesQ = useEntries({ businessId: selectedBusinessId, accountId: selectedAccountId, limit: 200 });

  const [bankTxLoading, setBankTxLoading] = useState(false);
  const [bankTx, setBankTx] = useState<any[]>([]);

  const [matchesLoading, setMatchesLoading] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);

  // Plaid status + sync UI
  const [plaidLoading, setPlaidLoading] = useState(false);
  const [plaidSyncing, setPlaidSyncing] = useState(false);
  const [plaid, setPlaid] = useState<any>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);

  // Dialogs
  const [openUpload, setOpenUpload] = useState(false);
  const [openStatementHistory, setOpenStatementHistory] = useState(false);

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
  const [entryMatchSelectedBankTxnId, setEntryMatchSelectedBankTxnId] = useState<string | null>(null);
  const [entryMatchSearch, setEntryMatchSearch] = useState("");
  const [entryMatchBusy, setEntryMatchBusy] = useState(false);
  const [entryMatchError, setEntryMatchError] = useState<string | null>(null);

  // Hide adjusted entries locally (until we refetch entries with adjustment status)
  const [locallyAdjusted, setLocallyAdjusted] = useState<Set<string>>(() => new Set());

  // Load Plaid status
  useEffect(() => {
    if (!authReady) return;
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
  }, [authReady, selectedBusinessId, selectedAccountId]);

  // Load bank txns + matches
  useEffect(() => {
    if (!authReady) return;
    if (!selectedBusinessId) return;
    if (!selectedAccountId) return;

    let cancelled = false;
    (async () => {
      setBankTxLoading(true);
      try {
        const res = await listBankTransactions({
          businessId: selectedBusinessId,
          accountId: selectedAccountId,
          from: from || undefined,
          to: to || undefined,
          limit: 500,
        });
        if (!cancelled) setBankTx(res?.items ?? []);
      } catch {
        if (!cancelled) setBankTx([]);
      } finally {
        if (!cancelled) setBankTxLoading(false);
      }

      setMatchesLoading(true);
      try {
        const m = await listMatches({ businessId: selectedBusinessId, accountId: selectedAccountId });
        if (!cancelled) setMatches(m?.items ?? []);
      } catch {
        if (!cancelled) setMatches([]);
      } finally {
        if (!cancelled) setMatchesLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authReady, selectedBusinessId, selectedAccountId, from, to]);

  // -------------------------
  // Derived + sorting (oldest-first)
  // -------------------------
  const allEntries = (entriesQ.data ?? []).filter((e: any) => !locallyAdjusted.has(e.id));

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

  // v1 constraint: one entry -> at most one match
  const matchByEntryId = useMemo(() => {
    const m = new Map<string, any>();
    for (const x of matches ?? []) {
      if (!x?.entry_id) continue;
      m.set(x.entry_id, x);
    }
    return m;
  }, [matches]);

  // bank txn can have many matches => sum abs
  const matchedAbsByBankTxnId = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const x of matches ?? []) {
      const id = x?.bank_transaction_id;
      if (!id) continue;
      const amt = toBigIntSafe(x.matched_amount_cents);
      const prev = m.get(id) ?? 0n;
      m.set(id, prev + absBig(amt));
    }
    return m;
  }, [matches]);

  const remainingAbsByBankTxnId = useMemo(() => {
    const m = new Map<string, bigint>();
    for (const t of bankTxSorted ?? []) {
      const bankAbs = absBig(toBigIntSafe(t.amount_cents));
      const matchedAbs = matchedAbsByBankTxnId.get(t.id) ?? 0n;
      const remaining = bankAbs - matchedAbs;
      m.set(t.id, remaining > 0n ? remaining : 0n);
    }
    return m;
  }, [bankTxSorted, matchedAbsByBankTxnId]);

  const expectedCount = allEntriesSorted.length;
  const matchedCount = 0;

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
      <button type="button" disabled title="Coming soon" className={disabledBtn}>
        <Download className="h-3.5 w-3.5" /> Export
      </button>
      <button type="button" disabled title="Coming soon" className={disabledBtn}>
        <Sparkles className="h-3.5 w-3.5" /> Smart Auto Reconcile
      </button>
      <button
        type="button"
        disabled
        title="Coming soon"
        className="h-7 px-2 text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-800 opacity-60 cursor-not-allowed inline-flex items-center gap-1"
      >
        <AlertCircle className="h-3.5 w-3.5" /> <span className="font-semibold">2</span> issues
      </button>
    </div>
  );

  const inputClass =
    "h-7 w-full px-2 py-0 text-xs leading-none bg-white border border-slate-200 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 focus-visible:ring-offset-0";

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
            <div className="text-slate-500">Begin balance</div>
            <div className="font-semibold text-slate-900">$0.00</div>
          </div>
          <div className="leading-tight">
            <div className="text-slate-500">Cleared</div>
            <div className="font-semibold text-slate-900">$0.00</div>
          </div>
          <div className="leading-tight">
            <div className="text-slate-500">Difference</div>
            <div className="font-semibold text-emerald-700">$0.00</div>
          </div>
          <div className="leading-tight">
            <div className="text-slate-500">Ending balance</div>
            <div className="font-semibold text-slate-900">Coming soon</div>
          </div>
          <div className="leading-tight">
            <div className="text-slate-500">Outstanding</div>
            <div className="font-semibold text-slate-900">Coming soon</div>
          </div>
          <div className="leading-tight">
            <div className="text-slate-500">Last sync</div>
            <div className="font-semibold text-slate-900">Coming soon</div>
          </div>
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
      className={`inline-flex items-center px-2 h-5 rounded-full border text-[11px] font-medium whitespace-nowrap leading-none ${
        plaid?.connected ? "bg-slate-50 text-slate-700 border-slate-200" : "bg-white text-slate-500 border-slate-200"
      }`}
    >
      {plaidLoading ? "Loading…" : plaid?.connected ? "Connected" : "Not connected"}
    </span>
  );

  const balanceSpan = (() => {
    const bal = plaid?.lastKnownBalanceCents ? toBigIntSafe(plaid.lastKnownBalanceCents) : null;
    const neg = bal !== null && bal < 0n;
    return <span className={`font-semibold ${neg ? "!text-red-700" : "text-slate-900"}`}>{bal !== null ? formatUsdFromCents(bal) : "—"}</span>;
  })();

  if (!authReady) return null;

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

        <div className="h-px bg-slate-200" />
        {differenceBar}
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
              <button type="button" className="h-7 px-3 text-xs rounded-md border border-slate-200 bg-white text-slate-900">
                Expected ({expectedCount})
              </button>
              <button type="button" className="h-7 px-3 text-xs rounded-md border border-transparent text-slate-500" disabled title="Coming soon">
                Matched ({matchedCount})
              </button>
            </div>
          </div>

          <div className="h-px bg-slate-200" />

          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
              {entriesQ.isLoading ? (
                <div className="p-3">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : allEntriesSorted.length === 0 ? (
                <EmptyState label="No expected entries in this period" />
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
                    {allEntriesSorted.map((e: any) => {
                      const amt = toBigIntSafe(e.amount_cents);
                      const payee = (e.payee ?? "").trim();

                      const m = matchByEntryId.get(e.id);
                      const matchedAmt = m ? toBigIntSafe(m.matched_amount_cents) : 0n;
                      const isPartial = m ? absBig(matchedAmt) > 0n && absBig(matchedAmt) < absBig(amt) : false;

                      return (
                        <tr key={e.id} className={trClass + (isPartial ? " bg-amber-50" : "")}>
                          <td className={`${tdClass} text-center`}>{e.date}</td>
                          <td className={`${tdClass} font-medium truncate`}>{payee}</td>
                          <td className={`${tdClass} text-right pr-4 tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-800"}`}>{formatUsdFromCents(amt)}</td>
                          <td className={`${tdClass} text-center pl-3`}>
                            <StatusChip label={isPartial ? "Partial" : "Expected"} tone={isPartial ? "warning" : "default"} />
                          </td>
                          <td className={`${tdClass} text-right`}>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                                onClick={() => {
                                  setEntryMatchEntryId(e.id);
                                  setEntryMatchSelectedBankTxnId(null);
                                  setEntryMatchSearch("");
                                  setEntryMatchError(null);
                                  setOpenEntryMatch(true);
                                }}
                                title="Match entry"
                                aria-label="Match entry"
                              >
                                <GitMerge className="h-4 w-4 text-slate-700" />
                              </button>

                              <button
                                type="button"
                                className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                                onClick={() => {
                                  setAdjustEntryId(e.id);
                                  setAdjustReason("");
                                  setAdjustError(null);
                                  setOpenAdjust(true);
                                }}
                                title="Mark adjustment (ledger-only)"
                                aria-label="Mark adjustment"
                              >
                                <Wrench className="h-4 w-4 text-slate-700" />
                              </button>
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
                      <span className="tabular-nums">Balance: {balanceSpan}</span>
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
                      onClick={() => setOpenStatementHistory(true)}
                    >
                      <Download className="h-3.5 w-3.5" /> Statement history
                    </button>

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
                        setSyncMsg(null);
                        setPendingMsg(null);
                        setPlaidLoading(true);
                        try {
                          const res = await plaidStatus(selectedBusinessId ?? "", selectedAccountId ?? "");
                          setPlaid(res);
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
                      onClick={() => setOpenStatementHistory(true)}
                    >
                      <Download className="h-3.5 w-3.5" /> History
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
              <button type="button" className="h-7 px-3 text-xs rounded-md border border-slate-200 bg-white text-slate-900">
                Unmatched ({bankTxSorted.length})
              </button>
              <button type="button" className="h-7 px-3 text-xs rounded-md border border-transparent text-slate-500" disabled title="Coming soon">
                Matched (0)
              </button>
            </div>
          </div>

          <div className="h-px bg-slate-200" />

          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="h-full min-h-0 overflow-y-auto overflow-x-hidden">
              <table className="w-full table-fixed border-collapse">
                <colgroup>
                  <col style={{ width: 110 }} />
                  <col />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 110 }} />
                </colgroup>

                <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200">
                  <tr className="h-[28px]">
                    <th className={`${thClass} pl-8.5`}>DATE</th>
                    <th className={thClass}>DESCRIPTION</th>
                    <th className={`${thClass} text-right pr-4`}>AMOUNT</th>
                    <th className={`${thClass} text-right`}>ACTIONS</th>
                  </tr>
                </thead>

                <tbody>
                  {bankTxLoading ? (
                    <tr>
                      <td colSpan={4} className="p-3">
                        <Skeleton className="h-24 w-full" />
                      </td>
                    </tr>
                  ) : bankTxSorted.length === 0 ? (
                    <tr>
                      <td colSpan={4}>
                        <EmptyState label="No bank transactions in this period" />
                      </td>
                    </tr>
                  ) : (
                    bankTxSorted.map((t: any) => {
                      const amt = toBigIntSafe(t.amount_cents);
                      const dateStr = (() => {
                        try {
                          const d = new Date(t.posted_date);
                          return d.toISOString().slice(0, 10);
                        } catch {
                          return String(t.posted_date ?? "");
                        }
                      })();

                      return (
                        <tr key={t.id} className={trClass}>
                          <td className={`${tdClass} text-center`}>{dateStr}</td>
                          <td className={`${tdClass} font-medium truncate`}>
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="truncate">{t.name}</span>
                              {t.source ? (
                                <span className="shrink-0">
                                  <StatusChip label={String(t.source)} tone="default" />
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className={`${tdClass} text-right pr-4 tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-800"}`}>
                            {formatUsdFromCents(amt)}
                          </td>

                          <td className={`${tdClass} text-right`}>
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                                onClick={() => {
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
                                title="Match this bank transaction"
                                aria-label="Match bank transaction"
                              >
                                <GitMerge className="h-4 w-4 text-slate-700" />
                              </button>

                              <button
                                type="button"
                                className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white opacity-50 cursor-not-allowed focus-visible:outline-none"
                                disabled
                                title="Create entry (Coming soon)"
                                aria-label="Create entry (coming soon)"
                              >
                                <Plus className="h-4 w-4 text-slate-700" />
                              </button>

                              {(() => {
                                const matchedAbs = matchedAbsByBankTxnId.get(t.id) ?? 0n;
                                const bankAbs = absBig(toBigIntSafe(t.amount_cents));
                                const isMatched = matchedAbs === bankAbs && bankAbs > 0n;
                                const isPartial = matchedAbs > 0n && matchedAbs < bankAbs;
                                if (!isMatched && !isPartial) return null;

                                return (
                                  <button
                                    type="button"
                                    className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
                                    onClick={async () => {
                                      if (!selectedBusinessId || !selectedAccountId) return;
                                      try {
                                        await unmatchBankTransaction({
                                          businessId: selectedBusinessId,
                                          accountId: selectedAccountId,
                                          bankTransactionId: t.id,
                                        });
                                        const m = await listMatches({ businessId: selectedBusinessId, accountId: selectedAccountId });
                                        setMatches(m?.items ?? []);
                                      } catch {
                                        // ignore
                                      }
                                    }}
                                    title="Unmatch (void audit)"
                                    aria-label="Unmatch bank transaction"
                                  >
                                    <Undo2 className="h-4 w-4 text-slate-700" />
                                  </button>
                                );
                              })()}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Phase 4D: Match dialog (Bank txn → many entries) */}
      <AppDialog open={openMatch} onClose={() => setOpenMatch(false)} title="Match bank transaction" size="lg">
        <div className="flex flex-col max-h-[70vh]">
          {/* Body (scroll only this area) */}
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="text-xs text-slate-600 mb-2">Select eligible entries (v1: entry matches at most one bank txn).</div>

            <div className="mb-2">
              <input
                className="h-8 w-full px-2 text-xs border border-slate-200 rounded-md"
                placeholder="Search entries…"
                value={matchSearch}
                onChange={(e) => setMatchSearch(e.target.value)}
              />
            </div>

            {(() => {
              const bank = bankTxSorted.find((x: any) => x.id === matchBankTxnId);
              const bankAmt = bank ? toBigIntSafe(bank.amount_cents) : 0n;
              const bankAbs = absBig(bankAmt);

              let selectedAbs = 0n;
              for (const id of matchSelectedEntryIds) {
                const e = allEntriesSorted.find((x: any) => x.id === id);
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

                  <div className="mt-1 text-[11px] text-slate-500">v1: select multiple entries until Remaining Δ is exactly 0. No manual amount input.</div>
                </div>
              );
            })()}

            {matchError ? <div className="text-xs text-red-700 mb-2">{matchError}</div> : null}

            {/* Suggested (top candidates) */}
            {(() => {
              const bank = bankTxSorted.find((x: any) => x.id === matchBankTxnId);
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
                  const overlap = tokenOverlap(String(bank.name ?? ""), String(e.payee ?? ""));
                  const score = Number(diff) * 1_000_000 + dt - overlap * 50_000;
                  return { e, score };
                })
                .sort((a: any, b: any) => a.score - b.score)
                .map((x: any) => x.e);

              const suggested = ranked.slice(0, 3);
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
                          className={`w-full text-left h-10 px-2 rounded-md border ${
                            selected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"
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
                                const overlap = tokenOverlap(String(bank.name ?? ""), String(e.payee ?? ""));
                                return `Amount Δ ${formatUsdFromCents(diff)} • Text similarity ${overlap}`;
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
                      const bank = bankTxSorted.find((x: any) => x.id === matchBankTxnId);
                      const bankAmt = bank ? toBigIntSafe(bank.amount_cents) : 0n;
                      const bankAbs = absBig(bankAmt);
                      const bankSign = bankAmt < 0n ? -1n : 1n;
                      const bankTime = bank?.posted_date ? new Date(bank.posted_date).getTime() : 0;

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
                          const dt = bankTime ? Math.abs(new Date(`${e.date}T00:00:00Z`).getTime() - bankTime) : 0;
                          const score = Number(diff) * 1_000_000 + dt;
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

            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
              disabled={(() => {
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
                try {
                  for (const entryId of matchSelectedEntryIds) {
                    const entry = allEntriesSorted.find((x: any) => x.id === entryId);
                    if (!entry) continue;

                    await createMatch({
                      businessId: selectedBusinessId,
                      accountId: selectedAccountId,
                      bankTransactionId: matchBankTxnId,
                      entryId,
                      matchType: "FULL",
                      matchedAmountCents: String(entry.amount_cents),
                    });
                  }

                  const m = await listMatches({ businessId: selectedBusinessId, accountId: selectedAccountId });
                  setMatches(m?.items ?? []);
                  await entriesQ.refetch?.();

                  setOpenMatch(false);
                } catch (e: any) {
                  setMatchError(e?.message ?? "Match failed");
                } finally {
                  setMatchBusy(false);
                }
              }}
              title={matchBusy ? "Matching…" : "Match selected entries (exact sum required)"}
              aria-label="Match selected entries"
            >
              {matchBusy ? "Matching…" : `Match ${matchSelectedEntryIds.size} entr${matchSelectedEntryIds.size === 1 ? "y" : "ies"}`}
            </button>
          </div>
        </div>
      </AppDialog>

      {/* Adjustment dialog */}
      <AppDialog open={openAdjust} onClose={() => setOpenAdjust(false)} title="Mark adjustment" size="md">
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

            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
              disabled={adjustBusy || !adjustEntryId || !adjustReason.trim()}
              onClick={async () => {
                if (!selectedBusinessId || !selectedAccountId) return;
                if (!adjustEntryId) return;

                setAdjustBusy(true);
                setAdjustError(null);
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

                  setOpenAdjust(false);
                } catch (e: any) {
                  setAdjustError(e?.message ?? "Failed to mark adjustment");
                } finally {
                  setAdjustBusy(false);
                }
              }}
              title={adjustBusy ? "Saving…" : "Mark adjustment"}
              aria-label="Mark adjustment"
            >
              {adjustBusy ? "Saving…" : "Mark adjustment"}
            </button>
          </div>
        </div>
      </AppDialog>

      {/* Entry → Bank match dialog */}
      <AppDialog open={openEntryMatch} onClose={() => setOpenEntryMatch(false)} title="Match entry" size="lg">
        <div className="flex flex-col max-h-[70vh]">
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="text-xs text-slate-600 mb-2">
              Select an eligible bank transaction (same sign; must have enough remaining; v1: entry matches at most one bank txn).
            </div>

            <div className="mb-2">
              <input
                className="h-8 w-full px-2 text-xs border border-slate-200 rounded-md"
                placeholder="Search bank transactions…"
                value={entryMatchSearch}
                onChange={(e) => setEntryMatchSearch(e.target.value)}
              />
            </div>

            {entryMatchError ? <div className="text-xs text-red-700 mb-2">{entryMatchError}</div> : null}

            {/* Suggested (top candidates) */}
            {(() => {
              const entry = allEntriesSorted.find((x: any) => x.id === entryMatchEntryId);
              if (!entry) return null;

              const entryAmt = toBigIntSafe(entry.amount_cents);
              const entryAbs = absBig(entryAmt);
              const entrySign = entryAmt < 0n ? -1n : 1n;

              const q = entryMatchSearch.trim().toLowerCase();

              const ranked = bankTxSorted
                .filter((t: any) => {
                  const bankAmt = toBigIntSafe(t.amount_cents);
                  const bankSign = bankAmt < 0n ? -1n : 1n;
                  if (bankSign !== entrySign) return false;

                  const remaining = remainingAbsByBankTxnId.get(t.id) ?? 0n;
                  if (remaining < entryAbs) return false;

                  if (!q) return true;
                  const name = (t.name ?? "").toString().toLowerCase();
                  const date = (t.posted_date ?? "").toString().toLowerCase();
                  return name.includes(q) || date.includes(q);
                })
                .map((t: any) => {
                  const bankAbs = absBig(toBigIntSafe(t.amount_cents));
                  const diff = bankAbs > entryAbs ? bankAbs - entryAbs : entryAbs - bankAbs;
                  const dt = Math.abs(new Date(t.posted_date).getTime() - new Date(`${entry.date}T00:00:00Z`).getTime());
                  const score = Number(diff) * 1_000_000 + dt;
                  return { t, score };
                })
                .sort((a: any, b: any) => a.score - b.score)
                .map((x: any) => x.t);

              const suggested = ranked.slice(0, 3);
              if (suggested.length === 0) return null;

              return (
                <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                  <div className="text-[11px] font-semibold text-slate-600 mb-1">Suggested</div>
                  <div className="flex flex-col gap-1">
                    {suggested.map((t: any) => {
                      const amt = toBigIntSafe(t.amount_cents);
                      const selected = entryMatchSelectedBankTxnId === t.id;
                      const dateStr = (() => {
                        try {
                          const d = new Date(t.posted_date);
                          return d.toISOString().slice(0, 10);
                        } catch {
                          return String(t.posted_date ?? "");
                        }
                      })();

                      return (
                        <button
                          key={t.id}
                          type="button"
                          className={`w-full text-left h-8 px-2 rounded-md border ${
                            selected ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"
                          } flex items-center justify-between gap-2`}
                          onClick={() => setEntryMatchSelectedBankTxnId(t.id)}
                          title="Select suggested bank transaction"
                        >
                          <span className="truncate text-xs font-medium text-slate-800">{dateStr} • {t.name}</span>
                          <span className={`shrink-0 text-xs tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-800"}`}>{formatUsdFromCents(amt)}</span>
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
                          return remaining >= entryAbs;
                        })
                        .slice(0, 200)
                        .map((t: any) => {
                          const amt = toBigIntSafe(t.amount_cents);
                          const selected = entryMatchSelectedBankTxnId === t.id;
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
                              onClick={() => setEntryMatchSelectedBankTxnId(t.id)}
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

            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500"
              disabled={entryMatchBusy || !entryMatchEntryId || !entryMatchSelectedBankTxnId}
              title="Continue"
              aria-label="Continue"
              onClick={() => {
                if (!entryMatchEntryId || !entryMatchSelectedBankTxnId) return;

                setMatchBankTxnId(entryMatchSelectedBankTxnId);
                setMatchSearch("");
                setMatchError(null);
                setMatchSelectedEntryIds(() => new Set([entryMatchEntryId]));
                setOpenEntryMatch(false);
                setOpenMatch(true);
              }}
            >
              {entryMatchBusy ? "Loading…" : "Continue"}
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
