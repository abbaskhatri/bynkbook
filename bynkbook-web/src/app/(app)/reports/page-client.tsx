"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { FilterBar } from "@/components/primitives/FilterBar";
import { PillToggle } from "@/components/primitives/PillToggle";
import { tabButtonClass } from "@/components/primitives/tokens";

import { AppDatePicker } from "@/components/primitives/AppDatePicker";

import { appErrorMessageOrNull } from "@/lib/errors/app-error";
import { AlertTriangle, CheckCircle2, FileText, Info, TrendingUp, TrendingDown, Sigma, BarChart3, LineChart, Landmark } from "lucide-react";

import {
  getPnlSummary,
  getCashflowSeries,
  getAccountsSummary,
  getApAging,
  getApAgingVendor,
  getCategories,
  getCategoriesDetail,
} from "@/lib/api/reports";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";

const ComboBarLineChart = dynamic(
  () => import("./reports-chart-panels").then((mod) => mod.ComboBarLineChart),
  { loading: () => <ReportsChartFallback /> }
);

const DonutBreakdown = dynamic(
  () => import("./reports-chart-panels").then((mod) => mod.DonutBreakdown),
  { loading: () => <ReportsDonutFallback /> }
);

function ReportsChartFallback() {
  return <div className="h-[260px] min-h-[260px] w-full rounded-md bg-bb-surface-soft" />;
}

function ReportsDonutFallback() {
  return <div className="h-[260px] min-h-[260px] w-full rounded-md border border-bb-border bg-bb-surface-soft" />;
}

type TabKey = "overview" | "pnl" | "cashflow" | "monthly";
type RangeMode = "weekly" | "monthly" | "yearly" | "custom";

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthNowYm() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function monthRangeFromYm(ym: string) {
  // ym: YYYY-MM
  const [yStr, mStr] = ym.split("-");
  const y = Number(yStr);
  const m = Number(mStr); // 1..12
  const from = `${yStr}-${mStr}-01`;
  const end = new Date(y, m, 0); // day 0 = last day of previous month => last day of this month because m is 1-based here
  const to = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return { from, to };
}

function yearNowY() {
  return String(new Date().getFullYear());
}

function yearRangeFromY(y: string) {
  const yy = String(y).slice(0, 4);
  return { from: `${yy}-01-01`, to: `${yy}-12-31` };
}

function startOfWeekYmd(d: Date) {
  // Week starts Monday
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1) - day;
  date.setDate(date.getDate() + diff);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDaysYmd(ymd: string, delta: number) {
  const [y, m, d] = ymd.split("-").map((x) => Number(x));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function priorRangeForCurrent(rangeMode: RangeMode, from: string, to: string, ym: string, year: string, weekFrom: string, customFrom: string, customTo: string, ytd: boolean) {
  // Deterministic prior comparison window:
  // weekly → previous week, monthly → previous month, yearly → previous year, custom → same-length previous range.
  if (rangeMode === "weekly") {
    const prevFrom = addDaysYmd(weekFrom, -7);
    const prevTo = addDaysYmd(weekFrom, -1);
    return { from: prevFrom, to: prevTo, ytd: false };
  }

  if (rangeMode === "monthly") {
    const [yy, mm] = (ym || monthNowYm()).split("-");
    const y = Number(yy);
    const m = Number(mm);
    const prev = new Date(y, m - 2, 1); // previous month (0-based)
    const prevYm = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
    const base = monthRangeFromYm(prevYm);
    if (ytd) {
      const yStr = String(prev.getFullYear());
      return { from: `${yStr}-01-01`, to: base.to, ytd: true };
    }
    return { ...base, ytd: false };
  }

  if (rangeMode === "yearly") {
    const y = Number((year || yearNowY()).slice(0, 4));
    const prevY = String(y - 1);
    const base = yearRangeFromY(prevY);
    if (ytd) {
      return { from: base.from, to: todayYmd(), ytd: true };
    }
    return { ...base, ytd: false };
  }

  // custom: same length immediately preceding `from`
  const start = new Date(from);
  const end = new Date(to);
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / (24 * 3600 * 1000)) + 1);
  const prevTo = addDaysYmd(from, -1);
  const prevFrom = addDaysYmd(prevTo, -(days - 1));
  return { from: prevFrom, to: prevTo, ytd: false };
}

function pctChange(curr: bigint, prev: bigint) {
  if (prev === 0n) return null;
  const delta = curr - prev;
  // scaled by 10000 for 2dp; deterministic integer math
  const pct = Number((delta * 10000n) / prev) / 100;
  return pct;
}

function topNByAbs(rows: Array<{ label: string; cents: string }>, n: number) {
  const absBig = (s: string) => {
    try { const x = BigInt(s); return x < 0n ? -x : x; } catch { return 0n; }
  };
  return [...rows]
    .map((r) => ({ ...r, abs: absBig(r.cents) }))
    .sort((a, b) => (b.abs > a.abs ? 1 : b.abs < a.abs ? -1 : 0))
    .slice(0, n)
    .map(({ label, cents }) => ({ label, cents }));
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

function formatBucketLabel(raw: string, rangeMode: RangeMode) {
  const s = String(raw ?? "").trim();
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // YEAR: "2026"
  if (/^\d{4}$/.test(s)) return s;

  // MONTH: "YYYY-MM" -> "Feb 26"
  if (/^\d{4}-\d{2}$/.test(s)) {
    const m = Number(s.slice(5, 7));
    return `${mon[m - 1] ?? s} ${s.slice(2, 4)}`;
  }

  // DAY (used for weekly/custom day buckets): "YYYY-MM-DD" -> "Mar 04"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const m = Number(s.slice(5, 7));
    const d = s.slice(8, 10);
    return `${mon[m - 1] ?? s} ${d}`;
  }

  // WEEK keys (if backend returns "YYYY-W09" or "YYYY-W9" or "YYYY-09")
  const wk = s.match(/^(\d{4})-W?(\d{1,2})$/i);
  if (wk) {
    const yy = wk[1].slice(2, 4);
    const ww = wk[2].padStart(2, "0");
    return `W${ww} ${yy}`;
  }

  // Never parse arbitrary strings into weekday names.
  return s || "—";
}

function hasMultiMonthSeries(monthly: Array<{ month: string }>) {
  if (!Array.isArray(monthly)) return false;
  const uniq = new Set(monthly.map((m) => String(m.month)));
  // Allow 1 bucket so charts still show for valid single-period ranges.
  return uniq.size >= 1;
}

function NoTrendNote() {
  return <div className="text-xs text-bb-text-muted">No trend for the selected range.</div>;
}

function ReportFootnote({ lines }: { lines: string[] }) {
  return (
    <div className="mt-3 border-t border-bb-border-muted pt-2 text-[11px] text-bb-text-muted space-y-0.5">
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

type ReportScope = {
  businessId: string;
  businessName: string;
  accountId: string;
  accountLabel: string;
  from: string;
  to: string;
  ytd: boolean;
};

function parseCents(value: unknown) {
  try {
    return BigInt(String(value ?? "0"));
  } catch {
    return 0n;
  }
}

function hasNonZeroCents(values: unknown[]) {
  return values.some((value) => parseCents(value) !== 0n);
}

function absCents(value: unknown) {
  const n = parseCents(value);
  return n < 0n ? -n : n;
}

function sumCents(values: unknown[]) {
  let total = 0n;
  for (const value of values) total += parseCents(value);
  return total;
}

function pnlHasLedgerActivity(pnl: any) {
  if (!pnl) return false;
  const period = pnl.period ?? {};
  const incomeCount = Number(period.income_count ?? 0);
  const expenseCount = Number(period.expense_count ?? 0);
  if (incomeCount + expenseCount > 0) return true;

  return hasNonZeroCents([
    period.income_cents,
    period.expense_cents,
    period.net_cents,
    ...(pnl.monthly ?? []).flatMap((row: any) => [row.income_cents, row.expense_cents, row.net_cents]),
  ]);
}

function cashflowHasLedgerActivity(cashflow: any) {
  if (!cashflow) return false;
  const totals = cashflow.totals ?? {};
  return hasNonZeroCents([
    totals.cash_in_cents,
    totals.cash_out_cents,
    totals.net_cents,
    ...(cashflow.monthly ?? []).flatMap((row: any) => [row.cash_in_cents, row.cash_out_cents, row.net_cents]),
  ]);
}

function formatScope(scope: ReportScope) {
  return `${scope.businessName} · ${scope.accountLabel} · ${scope.from} to ${scope.to}${scope.ytd ? " · YTD" : ""}`;
}

function scopeMatchesCurrent(scope: ReportScope | null, currentScope: ReportScope | null) {
  if (!scope || !currentScope) return true;
  return (
    scope.businessId === currentScope.businessId &&
    scope.accountId === currentScope.accountId &&
    scope.from === currentScope.from &&
    scope.to === currentScope.to &&
    scope.ytd === currentScope.ytd
  );
}

function ReportScopeSummary({
  currentScope,
  shownScope,
}: {
  currentScope: ReportScope | null;
  shownScope: ReportScope | null;
}) {
  const stale = !scopeMatchesCurrent(shownScope, currentScope);
  const scope = shownScope ?? currentScope;
  if (!scope) return null;

  return (
    <div className="rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2 text-xs text-bb-text-muted">
      <div>
        <span className="font-semibold text-bb-text">{shownScope ? "Showing results for" : "Selected scope"}:</span>{" "}
        {formatScope(scope)}
      </div>
      {stale && currentScope ? (
        <div className="mt-1 text-bb-status-warning-fg">
          Selected filters are now {formatScope(currentScope)}. Run the report to refresh results.
        </div>
      ) : null}
    </div>
  );
}

function ReportLoadingState({ title, scope }: { title: string; scope: ReportScope | null }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <ReportScopeSummary currentScope={scope} shownScope={null} />
      <div className="rounded-md border border-bb-border bg-bb-surface-soft p-3">
        <div className="text-sm font-semibold text-bb-text">Preparing {title}...</div>
        <div className="mt-1 text-xs text-bb-text-muted">Fetching report data for the selected range. This may take a moment.</div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[74px] rounded-md border border-bb-border bg-bb-surface-soft" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ReportsChartFallback />
        <ReportsChartFallback />
      </div>
    </div>
  );
}

function ReportEmptyState({ currentScope, shownScope }: { currentScope: ReportScope | null; shownScope: ReportScope | null }) {
  const scope = shownScope ?? currentScope;
  const accountScoped = Boolean(scope && scope.accountId !== "all");

  return (
    <div className="space-y-3">
      <ReportScopeSummary currentScope={currentScope} shownScope={shownScope} />
      <div className="rounded-md border border-bb-border bg-bb-surface-soft p-3">
        <div className="text-sm font-semibold text-bb-text">
          {accountScoped ? "No activity for this account and range." : "No ledger activity in this range."}
        </div>
        <div className="mt-1 text-xs text-bb-text-muted">
          {accountScoped ? "Switch accounts or widen the date range." : "Widen the date range if activity should appear here."}
        </div>
      </div>
    </div>
  );
}

type ReportCalloutTone = "default" | "success" | "warning" | "danger" | "info";

type ReportCallout = {
  key: string;
  tone: ReportCalloutTone;
  label: string;
  value?: string;
};

function reportCalloutClass(tone: ReportCalloutTone) {
  if (tone === "success") return "border-bb-status-success-border bg-bb-status-success-bg text-bb-status-success-fg";
  if (tone === "warning") return "border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg";
  if (tone === "danger") return "border-bb-status-danger-border bg-bb-status-danger-bg text-bb-status-danger-fg";
  if (tone === "info") return "border-bb-status-info-border bg-bb-status-info-bg text-bb-status-info-fg";
  return "border-bb-border bg-bb-surface-soft text-bb-text-muted";
}

function ReportDecisionCallouts({ callouts }: { callouts: ReportCallout[] }) {
  if (callouts.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
      {callouts.map((callout) => {
        const Icon = callout.tone === "success" ? CheckCircle2 : callout.tone === "warning" || callout.tone === "danger" ? AlertTriangle : Info;
        return (
          <div
            key={callout.key}
            className={`flex min-h-10 items-center gap-2 rounded-md border px-2.5 py-2 text-xs ${reportCalloutClass(callout.tone)}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0">
              <div className="truncate font-medium">{callout.label}</div>
              {callout.value ? <div className="mt-0.5 truncate text-[11px] opacity-85">{callout.value}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function inactivePeriodCount(rows: any[], valueKeys: string[]) {
  return (rows ?? []).filter((row) => valueKeys.every((key) => parseCents(row?.[key]) === 0n)).length;
}

function buildReportCallouts({
  pnl,
  cashflow,
  categories,
  apAging,
  mode,
}: {
  pnl?: any;
  cashflow?: any;
  categories?: any;
  apAging?: any;
  mode: "overview" | "monthly" | "pnl" | "cashflow";
}) {
  const callouts: ReportCallout[] = [];

  if ((mode === "overview" || mode === "monthly" || mode === "pnl") && pnl?.period) {
    const net = parseCents(pnl.period.net_cents);
    if (net > 0n) {
      callouts.push({ key: "net-positive", tone: "success", label: "Net income is positive", value: formatUsdAccountingFromCents(String(net)).text });
    } else if (net < 0n) {
      callouts.push({ key: "net-negative", tone: "danger", label: "Net income is negative", value: formatUsdAccountingFromCents(String(net)).text });
    } else {
      callouts.push({ key: "net-zero", tone: "default", label: "Net income is break-even", value: formatUsdAccountingFromCents(String(net)).text });
    }
  }

  if (mode === "cashflow" && cashflow?.totals) {
    const net = parseCents(cashflow.totals.net_cents);
    callouts.push({
      key: net < 0n ? "cash-net-negative" : net > 0n ? "cash-net-positive" : "cash-net-zero",
      tone: net < 0n ? "danger" : net > 0n ? "success" : "default",
      label: net < 0n ? "Net cash flow is negative" : net > 0n ? "Net cash flow is positive" : "Net cash flow is flat",
      value: formatUsdAccountingFromCents(String(net)).text,
    });
  }

  const categoryRows = categories?.rows ?? [];
  const uncategorized = categoryRows.find((row: any) => row?.category_id === null || String(row?.category ?? "").trim().toLowerCase() === "uncategorized");
  if (uncategorized && absCents(uncategorized.amount_cents) > 0n) {
    callouts.push({
      key: "uncategorized",
      tone: "warning",
      label: "Uncategorized expenses exist",
      value: formatUsdAccountingFromCents(String(uncategorized.amount_cents ?? "0")).text,
    });
  }

  const nonZeroCategories = categoryRows
    .map((row: any) => ({ amount: absCents(row?.amount_cents), label: String(row?.category ?? "Category") }))
    .filter((row: any) => row.amount > 0n)
    .sort((a: any, b: any) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  const totalCategoryAbs = sumCents(nonZeroCategories.map((row: any) => row.amount));
  const topTwoAbs = sumCents(nonZeroCategories.slice(0, 2).map((row: any) => row.amount));
  if (nonZeroCategories.length >= 3 && totalCategoryAbs > 0n && topTwoAbs * 100n >= totalCategoryAbs * 70n) {
    const pct = Number((topTwoAbs * 1000n) / totalCategoryAbs) / 10;
    callouts.push({
      key: "category-concentration",
      tone: "info",
      label: "Expenses concentrated in top categories",
      value: `Top 2: ${pct.toFixed(1)}%`,
    });
  }

  const apTotal = sumCents((apAging?.rows ?? []).map((row: any) => row?.total_cents));
  if (apTotal > 0n) {
    callouts.push({
      key: "ap-exposure",
      tone: "warning",
      label: "AP exposure exists",
      value: formatUsdAccountingFromCents(String(apTotal)).text,
    });
  }

  const pnlRows = pnl?.monthly ?? [];
  const cashRows = cashflow?.monthly ?? [];
  if ((mode === "overview" || mode === "monthly" || mode === "pnl") && pnlRows.length > 1) {
    const inactive = inactivePeriodCount(pnlRows, ["income_cents", "expense_cents", "net_cents"]);
    if (inactive > 0) callouts.push({ key: "pnl-missing-periods", tone: "default", label: "Some periods have no P&L activity", value: `${inactive} of ${pnlRows.length}` });
  } else if (mode === "cashflow" && cashRows.length > 1) {
    const inactive = inactivePeriodCount(cashRows, ["cash_in_cents", "cash_out_cents", "net_cents"]);
    if (inactive > 0) callouts.push({ key: "cash-missing-periods", tone: "default", label: "Some periods have no cash activity", value: `${inactive} of ${cashRows.length}` });
  } else if ((mode === "overview" || mode === "monthly" || mode === "pnl") && pnlRows.length === 1) {
    callouts.push({ key: "single-period", tone: "default", label: "Trend is thin for this range", value: "Single period" });
  } else if (mode === "cashflow" && cashRows.length === 1) {
    callouts.push({ key: "single-period", tone: "default", label: "Trend is thin for this range", value: "Single period" });
  }

  return callouts.slice(0, 5);
}

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

  const selectedAccountLabel = useMemo(() => {
    if (selectedAccountId === "all") return "All accounts";
    const account = activeAccountOptions.find((a: any) => a?.id === selectedAccountId);
    return account?.name ? `Account: ${account.name}` : "Selected account";
  }, [activeAccountOptions, selectedAccountId]);

  const [tab, setTab] = useState<TabKey>("overview"); // Default tab: Financial Overview

  const [rangeMode, setRangeMode] = useState<RangeMode>("monthly");
  const [ym, setYm] = useState(monthNowYm()); // monthly
  const [year, setYear] = useState(yearNowY()); // yearly (YYYY)
  const [weekFrom, setWeekFrom] = useState(() => startOfWeekYmd(new Date())); // weekly (start of week)
  const [customFrom, setCustomFrom] = useState(() => monthRangeFromYm(monthNowYm()).from);
  const [customTo, setCustomTo] = useState(() => monthRangeFromYm(monthNowYm()).to);

  const [ytd, setYtd] = useState(false); // applies only to monthly/yearly

  const { from, to } = useMemo(() => {
    if (rangeMode === "weekly") {
      const f = weekFrom;
      const t = addDaysYmd(weekFrom, 6);
      return { from: f, to: t };
    }

    if (rangeMode === "custom") return { from: customFrom, to: customTo };

    if (rangeMode === "yearly") {
      const base = yearRangeFromY(year || yearNowY());
      // YTD on yearly means: Jan 1 → today (or selected 'to' if you later add it)
      if (ytd) return { from: base.from, to: todayYmd() };
      return base;
    }

    // monthly
    const base = monthRangeFromYm(ym);
    if (ytd) {
      // YTD on monthly means: Jan 1 of that year → end of selected month
      const yy = String(ym || monthNowYm()).slice(0, 4);
      return { from: `${yy}-01-01`, to: base.to };
    }
    return base;
  }, [rangeMode, ym, year, weekFrom, customFrom, customTo, ytd]);

  const accountId = selectedAccountId;

  const selectedScope = useMemo<ReportScope | null>(() => {
    if (!businessId || !from || !to) return null;
    return {
      businessId,
      businessName: activeBusinessName ?? "Business",
      accountId,
      accountLabel: selectedAccountLabel,
      from,
      to,
      ytd,
    };
  }, [accountId, activeBusinessName, businessId, from, selectedAccountLabel, to, ytd]);

  const defaultReportScopeReady = Boolean(
    selectedScope &&
    !businessesQ.isLoading &&
    (selectedAccountId === "all" || !accountsQ.isLoading)
  );
  const reportScopeResolving = businessesQ.isLoading || (Boolean(businessId) && accountsQ.isLoading);
  const reportScopeMissing = !reportScopeResolving && !selectedScope;

  const [loading, setLoading] = useState(false);
  const [hasRequestedReport, setHasRequestedReport] = useState(false);
  const [lastRunScope, setLastRunScope] = useState<ReportScope | null>(null);

  // Phase 1 Stabilization:
  // - Loading token prevents overlapping async flows from clearing each other’s busy state
  // - Run epoch prevents stale async completions from committing after tab/range changes
  const loadingTokenRef = useRef(0);
  function beginLoading() {
    const token = ++loadingTokenRef.current;
    setLoading(true);
    return token;
  }
  function endLoading(token: number) {
    if (token === loadingTokenRef.current) setLoading(false);
  }

  const runEpochRef = useRef(0);
  const autoRunStartedRef = useRef(false);
  const [err, setErr] = useState<string | null>(null);

  const bannerMsg =
    err ||
    appErrorMessageOrNull(businessesQ.error) ||
    appErrorMessageOrNull(accountsQ.error) ||
    null;

  const [pnl, setPnl] = useState<any>(null);
  const [pnlPrev, setPnlPrev] = useState<any>(null);

  const [cashflow, setCashflow] = useState<any>(null);
  const [cashflowPrev, setCashflowPrev] = useState<any>(null);

  const [cashEndingCents, setCashEndingCents] = useState<string | null>(null);
  const [cashEndingPrevCents, setCashEndingPrevCents] = useState<string | null>(null);

  const [topCats, setTopCats] = useState<Array<{ label: string; cents: string }> | null>(null);
  const [topVendorsAp, setTopVendorsAp] = useState<Array<{ label: string; cents: string }> | null>(null);

  const [accountsSummary, setAccountsSummary] = useState<any>(null);
  const [includeArchivedAccounts, setIncludeArchivedAccounts] = useState(false); // Accounts Summary default: exclude archived
  const [apAging, setApAging] = useState<any>(null);
  const [apVendorId, setApVendorId] = useState<string | null>(null);
  const [apVendorDetail, setApVendorDetail] = useState<any>(null);

  const [categories, setCategories] = useState<any>(null);
  const [catDetail, setCatDetail] = useState<any>(null);
  const [catDetailCategoryId, setCatDetailCategoryId] = useState<string | null>(null);
  const [catPage, setCatPage] = useState(1);

  const asOf = useMemo(() => {
    // As-of uses end of selected month (or today if month is current and you want later).
    return to;
  }, [to]);

  async function run() {
    if (!businessId || !selectedScope) return;

    const runBusinessId = businessId;
    const runAccountId = accountId;
    const runFrom = from;
    const runTo = to;
    const runYtd = ytd;
    const runTab = tab;
    const runScope = selectedScope;

    const myEpoch = ++runEpochRef.current;
    const loadingToken = beginLoading();
    setHasRequestedReport(true);
    setErr(null);

    try {
      if (runTab === "overview" || runTab === "monthly" || runTab === "pnl") {
        const prev = priorRangeForCurrent(rangeMode, runFrom, runTo, ym, year, weekFrom, customFrom, customTo, runYtd);

        const [
          resPnl,
          resPnlPrev,
          resCash,
          resCashPrev,
          cats,
          ap,
          endAcct,
          endPrevAcct,
        ] = await Promise.all([
          getPnlSummary(runBusinessId, { from: runFrom, to: runTo, accountId: runAccountId, ytd: runYtd }),
          getPnlSummary(runBusinessId, { from: prev.from, to: prev.to, accountId: runAccountId, ytd: prev.ytd }),
          getCashflowSeries(runBusinessId, { from: runFrom, to: runTo, accountId: runAccountId, ytd: runYtd }),
          getCashflowSeries(runBusinessId, { from: prev.from, to: prev.to, accountId: runAccountId, ytd: prev.ytd }),
          getCategories(runBusinessId, { from: runFrom, to: runTo, accountId: runAccountId }),
          getApAging(runBusinessId, { asOf: runTo }),
          getAccountsSummary(runBusinessId, { asOf: runTo, accountId: runAccountId, includeArchived: false }),
          getAccountsSummary(runBusinessId, { asOf: prev.to, accountId: runAccountId, includeArchived: false }),
        ]);

        if (myEpoch !== runEpochRef.current) return;

        setLastRunScope(runScope);
        setPnl(resPnl);
        setPnlPrev(resPnlPrev);

        setCashflow(resCash);
        setCashflowPrev(resCashPrev);

        // Categories + AP (used by Overview / Monthly)
        setCategories(cats);
        setApAging(ap);

        const catRows = (cats?.rows ?? []).map((r: any) => ({ label: String(r.category ?? "Category"), cents: String(r.amount_cents ?? "0") }));
        setTopCats(topNByAbs(catRows, 6));

        const vendorRows = (ap?.rows ?? []).map((r: any) => ({ label: String(r.vendor ?? "Vendor"), cents: String(r.total_cents ?? "0") }));
        setTopVendorsAp(topNByAbs(vendorRows, 6));

        // Ending cash (Overview / Cashflow Statement)
        const sumBalances = (rows: any[]) => {
          let s = 0n;
          for (const r of rows ?? []) {
            try { s += BigInt(String(r.balance_cents ?? "0")); } catch { }
          }
          return String(s);
        };
        setCashEndingCents(sumBalances(endAcct?.rows ?? []));
        setCashEndingPrevCents(sumBalances(endPrevAcct?.rows ?? []));

        // Accounts summary list for Overview
        setAccountsSummary(endAcct);

        return;
      }

      if (runTab === "cashflow") {
        const prev = priorRangeForCurrent(rangeMode, runFrom, runTo, ym, year, weekFrom, customFrom, customTo, runYtd);

        const [res, resPrev, cats, ap, endAcct, endPrevAcct] = await Promise.all([
          getCashflowSeries(runBusinessId, { from: runFrom, to: runTo, accountId: runAccountId, ytd: runYtd }),
          getCashflowSeries(runBusinessId, { from: prev.from, to: prev.to, accountId: runAccountId, ytd: prev.ytd }),
          getCategories(runBusinessId, { from: runFrom, to: runTo, accountId: runAccountId }),
          getApAging(runBusinessId, { asOf: runTo }),
          getAccountsSummary(runBusinessId, { asOf: runTo, accountId: runAccountId, includeArchived: false }),
          getAccountsSummary(runBusinessId, { asOf: prev.to, accountId: runAccountId, includeArchived: false }),
        ]);

        if (myEpoch !== runEpochRef.current) return;

        setLastRunScope(runScope);
        setCashflow(res);
        setCashflowPrev(resPrev);

        const sumBalances = (rows: any[]) => {
          let s = 0n;
          for (const r of rows ?? []) {
            try { s += BigInt(String(r.balance_cents ?? "0")); } catch { }
          }
          return String(s);
        };

        setCashEndingCents(sumBalances(endAcct?.rows ?? []));
        setCashEndingPrevCents(sumBalances(endPrevAcct?.rows ?? []));

        setCategories(cats);
        setApAging(ap);

        const catRows = (cats?.rows ?? []).map((r: any) => ({ label: String(r.category ?? "Category"), cents: String(r.amount_cents ?? "0") }));
        setTopCats(topNByAbs(catRows, 5));

        const vendorRows = (ap?.rows ?? []).map((r: any) => ({ label: String(r.vendor ?? "Vendor"), cents: String(r.total_cents ?? "0") }));
        setTopVendorsAp(topNByAbs(vendorRows, 5));

        return;
      }

    } catch (e: any) {
      if (myEpoch !== runEpochRef.current) return;
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      endLoading(loadingToken);
    }
  }

  async function openApVendor(vendorId: string) {
    if (!businessId) return;

    const myEpoch = ++runEpochRef.current;
    const loadingToken = beginLoading();
    setErr(null);

    try {
      const res = await getApAgingVendor(businessId, { asOf, vendorId });
      if (myEpoch !== runEpochRef.current) return;
      setApVendorId(vendorId);
      setApVendorDetail(res);
    } catch (e: any) {
      if (myEpoch !== runEpochRef.current) return;
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      endLoading(loadingToken);
    }
  }

  async function openCategoryDetail(categoryId: string | null, page: number) {
    if (!businessId) return;

    const myEpoch = ++runEpochRef.current;
    const loadingToken = beginLoading();
    setErr(null);

    try {
      const res = await getCategoriesDetail(businessId, {
        from,
        to,
        accountId,
        categoryId,
        page,
        take: 50,
      });
      if (myEpoch !== runEpochRef.current) return;
      setCatDetail(res);
      setCatDetailCategoryId(categoryId);
      setCatPage(page);
    } catch (e: any) {
      if (myEpoch !== runEpochRef.current) return;
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      endLoading(loadingToken);
    }
  }

  // Switching tabs should never empty-clear existing results.
  // We keep the last known results for each tab until the user runs a new report (deterministic, no blank flicker).
  useEffect(() => {
    setErr(null);
    runEpochRef.current += 1;
    setLoading(false);

    // Reset only tab-local paging state (safe; does not blank existing results).
    setCatPage(1);
  }, [tab]);

  // Do NOT empty-clear results while the user adjusts range controls.
  // Keep prior results visible until they click Run report again (more readable, deterministic).
  useEffect(() => {
    setErr(null);
    runEpochRef.current += 1;
    setLoading(false);

    // Safe reset: paging-only.
    setCatPage(1);
  }, [rangeMode, ym, year, weekFrom, customFrom, customTo, ytd, accountId, includeArchivedAccounts]);

  // YTD only makes sense for monthly/yearly; force off for weekly/custom
  useEffect(() => {
    if (rangeMode === "weekly" || rangeMode === "custom") {
      setYtd(false);
    }
  }, [rangeMode]);

  useEffect(() => {
    if (autoRunStartedRef.current || tab !== "overview" || !businessId || !selectedScope || !defaultReportScopeReady) return;
    autoRunStartedRef.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, defaultReportScopeReady, selectedScope, tab]);

  const overviewReady = Boolean(pnl && cashflow);
  const overviewHasActivity = pnlHasLedgerActivity(pnl) || cashflowHasLedgerActivity(cashflow);
  const overviewShouldPrepare = !overviewReady && (loading || reportScopeResolving || (!hasRequestedReport && Boolean(selectedScope)));

  const pnlReady = Boolean(pnl);
  const pnlHasActivity = pnlHasLedgerActivity(pnl);
  const pnlShouldPrepare = !pnlReady && loading;

  const cashflowReady = Boolean(cashflow);
  const cashflowHasActivity = cashflowHasLedgerActivity(cashflow);
  const cashflowShouldPrepare = !cashflowReady && loading;

  const overviewCallouts = useMemo(
    () => buildReportCallouts({ pnl, cashflow, categories, apAging, mode: "overview" }),
    [apAging, cashflow, categories, pnl]
  );
  const monthlyCallouts = useMemo(
    () => buildReportCallouts({ pnl, cashflow, categories, apAging, mode: "monthly" }),
    [apAging, cashflow, categories, pnl]
  );
  const pnlCallouts = useMemo(
    () => buildReportCallouts({ pnl, cashflow, categories, apAging, mode: "pnl" }),
    [apAging, cashflow, categories, pnl]
  );
  const cashflowCallouts = useMemo(
    () => buildReportCallouts({ pnl, cashflow, categories, apAging, mode: "cashflow" }),
    [apAging, cashflow, categories, pnl]
  );

  return (
    <div className="flex flex-col gap-2 overflow-hidden max-w-6xl">
      <div className="rounded-xl border border-bb-border bg-bb-surface-card shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<FileText className="h-4 w-4" />}
            title="Reports"
            afterTitle={
              <div className="h-6 px-1.5 rounded-lg border border-primary/20 bg-primary/10 flex items-center">
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
            right={null}
          />
        </div>

        <div className="mt-2 h-px bg-bb-border" />

        {/* Tabs */}
        <div className="px-3 py-2">
          <div className="flex gap-1.5 text-sm">
            {[
              { key: "overview", label: "Financial Overview" },
              { key: "pnl", label: "P&L Statement" },
              { key: "cashflow", label: "Cash Flow Statement" },
              { key: "monthly", label: "Monthly Review" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key as TabKey)}
                className={tabButtonClass(tab === t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-px bg-bb-border" />

        {/* Controls: Month picker + YTD toggle (only) */}
        <div className="px-3 py-2">
          <FilterBar
            left={
              <>
                <div className="space-y-1">
                  <div className="text-[11px] text-bb-text-muted">Range</div>
                  <Select value={rangeMode} onValueChange={(value) => setRangeMode(value as RangeMode)}>
                    <SelectTrigger
                      size="sm"
                      className="h-7 w-[140px] border-bb-input-border bg-bb-input-bg px-2 text-xs text-bb-text"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="min-w-[180px] border-bb-border bg-bb-surface-card text-bb-text">
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {rangeMode === "monthly" ? (
                  <div className="space-y-1">
                    <div className="text-[11px] text-bb-text-muted">Month</div>

                    <div className="w-[140px]">
                      <AppDatePicker
                        value={ym ? `${ym}-01` : ""}
                        onChange={(next) => setYm(next ? next.slice(0, 7) : "")}
                        placeholder="Select month"
                        allowClear
                      />
                    </div>
                  </div>
                ) : null}

                {rangeMode === "yearly" ? (
                  <div className="space-y-1">
                    <div className="text-[11px] text-bb-text-muted">Year</div>
                    <Input
                      type="number"
                      className="h-7 w-[110px] text-xs"
                      value={year}
                      onChange={(e) => {
                        const v = String(e.target.value ?? "").replace(/[^\d]/g, "").slice(0, 4);
                        setYear(v);
                      }}
                    />
                  </div>
                ) : null}

                {rangeMode === "weekly" ? (
                  <div className="space-y-1">
                    <div className="text-[11px] text-bb-text-muted">Week of</div>

                    <div className="w-[140px]">
                      <AppDatePicker
                        value={weekFrom}
                        onChange={(next) => setWeekFrom(next)}
                        allowClear={false}
                      />
                    </div>
                  </div>
                ) : null}

                {rangeMode === "custom" ? (
                  <div className="flex items-end gap-2">
                    <div className="space-y-1">
                      <div className="text-[11px] text-bb-text-muted">From</div>

                      <div className="w-[140px]">
                        <AppDatePicker
                          value={customFrom}
                          onChange={(next) => setCustomFrom(next)}
                          allowClear={false}
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="text-[11px] text-bb-text-muted">To</div>

                      <div className="w-[140px]">
                        <AppDatePicker
                          value={customTo}
                          onChange={(next) => setCustomTo(next)}
                          allowClear={false}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="ml-2 flex flex-col justify-end">
                  <div className="text-[11px] text-bb-text-muted">Range</div>
                  <div className="text-[11px] text-bb-text-subtle">
                    {from} → {to}
                  </div>
                </div>

                <div className="ml-4 flex items-center gap-2">
                  <div className="text-[11px] text-bb-text-muted">YTD</div>
                  <PillToggle checked={ytd} onCheckedChange={(next) => setYtd(next)} disabled={rangeMode === "weekly" || rangeMode === "custom"} />
                </div>

                <div className="ml-4 flex items-end gap-3">
                  <div className="flex flex-col justify-end" />
                </div>
              </>
            }
            right={
              <>
                <Button className="h-7 px-3 text-xs" onClick={run} disabled={!businessId || loading}>
                  {loading ? (pnl || cashflow ? "Refreshing..." : "Preparing...") : "Run report"}
                </Button>
                {err ? <div className="text-xs text-bb-status-danger-fg ml-2">{err}</div> : null}
              </>
            }
          />
        </div>

        {/* Financial Overview (Base44-style: charts-first, everything in one page) */}
        {tab === "overview" ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Financial Overview</CardTitle>
            </CardHeader>

            <CardContent className="space-y-3 text-sm">
              {overviewShouldPrepare ? (
                <ReportLoadingState title="Financial Overview" scope={selectedScope} />
              ) : !overviewReady && reportScopeMissing ? (
                <div className="text-sm text-bb-text-muted">Select a business and account scope to prepare Financial Overview.</div>
              ) : !overviewReady ? (
                <ReportLoadingState title="Financial Overview" scope={selectedScope} />
              ) : !overviewHasActivity ? (
                <ReportEmptyState currentScope={selectedScope} shownScope={lastRunScope} />
              ) : (
                <>
                  <ReportScopeSummary currentScope={selectedScope} shownScope={lastRunScope} />
                  <ReportDecisionCallouts callouts={overviewCallouts} />

                  {/* KPI strip (Income / Expenses / Net) */}
                  <div className="grid grid-cols-3 gap-3">
                    {/* Income */}
                    <div className="rounded-md border border-bb-border p-3">
                      <div className="flex items-center gap-3">
                        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bb-status-success-bg">
                          <TrendingUp className="h-7 w-7 text-bb-status-success-fg" strokeWidth={2} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-bb-text-muted">Income</div>
                          <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.period.income_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                            {formatUsdAccountingFromCents(pnl.period.income_cents).text}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Expenses */}
                    <div className="rounded-md border border-bb-border p-3">
                      <div className="flex items-center gap-3">
                        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bb-status-success-bg">
                          <TrendingDown className="h-7 w-7 text-bb-status-success-fg" strokeWidth={2} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-bb-text-muted">Expenses</div>
                          <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.period.expense_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                            {formatUsdAccountingFromCents(pnl.period.expense_cents).text}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Net */}
                    <div className="rounded-md border border-bb-border p-3">
                      <div className="flex items-center gap-3">
                        <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bb-status-success-bg">
                          <Sigma className="h-7 w-7 text-bb-status-success-fg" strokeWidth={2} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs text-bb-text-muted">Net</div>
                          <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.period.net_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                            {formatUsdAccountingFromCents(pnl.period.net_cents).text}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Charts row: Income vs Expenses + Net, and Net Cash Flow */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="rounded-md border border-bb-border p-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-bb-text">
                        <BarChart3 className="h-4 w-4 text-bb-text-muted" />
                        Income vs Expenses by Month
                      </div>
                      <div className="mt-2">
                        {hasMultiMonthSeries(pnl.monthly ?? []) ? (
                          <ComboBarLineChart
                            title="Income vs Expenses (bars) + Net (line)"
                            rangeMode={rangeMode}
                            rangeTo={to}
                            months={(pnl.monthly ?? []).map((m: any) => m.month)}
                            barA={(pnl.monthly ?? []).map((m: any) => m.income_cents)}
                            barB={(pnl.monthly ?? []).map((m: any) => m.expense_cents)}
                            line={(pnl.monthly ?? []).map((m: any) => m.net_cents)}
                            aLabel="Income"
                            bLabel="Expenses"
                            lineLabel="Net"
                          />
                        ) : (
                          <NoTrendNote />
                        )}
                      </div>
                    </div>

                    <div className="rounded-md border border-bb-border p-3">
                      <div className="flex items-center gap-2 text-xs font-semibold text-bb-text">
                        <LineChart className="h-4 w-4 text-bb-text-muted" />
                        Net Cash Flow (Last 6 Months)
                      </div>
                      <div className="mt-2">
                        {hasMultiMonthSeries(cashflow.monthly ?? []) ? (
                          <ComboBarLineChart
                            title="Cash In vs Cash Out (bars) + Cumulative net change (line)"
                            rangeMode={rangeMode}
                            rangeTo={to}
                            months={(cashflow.monthly ?? []).map((m: any) => m.month)}
                            barA={(cashflow.monthly ?? []).map((m: any) => m.cash_in_cents)}
                            barB={(cashflow.monthly ?? []).map((m: any) => m.cash_out_cents)}
                            line={(() => {
                              const src = (cashflow.monthly ?? []).map((m: any) => m.net_cents);
                              let run = 0n;
                              return src.map((c: any) => {
                                try { run += BigInt(String(c ?? "0")); return String(run); } catch { return String(run); }
                              });
                            })()}
                            aLabel="Cash In"
                            bLabel="Cash Out"
                            lineLabel="Cumulative"
                          />
                        ) : (
                          <NoTrendNote />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Donut + top accounts */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div>
                      {categories?.rows?.length ? (
                        <DonutBreakdown
                          title="Expenses by Category"
                          rows={(categories.rows ?? [])
                            .filter((r: any) => r && typeof r.amount_cents === "string")
                            .map((r: any) => ({ label: String(r.category ?? "Category"), cents: String(r.amount_cents) }))}
                        />
                      ) : (
                        <div className="rounded-md border border-bb-border p-3 text-sm text-bb-text-muted">No category data.</div>
                      )}
                    </div>

                    <div className="rounded-md border border-bb-border p-3 text-sm text-bb-text-muted">
                      Opening-balance driven account balances are intentionally excluded from Reports.
                    </div>
                  </div>
                </>
              )}

              <ReportFootnote
                lines={[
                  "Overview aggregates P&L, Cash Flow, and Categories for the selected range.",
                  "Basis: Ledger effective date (entry date). Closed periods are read-only.",
                ]}
              />
            </CardContent>
          </Card>
        ) : null}

        {tab === "monthly" ? (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bb-status-success-bg">
                  <Sigma className="h-7 w-7 text-bb-status-success-fg" strokeWidth={2} />
                </div>
                <CardTitle className="text-sm">Monthly Review</CardTitle>
              </div>
            </CardHeader>

            <CardContent className="space-y-3 text-sm">
              {!pnl || !cashflow ? (
                loading ? (
                  <ReportLoadingState title="Monthly Review" scope={selectedScope} />
                ) : (
                  <div className="text-sm text-bb-text-muted">Run the report to prepare Monthly Review.</div>
                )
              ) : !overviewHasActivity ? (
                <ReportEmptyState currentScope={selectedScope} shownScope={lastRunScope} />
              ) : (
                <>
                  <ReportScopeSummary currentScope={selectedScope} shownScope={lastRunScope} />
                  <ReportDecisionCallouts callouts={monthlyCallouts} />

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs text-bb-text-muted">Income</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.period.income_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                        {formatUsdAccountingFromCents(pnl.period.income_cents).text}
                      </div>
                    </div>

                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs text-bb-text-muted">Expenses</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.period.expense_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                        {formatUsdAccountingFromCents(pnl.period.expense_cents).text}
                      </div>
                    </div>

                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs text-bb-text-muted">Net</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.period.net_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                        {formatUsdAccountingFromCents(pnl.period.net_cents).text}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs font-semibold text-bb-text">Top Categories</div>
                      <div className="mt-2 space-y-1">
                        {(topCats ?? []).map((r, i) => (
                          <div key={`${r.label}-${i}`} className="flex items-center justify-between text-xs">
                            <div className="truncate text-bb-text">{r.label}</div>
                            <div className={`tabular-nums ${formatUsdAccountingFromCents(r.cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                              {formatUsdAccountingFromCents(r.cents).text}
                            </div>
                          </div>
                        ))}
                        {(topCats ?? []).length === 0 ? <div className="text-xs text-bb-text-muted">No category data.</div> : null}
                      </div>
                    </div>

                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs font-semibold text-bb-text">Top Vendors (AP)</div>
                      <div className="mt-2 space-y-1">
                        {(topVendorsAp ?? []).map((r, i) => (
                          <div key={`${r.label}-${i}`} className="flex items-center justify-between text-xs">
                            <div className="truncate text-bb-text">{r.label}</div>
                            <div className={`tabular-nums ${formatUsdAccountingFromCents(r.cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                              {formatUsdAccountingFromCents(r.cents).text}
                            </div>
                          </div>
                        ))}
                        {(topVendorsAp ?? []).length === 0 ? <div className="text-xs text-bb-text-muted">No AP vendor data.</div> : null}
                      </div>
                    </div>
                  </div>
                </>
              )}

              <ReportFootnote
                lines={[
                  "Monthly Review is deterministic: highlights top categories and AP vendors for the selected range.",
                  "No AI output. Closed periods are read-only.",
                ]}
              />
            </CardContent>
          </Card>
        ) : null}

        {/* Content */}
        {tab === "pnl" ? (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bb-status-success-bg">
                  <BarChart3 className="h-7 w-7 text-bb-status-success-fg" strokeWidth={2} />
                </div>
                <CardTitle className="text-sm">Profit &amp; Loss</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="text-[11px] text-bb-text-muted">
                Income and Expenses (ledger effective date). Net = Income − Expenses.
              </div>
              {pnlShouldPrepare ? (
                <ReportLoadingState title="Profit & Loss" scope={selectedScope} />
              ) : !pnlReady ? (
                <div className="text-sm text-bb-text-muted">Run the report to prepare Profit &amp; Loss.</div>
              ) : !pnlHasActivity ? (
                <ReportEmptyState currentScope={selectedScope} shownScope={lastRunScope} />
              ) : (
                <>
                  <ReportScopeSummary currentScope={selectedScope} shownScope={lastRunScope} />
                  <ReportDecisionCallouts callouts={pnlCallouts} />

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs text-bb-text-muted">Income</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.period.income_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                        {formatUsdAccountingFromCents(pnl.period.income_cents).text}
                      </div>
                    </div>

                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs text-bb-text-muted">Expenses</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.period.expense_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                        {formatUsdAccountingFromCents(pnl.period.expense_cents).text}
                      </div>
                    </div>

                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs text-bb-text-muted">Net</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.period.net_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                        {formatUsdAccountingFromCents(pnl.period.net_cents).text}
                      </div>
                    </div>
                  </div>

                  {pnlPrev?.period ? (
                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs text-bb-text-muted">Change vs prior period</div>

                      {(() => {
                        const curInc = BigInt(String(pnl.period.income_cents ?? "0"));
                        const curExp = BigInt(String(pnl.period.expense_cents ?? "0"));
                        const curNet = BigInt(String(pnl.period.net_cents ?? "0"));

                        const prevInc = BigInt(String(pnlPrev.period.income_cents ?? "0"));
                        const prevExp = BigInt(String(pnlPrev.period.expense_cents ?? "0"));
                        const prevNet = BigInt(String(pnlPrev.period.net_cents ?? "0"));

                        const dInc = curInc - prevInc;
                        const dExp = curExp - prevExp;
                        const dNet = curNet - prevNet;

                        const pInc = pctChange(curInc, prevInc);
                        const pExp = pctChange(curExp, prevExp);
                        const pNet = pctChange(curNet, prevNet);

                        const fmtPct = (p: number | null) => (p === null ? "—" : `${p.toFixed(1)}%`);

                        return (
                          <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                            <div>
                              <div className="text-[11px] text-bb-text-muted">Income</div>
                              <div className={`tabular-nums ${dInc < 0n ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                                {formatUsdAccountingFromCents(String(dInc)).text} <span className="text-[11px] text-bb-text-muted">({fmtPct(pInc)})</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-bb-text-muted">Expenses</div>
                              <div className={`tabular-nums ${dExp < 0n ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                                {formatUsdAccountingFromCents(String(dExp)).text} <span className="text-[11px] text-bb-text-muted">({fmtPct(pExp)})</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-bb-text-muted">Net</div>
                              <div className={`tabular-nums ${dNet < 0n ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                                {formatUsdAccountingFromCents(String(dNet)).text} <span className="text-[11px] text-bb-text-muted">({fmtPct(pNet)})</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}

                  <div className="rounded-md border border-bb-border p-3">
                    <div className="text-xs text-bb-text-muted">Trend</div>
                    <div className="mt-2">
                      {hasMultiMonthSeries(pnl.monthly ?? []) ? (
                        <ComboBarLineChart
                          title="Income vs Expenses (bars) + Net per period (line)"
                          rangeMode={rangeMode}
                          rangeTo={to}
                          months={(pnl.monthly ?? []).map((m: any) => m.month)}
                          barA={(pnl.monthly ?? []).map((m: any) => m.income_cents)}
                          barB={(pnl.monthly ?? []).map((m: any) => m.expense_cents)}
                          line={(pnl.monthly ?? []).map((m: any) => m.net_cents)}
                          aLabel="Income"
                          bLabel="Expenses"
                          lineLabel="Net"
                        />
                      ) : (
                        <NoTrendNote />
                      )}
                    </div>

                    {ytd && pnl.ytd ? (
                      <div className="mt-3 rounded-md border border-bb-border p-3">
                        <div className="text-xs text-bb-text-muted">YTD ({pnl.ytd.from} → {pnl.ytd.to})</div>
                        <div className="mt-2 grid grid-cols-3 gap-3">
                          <div>
                            <div className="text-[11px] text-bb-text-muted">Income</div>
                            <div className={`font-semibold ${formatUsdAccountingFromCents(pnl.ytd.income_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                              {formatUsdAccountingFromCents(pnl.ytd.income_cents).text}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-bb-text-muted">Expenses</div>
                            <div className={`font-semibold ${formatUsdAccountingFromCents(pnl.ytd.expense_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                              {formatUsdAccountingFromCents(pnl.ytd.expense_cents).text}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-bb-text-muted">Net</div>
                            <div className={`font-semibold ${formatUsdAccountingFromCents(pnl.ytd.net_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                              {formatUsdAccountingFromCents(pnl.ytd.net_cents).text}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* Cash Flow: keep interpretation unique. Top categories/vendors shown on P&L and AP tabs. */}

                  <div className="rounded-md border border-bb-border overflow-hidden">
                    <div className="bg-bb-table-header px-3 h-9 flex items-center justify-between">
                      <div className="text-xs font-semibold text-bb-text">Monthly</div>
                      <div className="text-[11px] text-bb-text-muted">{ytd ? "Fiscal YTD buckets" : "Selected month"}</div>
                    </div>

                    <div className="overflow-x-auto">
                      <div className="min-w-[640px] divide-y divide-bb-border-muted">
                        <div className="h-9 px-3 grid grid-cols-[110px_160px_160px_160px] items-center gap-3 text-[11px] font-semibold text-bb-text bg-bb-surface-card">
                          <div className="truncate">Month</div>
                          <div className="text-right">Income</div>
                          <div className="text-right">Expenses</div>
                          <div className="text-right">Net</div>
                        </div>

                        {(pnl.monthly ?? []).map((r: any, idx: number) => (
                          <div key={`${r.month}-${idx}`} className="h-9 px-3 grid grid-cols-[110px_160px_160px_160px] items-center gap-3 text-sm">
                            <div className="truncate tabular-nums text-bb-text" title={formatBucketLabel(String(r.month), rangeMode)}>
                              {formatBucketLabel(String(r.month), rangeMode)}
                            </div>
                            <div className={`text-right tabular-nums ${formatUsdAccountingFromCents(r.income_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                              {formatUsdAccountingFromCents(r.income_cents).text}
                            </div>
                            <div className={`text-right tabular-nums ${formatUsdAccountingFromCents(r.expense_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                              {formatUsdAccountingFromCents(r.expense_cents).text}
                            </div>
                            <div className={`text-right tabular-nums ${formatUsdAccountingFromCents(r.net_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                              {formatUsdAccountingFromCents(r.net_cents).text}
                            </div>
                          </div>
                        ))}
                        {(pnl.monthly ?? []).length === 0 ? (
                          <div className="h-9 px-3 flex items-center text-sm text-bb-text-muted">No activity in range.</div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </>
              )}
              <ReportFootnote
                lines={[
                  "Basis: Ledger effective date (entry date).",
                  "Scope: Selected account (or All accounts), excluding deleted entries.",
                  "Closed periods are read-only (no mutations allowed).",
                ]}
              />
            </CardContent>
          </Card>
        ) : null}

        {tab === "cashflow" ? (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bb-status-success-bg">
                  <LineChart className="h-7 w-7 text-bb-status-success-fg" strokeWidth={2} />
                </div>
                <CardTitle className="text-sm">Cash Flow</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="text-[11px] text-bb-text-muted">
                Cash In/Out movements (ledger effective date). Line shows cumulative net cash change over the range.
              </div>
              {cashflowShouldPrepare ? (
                <ReportLoadingState title="Cash Flow" scope={selectedScope} />
              ) : !cashflowReady ? (
                <div className="text-sm text-bb-text-muted">Run the report to prepare Cash Flow.</div>
              ) : !cashflowHasActivity ? (
                <ReportEmptyState currentScope={selectedScope} shownScope={lastRunScope} />
              ) : (
                <>
                  <ReportScopeSummary currentScope={selectedScope} shownScope={lastRunScope} />
                  <ReportDecisionCallouts callouts={cashflowCallouts} />

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs text-bb-text-muted">Cash In</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(cashflow.totals.cash_in_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                        {formatUsdAccountingFromCents(cashflow.totals.cash_in_cents).text}
                      </div>
                    </div>

                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs text-bb-text-muted">Cash Out</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(cashflow.totals.cash_out_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                        {formatUsdAccountingFromCents(cashflow.totals.cash_out_cents).text}
                      </div>
                    </div>

                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs text-bb-text-muted">Net change</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(cashflow.totals.net_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                        {formatUsdAccountingFromCents(cashflow.totals.net_cents).text}
                      </div>
                    </div>
                  </div>

                  {cashflowPrev?.totals ? (
                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-xs text-bb-text-muted">Change vs prior period</div>

                      {(() => {
                        const curIn = BigInt(String(cashflow.totals.cash_in_cents ?? "0"));
                        const curOut = BigInt(String(cashflow.totals.cash_out_cents ?? "0"));
                        const curNet = BigInt(String(cashflow.totals.net_cents ?? "0"));

                        const prevIn = BigInt(String(cashflowPrev.totals.cash_in_cents ?? "0"));
                        const prevOut = BigInt(String(cashflowPrev.totals.cash_out_cents ?? "0"));
                        const prevNet = BigInt(String(cashflowPrev.totals.net_cents ?? "0"));

                        const dIn = curIn - prevIn;
                        const dOut = curOut - prevOut;
                        const dNet = curNet - prevNet;

                        const pIn = pctChange(curIn, prevIn);
                        const pOut = pctChange(curOut, prevOut);
                        const pNet = pctChange(curNet, prevNet);

                        const fmtPct = (p: number | null) => (p === null ? "—" : `${p.toFixed(1)}%`);

                        return (
                          <div className="mt-2 grid grid-cols-3 gap-3 text-sm">
                            <div>
                              <div className="text-[11px] text-bb-text-muted">Cash In</div>
                              <div className={`tabular-nums ${dIn < 0n ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                                {formatUsdAccountingFromCents(String(dIn)).text} <span className="text-[11px] text-bb-text-muted">({fmtPct(pIn)})</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-bb-text-muted">Cash Out</div>
                              <div className={`tabular-nums ${dOut < 0n ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                                {formatUsdAccountingFromCents(String(dOut)).text} <span className="text-[11px] text-bb-text-muted">({fmtPct(pOut)})</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-bb-text-muted">Net change</div>
                              <div className={`tabular-nums ${dNet < 0n ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                                {formatUsdAccountingFromCents(String(dNet)).text} <span className="text-[11px] text-bb-text-muted">({fmtPct(pNet)})</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {/* Trend (left) */}
                    <div className="rounded-md border border-bb-border p-3">
                      <div className="text-[11px] text-bb-text-muted mb-2">Trend</div>

                      {hasMultiMonthSeries(cashflow.monthly ?? []) ? (
                        <ComboBarLineChart
                          title="Cash In vs Cash Out (bars) + Cumulative net cash change (line)"
                          rangeMode={rangeMode}
                          rangeTo={to}
                          months={(cashflow.monthly ?? []).map((m: any) => m.month)}
                          barA={(cashflow.monthly ?? []).map((m: any) => m.cash_in_cents)}
                          barB={(cashflow.monthly ?? []).map((m: any) => m.cash_out_cents)}
                          line={(() => {
                            const src = (cashflow.monthly ?? []).map((m: any) => m.net_cents);
                            let run = 0n;
                            return src.map((c: any) => {
                              try { run += BigInt(String(c ?? "0")); return String(run); } catch { return String(run); }
                            });
                          })()}
                          aLabel="Cash In"
                          bLabel="Cash Out"
                          lineLabel="Cumulative"
                        />
                      ) : (
                        <NoTrendNote />
                      )}
                    </div>

                    {/* Monthly table (right) */}
                    <div className="rounded-md border border-bb-border overflow-hidden">
                      <div className="bg-bb-table-header px-3 h-9 flex items-center justify-between">
                        <div className="text-xs font-semibold text-bb-text">Monthly</div>
                        <div className="text-[11px] text-bb-text-muted">{ytd ? "Fiscal YTD buckets" : "Selected month"}</div>
                      </div>

                      <div className="overflow-x-auto">
                        <div className="min-w-[640px] divide-y divide-bb-border-muted">
                          <div className="h-9 px-3 grid grid-cols-[110px_160px_160px_160px] items-center gap-3 text-[11px] font-semibold text-bb-text bg-bb-surface-card">
                            <div className="truncate">Period</div>
                            <div className="text-right">Cash In</div>
                            <div className="text-right">Cash Out</div>
                            <div className="text-right">Net</div>
                          </div>

                          {(cashflow.monthly ?? []).map((r: any, idx: number) => (
                            <div key={`${r.month}-${idx}`} className="h-9 px-3 grid grid-cols-[110px_160px_160px_160px] items-center gap-3 text-sm">
                              <div className="truncate tabular-nums text-bb-text" title={formatBucketLabel(String(r.month), rangeMode)}>
                                {formatBucketLabel(String(r.month), rangeMode)}
                              </div>
                              <div className={`text-right tabular-nums ${formatUsdAccountingFromCents(r.cash_in_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                                {formatUsdAccountingFromCents(r.cash_in_cents).text}
                              </div>
                              <div className={`text-right tabular-nums ${formatUsdAccountingFromCents(r.cash_out_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                                {formatUsdAccountingFromCents(r.cash_out_cents).text}
                              </div>
                              <div className={`text-right tabular-nums ${formatUsdAccountingFromCents(r.net_cents).isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>
                                {formatUsdAccountingFromCents(r.net_cents).text}
                              </div>
                            </div>
                          ))}

                          {(cashflow.monthly ?? []).length === 0 ? (
                            <div className="h-9 px-3 flex items-center text-sm text-bb-text-muted">No activity in range.</div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
              <ReportFootnote
                lines={[
                  "Basis: Ledger effective date (entry date).",
                  "Cash in/out reflects INCOME/EXPENSE entries in the selected scope (excludes deleted entries).",
                  "Closed periods are read-only (no mutations allowed).",
                ]}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
