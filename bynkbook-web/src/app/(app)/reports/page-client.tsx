"use client";

import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { FilterBar } from "@/components/primitives/FilterBar";
import { PillToggle } from "@/components/primitives/PillToggle";
import { ringFocus } from "@/components/primitives/tokens";

import { AppDatePicker } from "@/components/primitives/AppDatePicker";

import { InlineBanner } from "@/components/app/inline-banner";
import { EmptyStateCard } from "@/components/app/empty-state";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";
import { FileText, TrendingUp, TrendingDown, Sigma, BarChart3, LineChart, PieChart as PieIcon, Landmark } from "lucide-react";

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

function normalizeMonthKeysForChart(rawMonths: string[], rangeToYmd: string) {
  const months = (rawMonths ?? []).map((m) => String(m ?? "").trim());
  if (months.length === 0) return months;

  // Accept already-good keys: YYYY, YYYY-MM, YYYY-MM-DD, YYYY-W##.
  const ok = (s: string) =>
    /^\d{4}$/.test(s) ||
    /^\d{4}-\d{2}$/.test(s) ||
    /^\d{4}-\d{2}-\d{2}$/.test(s) ||
    /^\d{4}-W?\d{1,2}$/i.test(s);

  // If ALL are acceptable, do nothing.
  if (months.every(ok)) return months;

  // Otherwise: synthesize YYYY-MM buckets ending at rangeTo month.
  // This fixes bad labels like "Fri Aug" while staying deterministic.
  const end = new Date(`${rangeToYmd}T00:00:00`);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  const n = months.length;
  return months.map((_, i) => {
    const d = new Date(endMonth.getFullYear(), endMonth.getMonth() - (n - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

function hasMultiMonthSeries(monthly: Array<{ month: string }>) {
  if (!Array.isArray(monthly)) return false;
  const uniq = new Set(monthly.map((m) => String(m.month)));
  // Allow 1 bucket so charts still show for valid single-period ranges.
  return uniq.size >= 1;
}

function NoTrendNote() {
  return <div className="text-xs text-bb-text-muted">No multi-month trend for this range.</div>;
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

function ReportsResponsiveChartFrame({
  children,
  className = "h-[260px] min-h-[260px]",
}: {
  children: ReactElement;
  className?: string;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [initialDimension, setInitialDimension] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    let rafId = 0;
    let disposed = false;

    const markReadyIfMeasured = () => {
      const el = frameRef.current;
      if (!el || disposed) return;

      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setInitialDimension((current) => current ?? {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    };

    rafId = window.requestAnimationFrame(markReadyIfMeasured);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(markReadyIfMeasured);

    if (frameRef.current) {
      resizeObserver?.observe(frameRef.current);
    }

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
    };
  }, []);

  return (
    <div ref={frameRef} className={`min-w-0 w-full ${className}`}>
      {initialDimension ? (
        <ResponsiveContainer
          width="99%"
          height="99%"
          minWidth={0}
          minHeight={0}
          initialDimension={initialDimension}
        >
          {children}
        </ResponsiveContainer>
      ) : (
        <div className="h-full w-full" />
      )}
    </div>
  );
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
  rangeMode,
  rangeTo,
}: {
  title: string;
  months: string[];
  barA: string[];
  barB: string[];
  line: string[];
  aLabel: string;
  bLabel: string;
  lineLabel: string;
  rangeMode: RangeMode;
  rangeTo: string;
}) {
  const normMonths = normalizeMonthKeysForChart(months, rangeTo);
  const data = mkComboSeriesData(normMonths, barA, barB, line);
  if (data.length < 1) return <NoTrendNote />;

  const tooltipFmt = (v: any) => {
    try {
      const cents = BigInt(Math.round(Number(v) || 0));
      return formatUsdAccountingFromCents(String(cents)).text;
    } catch {
      return "—";
    }
  };

  return (
    <ReportsResponsiveChartFrame>
      <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 6, left: 8 }}>
        <CartesianGrid stroke="var(--bb-chart-grid)" strokeDasharray="3 3" />

        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: "var(--bb-chart-axis)" }}
          tickFormatter={(v: any) => formatBucketLabel(String(v), rangeMode)}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--bb-chart-axis)" }}
          tickFormatter={(v) => compactUsdTickFromCentsNumber(Number(v))}
          width={72}
        />

        <Tooltip
          formatter={(value: any, name: any) => [tooltipFmt(value), String(name)]}
          labelFormatter={(label: any) => formatBucketLabel(String(label), rangeMode)}
          contentStyle={{
            fontSize: 12,
            background: "var(--bb-chart-tooltip-bg)",
            border: "1px solid var(--bb-chart-tooltip-border)",
            borderRadius: 10,
          }}
          labelStyle={{ color: "var(--bb-chart-tooltip-text)", fontWeight: 600 }}
          itemStyle={{ color: "var(--bb-chart-tooltip-text)" }}
        />

        <Bar
          dataKey="a"
          name={aLabel}
          fill="var(--bb-chart-income)"
          radius={[4, 4, 0, 0]}
          isAnimationActive
          animationDuration={200}
        />
        <Bar
          dataKey="b"
          name={bLabel}
          fill="var(--bb-chart-expense)"
          radius={[4, 4, 0, 0]}
          isAnimationActive
          animationDuration={200}
        />
        <Line
          dataKey="l"
          name={lineLabel}
          type="monotone"
          stroke="var(--bb-chart-net)"
          strokeWidth={2.25}
          dot={false}
          isAnimationActive
          animationDuration={200}
        />
      </ComposedChart>
    </ReportsResponsiveChartFrame>
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
    "var(--bb-text-subtle)",
    "var(--chart-4)",
    "var(--chart-5)",
    "var(--bb-chart-income)",
    "var(--bb-chart-expense)",
    "var(--bb-chart-net)",
    "rgb(147 51 234)", // purple
    "rgb(14 165 233)", // sky
  ];

  return (
    <div className="rounded-md border border-bb-border p-3">
      <div className="flex items-center gap-2 text-[11px] text-bb-text-muted">
        <PieIcon className="h-4 w-4 text-bb-text-muted" />
        {title}
      </div>

      <div className="mt-2 grid grid-cols-[260px_1fr] gap-6 items-start">
        <ReportsResponsiveChartFrame>
          <PieChart>
            <Tooltip
              formatter={(v: any, name: any, props: any) => {
                const cents = props?.payload?.cents ?? "0";
                return [formatUsdAccountingFromCents(String(cents)).text, String(name)];
              }}
              contentStyle={{
                fontSize: 12,
                background: "var(--bb-chart-tooltip-bg)",
                border: "1px solid var(--bb-chart-tooltip-border)",
                borderRadius: 10,
                color: "var(--bb-chart-tooltip-text)",
              }}
              itemStyle={{ color: "var(--bb-chart-tooltip-text)" }}
            />
            <Pie data={slices} dataKey="value" nameKey="name" innerRadius={62} outerRadius={90} paddingAngle={2}>
              {slices.map((_, i) => (
                <Cell key={`cell-${i}`} fill={palette[i % palette.length]} />
              ))}
            </Pie>
          </PieChart>
        </ReportsResponsiveChartFrame>

        <div className="min-w-0">
          <div className="space-y-1">
            {top.map((r, i) => {
              const fm = formatUsdAccountingFromCents(r.cents);
              return (
                <div key={`${r.label}-${i}`} className="flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-sm" style={{ background: palette[i % palette.length] }} />
                    <span className="truncate text-bb-text">{r.label}</span>
                  </div>
                  <div className={`tabular-nums ${fm.isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}>{fm.text}</div>
                </div>
              );
            })}
          </div>

          <div className="mt-2 text-[11px] text-bb-text-muted">
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
      if (tab === "overview" || tab === "monthly" || tab === "pnl") {
        const prev = priorRangeForCurrent(rangeMode, from, to, ym, year, weekFrom, customFrom, customTo, ytd);

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
          getPnlSummary(businessId, { from, to, accountId, ytd }),
          getPnlSummary(businessId, { from: prev.from, to: prev.to, accountId, ytd: prev.ytd }),
          getCashflowSeries(businessId, { from, to, accountId, ytd }),
          getCashflowSeries(businessId, { from: prev.from, to: prev.to, accountId, ytd: prev.ytd }),
          getCategories(businessId, { from, to, accountId }),
          getApAging(businessId, { asOf: to }),
          getAccountsSummary(businessId, { asOf: to, accountId, includeArchived: false }),
          getAccountsSummary(businessId, { asOf: prev.to, accountId, includeArchived: false }),
        ]);

        if (myEpoch !== runEpochRef.current) return;

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
            try { s += BigInt(String(r.balance_cents ?? "0")); } catch { }
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
                className={`h-7 px-3 rounded-md text-xs font-medium transition ${tab === t.key
                  ? "bg-bb-text text-bb-text-inverse shadow-sm"
                  : "text-bb-text-muted hover:bg-bb-table-row-hover"
                  }`}
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
                  <select
                    className="h-7 w-[140px] text-xs rounded-md border border-bb-input-border bg-bb-input-bg px-2"
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
                  {loading ? "Running…" : "Run report"}
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
              {!pnl || !cashflow ? (
                <div className="text-sm text-bb-text-muted">Run the report to view results.</div>
              ) : (
                <>
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
                <div className="text-sm text-bb-text-muted">Run the report to view results.</div>
              ) : (
                <>
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
              {!pnl ? (
                <div className="text-sm text-bb-text-muted">Run the report to view results.</div>
              ) : (
                <>
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
              {!cashflow ? (
                <div className="text-sm text-bb-text-muted">Run the report to view results.</div>
              ) : (
                <>
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
