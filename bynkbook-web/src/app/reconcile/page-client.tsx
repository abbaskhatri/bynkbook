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

import { GitMerge, RefreshCw, Download, Sparkles, AlertCircle } from "lucide-react";

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

// Parses user input like "123.45" -> 12345n cents (ABS value)
function parseMoneyToAbsCents(input: string): bigint | null {
  const t = (input ?? "").trim();
  if (!t) return null;
  const cleaned = t.replace(/[$,]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return BigInt(Math.round(Math.abs(n) * 100));
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

  // Phase 4D: Match dialog
  const [openMatch, setOpenMatch] = useState(false);
  const [matchBankTxnId, setMatchBankTxnId] = useState<string | null>(null);
  const [matchSearch, setMatchSearch] = useState("");
  const [matchSelectedEntryId, setMatchSelectedEntryId] = useState<string | null>(null);
  const [matchType, setMatchType] = useState<"FULL" | "PARTIAL">("FULL");
  const [matchAmount, setMatchAmount] = useState(""); // dollars input for partial
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);

  // Phase 4D: Adjustment dialog
  const [openAdjust, setOpenAdjust] = useState(false);
  const [adjustEntryId, setAdjustEntryId] = useState<string | null>(null);
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

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

  // Counts
  const expectedCount = allEntriesSorted.length;
  const matchedCount = 0;

  // -------------------------
  // UI primitives
  // -------------------------
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
    return (
      <span className={`font-semibold ${neg ? "!text-red-700" : "text-slate-900"}`}>
        {bal !== null ? formatUsdFromCents(bal) : "—"}
      </span>
    );
  })();

  // IMPORTANT: authReady guard must be AFTER hooks (this is safe now)
  if (!authReady) return null;

  return (
    <div className="flex flex-col gap-2 overflow-hidden" style={containerStyle}>
      {/* Header */}
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

      {/* Two cards */}
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
                    <col style={{ width: 105 }} />
                    <col />
                    <col style={{ width: 140 }} />
                    <col style={{ width: 110 }} />
                    <col style={{ width: 110 }} />
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
                          <td className={`${tdClass} text-right pr-4 tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-800"}`}>
                            {formatUsdFromCents(amt)}
                          </td>
                          <td className={`${tdClass} text-center pl-3`}>
                            <StatusChip label={isPartial ? "Partial" : "Expected"} tone={isPartial ? "warning" : "default"} />
                          </td>
                          <td className={`${tdClass} text-right`}>
                            <button
                              type="button"
                              className="h-6 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
                              onClick={() => {
                                setAdjustEntryId(e.id);
                                setAdjustReason("");
                                setAdjustError(null);
                                setOpenAdjust(true);
                              }}
                              title="Mark entry as adjustment (ledger-only)"
                            >
                              Adjustment
                            </button>
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
                  <col style={{ width: 105 }} />
                  <col />
                  <col style={{ width: 140 }} />
                  <col style={{ width: 120 }} />
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
                                className="h-6 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
                                onClick={() => {
                                  setMatchBankTxnId(t.id);
                                  setMatchSearch("");
                                  setMatchSelectedEntryId(null);
                                  setMatchType("FULL");
                                  setMatchAmount("");
                                  setMatchError(null);
                                  setOpenMatch(true);
                                }}
                              >
                                Match…
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
                                    className="h-6 px-2 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
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
                                  >
                                    Unmatch
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

      {/* Phase 4D: Match dialog */}
      <AppDialog open={openMatch} onClose={() => setOpenMatch(false)} title="Match bank transaction" size="lg">
        <div className="flex flex-col max-h-[70vh]">
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="text-xs text-slate-600 mb-2">
              Select an eligible entry (v1: an entry can be matched to at most one bank transaction).
            </div>

            <div className="mb-2">
              <input
                className="h-8 w-full px-2 text-xs border border-slate-200 rounded-md"
                placeholder="Search entries…"
                value={matchSearch}
                onChange={(e) => setMatchSearch(e.target.value)}
              />
            </div>

            <div className="mb-2 flex items-center gap-2">
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${
                  matchType === "FULL" ? "border-slate-200 bg-white text-slate-900" : "border-transparent text-slate-500"
                }`}
                onClick={() => setMatchType("FULL")}
              >
                Full
              </button>
              <button
                type="button"
                className={`h-7 px-3 text-xs rounded-md border ${
                  matchType === "PARTIAL" ? "border-slate-200 bg-white text-slate-900" : "border-transparent text-slate-500"
                }`}
                onClick={() => setMatchType("PARTIAL")}
              >
                Partial
              </button>

              {matchType === "PARTIAL" ? (
                <input
                  className="h-7 w-[140px] px-2 text-xs border border-slate-200 rounded-md tabular-nums"
                  placeholder="Amount"
                  value={matchAmount}
                  onChange={(e) => setMatchAmount(e.target.value)}
                />
              ) : null}
            </div>

            {matchError ? <div className="text-xs text-red-700 mb-2">{matchError}</div> : null}

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
                    {allEntriesSorted
                      .filter((e: any) => {
                        if (matchByEntryId.has(e.id)) return false; // v1 constraint
                        const q = matchSearch.trim().toLowerCase();
                        if (!q) return true;
                        const payee = (e.payee ?? "").toString().toLowerCase();
                        const date = (e.date ?? "").toString().toLowerCase();
                        return payee.includes(q) || date.includes(q);
                      })
                      .slice(0, 200)
                      .map((e: any) => {
                        const amt = toBigIntSafe(e.amount_cents);
                        const selected = matchSelectedEntryId === e.id;

                        return (
                          <tr
                            key={e.id}
                            className={`h-[30px] border-b border-slate-100 cursor-pointer ${
                              selected ? "bg-emerald-50" : "hover:bg-slate-50"
                            }`}
                            onClick={() => setMatchSelectedEntryId(e.id)}
                          >
                            <td className="px-2 text-xs text-slate-800">{e.date}</td>
                            <td className="px-2 text-xs text-slate-800 font-medium truncate">{e.payee}</td>
                            <td className={`px-2 text-xs text-right tabular-nums ${amt < 0n ? "!text-red-700" : "text-slate-800"}`}>
                              {formatUsdFromCents(amt)}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="shrink-0 pt-3 flex items-center justify-between border-t border-slate-200 mt-3">
            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
              onClick={() => setOpenMatch(false)}
              disabled={matchBusy}
            >
              Cancel
            </button>

            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
              disabled={matchBusy || !matchBankTxnId || !matchSelectedEntryId}
              onClick={async () => {
                if (!selectedBusinessId || !selectedAccountId) return;
                if (!matchBankTxnId || !matchSelectedEntryId) return;

                setMatchBusy(true);
                setMatchError(null);
                try {
                  const entry = allEntriesSorted.find((x: any) => x.id === matchSelectedEntryId);
                  if (!entry) throw new Error("Entry not found");

                  const entryAmt = toBigIntSafe(entry.amount_cents);
                  const sign = entryAmt < 0n ? -1n : 1n;

                  let centsAbs: bigint;
                  if (matchType === "FULL") {
                    centsAbs = absBig(entryAmt);
                  } else {
                    const parsed = parseMoneyToAbsCents(matchAmount);
                    if (parsed == null) throw new Error("Enter a valid partial amount");
                    centsAbs = parsed;
                    if (centsAbs <= 0n) throw new Error("Partial amount must be > 0");
                    if (centsAbs >= absBig(entryAmt)) throw new Error("Partial must be less than full entry amount");
                  }

                  const matchedSigned = (sign * centsAbs).toString();

                  await createMatch({
                    businessId: selectedBusinessId,
                    accountId: selectedAccountId,
                    bankTransactionId: matchBankTxnId,
                    entryId: matchSelectedEntryId,
                    matchType,
                    matchedAmountCents: matchedSigned,
                  });

                  const m = await listMatches({ businessId: selectedBusinessId, accountId: selectedAccountId });
                  setMatches(m?.items ?? []);

                  setOpenMatch(false);
                } catch (e: any) {
                  setMatchError(e?.message ?? "Match failed");
                } finally {
                  setMatchBusy(false);
                }
              }}
            >
              {matchBusy ? "Matching…" : "Match"}
            </button>
          </div>
        </div>
      </AppDialog>

      {/* Phase 4D: Adjustment dialog */}
      <AppDialog open={openAdjust} onClose={() => setOpenAdjust(false)} title="Mark adjustment" size="md">
        <div className="flex flex-col max-h-[55vh]">
          <div className="flex-1 overflow-y-auto">
            <div className="text-xs text-slate-600 mb-2">
              Marking an entry as an adjustment is ledger-only and reversible later.
            </div>

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
              className="h-8 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
              onClick={() => setOpenAdjust(false)}
              disabled={adjustBusy}
            >
              Cancel
            </button>

            <button
              type="button"
              className="h-8 px-3 text-xs rounded-md border border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50"
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
            >
              {adjustBusy ? "Saving…" : "Mark adjustment"}
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
