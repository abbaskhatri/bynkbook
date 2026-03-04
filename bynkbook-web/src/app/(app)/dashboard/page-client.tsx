"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
// Auth handled by AppShell

import { useQuery } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { getPnlSummary, getCashflowSeries, getCategories, getAccountsSummary } from "@/lib/api/reports";
import { getIssuesCount } from "@/lib/api/issues";

import { AppDatePicker } from "@/components/primitives/AppDatePicker";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend as RechartsLegend,
  ReferenceLine,
} from "recharts";

import {
  ChartContainer,
  MoneyXAxis,
  MoneyYAxis,
  MoneyGrid,
  MoneyTooltip,
  formatUsdAccountingFromCents,
} from "@/components/charts/ChartContainer";

import {
  LayoutDashboard,
  Wallet,
  Timer,
  TrendingUp,
  TrendingDown,
  Sigma,
  Landmark,
  AlertTriangle,
  Tag,
  BarChart3,
  LineChart,
  PieChart as PieIcon,
  Sparkles,
  CalendarDays,
} from "lucide-react";

import { EmptyStateCard } from "@/components/app/empty-state";
import { InlineBanner } from "@/components/app/inline-banner";
import { appErrorMessageOrNull, extractHttpStatus } from "@/lib/errors/app-error";

type PeriodMode = "THIS_MONTH" | "LAST_MONTH" | "LAST_3_MONTHS" | "YTD" | "CUSTOM";

type Money = { text: string; isNeg: boolean };

function isoYmd(d: Date) {
  return d.toISOString().slice(0, 10);
}
function ymOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function firstOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function lastOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}
function monthAbbr(raw: string) {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const s = String(raw ?? "").trim();

  // Preferred: YYYY-MM
  if (/^\d{4}-\d{2}$/.test(s)) {
    const m = Number(s.slice(5, 7));
    return `${names[m - 1] ?? s} ${s.slice(2, 4)}`;
  }

  // Do NOT parse arbitrary date strings (it creates "Fri Aug" style labels).
  // If it's not YYYY-MM, return the raw value.

  return s || "—";
}

function absBig(n: bigint) {
  return n < 0n ? -n : n;
}

function fmtUsdAccountingFromCents(centsStr?: string): Money {
  if (!centsStr) return { text: "—", isNeg: false };
  let n: bigint;
  try {
    n = BigInt(centsStr);
  } catch {
    return { text: "—", isNeg: false };
  }
  const isNeg = n < 0n;
  const a = isNeg ? -n : n;

  const dollars = a / 100n;
  const cents = a % 100n;

  const dollarsStr = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents2 = cents.toString().padStart(2, "0");
  const base = `$${dollarsStr}.${cents2}`;
  return { text: isNeg ? `(${base})` : base, isNeg };
}

function centsToNumber(centsStr: string) {
  try {
    return Number(BigInt(centsStr)) / 100;
  } catch {
    return 0;
  }
}

function moneyClassFromCents(centsStr?: string) {
  try {
    if (!centsStr) return "text-slate-900";
    return BigInt(centsStr) < 0n ? "text-rose-600" : "text-slate-900";
  } catch {
    return "text-slate-900";
  }
}

type AreaLayout = {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  domainMin: number;
  domainMax: number;
  zeroY: number | null;
  grid: Array<{ y: number; label: string; isZero: boolean }>;
  x: number[];
  lineD: string;
  areaD: string;
};

function computeNiceTicks(minV: number, maxV: number) {
  // 5 ticks max. Deterministic, no scoring.
  const span = maxV - minV || 1;
  const rawStep = span / 4;
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep))));
  const step = Math.max(pow10, Math.round(rawStep / pow10) * pow10);

  const start = Math.floor(minV / step) * step;
  const end = Math.ceil(maxV / step) * step;

  const ticks: number[] = [];
  for (let v = start; v <= end + step * 0.5; v += step) ticks.push(v);
  return ticks;
}

function fmtAxisUsd(n: number) {
  const abs = Math.abs(n);
  const sign = n < 0 ? -1 : 1;

  const to = (v: number) => {
    // v is dollars (number)
    // Compact format: $0, $10K, $1.2M
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(v % 1_000 === 0 ? 0 : 1)}K`;
    return `$${Math.round(v).toString()}`;
  };

  const s = to(abs);
  return sign < 0 ? `(${s})` : s;
}

function computeAreaLayout(args: {
  labels: string[];
  valuesDollars: number[];
  // Chart rule: add 5–10% padding so movement is visible in tight ranges.
  padPct: number;
}): AreaLayout {
  const w = 980;
  const h = 300;

  const padL = 64;
  const padR = 16;
  const padT = 16;
  const padB = 34;

  const n = Math.min(args.labels.length, args.valuesDollars.length);
  const vals = args.valuesDollars.slice(0, n);

  // Guard: if we don't have at least 2 points, return a safe empty layout.
  // This prevents runtime crashes during initial loads / empty datasets.
  if (vals.length < 2) {
    return {
      w,
      h,
      padL,
      padR,
      padT,
      padB,
      domainMin: 0,
      domainMax: 1,
      zeroY: null,
      grid: [],
      x: [],
      lineD: "",
      areaD: "",
    };
  }

  let minV = Math.min(...vals);
  let maxV = Math.max(...vals);

  // padding rule (5–10% of range); if range is 0, use a small fixed pad.
  const span = maxV - minV;
  const pad = span === 0 ? Math.max(Math.abs(maxV) * 0.08, 250) : Math.max(span * args.padPct, span * 0.05);
  minV = minV - pad;
  maxV = maxV + pad;

  const yOf = (v: number) => {
    const usable = h - padT - padB;
    const s = (maxV - v) / (maxV - minV || 1);
    return Math.round(padT + s * usable);
  };

  const xStep = (w - padL - padR) / (n - 1);
  const x = Array.from({ length: n }).map((_, i) => Math.round(padL + i * xStep));

  const ticks = computeNiceTicks(minV, maxV);

  // Zero baseline: only if 0 is within visible range.
  const zeroY = 0 >= minV && 0 <= maxV ? yOf(0) : null;

  const grid = ticks
    .map((t) => ({
      y: yOf(t),
      label: fmtAxisUsd(t),
      isZero: Math.abs(t) < 1e-9,
    }))
    .filter((g, idx, arr) => idx === 0 || g.y !== arr[idx - 1].y); // avoid duplicates after rounding

  const pts = vals.map((v, i) => ({ x: x[i], y: yOf(v) }));

  const lineD = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  // Area closes to bottom plot baseline (not zero). This is Cash Position chart (ending cash), not net chart.
  const bottomY = h - padB;
  const areaD =
    `${lineD} ` +
    `L ${pts[pts.length - 1].x} ${bottomY} ` +
    `L ${pts[0].x} ${bottomY} Z`;

  return {
    w,
    h,
    padL,
    padR,
    padT,
    padB,
    domainMin: minV,
    domainMax: maxV,
    zeroY,
    grid,
    x,
    lineD,
    areaD,
  };
}

type CashBarsLayout = {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
  x: number[];
  grid: Array<{ y: number; label: string; isZero: boolean }>;
  yOf: (v: number) => number;
};

function computeCashBarsLayout(args: {
  labels: string[];
  inCents: string[];
  outCents: string[];
  padPct: number; // 5–10% domain padding
}): CashBarsLayout {
  const w = 980;
  const h = 300;

  const padL = 64;
  const padR = 16;
  const padT = 16;
  const padB = 34;

  const n = Math.min(args.labels.length, args.inCents.length, args.outCents.length);
  if (n < 2) {
    return { w, h, padL, padR, padT, padB, x: [], grid: [], yOf: () => h - padB };
  }

  const centsToAbsDollars = (s: string) => {
    try {
      return Math.abs(Number(BigInt(String(s ?? "0")))) / 100;
    } catch {
      return 0;
    }
  };

  let maxV = 0;
  for (let i = 0; i < n; i++) {
    maxV = Math.max(maxV, centsToAbsDollars(args.inCents[i]), centsToAbsDollars(args.outCents[i]));
  }

  const pad = Math.max(maxV * args.padPct, maxV * 0.05, 100);
  const domainMax = maxV + pad;

  const yOf = (v: number) => {
    const usable = h - padT - padB;
    const s = (domainMax - v) / (domainMax || 1);
    return Math.round(padT + s * usable);
  };

  const xStep = (w - padL - padR) / (n - 1);
  const x = Array.from({ length: n }).map((_, i) => Math.round(padL + i * xStep));

  const ticks = computeNiceTicks(0, domainMax);
  const grid = ticks
    .map((t) => ({ y: yOf(t), label: fmtAxisUsd(t), isZero: Math.abs(t) < 1e-9 }))
    .filter((g, idx, arr) => idx === 0 || g.y !== arr[idx - 1].y);

  return { w, h, padL, padR, padT, padB, x, grid, yOf };
}

export default function DashboardPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  useEffect(() => {
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;
    if (!sp.get("businessId")) router.replace(`/dashboard?businessId=${selectedBusinessId}`);
  }, [businessesQ.isLoading, selectedBusinessId, router, sp]);

  // Period selector (top-right; controls ALL widgets)
  const [periodMode, setPeriodMode] = useState<PeriodMode>("LAST_3_MONTHS");
  const [customFrom, setCustomFrom] = useState<string>(() => isoYmd(firstOfMonth(new Date())));
  const [customTo, setCustomTo] = useState<string>(() => isoYmd(new Date()));

  const range = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (periodMode === "THIS_MONTH") {
      const from = isoYmd(firstOfMonth(today));
      const to = isoYmd(today);
      return { from, to, mode: periodMode };
    }

    if (periodMode === "LAST_MONTH") {
      const lm = addMonths(today, -1);
      const from = isoYmd(firstOfMonth(lm));
      const to = isoYmd(lastOfMonth(lm));
      return { from, to, mode: periodMode };
    }

    if (periodMode === "LAST_3_MONTHS") {
      const start = addMonths(today, -2);
      const from = isoYmd(firstOfMonth(start));
      const to = isoYmd(today);
      return { from, to, mode: periodMode };
    }

    if (periodMode === "YTD") {
      const from = `${today.getFullYear()}-01-01`;
      const to = isoYmd(today);
      return { from, to, mode: periodMode };
    }

    // CUSTOM
    const from = customFrom || isoYmd(firstOfMonth(today));
    const to = customTo || isoYmd(today);
    return { from, to, mode: periodMode };
  }, [periodMode, customFrom, customTo]);

  const dashEnabled = !!selectedBusinessId;

  // Account scope selector: All accounts vs a specific account
  const [accountScopeId, setAccountScopeId] = useState<string>("all");

  // Keep-last-good: preserve previous data while fetching new period.
  const pnlQ = useQuery({
    queryKey: ["dashboardExec", "pnlSummary", selectedBusinessId, range.from, range.to, range.mode],
    queryFn: () =>
      getPnlSummary(selectedBusinessId as string, {
        from: range.from,
        to: range.to,
        accountId: accountScopeId,
        ytd: range.mode === "YTD",
      }),
    enabled: dashEnabled,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });

  const cashflowQ = useQuery({
    queryKey: ["dashboardExec", "cashflowSeries", selectedBusinessId, range.from, range.to, range.mode],
    queryFn: () =>
      getCashflowSeries(selectedBusinessId as string, {
        from: range.from,
        to: range.to,
        accountId: accountScopeId,
        ytd: range.mode === "YTD",
      }),
    enabled: dashEnabled,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });

  const categoriesQ = useQuery({
    queryKey: ["dashboardExec", "categories", selectedBusinessId, range.from, range.to, range.mode],
    queryFn: () => getCategories(selectedBusinessId as string, { from: range.from, to: range.to, accountId: accountScopeId }),
    enabled: dashEnabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const issuesCountQ = useQuery({
    queryKey: ["dashboardExec", "issuesCount", selectedBusinessId, accountScopeId, "OPEN"],
    queryFn: () => getIssuesCount(selectedBusinessId as string, { status: "OPEN", accountId: accountScopeId }),
    enabled: dashEnabled,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });

  const openIssuesN = Number((issuesCountQ.data as any)?.count ?? 0) || 0;

  // Always fetch "all accounts" summary (for account picker options + business cash balance)
  const accountsAllQ = useQuery({
    queryKey: ["dashboardExec", "accountsSummaryAll", selectedBusinessId, range.to],
    queryFn: () =>
      getAccountsSummary(selectedBusinessId as string, {
        asOf: range.to,
        accountId: "all",
        includeArchived: false,
      }),
    enabled: dashEnabled,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });

  // Scoped summary for the selected account (or all)
  const accountsSummaryQ = useQuery({
    queryKey: ["dashboardExec", "accountsSummary", selectedBusinessId, range.to, accountScopeId],
    queryFn: () =>
      getAccountsSummary(selectedBusinessId as string, {
        asOf: range.to,
        accountId: accountScopeId,
        includeArchived: false,
      }),
    enabled: dashEnabled,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });

  const dashErr = useMemo(() => {
    const errs = [pnlQ.error, cashflowQ.error, categoriesQ.error, accountsSummaryQ.error].filter(Boolean) as any[];
    if (errs.length === 0) return null;

    const first = errs[0];
    const status = extractHttpStatus(first);
    const detail = appErrorMessageOrNull(first) ?? "Something went wrong. Try again.";
    if (status === 401) return { title: "Signed out", detail };
    if (status === 403) return { title: "Access denied", detail };
    return { title: "Dashboard failed to load", detail };
  }, [pnlQ.error, cashflowQ.error, categoriesQ.error, accountsSummaryQ.error]);

  const refetchAll = () => {
    void pnlQ.refetch();
    void cashflowQ.refetch();
    void categoriesQ.refetch();
    void accountsSummaryQ.refetch();
  };

  // ---- Derivations (deterministic only) ----
  const cashBalanceCents = useMemo(() => {
    let s = 0n;
    for (const r of accountsSummaryQ.data?.rows ?? []) {
      try {
        s += BigInt(String((r as any).balance_cents ?? "0"));
      } catch {
        // ignore
      }
    }
    return String(s);
  }, [accountsSummaryQ.data]);

  const revenueCents = pnlQ.data?.period?.income_cents ?? null;
  const expensesCents = pnlQ.data?.period?.expense_cents ?? null;
  const netCents = pnlQ.data?.period?.net_cents ?? null;

  // Monthly cash ending series for Cash Position:
  // - If backend provides ending_cash_cents (or similar), use it.
  // - Else compute cumulative net and offset so the last point matches cashBalanceCents.
  const cashMonthly = useMemo(() => {
    const rows = (cashflowQ.data?.monthly ?? []) as any[];
    if (!Array.isArray(rows) || rows.length < 1) return [] as any[];

    const monthKeyOf = (raw: any) => {
      const s = String(raw ?? "").trim();

      // Preferred: YYYY-MM
      if (/^\d{4}-\d{2}$/.test(s)) return s;

      // Also accept YYYY-MM-DD and normalize to YYYY-MM
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);

      // Do NOT accept/return weekday strings like "Fri Aug".
      // Return empty marker to trigger a deterministic synthetic timeline.
      return "";
    };

    const mapped = [...rows].map((r) => ({
      ...r,
      month: monthKeyOf(r.month ?? r.ym ?? r.date ?? r.period),
    }));

    const allValidYm = mapped.length > 0 && mapped.every((r) => /^\d{4}-\d{2}$/.test(String(r.month)));

    const sorted = allValidYm
      ? mapped.sort((a, b) => (String(a.month) > String(b.month) ? 1 : -1))
      : (() => {
        // Synthetic month keys ending at range.to month, preserving row order.
        const end = new Date(`${range.to}T00:00:00`);
        const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

        const n = mapped.length;
        return mapped.map((r, i) => {
          const d = new Date(endMonth.getFullYear(), endMonth.getMonth() - (n - 1 - i), 1);
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          return { ...r, month: ym };
        });
      })();

    let cashEnd: bigint;
    try {
      cashEnd = BigInt(String(cashBalanceCents ?? "0"));
    } catch {
      cashEnd = 0n;
    }

    // Prefer server-provided ending cash if present.
    const serverEnding = sorted.every((r) => r.ending_cash_cents != null);
    if (serverEnding) {
      return sorted.map((r) => ({
        ym: String(r.month),
        label: monthAbbr(String(r.month)),
        endingCashCents: String(r.ending_cash_cents ?? "0"),
        cashInCents: String(r.cash_in_cents ?? "0"),
        cashOutCents: String(r.cash_out_cents ?? "0"),
        netCents: String(r.net_cents ?? "0"),
      }));
    }

    // Otherwise: cumulative net (per bucket) and offset to match real ending cash.
    const cum: bigint[] = [];
    let run = 0n;
    for (const r of sorted) {
      try {
        run += BigInt(String(r.net_cents ?? "0"));
      } catch {
        // ignore
      }
      cum.push(run);
    }

    const lastCum = cum[cum.length - 1] ?? 0n;
    const offset = cashEnd - lastCum;

    return sorted.map((r, i) => {
      const ending = (cum[i] ?? 0n) + offset;
      return {
        ym: String(r.month),
        label: monthAbbr(String(r.month)),
        endingCashCents: String(ending),
        cashInCents: String(r.cash_in_cents ?? "0"),
        cashOutCents: String(r.cash_out_cents ?? "0"),
        netCents: String(r.net_cents ?? "0"),
      };
    });
  }, [cashflowQ.data, cashBalanceCents]);

  // Hover (tooltip) for Cash Position chart
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  // Area chart animation: tween values over 200ms when series length matches.
  const [animCashMonthly, setAnimCashMonthly] = useState(cashMonthly);

  const cashBarsData = useMemo(() => {
    return (animCashMonthly ?? []).map((r: any) => {
      const cashIn = centsToNumber(String(r.cashInCents ?? "0")); // dollars (>=0)
      const cashOutAbs = Math.abs(centsToNumber(String(r.cashOutCents ?? "0"))); // dollars (abs)
      return {
        ym: String(r.ym ?? ""),
        label: String(r.label ?? ""),
        cashIn,
        cashOutAbs,
      };
    });
  }, [animCashMonthly]);

  const cashPosData = useMemo(() => {
    return (animCashMonthly ?? []).map((r: any) => {
      const endingCash = centsToNumber(String(r.endingCashCents ?? "0")); // dollars
      return {
        ym: String(r.ym ?? ""),
        label: String(r.label ?? ""),
        endingCash,
        endingCashPos: Math.max(endingCash, 0),
        endingCashNeg: Math.min(endingCash, 0),
      };
    });
  }, [animCashMonthly]);

  const prevCashMonthlyRef = useRef(cashMonthly);

  useEffect(() => {
    const prev = prevCashMonthlyRef.current;
    const next = cashMonthly;

    // If shape changes, snap (still keep-last-good visually during fetch).
    if (!prev || !next || prev.length !== next.length || prev.length < 2) {
      prevCashMonthlyRef.current = next;
      setAnimCashMonthly(next);
      return;
    }

    // If values unchanged, do nothing.
    const same = prev.every(
      (p: any, i: number) =>
        p.ym === next[i].ym &&
        String(p.endingCashCents) === String(next[i].endingCashCents) &&
        String(p.cashInCents) === String(next[i].cashInCents) &&
        String(p.cashOutCents) === String(next[i].cashOutCents) &&
        String(p.netCents) === String(next[i].netCents)
    );
    if (same) return;

    const start = performance.now();
    const dur = 200;

    const centsNum = (s: any) => {
      try {
        return Number(BigInt(String(s ?? "0")));
      } catch {
        return 0;
      }
    };

    const prevEnd = prev.map((r: any) => centsNum(r.endingCashCents));
    const nextEnd = next.map((r: any) => centsNum(r.endingCashCents));

    const prevIn = prev.map((r: any) => centsNum(r.cashInCents));
    const nextIn = next.map((r: any) => centsNum(r.cashInCents));

    const prevOut = prev.map((r: any) => centsNum(r.cashOutCents));
    const nextOut = next.map((r: any) => centsNum(r.cashOutCents));

    const prevNet = prev.map((r: any) => centsNum(r.netCents));
    const nextNet = next.map((r: any) => centsNum(r.netCents));

    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const ease = 1 - Math.pow(1 - k, 3); // easeOutCubic

      const blended = next.map((r: any, i: number) => {
        const lerp = (a: number, b: number) => a + (b - a) * ease;

        const endC = BigInt(Math.round(lerp(prevEnd[i], nextEnd[i])));
        const inC = BigInt(Math.round(lerp(prevIn[i], nextIn[i])));
        const outC = BigInt(Math.round(lerp(prevOut[i], nextOut[i])));
        const netC = BigInt(Math.round(lerp(prevNet[i], nextNet[i])));

        return {
          ...r,
          endingCashCents: String(endC),
          cashInCents: String(inC),
          cashOutCents: String(outC),
          netCents: String(netC),
        };
      });

      setAnimCashMonthly(blended);

      if (k < 1) raf = requestAnimationFrame(tick);
      else {
        prevCashMonthlyRef.current = next;
        setAnimCashMonthly(next);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cashMonthly]);

  const runway = useMemo(() => {
    // avg monthly expenses (last 3 full months) derived from pnl monthly buckets if present.
    const monthly = (pnlQ.data?.monthly ?? []) as any[];
    const sorted = [...monthly].map((r) => ({ ...r, month: String(r.month) })).sort((a, b) => (a.month > b.month ? 1 : -1));

    // Use last 3 *full* months if possible. For simplicity, take last 3 buckets excluding current partial month when mode includes current month.
    // Deterministic rule: if we have >=4 buckets and range includes current month, drop the last bucket from avg calc.
    const nowYm = ymOf(new Date());
    const includesCurrent = sorted.some((r) => String(r.month) === nowYm) && (range.mode === "THIS_MONTH" || range.mode === "LAST_3_MONTHS" || range.mode === "YTD" || range.mode === "CUSTOM");

    const usable = includesCurrent && sorted.length >= 4 ? sorted.slice(0, -1) : sorted;
    const last3 = usable.slice(-3);

    let expSumAbs = 0n;
    let n = 0n;

    for (const r of last3) {
      try {
        const e = BigInt(String(r.expense_cents ?? "0"));
        expSumAbs += absBig(e);
        n += 1n;
      } catch {
        // ignore
      }
    }

    if (n === 0n) return { display: "—", tooltip: null as string | null };

    // average monthly expense in cents
    const avg = expSumAbs / n;
    if (avg <= 0n) return { display: "—", tooltip: null };

    let cash: bigint;
    try {
      cash = BigInt(String(cashBalanceCents ?? "0"));
    } catch {
      cash = 0n;
    }

    if (cash <= 0n) return { display: "0.0", tooltip: "Runway: 0.0 months" };

    const months = Number(cash) / Number(avg);
    if (!Number.isFinite(months)) return { display: "—", tooltip: null };

    const uncapped = Math.round(months * 10) / 10; // 1 decimal
    const capped = uncapped > 24 ? "24+ months" : `${uncapped.toFixed(1)} months`;
    const tip = uncapped > 24 ? `Runway: ${uncapped.toFixed(1)} months (display capped)` : `Runway: ${uncapped.toFixed(1)} months`;

    return { display: capped, tooltip: tip };
  }, [pnlQ.data, cashBalanceCents, range.mode]);

  const topExpenseCats = useMemo(() => {
    const cats: any = categoriesQ.data;
    const rows = Array.isArray(cats?.rows) ? cats.rows : [];
    const items = rows
      .map((r: any) => ({
        label: String(r.category ?? r.category_name ?? r.name ?? r.label ?? "Category"),
        cents: String(r.amount_cents ?? r.total_cents ?? r.spent_cents ?? r.value_cents ?? r.cents ?? "0"),
      }))
      .filter((x: any) => x && typeof x.cents === "string")
      .filter((x: any) => {
        try {
          return absBig(BigInt(x.cents)) > 0n;
        } catch {
          return false;
        }
      });

    // Expenses only: take absolute value for ranking; keep original sign for display (should be negative).
    const abs = (s: string) => {
      try {
        return absBig(BigInt(s));
      } catch {
        return 0n;
      }
    };

    const sorted = items.sort((a: any, b: any) => (abs(b.cents) > abs(a.cents) ? 1 : abs(b.cents) < abs(a.cents) ? -1 : 0));

    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6);

    let other = 0n;
    for (const r of rest) {
      try {
        other += absBig(BigInt(r.cents));
      } catch {
        // ignore
      }
    }

    // total for pct calc
    let total = 0n;
    for (const r of sorted) {
      try {
        total += absBig(BigInt(r.cents));
      } catch {
        // ignore
      }
    }

    const withOther =
      other > 0n
        ? [
          ...top.map((t: any) => ({ ...t, absCents: abs(t.cents) })),
          { label: "Other", cents: String(other), absCents: other },
        ]
        : top.map((t: any) => ({ ...t, absCents: abs(t.cents) }));

    if (total <= 0n) return { rows: [] as any[], totalAbs: 0n };
    return { rows: withOther, totalAbs: total };
  }, [categoriesQ.data]);

  const expensePieFills = [
    "var(--bb-emerald-600)",
    "var(--bb-blue-500)",
    "var(--bb-amber-500)",
    "var(--bb-green-600)",
    "var(--bb-red-600)",
  ];

  const expensePieFillFor = (label: string, i: number) => {
    const t = (label ?? "").toLowerCase();
    if (t.includes("uncategorized")) return "var(--bb-slate-400)";
    return expensePieFills[i % expensePieFills.length];
  };

  const expensePieData = useMemo(() => {
    const rows = topExpenseCats?.rows ?? [];
    if (!Array.isArray(rows) || rows.length === 0) return [] as any[];
    return rows.map((r: any) => ({
      label: String(r.label ?? "Category"),
      // dollars (positive) for pie geometry; tooltip renders as negative accounting.
      value: Math.max(0, centsToNumber(String(r.absCents ?? "0"))),
    }));
  }, [topExpenseCats]);
  const expenseRanked = useMemo(() => {
    const rows = topExpenseCats.rows ?? [];
    const total = topExpenseCats.totalAbs ?? 0n;

    return rows
      .slice(0, 8)
      .map((r: any) => {
        let absC = 0n;
        try {
          absC = BigInt(String(r.absCents ?? "0"));
        } catch {
          absC = 0n;
        }
        const pct = total > 0n ? Number(absC) / Number(total) : 0;
        return {
          label: String(r.label ?? "Category"),
          absCents: String(absC),
          pct: Number.isFinite(pct) ? pct : 0,
        };
      });
  }, [topExpenseCats]);

  const monthlySummary = useMemo(() => {
    // Prefer pnl monthly for revenue/expenses/net; use cashMonthly for ending cash.
    const pnlMonthly = (pnlQ.data?.monthly ?? []) as any[];
    const pnlSorted = [...pnlMonthly].map((r) => ({ ...r, month: String(r.month) })).sort((a, b) => (a.month > b.month ? 1 : -1));

    const cashByYm: Record<string, string> = {};
    for (const r of cashMonthly) cashByYm[r.ym] = r.endingCashCents;

    const rows = pnlSorted.map((r, idx) => {
      const ym = String(r.month);
      const ending = cashByYm[ym] ?? null;

      let deltaCash: string | null = null;
      if (ending && idx > 0) {
        const prevYm = String(pnlSorted[idx - 1].month);
        const prevEnd = cashByYm[prevYm] ?? null;
        if (prevEnd) {
          try {
            deltaCash = String(BigInt(ending) - BigInt(prevEnd));
          } catch {
            deltaCash = null;
          }
        }
      }

      return {
        ym,
        label: monthAbbr(ym),
        revenue_cents: String(r.income_cents ?? "0"),
        expenses_cents: String(r.expense_cents ?? "0"),
        net_cents: String(r.net_cents ?? "0"),
        delta_cash_cents: deltaCash, // null => show —
        ending_cash_cents: ending, // null => show —
      };
    });

    return rows;
  }, [pnlQ.data, cashMonthly]);

  // Deterministic insights (max 3)
  const insights = useMemo(() => {
    const out: Array<{ title: string; value: string; tone?: "default" | "good" | "bad" }> = [];

    // 1) Net change vs prior period (if we have a prior period from same duration)
    // Simple deterministic: compare last month vs previous month when mode is THIS_MONTH/LAST_MONTH/LAST_3_MONTHS.
    if (monthlySummary.length >= 2) {
      const last = monthlySummary[monthlySummary.length - 1];
      const prev = monthlySummary[monthlySummary.length - 2];

      try {
        const lastNet = BigInt(last.net_cents);
        const prevNet = BigInt(prev.net_cents);
        const delta = lastNet - prevNet;

        const pct = prevNet === 0n ? null : Number(delta) / Number(prevNet);
        if (pct !== null && Number.isFinite(pct)) {
          const pctText = `${(pct * 100).toFixed(0)}%`;
          out.push({
            title: "Net vs prior month",
            value: `${pct >= 0 ? "+" : ""}${pctText}`,
            tone: pct >= 0 ? "good" : "bad",
          });
        }
      } catch {
        // ignore
      }
    }

    // 2) Cash streak (>=2 decreases)
    if (monthlySummary.length >= 3) {
      let streak = 0;
      for (let i = monthlySummary.length - 1; i >= 1; i--) {
        const cur = monthlySummary[i].ending_cash_cents;
        const prev = monthlySummary[i - 1].ending_cash_cents;
        if (!cur || !prev) break;
        try {
          if (BigInt(cur) < BigInt(prev)) streak++;
          else break;
        } catch {
          break;
        }
      }
      if (streak >= 2) {
        out.push({ title: "Cash declining streak", value: `${streak} months`, tone: "bad" });
      }
    }

    // 3) Largest expense category (from donut data)
    const firstCat = topExpenseCats.rows[0];
    if (firstCat && topExpenseCats.totalAbs > 0n) {
      const pct = Number(firstCat.absCents) / Number(topExpenseCats.totalAbs);
      if (Number.isFinite(pct)) {
        out.push({
          title: "Largest expense category",
          value: `${firstCat.label} (${(pct * 100).toFixed(0)}%)`,
          tone: "default",
        });
      }
    }

    return out.slice(0, 3);
  }, [monthlySummary, topExpenseCats]);

  // Area chart layout + zero baseline emphasis rule
  const areaLayout = useMemo(() => {
    const labels = animCashMonthly.map((r) => r.label);
    const values = animCashMonthly.map((r) => centsToNumber(r.endingCashCents)); // dollars
    return computeAreaLayout({ labels, valuesDollars: values, padPct: 0.08 });
  }, [animCashMonthly]);

  // Donut rendering (simple deterministic SVG)
  const donut = useMemo(() => {
    const rows = topExpenseCats.rows;
    const total = topExpenseCats.totalAbs;

    if (!rows || rows.length === 0 || total <= 0n) {
      return { arcs: [] as Array<{ a0: number; a1: number; label: string; cents: string }>, totalAbs: total };
    }

    let angle = -Math.PI / 2;
    const arcs: Array<{ a0: number; a1: number; label: string; cents: string }> = [];

    for (const r of rows) {
      const v = Number(r.absCents);
      const t = Number(total);
      const frac = t > 0 ? v / t : 0;
      const a0 = angle;
      const a1 = angle + frac * Math.PI * 2;
      arcs.push({ a0, a1, label: r.label, cents: r.cents });
      angle = a1;
    }

    return { arcs, totalAbs: total };
  }, [topExpenseCats]);

  // Donut animation (200ms): tween arc angles when data changes.
  const [animDonutArcs, setAnimDonutArcs] = useState(donut.arcs);
  const prevDonutRef = useRef(donut.arcs);

  useEffect(() => {
    const prev = prevDonutRef.current;
    const next = donut.arcs;

    if (!prev || !next || prev.length !== next.length || next.length === 0) {
      prevDonutRef.current = next;
      setAnimDonutArcs(next);
      return;
    }

    const start = performance.now();
    const dur = 200;

    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const ease = 1 - Math.pow(1 - k, 3);

      const blended = next.map((n: any, i: number) => {
        const p: any = prev[i];
        return {
          ...n,
          a0: (p.a0 ?? n.a0) + ((n.a0 ?? 0) - (p.a0 ?? n.a0)) * ease,
          a1: (p.a1 ?? n.a1) + ((n.a1 ?? 0) - (p.a1 ?? n.a1)) * ease,
        };
      });

      setAnimDonutArcs(blended);

      if (k < 1) raf = requestAnimationFrame(tick);
      else {
        prevDonutRef.current = next;
        setAnimDonutArcs(next);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [donut.arcs]);

  function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number) {
    const large = a1 - a0 > Math.PI ? 1 : 0;

    const x0 = cx + rOuter * Math.cos(a0);
    const y0 = cy + rOuter * Math.sin(a0);
    const x1 = cx + rOuter * Math.cos(a1);
    const y1 = cy + rOuter * Math.sin(a1);

    const xi1 = cx + rInner * Math.cos(a1);
    const yi1 = cy + rInner * Math.sin(a1);
    const xi0 = cx + rInner * Math.cos(a0);
    const yi0 = cy + rInner * Math.sin(a0);

    return [
      `M ${x0} ${y0}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}`,
      `L ${xi1} ${yi1}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${xi0} ${yi0}`,
      "Z",
    ].join(" ");
  }

  const periodCapsule = (
    <div className="h-6 px-1.5 rounded-lg border border-slate-200 bg-white flex items-center">
      <CapsuleSelect
        variant="flat"
        value={periodMode}
        onValueChange={(v) => setPeriodMode(v as PeriodMode)}
        options={[
          { value: "THIS_MONTH", label: "This Month" },
          { value: "LAST_MONTH", label: "Last Month" },
          { value: "LAST_3_MONTHS", label: "Last 3 Months" },
          { value: "YTD", label: "YTD" },
          { value: "CUSTOM", label: "Custom" },
        ]}
        placeholder="This Month"
      />
    </div>
  );

  return (
    <div className="space-y-5 max-w-7xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<LayoutDashboard className="h-4 w-4" />}
            title="Dashboard"
            right={
              <div className="flex items-center gap-2">

                {periodCapsule}

                {periodMode === "CUSTOM" ? (
                  <div className="flex items-center gap-2">
                    <div className="w-[155px]">
                      <AppDatePicker
                        value={customFrom}
                        onChange={(next) => setCustomFrom(next)}
                        allowClear={false}
                      />
                    </div>

                    <span className="text-xs text-slate-400">→</span>

                    <div className="w-[155px]">
                      <AppDatePicker
                        value={customTo}
                        onChange={(next) => setCustomTo(next)}
                        allowClear={false}
                      />
                    </div>
                  </div>

                ) : null}
              </div>
            }
          />
        </div>
        <div className="mt-2 h-px bg-slate-200" />
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2">
          <div className="h-6 px-1.5 rounded-lg border border-slate-200 bg-white flex items-center">
            <CapsuleSelect
              variant="flat"
              value={accountScopeId}
              onValueChange={(v) => setAccountScopeId(String(v))}
              options={[
                { value: "all", label: "All Accounts" },
                ...((accountsAllQ.data?.rows ?? []) as any[])
                  .filter((r: any) => r && r.id && !r.archived_at)
                  .map((r: any) => ({
                    value: String(r.id),
                    label: String(r.name ?? "Account"),
                  })),
              ]}
              placeholder="All Accounts"
            />
          </div>
        </div>
      </div>

      {!selectedBusinessId && !businessesQ.isLoading ? (
        <EmptyStateCard
          title="No business yet"
          description="Create a business to start using BynkBook."
          primary={{ label: "Create business", href: "/settings?tab=business" }}
          secondary={{ label: "Reload", onClick: () => router.refresh() }}
        />
      ) : null}

      {dashErr ? (
        <InlineBanner title={dashErr.title} message={dashErr.detail} onRetry={() => refetchAll()} />
      ) : null}

      {/* KPI Strip */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
        {[
          {
            label: "Cash Balance",
            value: fmtUsdAccountingFromCents(cashBalanceCents).text,
            isNeg: fmtUsdAccountingFromCents(cashBalanceCents).isNeg,
            sub: `As of ${range.to}`,
            tooltip: null as string | null,
            icon: Wallet,
            accent: "bg-emerald-600",
            iconBg: "bg-emerald-50",
            iconFg: "text-emerald-700",
          },
          {
            label: "Cash Runway",
            value: runway.display,
            isNeg: false,
            sub: "based on 3-mo avg expenses",
            tooltip: runway.tooltip,
            icon: Timer,
            accent: "bg-emerald-600",
            iconBg: "bg-emerald-50",
            iconFg: "text-emerald-700",
          },
          {
            label: "Revenue",
            value: fmtUsdAccountingFromCents(revenueCents ?? undefined).text,
            isNeg: fmtUsdAccountingFromCents(revenueCents ?? undefined).isNeg,
            sub: "Cash-basis",
            tooltip: null as string | null,
            icon: TrendingUp,
            accent: "bg-green-600",
            iconBg: "bg-emerald-50",
            iconFg: "text-emerald-700",
          },
          {
            label: "Expenses",
            value: fmtUsdAccountingFromCents(expensesCents ?? undefined).text,
            isNeg: fmtUsdAccountingFromCents(expensesCents ?? undefined).isNeg,
            sub: "Cash-basis",
            tooltip: null as string | null,
            icon: TrendingDown,
            accent: "bg-red-600",
            iconBg: "bg-emerald-50",
            iconFg: "text-emerald-700",
          },
          {
            label: "Net",
            value: fmtUsdAccountingFromCents(netCents ?? undefined).text,
            isNeg: fmtUsdAccountingFromCents(netCents ?? undefined).isNeg,
            sub: "Revenue − Expenses",
            tooltip: null as string | null,
            icon: Sigma,
            accent: "bg-emerald-600",
            iconBg: "bg-emerald-50",
            iconFg: "text-emerald-700",
          },
        ].map((k) => {
          const Icon = k.icon;
          const loading = pnlQ.isFetching || cashflowQ.isFetching || accountsSummaryQ.isFetching;

          return (
            <Card key={k.label} className="flex flex-col gap-3 py-3 rounded-[10px] border border-slate-200 shadow-sm overflow-hidden transition-[color,background-color,border-color,opacity,transform,box-shadow] duration-200 ease-out hover:shadow-md">
              <CardContent className="px-3 py-3">
                <div className="flex items-center gap-3">
                  <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${k.iconBg}`}>
                    <Icon className={`h-7 w-7 ${k.iconFg}`} strokeWidth={2} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-slate-600">{k.label}</div>

                    <div
                      className={`mt-0.5 text-[18px] leading-tight font-semibold tabular-nums ${k.isNeg ? "text-rose-600" : "text-slate-900"}`}
                      title={k.tooltip ?? undefined}
                    >
                      {loading ? (
                        <span className="inline-block align-middle">
                          <Skeleton className="h-6 w-24" />
                        </span>
                      ) : (
                        k.value
                      )}
                    </div>

                    <div className="mt-0.5 text-[10px] text-slate-500 truncate">{k.sub}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Base44 layout: Left stack (same heights) + Right stack (same width) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: charts stack */}
        <div className="lg:col-span-2 space-y-4">
          {/* 1) Cash Flow bars (Cash In / Cash Out) */}
          <ChartContainer
            title="Cash Flow"
            subtitle="Cash In vs Cash Out by month"
            right={
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                <BarChart3 className="h-7 w-7 text-emerald-700" strokeWidth={2} />
              </div>
            }
            height="sm"
            loading={cashflowQ.isFetching}
            empty={
              cashBarsData.length < 2
                ? { title: "Not enough data", description: "Add transactions to see monthly cash flow." }
                : undefined
            }
          >
            <BarChart
              data={cashBarsData}
              barSize={20}
              barGap={6}
              barCategoryGap="30%"
              margin={{ top: 0, right: 10, bottom: 0, left: 8 }}
            >
              <MoneyGrid />
              <MoneyXAxis dataKey="ym" tickFormatter={(v: any) => monthAbbr(String(v))} />
              <MoneyYAxis />
              <RechartsTooltip
                contentStyle={{
                  background: "var(--bb-chart-tooltip-bg)",
                  border: "1px solid var(--bb-chart-tooltip-border)",
                  borderRadius: 10,
                  fontSize: 12,
                }}
                labelStyle={{ color: "var(--bb-chart-tooltip-text)", fontWeight: 600 }}
                itemStyle={{ color: "var(--bb-chart-tooltip-text)" }}
                formatter={(value: any, name: any) => {
                  const dollars = Number(value ?? 0);
                  const cents = Number.isFinite(dollars) ? BigInt(Math.trunc(dollars * 100)) : 0n;

                  // Accounting style negatives: Cash Out shown as negative.
                  if (String(name) === "Cash Out") return formatUsdAccountingFromCents(-cents).text;
                  return formatUsdAccountingFromCents(cents).text;
                }}
              />
              <RechartsLegend
                verticalAlign="top"
                align="right"
                height={18}
                wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
              />
              <Bar
                dataKey="cashIn"
                name="Cash In"
                fill="var(--bb-green-600)"
                radius={[4, 4, 0, 0]}
                isAnimationActive
                animationDuration={200}
              />
              <Bar
                dataKey="cashOutAbs"
                name="Cash Out"
                fill="var(--bb-red-600)"
                radius={[4, 4, 0, 0]}
                isAnimationActive
                animationDuration={200}
              />
            </BarChart>
          </ChartContainer>

          {/* 2) Cash Position line/area (compact) */}
          <ChartContainer
            title="Cash Position"
            subtitle="Ending cash balance by month (cash-basis)"
            right={
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                <LineChart className="h-7 w-7 text-emerald-700" strokeWidth={2} />
              </div>
            }
            height="sm"
            loading={cashflowQ.isFetching || accountsSummaryQ.isFetching}
            empty={
              cashPosData.length < 2
                ? { title: "Not enough data", description: "Add transactions to see monthly cash trend." }
                : undefined
            }
          >
            <AreaChart data={cashPosData} margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
              <defs>
                <linearGradient id="bbCashPosFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--bb-emerald-600)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--bb-emerald-600)" stopOpacity={0.0} />
                </linearGradient>
              </defs>

              <MoneyGrid />
              <MoneyXAxis dataKey="ym" tickFormatter={(v: any) => monthAbbr(String(v))} />
              <MoneyYAxis />
              <ReferenceLine y={0} stroke="var(--bb-chart-grid)" strokeWidth={1} />
              <MoneyTooltip />
              <RechartsLegend
                verticalAlign="top"
                align="right"
                height={18}
                wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
              />

              <Area
                type="monotone"
                dataKey="endingCashPos"
                name="Ending Cash"
                stroke="var(--bb-emerald-600)"
                fill="url(#bbCashPosFill)"
                strokeWidth={2.25}
                dot={false}
                activeDot={{ r: 4 }}
                isAnimationActive
                animationDuration={200}
              />

              <Area
                type="monotone"
                dataKey="endingCashNeg"
                name="Ending Cash (negative)"
                stroke="var(--bb-red-600)"
                fill="transparent"
                strokeWidth={1.75}
                dot={false}
                activeDot={{ r: 3 }}
                isAnimationActive
                animationDuration={200}
              />
            </AreaChart>
          </ChartContainer>

          {/* 3) Category donut (thin/compact) */}
          <ChartContainer
            title="Category Breakdown"
            subtitle="Top expense categories"
            right={
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                <PieIcon className="h-7 w-7 text-emerald-700" strokeWidth={2} />
              </div>
            }
            height="md"
            noResponsive
            loading={categoriesQ.isFetching}
            empty={
              expensePieData.length === 0
                ? { title: "No category spend in this period", description: "Try a wider date range to see your breakdown." }
                : undefined
            }
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              {/* Donut */}
              <div className="flex items-center justify-center md:justify-center md:self-start">
                <div style={{ width: 220, height: 220 }}>
                  <PieChart width={220} height={220}>
                    <RechartsTooltip
                      contentStyle={{
                        background: "var(--bb-chart-tooltip-bg)",
                        border: "1px solid var(--bb-chart-tooltip-border)",
                        borderRadius: 10,
                        fontSize: 12,
                      }}
                      labelStyle={{ color: "var(--bb-chart-tooltip-text)", fontWeight: 600 }}
                      itemStyle={{ color: "var(--bb-chart-tooltip-text)" }}
                      formatter={(value: any) => {
                        const dollars = Number(value);
                        const cents = Number.isFinite(dollars) ? BigInt(Math.trunc(dollars * 100)) : 0n;
                        return formatUsdAccountingFromCents(-cents).text;
                      }}
                    />

                    <Pie
                      data={expensePieData}
                      dataKey="value"
                      nameKey="label"
                      innerRadius={62}
                      outerRadius={92}
                      paddingAngle={2}
                      stroke="var(--bb-chart-tooltip-bg)"
                      strokeWidth={2}
                    >
                      {expensePieData.map((d: any, i: number) => (
                        <Cell key={i} fill={expensePieFillFor(String(d.label ?? ""), i)} />
                      ))}
                    </Pie>

                    <text x="50%" y="48%" textAnchor="middle" fill="#94a3b8" fontSize="11">
                      Total
                    </text>
                    <text x="50%" y="58%" textAnchor="middle" fill="#0f172a" fontSize="14" fontWeight="600">
                      {formatUsdAccountingFromCents(-BigInt(String(topExpenseCats.totalAbs ?? 0n))).text}
                    </text>
                  </PieChart>
                </div>
              </div>

              {/* Ranked list (table-like; compact) */}
              <div>
                <div className="-mt-1 divide-y divide-slate-100">
                  {expenseRanked.map((r: any, idx: number) => (
                    <div key={`${r.label}-${idx}`} className="py-2">
                      {/* Top row: label left, amount + % right */}
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 truncate text-sm font-medium text-slate-800">
                          {r.label}
                        </div>

                        <div className="flex items-baseline gap-3 text-right tabular-nums">
                          <div className="text-sm font-semibold text-slate-900">
                            {formatUsdAccountingFromCents(-BigInt(r.absCents)).text}
                          </div>
                          <div className="text-[12px] text-slate-500">
                            {(r.pct * 100).toFixed(0)}%
                          </div>
                        </div>
                      </div>

                      {/* Bar */}
                      <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(0, Math.min(100, r.pct * 100))}%`,
                            background: expensePieFillFor(String(r.label ?? ""), idx),
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </ChartContainer>
        </div>

        {/* RIGHT: cards stack */}
        <div className="space-y-4">
          {/* Account Balances (Base44 structure) */}
          <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white flex flex-col !gap-0 !py-1">
            <CHeader className="p-0 px-3 pt-1 pb-0.5 border-b border-slate-200 !gap-0">
              <div className="flex items-center justify-between leading-none">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                    <Landmark className="h-7 w-7 text-emerald-700" strokeWidth={2} />
                  </div>
                  <CardTitle className="text-sm font-semibold text-slate-900 leading-none">Account Balances</CardTitle>
                </div>

                <div className="text-[11px] text-slate-500 leading-none">As of {range.to}</div>
              </div>
            </CHeader>

            <CardContent className="p-0">
              {(accountsSummaryQ.data?.rows ?? []).length === 0 ? (
                <div className="px-4 py-3 text-sm text-slate-500">No accounts found.</div>
              ) : (
                <div className="-mt-1 divide-y divide-slate-100">
                  {(accountsSummaryQ.data?.rows ?? []).slice(0, 6).map((r: any, idx: number) => (
                    <div
                      key={`${String(r.id ?? "")}-${String(r.name ?? "")}-${idx}`}
                      className="flex items-center justify-between px-4 py-1.5"
                    >
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <Landmark className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <div className="min-w-0 leading-tight">
                          <div className="font-medium text-[13px] truncate text-slate-900">
                            {String(r.name ?? "Account")}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {String(r.type ?? "")}
                          </div>
                        </div>
                      </div>

                      <div className={`text-sm font-semibold tabular-nums ${moneyClassFromCents(String(r.balance_cents ?? "0"))}`}>
                        {fmtUsdAccountingFromCents(String(r.balance_cents ?? "0")).text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Next Actions */}
          <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white flex flex-col !gap-0 !py-1">
            <CHeader className="p-0 px-3 pt-1 pb-0.5 border-b border-slate-200 !gap-0">
              <div className="flex items-center justify-between leading-none">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                    <Tag className="h-7 w-7 text-emerald-700" strokeWidth={2} />
                  </div>
                  <CardTitle className="text-sm font-semibold text-slate-900 leading-none">Next Actions</CardTitle>
                </div>

                <div className="text-xs font-medium rounded-full border border-slate-200 px-2 py-0.5 text-slate-700 bg-white">
                  {openIssuesN} open
                </div>
              </div>
            </CHeader>

            <CardContent className="p-0">
              <div className="-mt-1 divide-y divide-slate-100">
                <button
                  type="button"
                  onClick={() => router.push("/issues")}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-rose-100 flex items-center justify-center">
                      <AlertTriangle className="h-4 w-4 text-rose-600" strokeWidth={2} />
                    </div>
                    <div>
                      <div className="font-medium text-sm text-slate-900">{openIssuesN} Open Issues</div>
                      <div className="text-xs text-slate-500">Review and resolve</div>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/category-review")}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <Tag className="h-4 w-4 text-emerald-700" strokeWidth={2} />
                    </div>
                    <div>
                      <div className="font-medium text-sm text-slate-900">Category Review</div>
                      <div className="text-xs text-slate-500">Assign categories</div>
                    </div>
                  </div>
                </button>
              </div>
            </CardContent>
          </Card>

          {/* AI Insights (Base44 card structure; deterministic for now) */}
          <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white flex flex-col !gap-0 !py-1">
            <CHeader className="p-0 px-3 pt-1 pb-0.5 border-b border-slate-200 !gap-0">
              <div className="flex items-center justify-between leading-none">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                    <Sparkles className="h-7 w-7 text-emerald-700" strokeWidth={2} />
                  </div>
                  <CardTitle className="text-sm font-semibold text-slate-900 leading-none">AI Insights</CardTitle>
                </div>

                <div className="text-xs text-slate-500 leading-none">Deterministic</div>
              </div>
            </CHeader>

            <CardContent className="p-0">
              {pnlQ.isLoading || cashflowQ.isLoading || accountsSummaryQ.isLoading ? (
                <div className="px-4 py-4 space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : insights.length === 0 ? (
                <div className="px-4 py-4 text-sm text-slate-500">No notable signals for this period.</div>
              ) : (
                <div className="-mt-1 divide-y divide-slate-100">
                  {insights.slice(0, 3).map((it) => (
                    <div key={it.title} className="px-4 py-3">
                      <div className="text-xs text-slate-500">{it.title}</div>
                      <div
                        className={`mt-0.5 text-sm font-semibold tabular-nums ${it.tone === "good" ? "text-emerald-700" : it.tone === "bad" ? "text-rose-600" : "text-slate-900"
                          }`}
                      >
                        {it.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Monthly Summary (Base44 card structure) */}
          <Card className="rounded-xl border border-slate-200 shadow-sm overflow-hidden bg-white flex flex-col !gap-0 !py-1">
            <CHeader className="p-0 px-3 pt-1 pb-0.5 border-b border-slate-200 !gap-0">
              <div className="flex items-center justify-between leading-none">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                    <CalendarDays className="h-7 w-7 text-emerald-700" strokeWidth={2} />
                  </div>
                  <CardTitle className="text-sm font-semibold text-slate-900 leading-none">Monthly Summary</CardTitle>
                </div>

                <div className="text-xs text-slate-500 leading-none">Last 4 months</div>
              </div>
            </CHeader>

            <CardContent className="p-0">
              {monthlySummary.length === 0 ? (
                <div className="px-4 py-4">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : (
                <div>
                  <div className="grid grid-cols-3 items-center px-4 py-2 text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <div>Month</div>
                    <div className="text-right">Net</div>
                    <div className="text-right">End Cash</div>
                  </div>

                  <div className="-mt-1 divide-y divide-slate-100">
                    {monthlySummary.slice(-4).map((r) => (
                      <div key={r.ym} className="grid grid-cols-3 items-center px-4 py-3 text-sm">
                        <div className="text-slate-700">{r.label}</div>
                        <div className={`text-right tabular-nums ${moneyClassFromCents(r.net_cents)}`}>
                          {fmtUsdAccountingFromCents(r.net_cents).text}
                        </div>
                        <div className="text-right tabular-nums">
                          {r.ending_cash_cents ? (
                            <span className={moneyClassFromCents(r.ending_cash_cents)}>
                              {fmtUsdAccountingFromCents(r.ending_cash_cents).text}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}