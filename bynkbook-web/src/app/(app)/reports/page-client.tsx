"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { FilterBar } from "@/components/primitives/FilterBar";

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

  const values = [...A, ...B, ...L];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const w = 720;
  const h = 140;
  const padX = 12;
  const padY = 14;

  const xStep = (w - padX * 2) / (n - 1);

  const y = (v: number) => {
    return padY + ((max - v) * (h - padY * 2)) / span;
  };

  const zeroY = y(0);

  const linePts = L.map((v, i) => `${(padX + i * xStep).toFixed(1)},${y(v).toFixed(1)}`);

  // Bars: draw small vertical bars centered on each x
  const barW = Math.max(6, Math.min(18, xStep * 0.35));

  const barRect = (xCenter: number, v: number, cls: string, key: string) => {
    const yy = y(v);
    const top = Math.min(yy, zeroY);
    const bottom = Math.max(yy, zeroY);
    const height = Math.max(1, bottom - top);
    const xLeft = xCenter - barW / 2;
    return <rect key={key} x={xLeft} y={top} width={barW} height={height} rx={3} className={cls} />;
  };

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
            <span className="inline-block h-2 w-2 rounded-sm bg-emerald-600" />
            <span>In: <span className="text-slate-900">{lastA.text}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-sm bg-red-500" />
            <span>Out: <span className={`${lastB.isNeg ? "text-red-600" : "text-slate-900"}`}>{lastB.text}</span></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-[2px] w-6 bg-slate-700" />
            <span>Net: <span className={`${lastL.isNeg ? "text-red-600" : "text-slate-900"}`}>{lastL.text}</span></span>
          </div>
        </div>
      </div>

      <div className="mt-2 overflow-x-auto">
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
          {/* zero line */}
          <line x1={padX} x2={w - padX} y1={zeroY} y2={zeroY} className="stroke-slate-200" strokeWidth="1" />

          {/* bars */}
          {Array.from({ length: n }).map((_, i) => {
            const xc = padX + i * xStep;
            const a = A[i];
            const b = B[i];
            return (
              <g key={`bars-${i}`}>
                {barRect(xc - barW * 0.35, a, "fill-emerald-600/80", `a-${i}`)}
                {barRect(xc + barW * 0.35, b, "fill-red-500/70", `b-${i}`)}
              </g>
            );
          })}

          {/* net line */}
          <polyline fill="none" stroke="currentColor" strokeWidth="2" points={linePts.join(" ")} className="text-slate-700" />
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
    "stroke-emerald-600",
    "stroke-emerald-500",
    "stroke-emerald-400",
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
                    <span className={`inline-block h-2 w-2 rounded-sm ${i % 2 === 0 ? "bg-slate-700" : "bg-emerald-600"}`} />
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
  const [ym, setYm] = useState(monthNowYm()); // Month picker only
  const [ytd, setYtd] = useState(false); // YTD toggle only

  const { from, to } = useMemo(() => monthRangeFromYm(ym), [ym]);
  const accountId = selectedAccountId;

  const [loading, setLoading] = useState(false);
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
    setLoading(true);
    setErr(null);

    try {
      if (tab === "pnl") {
        const res = await getPnlSummary(businessId, { from, to, accountId, ytd });
        setPnl(res);
        return;
      }

      if (tab === "cashflow") {
        const res = await getCashflowSeries(businessId, { from, to, accountId, ytd });
        setCashflow(res);
        return;
      }

      if (tab === "accounts") {
        const res = await getAccountsSummary(businessId, { asOf, accountId, includeArchived: includeArchivedAccounts });
        setAccountsSummary(res);
        return;
      }

      if (tab === "ap") {
        const res = await getApAging(businessId, { asOf });
        setApAging(res);
        setApVendorId(null);
        setApVendorDetail(null);
        return;
      }

      if (tab === "categories") {
        const res = await getCategories(businessId, { from, to, accountId });
        setCategories(res);
        setCatDetail(null);
        setCatDetailCategoryId(null);
        setCatPage(1);
        return;
      }
    } catch (e: any) {
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function openApVendor(vendorId: string) {
    if (!businessId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await getApAgingVendor(businessId, { asOf, vendorId });
      setApVendorId(vendorId);
      setApVendorDetail(res);
    } catch (e: any) {
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function openCategoryDetail(categoryId: string | null, page: number) {
    if (!businessId) return;
    setLoading(true);
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
      setCatDetail(res);
      setCatDetailCategoryId(categoryId);
      setCatPage(page);
    } catch (e: any) {
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  // Small convenience: when switching tabs, clear error but do NOT auto-run.
  useEffect(() => {
    setErr(null);
  }, [tab]);

  return (
    <div className="flex flex-col gap-2 overflow-hidden max-w-6xl">
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
                  <div className="text-[11px] text-slate-600">Month</div>
                  <Input type="month" className="h-7 w-[140px] text-xs" value={ym} onChange={(e) => setYm(e.target.value)} />
                </div>

                <div className="ml-2 flex flex-col justify-end">
                  <div className="text-[11px] text-slate-500">Range</div>
                  <div className="text-[11px] text-slate-400">
                    {from} → {to}
                  </div>
                </div>

                <div className="ml-4 flex items-end gap-3">
                  <div className="flex flex-col justify-end">
                    <div className="text-[11px] text-slate-600">YTD</div>

                    <label className="h-7 flex items-center gap-2 select-none">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={ytd}
                        onClick={() => setYtd((prev) => !prev)}
                        className={`relative inline-flex h-[16px] w-[30px] items-center rounded-full transition
                          ${ytd ? "bg-emerald-600" : "bg-slate-300"}`}
                        title="Toggle YTD"
                      >
                        <span
                          className={`inline-block h-[12px] w-[12px] rounded-full bg-white transition-transform
                            ${ytd ? "translate-x-[14px]" : "translate-x-[2px]"}`}
                        />
                      </button>

                      <span className="text-xs text-slate-700">{ytd ? "On" : "Off"}</span>
                    </label>
                  </div>

                  {tab === "accounts" ? (
                    <button
                      type="button"
                      onClick={() => setIncludeArchivedAccounts((v) => !v)}
                      className={`h-7 px-3 rounded-md text-xs font-medium border ${includeArchivedAccounts
                        ? "bg-slate-900 text-white border-slate-900"
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                        }`}
                      title="Include archived accounts"
                    >
                      Archived {includeArchivedAccounts ? "Included" : "Excluded"}
                    </button>
                  ) : null}
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
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
