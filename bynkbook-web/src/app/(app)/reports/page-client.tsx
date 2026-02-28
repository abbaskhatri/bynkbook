"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { FilterBar } from "@/components/primitives/FilterBar";
import { PillToggle } from "@/components/primitives/PillToggle";
import { ringFocus } from "@/components/primitives/tokens";

import { InlineBanner } from "@/components/app/inline-banner";
import { EmptyStateCard } from "@/components/app/empty-state";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";
import { FileText } from "lucide-react";

import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";

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

type TabKey = "pnl" | "cashflow" | "accounts" | "ap" | "categories";
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

function hasMultiMonthSeries(monthly: Array<{ month: string }>) {
  if (!Array.isArray(monthly)) return false;
  const uniq = new Set(monthly.map((m) => String(m.month)));
  return uniq.size >= 2;
}

function NoTrendNote() {
  return <div className="text-xs text-slate-500">No multi-month trend for this range.</div>;
}

function ReportFootnote({ lines }: { lines: string[] }) {
  return (
    <div className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-500 space-y-0.5">
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

function compactUsdTickFromCentsNumber(v: number) {
  // v is cents in number form (charting)
  try {
    const cents = BigInt(Math.round(v));
    const fm = formatUsdAccountingFromCents(String(cents));
    const raw = fm.text.replace(/[(),$]/g, "").replace(/,/g, "");
    const n = Number(raw);
    if (!Number.isFinite(n)) return fm.text;

    const abs = Math.abs(n);
    const withSuffix =
      abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M`
      : abs >= 1_000 ? `${(abs / 1_000).toFixed(1)}k`
      : abs.toFixed(0);

    const base = `$${withSuffix}`;
    return fm.isNeg ? `(${base})` : base;
  } catch {
    return "$0";
  }
}

function mkComboSeriesData(months: string[], a: string[], b: string[], l: string[]) {
  const n = Math.min(months.length, a.length, b.length, l.length);
  return Array.from({ length: n }).map((_, i) => {
    const A = (() => { try { return Number(BigInt(a[i] ?? "0")); } catch { return 0; } })();
    const B = (() => { try { return Number(BigInt(b[i] ?? "0")); } catch { return 0; } })();
    const L = (() => { try { return Number(BigInt(l[i] ?? "0")); } catch { return 0; } })();
    return { month: String(months[i] ?? ""), a: A, b: B, l: L };
  });
}

function ComboBarLineChart({
  title,
  months,
  barA,
  barB,
  line,
  aLabel,
  bLabel,
  lineLabel,
}: {
  title: string;
  months: string[];
  barA: string[];
  barB: string[];
  line: string[];
  aLabel: string;
  bLabel: string;
  lineLabel: string;
}) {
  const data = mkComboSeriesData(months, barA, barB, line);
  if (data.length < 2) return <NoTrendNote />;

  const tooltipFmt = (v: any) => {
    try {
      const cents = BigInt(Math.round(Number(v) || 0));
      return formatUsdAccountingFromCents(String(cents)).text;
    } catch {
      return "—";
    }
  };

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] text-slate-600">{title}</div>
          <div className="text-[11px] text-slate-500">{data[data.length - 1]?.month}</div>
        </div>
      </div>

      <div className="mt-3 h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 10, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => compactUsdTickFromCentsNumber(Number(v))}
              width={72}
            />
            <Tooltip
              formatter={(value: any, name: any) => [tooltipFmt(value), String(name)]}
              labelFormatter={(label: any) => String(label)}
              contentStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="a" name={aLabel} fill="hsl(var(--primary))" radius={[3, 3, 3, 3]} />
            <Bar dataKey="b" name={bLabel} fill="rgb(239 68 68 / 0.70)" radius={[3, 3, 3, 3]} />
            <Line dataKey="l" name={lineLabel} type="monotone" stroke="rgb(51 65 85)" strokeWidth={2.25} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DonutBreakdown({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; cents: string }>;
}) {
  if (!rows || rows.length < 2) return null;

  const absBig = (s: string) => {
    try { const n = BigInt(s); return n < 0n ? -n : n; } catch { return 0n; }
  };

  const sorted = [...rows]
    .map((r) => ({ ...r, abs: absBig(r.cents) }))
    .sort((a, b) => (b.abs > a.abs ? 1 : b.abs < a.abs ? -1 : 0));

  const top = sorted.slice(0, 8);
  const rest = sorted.slice(8);
  const otherAbs = rest.reduce((acc, r) => acc + r.abs, 0n);

  const slices = [
    ...top.map((r) => ({ name: r.label, value: Number(r.abs), cents: r.cents })),
    ...(otherAbs > 0n ? [{ name: "Other", value: Number(otherAbs), cents: "0" }] : []),
  ];

  const palette = [
    "rgb(15 23 42)",
    "rgb(51 65 85)",
    "rgb(100 116 139)",
    "rgb(148 163 184)",
    "rgb(203 213 225)",
    "hsl(var(--primary))",
    "rgb(34 197 94)",
    "rgb(59 130 246)",
  ];

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="text-[11px] text-slate-600">{title}</div>

      <div className="mt-2 grid grid-cols-[260px_1fr] gap-6 items-start">
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip
                formatter={(v: any, name: any, props: any) => {
                  const cents = props?.payload?.cents ?? "0";
                  return [formatUsdAccountingFromCents(String(cents)).text, String(name)];
                }}
                contentStyle={{ fontSize: 12 }}
              />
              <Pie data={slices} dataKey="value" nameKey="name" innerRadius={62} outerRadius={90} paddingAngle={2}>
                {slices.map((_, i) => (
                  <Cell key={`cell-${i}`} fill={palette[i % palette.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="min-w-0">
          <div className="space-y-1">
            {top.map((r, i) => {
              const fm = formatUsdAccountingFromCents(r.cents);
              return (
                <div key={`${r.label}-${i}`} className="flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-sm" style={{ background: palette[i % palette.length] }} />
                    <span className="truncate text-slate-700">{r.label}</span>
                  </div>
                  <div className={`tabular-nums ${fm.isNeg ? "text-red-600" : "text-slate-900"}`}>{fm.text}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-2 text-[11px] text-slate-500">
            Composition uses absolute values; amounts display signed accounting values.
          </div>
        </div>
      </div>
    </div>
  );
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

  const [tab, setTab] = useState<TabKey>("pnl"); // Default tab: P&L

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

  const [loading, setLoading] = useState(false);

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
    if (!businessId) return;

    const myEpoch = ++runEpochRef.current;
    const loadingToken = beginLoading();
    setErr(null);

    try {
      if (tab === "pnl") {
        const prev = priorRangeForCurrent(rangeMode, from, to, ym, year, weekFrom, customFrom, customTo, ytd);

        const [res, resPrev, cats, ap] = await Promise.all([
          getPnlSummary(businessId, { from, to, accountId, ytd }),
          getPnlSummary(businessId, { from: prev.from, to: prev.to, accountId, ytd: prev.ytd }),
          getCategories(businessId, { from, to, accountId }),
          getApAging(businessId, { asOf: to }),
        ]);

        if (myEpoch !== runEpochRef.current) return;

        setPnl(res);
        setPnlPrev(resPrev);

        const catRows = (cats?.rows ?? []).map((r: any) => ({ label: String(r.category ?? "Category"), cents: String(r.amount_cents ?? "0") }));
        setTopCats(topNByAbs(catRows, 5));

        const vendorRows = (ap?.rows ?? []).map((r: any) => ({ label: String(r.vendor ?? "Vendor"), cents: String(r.total_cents ?? "0") }));
        setTopVendorsAp(topNByAbs(vendorRows, 5));

        return;
      }

      if (tab === "cashflow") {
        const prev = priorRangeForCurrent(rangeMode, from, to, ym, year, weekFrom, customFrom, customTo, ytd);

        const [res, resPrev, cats, ap, endAcct, endPrevAcct] = await Promise.all([
          getCashflowSeries(businessId, { from, to, accountId, ytd }),
          getCashflowSeries(businessId, { from: prev.from, to: prev.to, accountId, ytd: prev.ytd }),
          getCategories(businessId, { from, to, accountId }),
          getApAging(businessId, { asOf: to }),
          getAccountsSummary(businessId, { asOf: to, accountId, includeArchived: false }),
          getAccountsSummary(businessId, { asOf: prev.to, accountId, includeArchived: false }),
        ]);

        if (myEpoch !== runEpochRef.current) return;

        setCashflow(res);
        setCashflowPrev(resPrev);

        const sumBalances = (rows: any[]) => {
          let s = 0n;
          for (const r of rows ?? []) {
            try { s += BigInt(String(r.balance_cents ?? "0")); } catch {}
          }
          return String(s);
        };

        setCashEndingCents(sumBalances(endAcct?.rows ?? []));
        setCashEndingPrevCents(sumBalances(endPrevAcct?.rows ?? []));

        const catRows = (cats?.rows ?? []).map((r: any) => ({ label: String(r.category ?? "Category"), cents: String(r.amount_cents ?? "0") }));
        setTopCats(topNByAbs(catRows, 5));

        const vendorRows = (ap?.rows ?? []).map((r: any) => ({ label: String(r.vendor ?? "Vendor"), cents: String(r.total_cents ?? "0") }));
        setTopVendorsAp(topNByAbs(vendorRows, 5));

        return;
      }

      if (tab === "accounts") {
        const res = await getAccountsSummary(businessId, { asOf, accountId, includeArchived: includeArchivedAccounts });
        if (myEpoch !== runEpochRef.current) return;
        setAccountsSummary(res);
        return;
      }

      if (tab === "ap") {
        const res = await getApAging(businessId, { asOf });
        if (myEpoch !== runEpochRef.current) return;
        setApAging(res);
        setApVendorId(null);
        setApVendorDetail(null);
        return;
      }

      if (tab === "categories") {
        const res = await getCategories(businessId, { from, to, accountId });
        if (myEpoch !== runEpochRef.current) return;
        setCategories(res);
        setCatDetail(null);
        setCatDetailCategoryId(null);
        setCatPage(1);
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

  return (
    <div className="flex flex-col gap-2 overflow-hidden max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
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

        <div className="mt-2 h-px bg-slate-200" />

        {/* Tabs */}
        <div className="px-3 py-2">
          <div className="flex gap-1.5 text-sm">
            {[
              { key: "pnl", label: "Profit & Loss" },
              { key: "cashflow", label: "Cash Flow" },
              { key: "accounts", label: "Accounts Summary" },
              { key: "ap", label: "AP Aging" },
              { key: "categories", label: "Categories" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key as TabKey)}
                className={`h-7 px-3 rounded-md text-xs font-medium transition ${tab === t.key
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100"
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="h-px bg-slate-200" />

        {/* Controls: Month picker + YTD toggle (only) */}
        <div className="px-3 py-2">
          <FilterBar
            left={
              <>
                <div className="space-y-1">
                  <div className="text-[11px] text-slate-600">Range</div>
                  <select
                    className="h-7 w-[140px] text-xs rounded-md border border-slate-200 bg-white px-2"
                    value={rangeMode}
                    onChange={(e) => setRangeMode(e.target.value as RangeMode)}
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                    <option value="custom">Custom</option>
                  </select>
                </div>

                {rangeMode === "monthly" ? (
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-600">Month</div>
                    <Input type="month" className="h-7 w-[140px] text-xs" value={ym} onChange={(e) => setYm(e.target.value)} />
                  </div>
                ) : null}

                {rangeMode === "yearly" ? (
                  <div className="space-y-1">
                    <div className="text-[11px] text-slate-600">Year</div>
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
                    <div className="text-[11px] text-slate-600">Week of</div>
                    <Input type="date" className="h-7 w-[140px] text-xs" value={weekFrom} onChange={(e) => setWeekFrom(e.target.value)} />
                  </div>
                ) : null}

                {rangeMode === "custom" ? (
                  <div className="flex items-end gap-2">
                    <div className="space-y-1">
                      <div className="text-[11px] text-slate-600">From</div>
                      <Input type="date" className="h-7 w-[140px] text-xs" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] text-slate-600">To</div>
                      <Input type="date" className="h-7 w-[140px] text-xs" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
                    </div>
                  </div>
                ) : null}

                <div className="ml-2 flex flex-col justify-end">
                  <div className="text-[11px] text-slate-500">Range</div>
                  <div className="text-[11px] text-slate-400">
                    {from} → {to}
                  </div>
                </div>

                <div className="ml-4 flex items-center gap-2">
                  <div className="text-[11px] text-slate-600">YTD</div>
                  <PillToggle checked={ytd} onCheckedChange={(next) => setYtd(next)} disabled={rangeMode === "weekly" || rangeMode === "custom"} />
                </div>

                <div className="ml-4 flex items-end gap-3">
                  <div className="flex flex-col justify-end">
                    {tab === "accounts" ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-600 whitespace-nowrap">Archived</span>
                        <PillToggle
                          checked={includeArchivedAccounts}
                          onCheckedChange={(next) => setIncludeArchivedAccounts(next)}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            }
            right={
              <>
                <Button className="h-7 px-3 text-xs" onClick={run} disabled={!businessId || loading}>
                  {loading ? "Running…" : "Run report"}
                </Button>
                {err ? <div className="text-xs text-red-600 ml-2">{err}</div> : null}
              </>
            }
          />
        </div>

        {/* Content */}
        {tab === "pnl" ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Profit &amp; Loss</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="text-[11px] text-slate-600">
                Income and Expenses (ledger effective date). Net = Income − Expenses.
              </div>
              {!pnl ? (
                <div className="text-sm text-slate-600">Run the report to view results.</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="text-xs text-slate-600">Income</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.period.income_cents).isNeg ? "text-red-600" : ""}`}>
                        {formatUsdAccountingFromCents(pnl.period.income_cents).text}
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="text-xs text-slate-600">Expenses</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.period.expense_cents).isNeg ? "text-red-600" : ""}`}>
                        {formatUsdAccountingFromCents(pnl.period.expense_cents).text}
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="text-xs text-slate-600">Net</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(pnl.period.net_cents).isNeg ? "text-red-600" : ""}`}>
                        {formatUsdAccountingFromCents(pnl.period.net_cents).text}
                      </div>
                    </div>
                  </div>

                  {pnlPrev?.period ? (
                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="text-xs text-slate-600">Change vs prior period</div>

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
                              <div className="text-[11px] text-slate-500">Income</div>
                              <div className={`tabular-nums ${dInc < 0n ? "text-red-600" : "text-slate-900"}`}>
                                {formatUsdAccountingFromCents(String(dInc)).text} <span className="text-[11px] text-slate-500">({fmtPct(pInc)})</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-slate-500">Expenses</div>
                              <div className={`tabular-nums ${dExp < 0n ? "text-red-600" : "text-slate-900"}`}>
                                {formatUsdAccountingFromCents(String(dExp)).text} <span className="text-[11px] text-slate-500">({fmtPct(pExp)})</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-slate-500">Net</div>
                              <div className={`tabular-nums ${dNet < 0n ? "text-red-600" : "text-slate-900"}`}>
                                {formatUsdAccountingFromCents(String(dNet)).text} <span className="text-[11px] text-slate-500">({fmtPct(pNet)})</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}

                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-xs text-slate-600">Trend</div>
                    <div className="mt-2">
                      {hasMultiMonthSeries(pnl.monthly ?? []) ? (
                        <ComboBarLineChart
                          title="Income vs Expenses (bars) + Net per period (line)"
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
                      <div className="mt-3 rounded-md border border-slate-200 p-3">
                        <div className="text-xs text-slate-600">YTD ({pnl.ytd.from} → {pnl.ytd.to})</div>
                        <div className="mt-2 grid grid-cols-3 gap-3">
                          <div>
                            <div className="text-[11px] text-slate-500">Income</div>
                            <div className={`font-semibold ${formatUsdAccountingFromCents(pnl.ytd.income_cents).isNeg ? "text-red-600" : ""}`}>
                              {formatUsdAccountingFromCents(pnl.ytd.income_cents).text}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-500">Expenses</div>
                            <div className={`font-semibold ${formatUsdAccountingFromCents(pnl.ytd.expense_cents).isNeg ? "text-red-600" : ""}`}>
                              {formatUsdAccountingFromCents(pnl.ytd.expense_cents).text}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-500">Net</div>
                            <div className={`font-semibold ${formatUsdAccountingFromCents(pnl.ytd.net_cents).isNeg ? "text-red-600" : ""}`}>
                              {formatUsdAccountingFromCents(pnl.ytd.net_cents).text}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* Cash Flow: keep interpretation unique. Top categories/vendors shown on P&L and AP tabs. */}

                  <div className="rounded-md border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-3 h-9 flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-700">Monthly</div>
                      <div className="text-[11px] text-slate-500">{ytd ? "Fiscal YTD buckets" : "Selected month"}</div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      <div className="h-9 px-3 grid grid-cols-4 items-center text-[11px] font-semibold text-slate-700 bg-white">
                        <div>Month</div>
                        <div className="text-right">Income</div>
                        <div className="text-right">Expenses</div>
                        <div className="text-right">Net</div>
                      </div>

                      {(pnl.monthly ?? []).map((r: any, idx: number) => (
                        <div key={`${r.month}-${idx}`} className="h-9 px-3 grid grid-cols-4 items-center gap-3 text-sm">
                          <div className="w-[90px] tabular-nums text-slate-700">{r.month}</div>
                          <div className={`w-[160px] text-right tabular-nums ${formatUsdAccountingFromCents(r.income_cents).isNeg ? "text-red-600" : ""}`}>
                            {formatUsdAccountingFromCents(r.income_cents).text}
                          </div>
                          <div className={`w-[160px] text-right tabular-nums ${formatUsdAccountingFromCents(r.expense_cents).isNeg ? "text-red-600" : ""}`}>
                            {formatUsdAccountingFromCents(r.expense_cents).text}
                          </div>
                          <div className={`w-[160px] text-right tabular-nums ${formatUsdAccountingFromCents(r.net_cents).isNeg ? "text-red-600" : ""}`}>
                            {formatUsdAccountingFromCents(r.net_cents).text}
                          </div>
                        </div>
                      ))}
                      {(pnl.monthly ?? []).length === 0 ? (
                        <div className="h-9 px-3 flex items-center text-sm text-slate-600">No activity in range.</div>
                      ) : null}
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
              <CardTitle className="text-sm">Cash Flow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="text-[11px] text-slate-600">
                Cash In/Out movements (ledger effective date). Line shows cumulative net cash change over the range.
              </div>
              {!cashflow ? (
                <div className="text-sm text-slate-600">Run the report to view results.</div>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-3">
                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="text-xs text-slate-600">Cash In</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(cashflow.totals.cash_in_cents).isNeg ? "text-red-600" : ""}`}>
                        {formatUsdAccountingFromCents(cashflow.totals.cash_in_cents).text}
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="text-xs text-slate-600">Cash Out</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(cashflow.totals.cash_out_cents).isNeg ? "text-red-600" : ""}`}>
                        {formatUsdAccountingFromCents(cashflow.totals.cash_out_cents).text}
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="text-xs text-slate-600">Net change</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(cashflow.totals.net_cents).isNeg ? "text-red-600" : ""}`}>
                        {formatUsdAccountingFromCents(cashflow.totals.net_cents).text}
                      </div>
                    </div>

                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="text-xs text-slate-600">Ending Cash (as of {to})</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(String(cashEndingCents ?? "0")).isNeg ? "text-red-600" : ""}`}>
                        {formatUsdAccountingFromCents(String(cashEndingCents ?? "0")).text}
                      </div>
                      {cashEndingPrevCents ? (
                        <div className="mt-1 text-[11px] text-slate-500">
                          vs prior end: {formatUsdAccountingFromCents(String(BigInt(String(cashEndingCents ?? "0")) - BigInt(String(cashEndingPrevCents)))).text}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {cashflowPrev?.totals ? (
                    <div className="rounded-md border border-slate-200 p-3">
                      <div className="text-xs text-slate-600">Change vs prior period</div>

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
                              <div className="text-[11px] text-slate-500">Cash In</div>
                              <div className={`tabular-nums ${dIn < 0n ? "text-red-600" : "text-slate-900"}`}>
                                {formatUsdAccountingFromCents(String(dIn)).text} <span className="text-[11px] text-slate-500">({fmtPct(pIn)})</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-slate-500">Cash Out</div>
                              <div className={`tabular-nums ${dOut < 0n ? "text-red-600" : "text-slate-900"}`}>
                                {formatUsdAccountingFromCents(String(dOut)).text} <span className="text-[11px] text-slate-500">({fmtPct(pOut)})</span>
                              </div>
                            </div>
                            <div>
                              <div className="text-[11px] text-slate-500">Net change</div>
                              <div className={`tabular-nums ${dNet < 0n ? "text-red-600" : "text-slate-900"}`}>
                                {formatUsdAccountingFromCents(String(dNet)).text} <span className="text-[11px] text-slate-500">({fmtPct(pNet)})</span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}

                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-[11px] text-slate-500 mb-2">Trend</div>

                    {hasMultiMonthSeries(cashflow.monthly ?? []) ? (
                      <ComboBarLineChart
                        title="Cash In vs Cash Out (bars) + Cumulative net cash change (line)"
                        months={(cashflow.monthly ?? []).map((m: any) => m.month)}
                        barA={(cashflow.monthly ?? []).map((m: any) => m.cash_in_cents)}
                        barB={(cashflow.monthly ?? []).map((m: any) => m.cash_out_cents)}
                        line={(() => {
                          const src = (cashflow.monthly ?? []).map((m: any) => m.net_cents);
                          let run = 0n;
                          return src.map((c: any) => {
                            try {
                              run += BigInt(String(c ?? "0"));
                              return String(run);
                            } catch {
                              return String(run);
                            }
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

                  {/* Cash Flow focuses on cash movement + ending cash. Category composition lives in Categories. */}

                  <div className="rounded-md border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-3 h-9 flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-700">Monthly</div>
                      <div className="text-[11px] text-slate-500">{ytd ? "Fiscal YTD buckets" : "Selected month"}</div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      <div className="h-9 px-3 grid grid-cols-4 items-center text-[11px] font-semibold text-slate-700 bg-white">
                        <div>Month</div>
                        <div className="text-right">Cash In</div>
                        <div className="text-right">Cash Out</div>
                        <div className="text-right">Net</div>
                      </div>

                      {(cashflow.monthly ?? []).map((r: any, idx: number) => (
                        <div key={`${r.month}-${idx}`} className="h-9 px-3 grid grid-cols-4 items-center gap-3 text-sm">
                          <div className="w-[90px] tabular-nums text-slate-700">{r.month}</div>
                          <div className={`w-[160px] text-right tabular-nums ${formatUsdAccountingFromCents(r.cash_in_cents).isNeg ? "text-red-600" : ""}`}>
                            {formatUsdAccountingFromCents(r.cash_in_cents).text}
                          </div>
                          <div className={`w-[160px] text-right tabular-nums ${formatUsdAccountingFromCents(r.cash_out_cents).isNeg ? "text-red-600" : ""}`}>
                            {formatUsdAccountingFromCents(r.cash_out_cents).text}
                          </div>
                          <div className={`w-[160px] text-right tabular-nums ${formatUsdAccountingFromCents(r.net_cents).isNeg ? "text-red-600" : ""}`}>
                            {formatUsdAccountingFromCents(r.net_cents).text}
                          </div>
                        </div>
                      ))}
                      {(cashflow.monthly ?? []).length === 0 ? (
                        <div className="h-9 px-3 flex items-center text-sm text-slate-600">No activity in range.</div>
                      ) : null}
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

        {tab === "accounts" ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Accounts Summary (as of {asOf})</CardTitle>
            </CardHeader>

            <CardContent className="space-y-3 text-sm">
              {!accountsSummary ? (
                <div className="text-sm text-slate-600">Run the report to view results.</div>
              ) : (accountsSummary.rows ?? []).length === 0 ? (
                <div className="text-sm text-slate-600">No accounts match this view.</div>
              ) : (
                <>
                  {/* Top accounts chart */}
                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-xs font-semibold text-slate-700">Top accounts</div>
                    <div className="mt-2 h-[320px]">
                      {(() => {
                        const rows = (accountsSummary.rows ?? []).map((r: any) => ({
                          name: String(r.name ?? "Account"),
                          balance: (() => {
                            try {
                              return Number(BigInt(String(r.balance_cents ?? "0")));
                            } catch {
                              return 0;
                            }
                          })(),
                        }));

                        rows.sort((a: any, b: any) => Math.abs(b.balance) - Math.abs(a.balance));
                        const top = rows.slice(0, 10);

                        return (
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={top} layout="vertical" margin={{ top: 10, right: 18, bottom: 10, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis
                                type="number"
                                tick={{ fontSize: 11 }}
                                tickFormatter={(v) => compactUsdTickFromCentsNumber(Number(v))}
                              />
                              <YAxis type="category" dataKey="name" width={180} tick={{ fontSize: 11 }} />
                              <Tooltip
                                formatter={(value: any) => {
                                  try {
                                    const cents = BigInt(Math.round(Number(value) || 0));
                                    return formatUsdAccountingFromCents(String(cents)).text;
                                  } catch {
                                    return "—";
                                  }
                                }}
                                contentStyle={{ fontSize: 12 }}
                              />
                              <Bar dataKey="balance" name="Balance" fill="hsl(var(--primary))" radius={[3, 3, 3, 3]} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Table */}
                  <div className="rounded-md border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-3 h-9 flex items-center text-xs font-semibold text-slate-700">
                      <div className="flex-1">Account</div>
                      <div className="w-[120px] text-right">Type</div>
                      <div className="w-[180px] text-right">Balance</div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {(accountsSummary.rows ?? []).map((r: any) => (
                        <div key={r.account_id} className="h-9 px-3 flex items-center text-sm">
                          <div className="flex-1 min-w-0 truncate">{r.name}</div>
                          <div className="w-[120px] text-right text-slate-600">{r.type}</div>
                          <div className={`w-[180px] text-right tabular-nums ${formatUsdAccountingFromCents(r.balance_cents).isNeg ? "text-red-600" : ""}`}>
                            {formatUsdAccountingFromCents(r.balance_cents).text}
                          </div>
                        </div>
                      ))}
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

        {tab === "ap" ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">AP Aging (as of {asOf})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!apAging ? (
                <div className="text-sm text-slate-600">Run the report to view results.</div>
              ) : (apAging.rows ?? []).length === 0 ? (
                <div className="text-sm text-slate-600">No outstanding AP as of {asOf}.</div>
              ) : (
                <>
                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-xs font-semibold text-slate-700">AP bucket totals</div>
                    <div className="mt-2 h-[260px]">
                      {(() => {
                        const sum = (k: string) => {
                          let s = 0n;
                          for (const r of apAging.rows ?? []) {
                            try { s += BigInt(String((r as any)[k] ?? "0")); } catch {}
                          }
                          return Number(s);
                        };

                        const data = [{
                          label: "AP",
                          Current: sum("current_cents"),
                          "1–30": sum("b1_30_cents"),
                          "31–60": sum("b31_60_cents"),
                          "61–90": sum("b61_90_cents"),
                          "90+": sum("b90p_cents"),
                        }];

                        const fmt = (v: any) => {
                          try {
                            const cents = BigInt(Math.round(Number(v) || 0));
                            return formatUsdAccountingFromCents(String(cents)).text;
                          } catch {
                            return "—";
                          }
                        };

                        return (
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={data} margin={{ top: 10, right: 18, bottom: 10, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => compactUsdTickFromCentsNumber(Number(v))} width={72} />
                              <Tooltip formatter={(value: any, name: any) => [fmt(value), String(name)]} contentStyle={{ fontSize: 12 }} />
                              <Bar dataKey="Current" stackId="ap" fill="rgb(51 65 85)" />
                              <Bar dataKey="1–30" stackId="ap" fill="rgb(100 116 139)" />
                              <Bar dataKey="31–60" stackId="ap" fill="rgb(148 163 184)" />
                              <Bar dataKey="61–90" stackId="ap" fill="rgb(203 213 225)" />
                              <Bar dataKey="90+" stackId="ap" fill="hsl(var(--primary))" />
                            </ComposedChart>
                          </ResponsiveContainer>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-3 h-9 flex items-center text-xs font-semibold text-slate-700">
                      <div className="flex-1">Vendor</div>
                      <div className="w-[120px] text-right">Current</div>
                      <div className="w-[120px] text-right">1–30</div>
                      <div className="w-[120px] text-right">31–60</div>
                      <div className="w-[120px] text-right">61–90</div>
                      <div className="w-[120px] text-right">90+</div>
                      <div className="w-[140px] text-right">Total</div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {(apAging.rows ?? []).map((r: any) => (
                        <button
                          key={r.vendor_id}
                          type="button"
                          className="h-9 px-3 flex items-center text-sm w-full text-left hover:bg-slate-50"
                          onClick={() => openApVendor(r.vendor_id)}
                          title="View bill detail"
                        >
                          <div className="flex-1 min-w-0 truncate">{r.vendor}</div>
                          <div className="w-[120px] text-right tabular-nums">{formatUsdAccountingFromCents(r.current_cents).text}</div>
                          <div className="w-[120px] text-right tabular-nums">{formatUsdAccountingFromCents(r.b1_30_cents).text}</div>
                          <div className="w-[120px] text-right tabular-nums">{formatUsdAccountingFromCents(r.b31_60_cents).text}</div>
                          <div className="w-[120px] text-right tabular-nums">{formatUsdAccountingFromCents(r.b61_90_cents).text}</div>
                          <div className="w-[120px] text-right tabular-nums">{formatUsdAccountingFromCents(r.b90p_cents).text}</div>
                          <div className="w-[140px] text-right tabular-nums font-semibold">{formatUsdAccountingFromCents(r.total_cents).text}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {apVendorId && apVendorDetail ? (
                    <div className="rounded-md border border-slate-200 overflow-hidden">
                      <div className="bg-slate-50 px-3 h-9 flex items-center justify-between">
                        <div className="text-xs font-semibold text-slate-700">Vendor detail</div>
                        <button type="button" className="text-xs text-slate-600 hover:text-slate-900" onClick={() => { setApVendorId(null); setApVendorDetail(null); }}>
                          Close
                        </button>
                      </div>

                      <div className="bg-white px-3 py-2 text-[11px] text-slate-500">
                        Showing open/partial bills only. Outstanding = bill amount − applied payments.
                      </div>

                      <div className="divide-y divide-slate-100">
                        <div className="px-3 py-2 text-[11px] font-semibold text-slate-700 bg-white flex items-center gap-3">
                          <div className="flex-1">Bill</div>
                          <div className="w-[160px] text-right">Outstanding</div>
                          <div className="w-[90px] text-right">Age</div>
                        </div>

                        {(apVendorDetail.rows ?? []).map((b: any) => (
                          <div key={b.bill_id} className="px-3 py-2 text-sm">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs text-slate-600">
                                  Invoice {b.invoice_date} • Due {b.due_date} • {b.status}
                                </div>
                                {b.memo ? <div className="text-xs text-slate-500 truncate">{b.memo}</div> : null}
                              </div>

                              <div className="text-right tabular-nums">
                                <div className="text-[11px] text-slate-500">Outstanding</div>
                                <div className="font-semibold">{formatUsdAccountingFromCents(b.outstanding_cents).text}</div>
                              </div>

                              <div className="w-[90px] text-right tabular-nums text-xs text-slate-600">
                                {b.past_due_days <= 0 ? "Current" : `${b.past_due_days}d`}
                              </div>
                            </div>
                          </div>
                        ))}
                        {(apVendorDetail.rows ?? []).length === 0 ? (
                          <div className="h-9 px-3 flex items-center text-sm text-slate-600">No open bills found.</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            <ReportFootnote
              lines={[
                "As-of: Outstanding vendor bills at the selected date, excluding deleted entries.",
                "Scope: Selected account (or All accounts) as applicable.",
                "Closed periods are read-only (no mutations allowed).",
              ]}
            />
            </CardContent>
          </Card>
        ) : null}

        {tab === "categories" ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Category Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {!categories ? (
                <div className="text-sm text-slate-600">Run the report to view results.</div>
              ) : (categories.rows ?? []).length === 0 ? (
                <div className="text-sm text-slate-600">No categorized activity in range.</div>
              ) : (
                <>
                  <DonutBreakdown
                    title="Category composition"
                    rows={(categories.rows ?? [])
                      .filter((r: any) => r && typeof r.amount_cents === "string")
                      .map((r: any) => ({
                        label: String(r.category ?? "Category"),
                        cents: String(r.amount_cents),
                      }))}
                  />

                  <div className="rounded-md border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-3 h-9 flex items-center text-xs font-semibold text-slate-700">
                      <div className="flex-1">Category</div>
                      <div className="w-[160px] text-right">Amount</div>
                      <div className="w-[90px] text-right">Count</div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {(categories.rows ?? []).map((r: any, idx: number) => (
                        <button
                          key={`${r.category_id ?? "null"}-${idx}`}
                          type="button"
                          className="h-9 px-3 flex items-center text-sm w-full text-left hover:bg-slate-50"
                          onClick={() => openCategoryDetail(r.category_id, 1)}
                          title="Drill down"
                        >
                          <div className="flex-1 min-w-0 truncate">{r.category}</div>
                          <div className={`w-[160px] text-right tabular-nums ${formatUsdAccountingFromCents(r.amount_cents).isNeg ? "text-red-600" : ""}`}>
                            {formatUsdAccountingFromCents(r.amount_cents).text}
                          </div>
                          <div className="w-[90px] text-right tabular-nums text-slate-600">{r.count}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {catDetail ? (
                    <div className="rounded-md border border-slate-200 overflow-hidden">
                      <div className="bg-slate-50 px-3 h-9 flex items-center justify-between">
                        <div className="text-xs font-semibold text-slate-700">Drilldown</div>
                        <button type="button" className="text-xs text-slate-600 hover:text-slate-900" onClick={() => { setCatDetail(null); setCatDetailCategoryId(null); setCatPage(1); }}>
                          Close
                        </button>
                      </div>

                      <div className="bg-white px-3 py-2 text-[11px] text-slate-500">
                        Showing entries for category {catDetailCategoryId === null ? "Uncategorized" : "selected"} • Page {catPage} of{" "}
                        {Math.max(1, Math.ceil(Number(catDetail.total ?? 0) / Number(catDetail.take ?? 50)))}
                      </div>

                      <div className="divide-y divide-slate-100">
                        <div className="h-9 px-3 flex items-center text-[11px] font-semibold text-slate-700 bg-white">
                          <div className="w-[100px]">Date</div>
                          <div className="flex-1">Payee / Memo</div>
                          <div className="w-[180px] text-right">Amount</div>
                        </div>

                        {(catDetail.rows ?? []).map((e: any) => (
                          <div key={e.entry_id} className="h-9 px-3 flex items-center text-sm">
                            <div className="w-[100px] text-slate-600 tabular-nums">{e.date}</div>
                            <div className="flex-1 min-w-0 truncate">{e.payee ?? e.memo ?? "—"}</div>
                            <div className={`w-[180px] text-right tabular-nums ${formatUsdAccountingFromCents(e.amount_cents).isNeg ? "text-red-600" : ""}`}>
                              {formatUsdAccountingFromCents(e.amount_cents).text}
                            </div>
                          </div>
                        ))}
                        {(catDetail.rows ?? []).length === 0 ? (
                          <div className="h-9 px-3 flex items-center text-sm text-slate-600">No entries found.</div>
                        ) : null}
                      </div>

                      <div className="px-3 py-2 flex items-center justify-between">
                        <Button
                          variant="outline"
                          className="h-7 px-3 text-xs"
                          disabled={catPage <= 1 || loading}
                          onClick={() => openCategoryDetail(catDetailCategoryId, Math.max(1, catPage - 1))}
                        >
                          Prev
                        </Button>
                        <Button
                          variant="outline"
                          className="h-7 px-3 text-xs"
                          disabled={catPage >= Math.ceil(Number(catDetail.total ?? 0) / Number(catDetail.take ?? 50)) || loading}
                          onClick={() => openCategoryDetail(catDetailCategoryId, catPage + 1)}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  ) : null}
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
      </div>
    </div>
  );
}
