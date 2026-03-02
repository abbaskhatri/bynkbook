"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
// Auth handled by AppShell

import { useQuery } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { getPnlSummary, getCashflowSeries, getCategories, getAccountsSummary } from "@/lib/api/reports";
import { getIssuesCount } from "@/lib/api/issues";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LayoutDashboard } from "lucide-react";

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

  // Fallback: parse date-like strings (e.g., "Fri Aug ...", "2026-02-01", etc.)
  try {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      const m = d.getMonth() + 1;
      const yy = String(d.getFullYear()).slice(2, 4);
      return `${names[m - 1] ?? s} ${yy}`;
    }
  } catch {
    // ignore
  }

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
  const [periodMode, setPeriodMode] = useState<PeriodMode>("THIS_MONTH");
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
      if (/^\d{4}-\d{2}$/.test(s)) return s;
      try {
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) {
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        }
      } catch {}
      return s;
    };

    const sorted = [...rows]
      .map((r) => ({ ...r, month: monthKeyOf(r.month ?? r.ym ?? r.date ?? r.period) }))
      .sort((a, b) => (String(a.month) > String(b.month) ? 1 : -1));

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
      .map((r: any) => ({ label: String(r.category ?? "Category"), cents: String(r.amount_cents ?? "0") }))
      .filter((x: any) => x && typeof x.cents === "string");

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

    return { rows: withOther, totalAbs: total };
  }, [categoriesQ.data]);

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
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<LayoutDashboard className="h-4 w-4" />}
            title="Dashboard"
            right={
              <div className="flex items-center gap-2">
                {/* Account scope (All vs account) */}
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

                {periodCapsule}

                {openIssuesN > 0 ? (
                  <div className="h-6 px-2 rounded-md border border-amber-200 bg-amber-50 text-[11px] font-semibold text-amber-800 flex items-center gap-2">
                    <span>Issues</span>
                    <span className="tabular-nums">{openIssuesN}</span>
                  </div>
                ) : null}

                {periodMode === "CUSTOM" ? (
                  <div className="flex items-center gap-2">
                    <input
                      className="h-6 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                    />
                    <span className="text-xs text-slate-400">→</span>
                    <input
                      className="h-6 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700"
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                    />
                  </div>
                ) : null}
              </div>
            }
          />
        </div>
        <div className="mt-2 h-px bg-slate-200" />
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
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {[
          {
            label: "Cash Balance",
            value: fmtUsdAccountingFromCents(cashBalanceCents).text,
            isNeg: fmtUsdAccountingFromCents(cashBalanceCents).isNeg,
            sub: `As of ${range.to}`,
            emphasize: true,
            tooltip: null as string | null,
          },
          {
            label: "Cash Runway",
            value: runway.display,
            isNeg: false,
            sub: "based on 3-mo avg expenses",
            emphasize: true,
            tooltip: runway.tooltip,
          },
          {
            label: "Revenue",
            value: fmtUsdAccountingFromCents(revenueCents ?? undefined).text,
            isNeg: fmtUsdAccountingFromCents(revenueCents ?? undefined).isNeg,
            sub: "Cash-basis",
            emphasize: false,
            tooltip: null as string | null,
          },
          {
            label: "Expenses",
            value: fmtUsdAccountingFromCents(expensesCents ?? undefined).text,
            isNeg: fmtUsdAccountingFromCents(expensesCents ?? undefined).isNeg,
            sub: "Cash-basis",
            emphasize: false,
            tooltip: null as string | null,
          },
          {
            label: "Net",
            value: fmtUsdAccountingFromCents(netCents ?? undefined).text,
            isNeg: fmtUsdAccountingFromCents(netCents ?? undefined).isNeg,
            sub: "Revenue − Expenses",
            emphasize: false,
            tooltip: null as string | null,
          },
        ].map((k) => (
          <Card key={k.label} className={`rounded-[10px] border ${k.emphasize ? "border-slate-300" : "border-slate-200"} shadow-sm`}>
            <CardContent className="p-4">
              <div className="text-[11px] uppercase tracking-wide text-slate-500">{k.label}</div>

              <div className={`mt-2 text-[28px] leading-tight font-semibold tabular-nums ${k.isNeg ? "text-rose-600" : "text-slate-900"}`} title={k.tooltip ?? undefined}>
                {pnlQ.isFetching || cashflowQ.isFetching || accountsSummaryQ.isFetching ? (
                  <span className="inline-block align-middle">
                    <Skeleton className="h-8 w-28" />
                  </span>
                ) : (
                  k.value
                )}
              </div>

              <div className="mt-1 text-[11px] text-slate-500">{k.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

{/* Cash Flow (bars) */}
      <Card className="rounded-[10px] border border-slate-200 shadow-sm">
        <CHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-slate-800">Cash Flow</CardTitle>
          <div className="text-[11px] text-slate-500">Cash In vs Cash Out by month (cash-basis)</div>
        </CHeader>
        <CardContent className="p-5 pt-3">
          {animCashMonthly.length < 2 ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (() => {
            const labels = animCashMonthly.map((r: any) => r.label);
            const ins = animCashMonthly.map((r: any) => String(r.cashInCents ?? "0"));
            const outs = animCashMonthly.map((r: any) => String(r.cashOutCents ?? "0"));
            const layout = computeCashBarsLayout({ labels, inCents: ins, outCents: outs, padPct: 0.08 });

            const n = animCashMonthly.length;
            const xStep = n > 1 ? (layout.x[1] - layout.x[0]) : 80;
            const groupW = Math.max(22, Math.min(44, Math.round(xStep * 0.55)));
            const gap = 6;
            const barW = Math.max(8, Math.floor((groupW - gap) / 2));
            const baseY = layout.h - layout.padB;

            const dollarsAbs = (centsStr: any) => {
              try {
                return Math.abs(Number(BigInt(String(centsStr ?? "0")))) / 100;
              } catch {
                return 0;
              }
            };

            return (
              <div className="w-full">
                <svg
                  viewBox={`0 0 ${layout.w} ${layout.h}`}
                  className="block w-full h-[300px]"
                  onMouseLeave={() => {
                    setHoverIdx(null);
                    setHoverX(null);
                  }}
                  onMouseMove={(e) => {
                    const svg = e.currentTarget;
                    const rect = svg.getBoundingClientRect();
                    const sx = ((e.clientX - rect.left) / rect.width) * layout.w;

                    let bestI = 0;
                    let bestD = Infinity;
                    for (let i = 0; i < layout.x.length; i++) {
                      const d = Math.abs(layout.x[i] - sx);
                      if (d < bestD) {
                        bestD = d;
                        bestI = i;
                      }
                    }
                    setHoverIdx(bestI);
                    setHoverX(layout.x[bestI]);
                  }}
                >
                  {/* grid + y labels */}
                  {layout.grid.map((g) => (
                    <g key={`g-${g.y}`}>
                      <line
                        x1={layout.padL}
                        x2={layout.w - layout.padR}
                        y1={g.y}
                        y2={g.y}
                        className="stroke-slate-100"
                        strokeWidth={1}
                      />
                      <text
                        x={layout.padL - 10}
                        y={g.y}
                        textAnchor="end"
                        dominantBaseline="middle"
                        className="fill-slate-500 text-[11px]"
                      >
                        {g.label}
                      </text>
                    </g>
                  ))}

                  {/* bars (animated via animCashMonthly) */}
                  {animCashMonthly.map((r: any, i: number) => {
                    const xc = layout.x[i];
                    if (xc == null) return null;

                    const inH = Math.max(1, baseY - layout.yOf(dollarsAbs(r.cashInCents)));
                    const outH = Math.max(1, baseY - layout.yOf(dollarsAbs(r.cashOutCents)));

                    const x0 = xc - Math.floor(groupW / 2);
                    const xIn = x0;
                    const xOut = x0 + barW + gap;

                    return (
                      <g key={`m-${i}`}>
                        <rect x={xIn} y={baseY - inH} width={barW} height={inH} rx={3} className="fill-primary/75" />
                        <rect x={xOut} y={baseY - outH} width={barW} height={outH} rx={3} className="fill-rose-500/70" />
                      </g>
                    );
                  })}

                  {/* hover tooltip */}
                  {hoverIdx !== null && hoverX !== null ? (() => {
                    const r: any = animCashMonthly[hoverIdx];
                    if (!r) return null;

                    const label = r.label;
                    const ending = fmtUsdAccountingFromCents(r.endingCashCents).text;
                    const cin = fmtUsdAccountingFromCents(r.cashInCents).text;
                    const cout = fmtUsdAccountingFromCents(r.cashOutCents).text;
                    const net = fmtUsdAccountingFromCents(r.netCents).text;

                    const tipW = 240;
                    const tipH = 92;
                    const x = Math.min(layout.w - tipW - 10, Math.max(10, hoverX + 10));
                    const y = 18;

                    return (
                      <g>
                        <line x1={hoverX} x2={hoverX} y1={layout.padT} y2={layout.h - layout.padB} className="stroke-slate-200" strokeWidth={1} />
                        <g transform={`translate(${x}, ${y})`}>
                          <rect width={tipW} height={tipH} rx={8} className="fill-white stroke-slate-200" />
                          <text x={10} y={18} className="fill-slate-700 text-[11px]">{label}</text>

                          <text x={10} y={38} className="fill-slate-500 text-[11px]">Cash In:</text>
                          <text x={86} y={38} className="fill-slate-700 text-[11px]">{cin}</text>

                          <text x={10} y={54} className="fill-slate-500 text-[11px]">Cash Out:</text>
                          <text x={86} y={54} className="fill-slate-700 text-[11px]">{cout}</text>

                          <text x={10} y={70} className="fill-slate-500 text-[11px]">Net:</text>
                          <text x={86} y={70} className="fill-slate-700 text-[11px]">{net}</text>

                          <text x={150} y={70} className="fill-slate-500 text-[11px]">End:</text>
                          <text x={182} y={70} className="fill-slate-700 text-[11px]">{ending}</text>
                        </g>
                      </g>
                    );
                  })() : null}

                  {/* x labels */}
                  {(() => {
                    const every = n <= 8 ? 1 : n <= 16 ? 2 : 3;
                    const y = layout.h - 8;
                    return animCashMonthly.map((r: any, i: number) =>
                      i % every === 0 || i === n - 1 ? (
                        <text
                          key={`x-${i}`}
                          x={layout.x[i]}
                          y={y}
                          textAnchor="middle"
                          dominantBaseline="ideographic"
                          className="fill-slate-500 text-[11px]"
                        >
                          {r.label}
                        </text>
                      ) : null
                    );
                  })()}
                </svg>

                {/* legend */}
                <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-sm bg-primary/75" />
                    <span>Cash In</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-2 w-2 rounded-sm bg-rose-500/70" />
                    <span>Cash Out</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {/* Donut + Insights (balanced height) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="rounded-[10px] border border-slate-200 shadow-sm" style={{ height: 360 }}>
          <CHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Expense Composition</CardTitle>
            <div className="text-[11px] text-slate-500">Top categories (Top 6 + Other)</div>
          </CHeader>
          <CardContent className="p-5 pt-3">
            {animDonutArcs.length === 0 ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <div className="h-full grid grid-cols-[240px_1fr] gap-4 items-center">
                {/* donut left */}
                <div className="flex items-center justify-center">
                  <svg width={220} height={220} viewBox="0 0 220 220" className="block">
                    <g>
                      {animDonutArcs.map((a: any, idx: number) => (
                        <path
                          key={`${a.label}-${idx}`}
                          d={arcPath(110, 110, 100, 62, a.a0, a.a1)}
                          className={idx === 0 ? "fill-primary" : idx === 1 ? "fill-primary/70" : idx === 2 ? "fill-primary/55" : "fill-primary/35"}
                        />
                      ))}
                    </g>
                  </svg>
                </div>

                {/* values right */}
                <div className="space-y-2">
                  {animDonutArcs.map((a: any, idx: number) => {
                    const abs = (() => {
                      try {
                        return absBig(BigInt(a.cents));
                      } catch {
                        return 0n;
                      }
                    })();
                    const pct = donut.totalAbs > 0n ? Number(abs) / Number(donut.totalAbs) : 0;
                    return (
                      <div key={`leg-${a.label}-${idx}`} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`inline-block h-2 w-2 rounded-sm ${idx === 0 ? "bg-primary" : idx === 1 ? "bg-primary/70" : idx === 2 ? "bg-primary/55" : "bg-primary/35"}`} />
                          <span className="text-slate-700 truncate">{a.label}</span>
                        </div>
                        <div className="flex items-center gap-3 tabular-nums">
                          <span className="text-slate-500">{(pct * 100).toFixed(0)}%</span>
                          <span className={moneyClassFromCents(a.cents)}>{fmtUsdAccountingFromCents(String(abs)).text}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[10px] border border-slate-200 shadow-sm" style={{ height: 360 }}>
          <CHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Insights</CardTitle>
            <div className="text-[11px] text-slate-500">Deterministic signals (no AI)</div>
          </CHeader>
          <CardContent className="p-5 pt-3 h-full">
            {pnlQ.isLoading || cashflowQ.isLoading || accountsSummaryQ.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : insights.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-slate-500">No notable signals for this period.</div>
            ) : (
              <div className={`h-full flex flex-col ${insights.length < 3 ? "justify-center" : "justify-start"} gap-3`}>
                {insights.map((it) => (
                  <div key={it.title} className="rounded-[10px] border border-slate-200 bg-white p-4">
                    <div className="text-[13px] font-medium text-slate-800">{it.title}</div>
                    <div className={`mt-1 text-[18px] font-semibold tabular-nums ${it.tone === "good" ? "text-primary" : it.tone === "bad" ? "text-rose-600" : "text-slate-900"}`}>
                      {it.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Monthly Summary */}
      <Card className="rounded-[10px] border border-slate-200 shadow-sm">
        <CHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-slate-800">Monthly Summary</CardTitle>
          <div className="text-[11px] text-slate-500">Cash-basis overview with Δ Cash</div>
        </CHeader>
        <CardContent className="p-5 pt-3">
          {monthlySummary.length === 0 ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <div className="rounded-md border border-slate-200 overflow-hidden">
              <div className="grid grid-cols-6 h-10 items-center bg-white px-3 text-[12px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <div>Month</div>
                <div className="text-right">Revenue</div>
                <div className="text-right">Expenses</div>
                <div className="text-right">Net</div>
                <div className="text-right">Δ Cash</div>
                <div className="text-right">Ending Cash</div>
              </div>

              {monthlySummary.map((r) => (
                <div key={r.ym} className="grid grid-cols-6 h-10 items-center px-3 text-sm border-b border-slate-100 hover:bg-slate-50">
                  <div className="text-slate-700">{r.label}</div>
                  <div className={`text-right tabular-nums ${moneyClassFromCents(r.revenue_cents)}`}>{fmtUsdAccountingFromCents(r.revenue_cents).text}</div>
                  <div className={`text-right tabular-nums ${moneyClassFromCents(r.expenses_cents)}`}>{fmtUsdAccountingFromCents(r.expenses_cents).text}</div>
                  <div className={`text-right tabular-nums ${moneyClassFromCents(r.net_cents)}`}>{fmtUsdAccountingFromCents(r.net_cents).text}</div>

                  <div className="text-right tabular-nums">
                    {r.delta_cash_cents ? (
                      <span className={moneyClassFromCents(r.delta_cash_cents)}>{fmtUsdAccountingFromCents(r.delta_cash_cents).text}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </div>

                  <div className="text-right tabular-nums">
                    {r.ending_cash_cents ? (
                      <span className={moneyClassFromCents(r.ending_cash_cents)}>{fmtUsdAccountingFromCents(r.ending_cash_cents).text}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}