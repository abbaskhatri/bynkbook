"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { getPnl, getCashflow } from "@/lib/api/reports";
import { getIssuesCount } from "@/lib/api/issues";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, ChevronRight } from "lucide-react";

export default function DashboardPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

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

  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  useEffect(() => {
    if (!authReady) return;
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;
    if (!sp.get("businessId")) router.replace(`/dashboard?businessId=${selectedBusinessId}`);
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);



  const accountsQ = useAccounts(selectedBusinessId);

  const accountIdFromUrl = sp.get("accountId"); // "all" | accountId
const [period, setPeriod] = useState<"90d" | "30d" | "ytd">("90d");

const [kpis, setKpis] = useState<{
  income?: string;
  expense?: string;
  net?: string;
  cashIn?: string;
  cashOut?: string;
  issues?: number;
}>({});

  const currency = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
    []
  );

  function fmtMoney(n: number) {
    return n < 0 ? `(${currency.format(Math.abs(n))})` : currency.format(n);
  }
  function moneyClass(n: number) {
    return n < 0 ? "text-rose-600" : "text-emerald-700";
  }

  function fmtUsdAccountingFromCents(centsStr?: string) {
    if (!centsStr) return { text: "—", isNeg: false };
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

    const dollarsStr = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const cents2 = cents.toString().padStart(2, "0");

    const base = `$${dollarsStr}.${cents2}`;
    return { text: isNeg ? `(${base})` : base, isNeg };
  }
  const formatAxis = useMemo(() => {
    return (n: number) => {
      if (n < 0) return `(${currency.format(Math.abs(n))})`;
      return currency.format(n);
    };
  }, [currency]);

  // Period window in months (UI-only Phase 3 buckets; current month on the right)
  const months = useMemo(() => {
    const now = new Date();
    const d = new Date(now);
    d.setDate(1);

    let count = 6; // default for 90d -> 6 months
    if (period === "30d") count = 3;
    if (period === "ytd") {
      count = d.getMonth() + 1; // Jan..current
      count = Math.max(3, Math.min(12, count));
    }

    const out: { key: string; label: string }[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const x = new Date(d);
      x.setMonth(d.getMonth() - i);
      const key = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
      const label = x.toLocaleString("en-US", { month: "short" });
      out.push({ key, label });
    }
    return out;
  }, [period]);

  // Placeholder series (Phase 3 shell): values are per-month totals
  const cashFlowSeries = useMemo(() => {
    return months.map((m, i) => {
      const cashIn = 8000 + (i % 5) * 2200 + (i % 2) * 900;
      const cashOut = 6000 + ((i + 2) % 5) * 1800 + ((i + 1) % 2) * 700;
      const net = cashIn - cashOut;
      return { ...m, cashIn, cashOut, net };
    });
  }, [months]);

  const maxAbs = useMemo(() => {
    const max = cashFlowSeries.reduce((acc, r) => Math.max(acc, r.cashIn, r.cashOut, Math.abs(r.net)), 0);
    const step = 5000;
    return Math.max(step, Math.ceil(max / step) * step);
  }, [cashFlowSeries]);

  const yTicks = useMemo(() => {
    const half = Math.round(maxAbs / 2);
    return [maxAbs, half, 0, -half, -maxAbs];
  }, [maxAbs]);

  const activeAccountOptions = useMemo(() => {
    return (accountsQ.data ?? []).filter((a) => !a.archived_at);
  }, [accountsQ.data]);

  const selectedAccountId = useMemo(() => {
    return accountIdFromUrl ?? "all";
  }, [accountIdFromUrl]);

  const selectedAccountLabel = useMemo(() => {
    if (selectedAccountId === "all") return "All accounts";
    const hit = activeAccountOptions.find((a) => a.id === selectedAccountId);
    return hit?.name ?? "Account";
  }, [selectedAccountId, activeAccountOptions]);

  useEffect(() => {
    if (!authReady) return;
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;
    if (!sp.get("accountId")) {
      router.replace(`/dashboard?businessId=${selectedBusinessId}&accountId=all`);
    }
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);

useEffect(() => {
  if (!selectedBusinessId) return;

  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from =
    period === "30d"
      ? new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10)
      : period === "90d"
      ? new Date(today.getTime() - 90 * 86400000).toISOString().slice(0, 10)
      : `${today.getFullYear()}-01-01`;

  (async () => {
    try {
      const [pnl, cashflow, issues] = await Promise.all([
        getPnl(selectedBusinessId, { from, to, accountId: selectedAccountId }),
        getCashflow(selectedBusinessId, { from, to, accountId: selectedAccountId }),
        getIssuesCount(selectedBusinessId, { status: "OPEN", accountId: selectedAccountId }),
      ]);

      setKpis({
        income: pnl.totals.income_cents,
        expense: pnl.totals.expense_cents,
        net: pnl.totals.net_cents,
        cashIn: cashflow.totals.cash_in_cents,
        cashOut: cashflow.totals.cash_out_cents,
        issues: issues.count,
      });
    } catch {
      // silent; dashboard remains empty
    }
  })();
}, [selectedBusinessId, selectedAccountId, period]);

  // Tooltip state (single source of truth)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  if (!authReady) return <Skeleton className="h-10 w-64" />;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          {(() => {
            const opts = [
              { value: "all", label: "All accounts" },
              ...activeAccountOptions.map((a) => ({ value: a.id, label: a.name })),
            ];

            const accountCapsule = (
              <div className="h-6 px-1.5 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center">
                <CapsuleSelect
                  variant="flat"
                  loading={accountsQ.isLoading}
                  value={selectedAccountId || "all"}
                  onValueChange={(v) => {
                    if (!selectedBusinessId) return;
                    const params = new URLSearchParams(sp.toString());
                    params.set("businessId", selectedBusinessId);
                    params.set("accountId", v);
                    router.replace(`/dashboard?${params.toString()}`);
                  }}
                  options={opts}
                  placeholder="All accounts"
                />
              </div>
            );

            const periodCapsule = (
              <div className="h-6 px-1.5 rounded-lg border border-slate-200 bg-white flex items-center">
                <CapsuleSelect
                  variant="flat"
                  value={period}
                  onValueChange={(v) => setPeriod(v as any)}
                  options={[
                    { value: "90d", label: "Last 90 days" },
                    { value: "30d", label: "Last 30 days" },
                    { value: "ytd", label: "Year to date" },
                  ]}
                  placeholder="Last 90 days"
                />
              </div>
            );

            return (
              <PageHeader
                icon={<LayoutDashboard className="h-4 w-4" />}
                title="Dashboard"
                afterTitle={accountCapsule}
                right={<div className="flex items-center gap-2">{periodCapsule}</div>}
              />
            );
          })()}
        </div>
      <div className="mt-2 h-px bg-slate-200" />
    </div>

      {/* KPI tiles (Bundle 2) */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: "Income", v: kpis.income },
          { label: "Expense", v: kpis.expense },
          { label: "Net", v: kpis.net },
          { label: "Open Issues", v: typeof kpis.issues === "number" ? String(kpis.issues) : undefined, isCount: true },
        ].map((x) => {
          const money = x.isCount ? null : fmtUsdAccountingFromCents(x.v);
          const text = x.isCount ? (x.v ?? "—") : money?.text ?? "—";
          const isNeg = x.isCount ? false : !!money?.isNeg;

          return (
            <div key={x.label} className="rounded-xl border border-slate-200 bg-white shadow-sm px-3 py-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{x.label}</div>
              <div className={`mt-1 text-sm font-semibold ${isNeg ? "text-rose-600" : "text-slate-900"}`}>{text}</div>
            </div>
          );
        })}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-4">
          {/* Cash Flow */}
          <Card>
            <CHeader className="pb-2">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-sm font-medium">Cash Flow</CardTitle>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {selectedAccountLabel} •{" "}
                    {period === "90d" ? "Last 90 days" : period === "30d" ? "Last 30 days" : "Year to date"}
                  </div>
                </div>
              </div>
            </CHeader>

            <CardContent className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                {/* Legend */}
                <div className="flex items-center gap-4 text-xs text-slate-700 mb-3">
                  <div className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-emerald-400" />
                    Cash in
                  </div>
                  <div className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-sm bg-violet-400" />
                    Cash out
                  </div>
                  <div className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-slate-700" />
                    Net
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex">
                    {/* Y axis */}
                    <div className="w-14 pr-2 text-[10px] text-slate-500">
                      <div className="h-40 flex flex-col justify-between">
                        {yTicks.map((t) => (
                          <div key={t} className="leading-none">
                            {formatAxis(t)}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Plot (single coordinate space for bars + line + dots + hover) */}
                    <div className="flex-1 relative">
                      {(() => {
                        const H = 160;
                        const half = H / 2;
                        const scale = half / maxAbs;

                        const n = cashFlowSeries.length;
                        const W = Math.max(1, n * 100); // fixed chart width, stable every render
                        const colW = W / n;
                        const barW = 14;
                        const DOT_R = 5;

                        const xPx = (i: number) => (i + 0.5) * colW;
                        const yPxNet = (net: number) => {
                          const y = half - net * scale;
                          return Math.max(2, Math.min(H - 2, y));
                        };

                        const points = cashFlowSeries.map((r, i) => ({ x: xPx(i), y: yPxNet(r.net) }));
                        const polyPoints = points.map((p) => `${p.x},${p.y}`).join(" ");

                        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

                        return (
                          <div
                            className="relative h-40"
                            onMouseLeave={() => {
                              setHoverIdx(null);
                              setHoverPos(null);
                            }}
                            onMouseMove={(e) => {
                              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                              const x = e.clientX - rect.left;
                              const y = e.clientY - rect.top;
                              setHoverPos({ x, y, w: rect.width, h: rect.height });
                            }}
                          >
                            {/* Grid + 0 line */}
                            <div className="absolute inset-0 pointer-events-none">
                              <div className="absolute left-0 right-0 border-t border-slate-200" style={{ top: 0 }} />
                              <div className="absolute left-0 right-0 border-t border-slate-200/70" style={{ top: `${H * 0.25}px` }} />
                              <div className="absolute left-0 right-0 border-t border-slate-400" style={{ top: `${half}px` }} />
                              <div className="absolute left-0 right-0 border-t border-slate-200/70" style={{ top: `${H * 0.75}px` }} />
                              <div className="absolute left-0 right-0 border-t border-slate-200" style={{ top: `${H}px` }} />
                            </div>

                            {/* One SVG: bars + line + dots + hit regions */}
                            <svg
                              className="absolute inset-0"
                              viewBox={`0 0 ${W} ${H}`}
                              preserveAspectRatio="none"
                            >
                              {/* Hit regions */}
                              {cashFlowSeries.map((r, i) => (
                                <rect
                                  key={`hit-${r.key}`}
                                  x={i * colW}
                                  y={0}
                                  width={colW}
                                  height={H}
                                  fill="transparent"
                                  onMouseEnter={() => setHoverIdx(i)}
                                />
                              ))}

{/* Bars */}
{cashFlowSeries.map((r, i) => {
  // Calculate heights based on the 0 line (half)
  const inPx = Math.max(0, r.cashIn * scale);
  const outPx = Math.max(0, r.cashOut * scale);

  const x = xPx(i) - barW / 2;
  // Green bar starts at its top and ends at the middle (half)
  const topY = half - inPx;
  // Purple bar starts at the middle (half) and goes down
  const bottomY = half;

  return (
    <g key={`bars-${r.key}`}>
      <defs>
        {/* Combined clip path for a single rounded pill shape */}
        <clipPath id={`pill-${r.key}`}>
          <rect x={x} y={topY} width={barW} height={inPx + outPx} rx={6} ry={6} />
        </clipPath>
      </defs>

      {/* Background shape */}
      <rect
        x={x}
        y={topY}
        width={barW}
        height={inPx + outPx}
        rx={6}
        ry={6}
        fill="rgba(148,163,184,0.12)"
      />

      {/* Color overlays clipped to the pill */}
      <g clipPath={`url(#pill-${r.key})`}>
        {/* Cash In (Green) - explicitly pinned to end at 'half' */}
        <rect
          x={x}
          y={topY}
          width={barW}
          height={inPx}
          fill="rgba(52,211,153,0.75)"
        />
        {/* Cash Out (Purple) - explicitly pinned to start at 'half' */}
        <rect
          x={x}
          y={half}
          width={barW}
          height={outPx}
          fill="rgba(167,139,250,0.75)"
        />
      </g>
    </g>
  );
})}

                              {/* Net line */}
                              <polyline
                                fill="none"
                                stroke="rgba(71,85,105,0.85)"
                                strokeWidth="2"
                                points={polyPoints}
                                pointerEvents="none"
                              />

                              {/* Dots (same points) */}
                              {points.map((p, i) => (
                                <circle
                                  key={`dot-${i}`}
                                  cx={p.x}
                                  cy={p.y}
                                  r={DOT_R}
                                  fill="rgb(51,65,85)"
                                  pointerEvents="none"
                                />
                              ))}
                            </svg>

                            {/* Tooltip (to the right of cursor, clamped) */}
                            {hoverIdx !== null && hoverPos ? (() => {
                              const TOOLTIP_W = 220;
                              const TOOLTIP_H = 104;

                              // Flip behavior: right by default; if overflow, place left.
                              const preferRight = hoverPos.x + 12;
                              const wouldOverflow = preferRight + TOOLTIP_W + 8 > hoverPos.w;

                              const left = wouldOverflow
                                ? clamp(hoverPos.x - 12 - TOOLTIP_W, 8, hoverPos.w - TOOLTIP_W - 8)
                                : clamp(preferRight, 8, hoverPos.w - TOOLTIP_W - 8);

                              const top = clamp(hoverPos.y, 8, hoverPos.h - TOOLTIP_H - 8);

                              const r = cashFlowSeries[hoverIdx];

                              return (
                                <div className="absolute z-20 pointer-events-none" style={{ left, top, width: TOOLTIP_W }}>
                                  <div className="rounded-lg border border-slate-200 bg-white shadow-sm px-3 py-2 text-xs">
                                    <div className="font-medium text-slate-900">{r.label}</div>

                                    <div className="mt-1 flex items-center justify-between gap-3">
                                      <span className="text-slate-600">Cash in</span>
                                      <span className="font-medium text-emerald-700">{fmtMoney(r.cashIn)}</span>
                                    </div>

                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-slate-600">Cash out</span>
                                      <span className="font-medium text-rose-600">({currency.format(r.cashOut)})</span>
                                    </div>

                                    <div className="mt-1 flex items-center justify-between gap-3">
                                      <span className="text-slate-600">Net</span>
                                      <span className={`font-semibold ${moneyClass(r.net)}`}>{fmtMoney(r.net)}</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })() : null}
                          </div>
                        );
                      })()}

                      {/* X axis labels */}
                      <div className="mt-2 flex gap-1">
                        {cashFlowSeries.map((r) => (
                          <div key={r.key} className="flex-1 text-center text-[10px] text-slate-500">
                            {r.label}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Currently entry-based; bank-based cash flow will come later.
                  </div>

                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Phase 3 shell: placeholder monthly cash flow series with final chart structure.
                  </div>
                </div>

                <div className="mt-3 text-[11px] text-muted-foreground">
                  Coming soon: monthly cash flow chart will be wired when monthly buckets are available (no client aggregation).
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Top Categories */}
          <Card>
            <CHeader className="pb-2">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm font-medium">Top Categories</CardTitle>
                <div className="text-xs text-muted-foreground">Phase 3 shell</div>
              </div>
            </CHeader>

            <CardContent className="pt-0">
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                <div className="px-3 py-3 text-sm text-slate-700">Coming soon</div>
                <div className="px-3 py-2 text-[11px] text-muted-foreground bg-slate-50 border-t border-slate-200">
                  Category totals are not available yet (Category Summary is disabled).
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Account Balances */}
          <Card>
            <CHeader className="pb-2">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm font-medium">Account Balances</CardTitle>
                <div className="text-xs text-muted-foreground">Top accounts</div>
              </div>
            </CHeader>

            <CardContent className="pt-0">
              <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                {activeAccountOptions.slice(0, 5).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 truncate">{a.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {"institution" in (a as any) && (a as any).institution ? (a as any).institution : "—"}{" "}
                        {"last4" in (a as any) && (a as any).last4 ? `•••• ${(a as any).last4}` : ""}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-slate-900">
                        {"balance_cents" in (a as any) ? currency.format(((a as any).balance_cents ?? 0) / 100) : "$—"}
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </div>
                  </div>
                ))}

                {activeAccountOptions.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">No accounts yet.</div>
                ) : null}

                <div className="px-3 py-2 text-[11px] text-muted-foreground bg-slate-50 border-t border-slate-200">
                  Phase 3: balances may be placeholders until live balance syncing is available.
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Open Issues */}
          <Card className="border-amber-200">
            <CHeader className="pb-2">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm font-medium">Open Issues</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => {
                    const params = new URLSearchParams();
                    if (selectedBusinessId) params.set("businessId", selectedBusinessId);
                    if (selectedAccountId && selectedAccountId !== "all") params.set("accountId", selectedAccountId);
                    router.push(`/issues?${params.toString()}`);
                  }}
                >
                  Review
                </Button>
              </div>
            </CHeader>

            <CardContent className="pt-0">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                <div className="text-sm font-medium text-amber-900">
                  Open issues: {typeof kpis.issues === "number" ? kpis.issues : "—"}
                </div>

                <div className="mt-2 text-[11px] text-amber-800/80">
                  Count of open issues for the selected business/account.
                </div>
              </div>
            </CardContent>
          </Card>

          {/* AI Insights */}
          <Card>
            <CHeader className="pb-2">
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-sm font-medium">AI Insights</CardTitle>
              </div>
            </CHeader>

            <CardContent className="pt-0">
              <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                <div className="text-sm text-slate-800">Get AI-powered summaries and next actions for your ledger.</div>
                <div className="mt-3 flex justify-center">
                  <Button size="sm" className="h-7" disabled title="Coming soon">
                    Open AI Insights
                  </Button>
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">Coming soon in Phase 4.</div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
