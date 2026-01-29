"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { LedgerTableShell } from "@/components/ledger/ledger-table-shell";
import { FilterBar } from "@/components/primitives/FilterBar";
import { FileText } from "lucide-react";

import { getPnl, getPayees, getCashflow, getActivity, getCategories } from "@/lib/api/reports";
import { downloadCsv } from "@/lib/csv";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";

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

// BigInt-safe accounting currency formatting (USD)
function addCommas(intStr: string) {
  const s = intStr.replace(/^0+(?=\d)/, "");
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const idxFromEnd = s.length - i;
    out.push(s[i]);
    if (idxFromEnd > 1 && idxFromEnd % 3 === 1) out.push(",");
  }
  return out.join("");
}

function formatUsdAccountingFromCents(centsStr: string) {
  let n: bigint;
  try {
    n = BigInt(centsStr);
  } catch {
    return { text: "—", isNeg: false };
  }

  const isNeg = n < 0n;
  const abs = isNeg ? -n : n;

  const dollars = abs / 100n;
  const cents = abs % 100n;

  const dollarsStr = addCommas(dollars.toString());
  const cents2 = cents.toString().padStart(2, "0");

  const base = `$${dollarsStr}.${cents2}`;
  return { text: isNeg ? `(${base})` : base, isNeg };
}

type TabKey = "summary" | "pnl" | "payees" | "cashflow" | "activity" | "categories";

export default function ReportsPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId") ?? null;
  const businessId = bizIdFromUrl ?? (businessesQ.data?.[0]?.id ?? null);

  const accountsQ = useAccounts(businessId);
  const activeAccountOptions = useMemo(() => {
    return (accountsQ.data ?? []).filter((a: any) => !a.archived_at);
  }, [accountsQ.data]);

  const selectedAccountId = useMemo(() => {
    const v = sp.get("accountId");
    return v ? String(v) : "all";
  }, [sp]);

  const activeBusinessName = useMemo(() => {
    if (!businessId) return null;
    const list = businessesQ.data ?? [];
    const b = list.find((x: any) => x?.id === businessId);
    return b?.name ?? "Business";
  }, [businessId, businessesQ.data]);

const accountId = selectedAccountId;

const [tab, setTab] = useState<TabKey>("summary");
  const [from, setFrom] = useState(firstOfThisMonth());
  const [to, setTo] = useState(todayYmd());

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

const [pnl, setPnl] = useState<any>(null);
const [payees, setPayees] = useState<any>(null);
const [cashflow, setCashflow] = useState<any>(null);
const [activity, setActivity] = useState<any>(null);
const [categories, setCategories] = useState<any>(null);

const [lastRun, setLastRun] = useState<
  Partial<Record<TabKey, { ranAtIso: string; from: string; to: string; accountId: string }>>
>({});

const definitionsText = useMemo(() => {
  if (tab === "summary") {
    return "Income=sum(INCOME). Expenses=sum(EXPENSE). Net=Income+Expenses. Cash flow is currently entry-based.";
  }
  if (tab === "pnl") return "Income=sum(INCOME). Expenses=sum(EXPENSE). Net=Income+Expenses.";
  if (tab === "cashflow")
    return "Currently entry-based. Cash in=sum(positive entries). Cash out=sum(negative entries). Net=Cash in+Cash out.";
  if (tab === "activity") return "Row-level entries in range (entry date basis).";
  if (tab === "categories") return "Grouped by category (sum of entry amounts). Includes Uncategorized bucket.";
  return "Grouped by payee (sum of entry amounts).";
}, [tab]);

const last = lastRun[tab];

const lastRunText = useMemo(() => {
  if (!last) return null;
  const d = new Date(last.ranAtIso);
  const when = d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const acctLabel = last.accountId === "all" ? "All accounts" : "Selected account";
  return `Last run: ${when} • ${last.from} → ${last.to} • ${acctLabel}`;
}, [last]);

  async function run() {
    if (!businessId) return;
    setLoading(true);
    setErr(null);

    try {
      if (tab === "summary") {
        const [p, y] = await Promise.all([
          getPnl(businessId, { from, to, accountId }),
          getPayees(businessId, { from, to, accountId }),
        ]);
        setPnl(p);
        setPayees(y);
        setLastRun((prev) => ({
          ...prev,
          summary: { ranAtIso: new Date().toISOString(), from, to, accountId },
        }));
        return;
      }

      if (tab === "pnl") {
        const res = await getPnl(businessId, { from, to, accountId });
        setPnl(res);
        setLastRun((prev) => ({
          ...prev,
          pnl: { ranAtIso: new Date().toISOString(), from, to, accountId },
        }));
        return;
      }

      if (tab === "payees") {
        const res = await getPayees(businessId, { from, to, accountId });
        setPayees(res);
        setLastRun((prev) => ({
          ...prev,
          payees: { ranAtIso: new Date().toISOString(), from, to, accountId },
        }));
        return;
      }

      if (tab === "cashflow") {
        const res = await getCashflow(businessId, { from, to, accountId });
        setCashflow(res);
        setLastRun((prev) => ({
          ...prev,
          cashflow: { ranAtIso: new Date().toISOString(), from, to, accountId },
        }));
        return;
      }

      if (tab === "activity") {
        const res = await getActivity(businessId, { from, to, accountId });
        setActivity(res);
        setLastRun((prev) => ({
          ...prev,
          activity: { ranAtIso: new Date().toISOString(), from, to, accountId },
        }));
        return;
      }

      if (tab === "categories") {
        const res = await getCategories(businessId, { from, to, accountId });
        setCategories(res);
        setLastRun((prev) => ({
          ...prev,
          categories: { ranAtIso: new Date().toISOString(), from, to, accountId },
        }));
        return;
      }
    } catch (e: any) {
      setErr(e?.message ?? "Failed to run report");
    } finally {
      setLoading(false);
    }
  }

  function exportPnlCsv() {
    if (!pnl) return;
    const filename = `BynkBook_${activeBusinessName ?? "Business"}_PnL_${from}_to_${to}.csv`;
    downloadCsv(
      filename,
      ["Metric", "Amount"],
      [
        ["Income", formatUsdAccountingFromCents(pnl.totals.income_cents).text],
        ["Expenses", formatUsdAccountingFromCents(pnl.totals.expense_cents).text],
        ["Net", formatUsdAccountingFromCents(pnl.totals.net_cents).text],
      ]
    );
  }

  function exportPayeesCsv() {
    if (!payees) return;
    const filename = `BynkBook_${activeBusinessName ?? "Business"}_Payees_${from}_to_${to}.csv`;
    downloadCsv(
      filename,
      ["Payee", "Amount", "Count"],
      (payees.rows ?? []).map((r: any) => [r.payee, formatUsdAccountingFromCents(r.amount_cents).text, r.count])
    );
  }

  function exportCashflowCsv() {
  if (!cashflow) return;
  const filename = `BynkBook_${activeBusinessName ?? "Business"}_CashFlow_${from}_to_${to}.csv`;
  downloadCsv(
    filename,
    ["Metric", "Amount"],
    [
      ["Cash in", formatUsdAccountingFromCents(cashflow.totals.cash_in_cents).text],
      ["Cash out", formatUsdAccountingFromCents(cashflow.totals.cash_out_cents).text],
      ["Net", formatUsdAccountingFromCents(cashflow.totals.net_cents).text],
    ]
  );
}

function exportActivityCsv() {
  if (!activity) return;
  const filename = `BynkBook_${activeBusinessName ?? "Business"}_Activity_${from}_to_${to}.csv`;
  downloadCsv(
    filename,
    ["Date", "Account", "Type", "Payee", "Memo", "Amount", "Entry ID"],
    (activity.rows ?? []).map((r: any) => [
      r.date,
      r.account_name,
      r.type,
      r.payee ?? "",
      r.memo ?? "",
      formatUsdAccountingFromCents(r.amount_cents).text,
      r.entry_id,
    ])
  );
}

function exportCategoriesCsv() {
  if (!categories) return;
  const filename = `BynkBook_${activeBusinessName ?? "Business"}_Categories_${from}_to_${to}.csv`;
  downloadCsv(
    filename,
    ["Category", "Amount", "Count"],
    (categories.rows ?? []).map((r: any) => [
      r.category,
      formatUsdAccountingFromCents(r.amount_cents).text,
      r.count,
    ])
  );
}

  return (
    <div className="flex flex-col gap-2 overflow-hidden max-w-6xl">
      {/* Header shell */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<FileText className="h-4 w-4" />}
            title="Reports"
            afterTitle={
              <div className="h-6 px-1.5 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center">
                <CapsuleSelect
                  variant="flat"
                  loading={accountsQ.isLoading}
                  value={selectedAccountId}
                  onValueChange={(v) => {
                    if (!businessId) return;
                    const params = new URLSearchParams(sp.toString());
                    params.set("businessId", businessId);
                    params.set("accountId", v);
                    router.replace(`/reports?${params.toString()}`);
                  }}
                  options={[
                    { value: "all", label: "All accounts" },
                    ...activeAccountOptions.map((a: any) => ({ value: a.id, label: a.name })),
                  ]}
                  placeholder="All accounts"
                />
              </div>
            }
            right={
              tab === "summary" ? (
                <Button
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  onClick={() => {
                    exportPnlCsv();
                    exportPayeesCsv();
                  }}
                  disabled={!pnl || !payees}
                  title={!pnl || !payees ? "Run P&L and Payees to enable Summary export." : "Export CSV"}
                >
                  Export CSV
                </Button>
              ) : tab === "pnl" ? (
                <Button
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  onClick={exportPnlCsv}
                  disabled={!pnl}
                  title={!pnl ? "Run report to enable export" : "Export CSV"}
                >
                  Export CSV
                </Button>
              ) : tab === "payees" ? (
                <Button
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  onClick={exportPayeesCsv}
                  disabled={!payees}
                  title={!payees ? "Run report to enable export" : "Export CSV"}
                >
                  Export CSV
                </Button>
              ) : tab === "cashflow" ? (
                <Button
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  onClick={exportCashflowCsv}
                  disabled={!cashflow}
                  title={!cashflow ? "Run report to enable export" : "Export CSV"}
                >
                  Export CSV
                </Button>
              ) : tab === "activity" ? (
                <Button
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  onClick={exportActivityCsv}
                  disabled={!activity}
                  title={!activity ? "Run report to enable export" : "Export CSV"}
                >
                  Export CSV
                </Button>
              ) : tab === "categories" ? (
                <Button
                  variant="outline"
                  className="h-7 px-3 text-xs"
                  onClick={exportCategoriesCsv}
                  disabled={!categories}
                  title={!categories ? "Run report to enable export" : "Export CSV"}
                >
                  Export CSV
                </Button>
              ) : (
                <Button variant="outline" className="h-7 px-3 text-xs" disabled title="Run report to enable export">
                  Export CSV
                </Button>
              )
            }
          />
        </div>

        <div className="mt-2 h-px bg-slate-200" />

        {/* Tabs row */}
        <div className="px-3 py-2">
          <div className="flex gap-2 text-sm">
            {[
  { key: "summary", label: "Summary" },
  { key: "pnl", label: "P&L" },
  { key: "cashflow", label: "Cash Flow" },
  { key: "activity", label: "Activity" },
  { key: "categories", label: "Categories" },
  { key: "payees", label: "Payees" },
].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key as any)}
                className={`h-7 px-3 rounded-md text-xs font-medium transition ${
                  tab === t.key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-px bg-slate-200" />

        {/* FilterBar row */}
        <div className="px-3 py-2">
          <FilterBar
            left={
              <>
                <div className="space-y-1">
                  <div className="text-[11px] text-slate-600">From</div>
                  <Input type="date" className="h-7 w-[160px] text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>

                <div className="space-y-1">
                  <div className="text-[11px] text-slate-600">To</div>
                  <Input type="date" className="h-7 w-[160px] text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>

                <div className="ml-2 flex flex-col justify-end">
                  <div className="text-[11px] text-slate-500">Date basis: entry date</div>
                  <div className="text-[11px] text-slate-400">{from} → {to}</div>
                </div>
              </>
            }
            right={
              <>
                <Button className="h-7 px-3 text-xs" onClick={run} disabled={!businessId || loading}>
                  {loading ? "Running…" : "Run report"}
                </Button>
                {err ? <div className="text-xs text-red-600 ml-1">{err}</div> : null}
              </>
            }
          />
        </div>

        {/* Definitions + Last run (Bundle 3) */}
        <div className="px-3 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] text-slate-500">
              <span className="font-medium text-slate-600">Definitions:</span> {definitionsText}
            </div>
            {lastRunText ? <div className="text-[11px] text-slate-400">{lastRunText}</div> : null}
          </div>
        </div>
      </div>

      {/* Content */}
      {tab === "summary" ? (
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!pnl && !payees ? (
                <div className="text-sm text-slate-600">Run the report to view results.</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="text-xs text-slate-600">Income</div>
                      <div className={`text-sm font-semibold ${pnl?.totals?.income_cents && formatUsdAccountingFromCents(pnl.totals.income_cents).isNeg ? "text-red-600" : ""}`}>
                        {pnl?.totals?.income_cents ? formatUsdAccountingFromCents(pnl.totals.income_cents).text : "—"}
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="text-xs text-slate-600">Expenses</div>
                      <div className={`text-sm font-semibold ${pnl?.totals?.expense_cents && formatUsdAccountingFromCents(pnl.totals.expense_cents).isNeg ? "text-red-600" : ""}`}>
                        {pnl?.totals?.expense_cents ? formatUsdAccountingFromCents(pnl.totals.expense_cents).text : "—"}
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="text-xs text-slate-600">Net</div>
                      <div className={`text-sm font-semibold ${pnl?.totals?.net_cents && formatUsdAccountingFromCents(pnl.totals.net_cents).isNeg ? "text-red-600" : ""}`}>
                        {pnl?.totals?.net_cents ? formatUsdAccountingFromCents(pnl.totals.net_cents).text : "—"}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-3 h-9 flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-700">Top payees</div>
                      <div className="text-[11px] text-slate-500">Top 5</div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {(payees?.rows ?? []).slice(0, 5).map((r: any, idx: number) => (
                        <div key={`${r.payee}-${idx}`} className="h-9 px-3 flex items-center gap-3 text-sm">
                          <div className="min-w-0 flex-1 truncate">{r.payee}</div>
                          <div className={`w-[160px] text-right tabular-nums ${formatUsdAccountingFromCents(r.amount_cents).isNeg ? "text-red-600" : ""}`}>
                            {formatUsdAccountingFromCents(r.amount_cents).text}
                          </div>
                          <div className="w-[80px] text-right tabular-nums text-slate-600">{r.count}</div>
                        </div>
                      ))}

                      {(payees?.rows ?? []).length === 0 ? (
                        <div className="h-9 px-3 flex items-center text-sm text-slate-600">No payees in range.</div>
                      ) : null}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : tab === "pnl" ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Profit &amp; Loss</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {!pnl ? (
              <div className="text-sm text-slate-600">Run the report to view results.</div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="text-xs text-slate-600">Income</div>
                  <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.totals.income_cents).isNeg ? "text-red-600" : ""}`}>
                    {formatUsdAccountingFromCents(pnl.totals.income_cents).text}
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 p-3">
                  <div className="text-xs text-slate-600">Expenses</div>
                  <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.totals.expense_cents).isNeg ? "text-red-600" : ""}`}>
                    {formatUsdAccountingFromCents(pnl.totals.expense_cents).text}
                  </div>
                </div>

                <div className="rounded-md border border-slate-200 p-3">
                  <div className="text-xs text-slate-600">Net</div>
                  <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.totals.net_cents).isNeg ? "text-red-600" : ""}`}>
                    {formatUsdAccountingFromCents(pnl.totals.net_cents).text}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : tab === "cashflow" ? (
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Cash Flow Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!cashflow ? (
                <div className="text-sm text-slate-600">Run the report to view results.</div>
              ) : (
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-xs text-slate-600">Cash in</div>
                    <div
                      className={`text-sm font-semibold ${
                        formatUsdAccountingFromCents(cashflow.totals.cash_in_cents).isNeg ? "text-red-600" : ""
                      }`}
                    >
                      {formatUsdAccountingFromCents(cashflow.totals.cash_in_cents).text}
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-xs text-slate-600">Cash out</div>
                    <div
                      className={`text-sm font-semibold ${
                        formatUsdAccountingFromCents(cashflow.totals.cash_out_cents).isNeg ? "text-red-600" : ""
                      }`}
                    >
                      {formatUsdAccountingFromCents(cashflow.totals.cash_out_cents).text}
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-xs text-slate-600">Net</div>
                    <div
                      className={`text-sm font-semibold ${
                        formatUsdAccountingFromCents(cashflow.totals.net_cents).isNeg ? "text-red-600" : ""
                      }`}
                    >
                      {formatUsdAccountingFromCents(cashflow.totals.net_cents).text}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : tab === "activity" ? (
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Account Activity</CardTitle>
            </CardHeader>

            <CardContent className="pt-0">
              <LedgerTableShell
                colgroup={
                  <>
                    <col style={{ width: 120 }} />  {/* Date */}
                    <col style={{ width: 280 }} />  {/* Account (wider) */}
                    <col style={{ width: 110 }} />  {/* Type */}
                    <col style={{ width: 260 }} />  {/* Payee (wider) */}
                    <col />                         {/* Memo (flex) */}
                    <col style={{ width: 160 }} />  {/* Amount (tight) */}
                  </>
                }
                header={
                  <tr className="h-9">
                    <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Date</th>
                    <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Account</th>
                    <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Type</th>
                    <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Payee</th>
                    <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Memo</th>
                    <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Amount</th>
                  </tr>
                }
                addRow={null}
                body={
                  !activity ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-3 text-sm text-slate-600">
                        Run the report to view results.
                      </td>
                    </tr>
                  ) : (activity.rows ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-3 text-sm text-slate-600">
                        No entries in range.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {(activity.rows ?? []).map((r: any) => (
                        <tr key={r.entry_id} className="h-9 border-b border-slate-100">
                          <td className="px-3 text-sm whitespace-nowrap">{r.date}</td>
                          <td className="px-3 text-sm truncate">{r.account_name}</td>
                          <td className="px-3 text-sm whitespace-nowrap">{r.type}</td>
                          <td className="px-3 text-sm truncate">{r.payee ?? ""}</td>
                          <td className="px-3 text-sm truncate">{r.memo ?? ""}</td>
                          <td
                            className={`px-3 text-sm text-right tabular-nums ${
                              formatUsdAccountingFromCents(r.amount_cents).isNeg ? "text-red-600" : ""
                            }`}
                          >
                            {formatUsdAccountingFromCents(r.amount_cents).text}
                          </td>
                        </tr>
                      ))}
                    </>
                  )
                }
                footer={null}
              />
            </CardContent>
          </Card>
        </div>
      ) : tab === "categories" ? (
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Category Summary</CardTitle>
            </CardHeader>

            <CardContent className="pt-0">
              <LedgerTableShell
                colgroup={
                  <>
                    <col />
                    <col style={{ width: 180 }} />
                    <col style={{ width: 100 }} />
                  </>
                }
                header={
                  <tr className="h-9">
                    <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Category</th>
                    <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Amount</th>
                    <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Count</th>
                  </tr>
                }
                addRow={null}
                body={
                  !categories ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-3 text-sm text-slate-600">
                        Run the report to view results.
                      </td>
                    </tr>
                  ) : (categories.rows ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-3 text-sm text-slate-600">
                        No categories in range.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {(categories.rows ?? []).map((r: any, idx: number) => (
                        <tr key={`${r.category}-${idx}`} className="h-9 border-b border-slate-100">
                          <td className="px-3 text-sm truncate">{r.category}</td>
                          <td
                            className={`px-3 text-sm text-right tabular-nums ${
                              formatUsdAccountingFromCents(r.amount_cents).isNeg ? "text-red-600" : ""
                            }`}
                          >
                            {formatUsdAccountingFromCents(r.amount_cents).text}
                          </td>
                          <td className="px-3 text-sm text-right tabular-nums">{r.count}</td>
                        </tr>
                      ))}
                    </>
                  )
                }
                footer={null}
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Payee Summary</CardTitle>
            </CardHeader>

            <CardContent className="pt-0">
              <LedgerTableShell
                colgroup={
                  <>
                    <col />
                    <col style={{ width: 160 }} />
                    <col style={{ width: 100 }} />
                  </>
                }
                header={
                  <tr className="h-9">
                    <th className="px-3 text-left text-[11px] font-semibold text-slate-600">Payee</th>
                    <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Amount</th>
                    <th className="px-3 text-right text-[11px] font-semibold text-slate-600">Count</th>
                  </tr>
                }
                addRow={null}
                body={
                  !payees ? (
                    <tr>
                      <td colSpan={3} className="px-3 py-3 text-sm text-slate-600">
                        Run the report to view results.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {(payees.rows ?? []).map((r: any, idx: number) => (
                        <tr key={`${r.payee}-${idx}`} className="h-9 border-b border-slate-100">
                          <td className="px-3 text-sm truncate">{r.payee}</td>
                          <td
                            className={`px-3 text-sm text-right tabular-nums ${
                              formatUsdAccountingFromCents(r.amount_cents).isNeg ? "text-red-600" : ""
                            }`}
                          >
                            {formatUsdAccountingFromCents(r.amount_cents).text}
                          </td>
                          <td className="px-3 text-sm text-right tabular-nums">{r.count}</td>
                        </tr>
                      ))}
                    </>
                  )
                }
                footer={null}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
