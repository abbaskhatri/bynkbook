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

type ComboChartLayout = {
  w: number;
  h: number;
  padX: number;
  padY: number;
  zeroY: number;
  grid: Array<{ y: number; isZero: boolean; label: string }>;
  bars: Array<{ x: number; y: number; width: number; height: number; cls: string; key: string }>;
  linePoints: string;
};

function computeChartLayout(args: {
  n: number;
  barA: number[];
  barB: number[];
  line: number[];
  formatMoney: (cents: string) => { text: string; isNeg: boolean };
}): ComboChartLayout {
  const { n, barA, barB, line, formatMoney } = args;

  const w = 720;
  const h = 140;
  const padX = 44; // leave room for Y labels
  const padY = 14;

  const values = [...barA, ...barB, ...line];
  let min = Math.min(...values);
  let max = Math.max(...values);

  // Ensure 0 is in range so baseline is always meaningful and stable.
  if (min > 0) min = 0;
  if (max < 0) max = 0;

  const span = max - min || 1;

  const xStep = (w - padX * 2) / (n - 1);

  const yOf = (v: number) => {
    const yy = padY + ((max - v) * (h - padY * 2)) / span;
    return Math.round(yy); // pixel rounding for consistent alignment
  };

  const zeroY = yOf(0);

  const makeTickLabel = (v: number) => {
    // Labels must align to the same baseline math; format as accounting cents.
    try {
      const cents = String(BigInt(Math.round(v)));
      return formatMoney(cents).text;
    } catch {
      return formatMoney("0").text;
    }
  };

  // Deterministic grid/ticks: always include 0 when range crosses 0.
  const gridValues: number[] = (() => {
    const crossesZero = min < 0 && max > 0;
    if (crossesZero) {
      return [max, (max + 0) / 2, 0, (0 + min) / 2, min];
    }
    // all positive or all negative (0 is forced into range above)
    return [max, (max + min) / 2, min];
  })();

  const grid = gridValues.map((v) => ({
    y: yOf(v),
    isZero: Math.round(v) === 0,
    label: makeTickLabel(v),
  }));

  // Bars
  const barW = Math.max(6, Math.min(18, xStep * 0.35));
  const bars: ComboChartLayout["bars"] = [];

  for (let i = 0; i < n; i++) {
    const xc = padX + i * xStep;

    const mk = (xCenter: number, v: number, cls: string, key: string) => {
      const yy = yOf(v);
      const top = Math.min(yy, zeroY);
      const bottom = Math.max(yy, zeroY);
      const height = Math.max(1, bottom - top);
      const xLeft = Math.round(xCenter - barW / 2);
      return { x: xLeft, y: top, width: Math.round(barW), height, cls, key };
    };

    bars.push(mk(xc - barW * 0.35, barA[i] ?? 0, "fill-primary/80", `a-${i}`));
    bars.push(mk(xc + barW * 0.35, barB[i] ?? 0, "fill-red-500/70", `b-${i}`));
  }

  const linePoints = line
    .slice(0, n)
    .map((v, i) => `${(padX + i * xStep).toFixed(1)},${yOf(v).toFixed(1)}`)
    .join(" ");

  return { w, h, padX, padY, zeroY, grid, bars, linePoints };
}

function ComboBarLineChart({
  title,
  months,
  barA, // positive series (income/cash in)
  barB, // negative series (expense/cash out)
  line, // net
  formatMoney,
}: {
  title: string;
  months: string[];
  barA: string[];
  barB: string[];
  line: string[];
  formatMoney: (cents: string) => { text: string; isNeg: boolean };
}) {
  const n = Math.min(months.length, barA.length, barB.length, line.length);
  if (n < 2) return <NoTrendNote />;

  // Convert BigInt cents to number for plotting (safe enough for charting ranges)
  const A = barA.slice(0, n).map((v) => {
    try { return Number(BigInt(v)); } catch { return 0; }
  });
  const B = barB.slice(0, n).map((v) => {
    try { return Number(BigInt(v)); } catch { return 0; }
  });
  const L = line.slice(0, n).map((v) => {
    try { return Number(BigInt(v)); } catch { return 0; }
  });

  const layout = computeChartLayout({ n, barA: A, barB: B, line: L, formatMoney });

  // Legend values: show most recent month numbers (signed, accounting format)
  const last = n - 1;
  const lastA = formatMoney(String(BigInt(barA[last] ?? "0")));
  const lastB = formatMoney(String(BigInt(barB[last] ?? "0")));
  const lastL = formatMoney(String(BigInt(line[last] ?? "0")));

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] text-slate-600">{title}</div>
          <div className="text-[11px] text-slate-500">{months[last]}</div>
        </div>

        <div className="flex items-center gap-4 text-[11px] text-slate-600">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-sm bg-primary" />
            <span>In</span>
            <span className={lastA.isNeg ? "text-red-600" : ""}>{lastA.text}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-sm bg-red-500/70" />
            <span>Out</span>
            <span className={lastB.isNeg ? "text-red-600" : ""}>{lastB.text}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 rounded bg-slate-700" />
            <span>Net</span>
            <span className={lastL.isNeg ? "text-red-600" : ""}>{lastL.text}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 overflow-x-auto">
        <svg width={layout.w} height={layout.h} viewBox={`0 0 ${layout.w} ${layout.h}`} className="block">
          {/* gridlines + labels (single source of truth from layout) */}
          {layout.grid.map((g) => (
            <g key={`grid-${g.y}`}>
              <line
                x1={layout.padX}
                x2={layout.w - layout.padX}
                y1={g.y}
                y2={g.y}
                className={g.isZero ? "stroke-slate-200" : "stroke-slate-100"}
                strokeWidth={g.isZero ? 1 : 1}
              />
              <text x={layout.padX - 8} y={g.y} textAnchor="end" dominantBaseline="middle" className="fill-slate-500 text-[10px]">
                {g.label}
              </text>
            </g>
          ))}

          {/* bars */}
          {layout.bars.map((b) => (
            <rect key={b.key} x={b.x} y={b.y} width={b.width} height={b.height} rx={3} className={b.cls} />
          ))}

          {/* net line */}
          <polyline fill="none" stroke="currentColor" strokeWidth="2" points={layout.linePoints} className="text-slate-700" />
        </svg>
      </div>

      <div className="mt-2 flex gap-2 text-[11px] text-slate-500">
        <span>{months[0]}</span>
        <span>→</span>
        <span>{months[last]}</span>
      </div>
    </div>
  );
}

function DonutBreakdown({
  title,
  rows,
  formatMoney,
}: {
  title: string;
  rows: Array<{ label: string; cents: string }>;
  formatMoney: (cents: string) => { text: string; isNeg: boolean };
}) {
  if (!rows || rows.length < 2) return null;

  // Top 8 by abs(amount); remainder -> Other
  const sorted = [...rows].sort((a, b) => {
    const aa = (() => { try { return Number(BigInt(a.cents < "0" ? a.cents.slice(1) : a.cents)); } catch { return 0; } })();
    const bb = (() => { try { return Number(BigInt(b.cents < "0" ? b.cents.slice(1) : b.cents)); } catch { return 0; } })();
    return bb - aa;
  });

  const top = sorted.slice(0, 8);
  const rest = sorted.slice(8);

  const absBig = (s: string) => {
    try { const n = BigInt(s); return n < 0n ? -n : n; } catch { return 0n; }
  };

  const topAbs = top.map((r) => absBig(r.cents));
  const otherAbs = rest.reduce((acc, r) => acc + absBig(r.cents), 0n);

  const slices = [...top.map((r, i) => ({ label: r.label, cents: r.cents, abs: topAbs[i] })), ...(otherAbs > 0n ? [{ label: "Other", cents: "0", abs: otherAbs }] : [])];

  const totalAbs = slices.reduce((acc, s) => acc + s.abs, 0n);
  if (totalAbs <= 0n) return null;

  const w = 160;
  const h = 160;
  const r = 62;
  const cx = w / 2;
  const cy = h / 2;
  const C = 2 * Math.PI * r;

  let offset = 0;

  // Use a restrained palette (professional): slate shades + one accent
  const colors = [
    "stroke-slate-900",
    "stroke-slate-700",
    "stroke-slate-500",
    "stroke-slate-400",
    "stroke-slate-300",
    "stroke-primary",
    "stroke-primary",
    "stroke-primary",
    "stroke-slate-200",
  ];

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="text-[11px] text-slate-600">{title}</div>

      <div className="mt-2 flex items-start gap-4">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
          {/* background ring */}
          <circle cx={cx} cy={cy} r={r} fill="none" className="stroke-slate-200" strokeWidth="14" />

          {/* slices sized by ABS(amount) */}
          {slices.map((s, i) => {
            const frac = Number(s.abs) / Number(totalAbs);
            const len = Math.max(1, frac * C);
            const dash = `${len} ${C - len}`;
            const thisOffset = offset;
            offset += len;

            return (
              <circle
                key={`${s.label}-${i}`}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                strokeWidth="14"
                strokeLinecap="butt"
                className={colors[i % colors.length]}
                style={{
                  strokeDasharray: dash,
                  strokeDashoffset: -thisOffset,
                  transform: "rotate(-90deg)",
                  transformOrigin: "50% 50%",
                  opacity: 0.9,
                }}
              />
            );
          })}
        </svg>

        <div className="min-w-0 flex-1">
          <div className="space-y-1">
            {top.map((r, i) => {
              const fm = formatMoney(r.cents);
              const abs = absBig(r.cents);
              const pct = Math.round((Number(abs) / Number(totalAbs)) * 100);
              return (
                <div key={`${r.label}-${i}`} className="flex items-center justify-between gap-3 text-xs">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-sm ${i % 2 === 0 ? "bg-slate-700" : "bg-primary"}`} />
                    <span className="truncate text-slate-700">{r.label}</span>
                    <span className="text-[11px] text-slate-500">{pct}%</span>
                  </div>
                  <div className={`tabular-nums ${fm.isNeg ? "text-red-600" : "text-slate-900"}`}>{fm.text}</div>
                </div>
              );
            })}
            {otherAbs > 0n ? (
              <div className="flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0 flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-sm bg-slate-300" />
                  <span className="truncate text-slate-700">Other</span>
                </div>
                <div className="tabular-nums text-slate-600">—</div>
              </div>
            ) : null}
          </div>

          <div className="mt-2 text-[11px] text-slate-500">
            Slice sizing uses absolute value; amounts display signed accounting values.
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
  const [cashflow, setCashflow] = useState<any>(null);
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
        const res = await getPnlSummary(businessId, { from, to, accountId, ytd });
        if (myEpoch !== runEpochRef.current) return;
        setPnl(res);
        return;
      }

      if (tab === "cashflow") {
        const res = await getCashflowSeries(businessId, { from, to, accountId, ytd });
        if (myEpoch !== runEpochRef.current) return;
        setCashflow(res);
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

    // Clear visible results when range inputs change (user must still click Run report)
  useEffect(() => {
    setErr(null);
    runEpochRef.current += 1;
    setLoading(false);

    setPnl(null);
    setCashflow(null);
    setAccountsSummary(null);
    setApAging(null);
    setApVendorId(null);
    setApVendorDetail(null);
    setCategories(null);
    setCatDetail(null);
    setCatDetailCategoryId(null);
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

                  {ytd && pnl.ytd ? (
                    <div className="rounded-md border border-slate-200 p-3">
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

                      <div className="mt-3">
                        <div className="text-[11px] text-slate-500 mb-2">Trend</div>

                        {hasMultiMonthSeries(pnl.monthly ?? []) ? (
                          <ComboBarLineChart
                            title="Income vs Expenses (bars) + Net (line)"
                            months={(pnl.monthly ?? []).map((m: any) => m.month)}
                            barA={(pnl.monthly ?? []).map((m: any) => m.income_cents)}
                            barB={(pnl.monthly ?? []).map((m: any) => m.expense_cents)}
                            line={(pnl.monthly ?? []).map((m: any) => m.net_cents)}
                            formatMoney={formatUsdAccountingFromCents}
                          />
                        ) : (
                          <NoTrendNote />
                        )}
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-md border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-3 h-9 flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-700">Monthly</div>
                      <div className="text-[11px] text-slate-500">{ytd ? "Fiscal YTD buckets" : "Selected month"}</div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {(pnl.monthly ?? []).map((r: any, idx: number) => (
                        <div key={`${r.month}-${idx}`} className="h-9 px-3 flex items-center gap-3 text-sm">
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
              {!cashflow ? (
                <div className="text-sm text-slate-600">Run the report to view results.</div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
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
                      <div className="text-xs text-slate-600">Net</div>
                      <div className={`text-sm font-semibold ${formatUsdAccountingFromCents(cashflow.totals.net_cents).isNeg ? "text-red-600" : ""}`}>
                        {formatUsdAccountingFromCents(cashflow.totals.net_cents).text}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-200 p-3">
                    <div className="text-[11px] text-slate-500 mb-2">Trend</div>

                    {hasMultiMonthSeries(cashflow.monthly ?? []) ? (
                      <ComboBarLineChart
                        title="Cash In vs Cash Out (bars) + Net (line)"
                        months={(cashflow.monthly ?? []).map((m: any) => m.month)}
                        barA={(cashflow.monthly ?? []).map((m: any) => m.cash_in_cents)}
                        barB={(cashflow.monthly ?? []).map((m: any) => m.cash_out_cents)}
                        line={(cashflow.monthly ?? []).map((m: any) => m.net_cents)}
                        formatMoney={formatUsdAccountingFromCents}
                      />
                    ) : (
                      <NoTrendNote />
                    )}
                  </div>

                  <div className="rounded-md border border-slate-200 overflow-hidden">
                    <div className="bg-slate-50 px-3 h-9 flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-700">Monthly</div>
                      <div className="text-[11px] text-slate-500">{ytd ? "Fiscal YTD buckets" : "Last 12 months ending selected month"}</div>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {(cashflow.monthly ?? []).map((r: any, idx: number) => (
                        <div key={`${r.month}-${idx}`} className="h-9 px-3 flex items-center gap-3 text-sm">
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
            <CardContent className="space-y-2 text-sm">
              {!accountsSummary ? (
                <div className="text-sm text-slate-600">Run the report to view results.</div>
              ) : (accountsSummary.rows ?? []).length === 0 ? (
                <div className="text-sm text-slate-600">No accounts match this view.</div>
              ) : (
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
                    formatMoney={formatUsdAccountingFromCents}
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
