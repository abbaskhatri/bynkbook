"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
// Auth is handled by AppShell

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { getPnlSummary, getCashflowSeries, getCategories, getAccountsSummary } from "@/lib/api/reports";
import { getIssuesCount } from "@/lib/api/issues";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, ChevronRight } from "lucide-react";

import { InlineBanner } from "@/components/app/inline-banner";
import { EmptyStateCard } from "@/components/app/empty-state";
import { appErrorMessageOrNull, extractHttpStatus } from "@/lib/errors/app-error";

export default function DashboardPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  function InlineErrorBanner({
    title,
    detail,
    onRetry,
  }: {
    title: string;
    detail?: string | null;
    onRetry?: (() => void) | null;
  }) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-rose-900">{title}</div>
            {detail ? <div className="mt-0.5 text-[11px] text-rose-800/90 break-words">{detail}</div> : null}
          </div>
          {onRetry ? (
            <Button size="sm" variant="outline" className="h-7" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  function normalizeApiError(e: any): { detail: string } {
    return { detail: appErrorMessageOrNull(e) ?? "Something went wrong. Try again." };
  }

  // Auth is handled by AppShell

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

  // Real chart series from cashflow_series endpoint (monthly buckets).
  const [cashSeries, setCashSeries] = useState<
    Array<{ key: string; label: string; cashInCents: string; cashOutCents: string; netCents: string }>
  >([]);

  const hasMultiMonth = useMemo(() => {
    const uniq = new Set(cashSeries.map((r) => r.key));
    return uniq.size >= 2;
  }, [cashSeries]);

  const { maxPosCents, maxNegAbsCents } = useMemo(() => {
    let pos = 0n;
    let neg = 0n;

    for (const r of cashSeries) {
      try {
        const cashIn = BigInt(r.cashInCents); // expected >= 0
        const cashOut = BigInt(r.cashOutCents); // expected <= 0
        const net = BigInt(r.netCents);

        if (cashIn > pos) pos = cashIn;

        const outAbs = cashOut < 0n ? -cashOut : cashOut;
        if (outAbs > neg) neg = outAbs;

        if (net > 0n && net > pos) pos = net;
        if (net < 0n && (-net) > neg) neg = -net;
      } catch {
        // ignore
      }
    }

    // Snap each side to a nice step so grid labels look clean
    const step = 500000n; // $5,000.00 in cents
    const snapUp = (v: bigint) => (v <= 0n ? step : ((v + step - 1n) / step) * step);

    return {
      maxPosCents: snapUp(pos),
      maxNegAbsCents: snapUp(neg),
    };
  }, [cashSeries]);

  const yTicksPosCents = useMemo(() => {
    const half = maxPosCents / 2n;
    return [maxPosCents, half, 0n];
  }, [maxPosCents]);

  const yTicksNegCents = useMemo(() => {
    const half = maxNegAbsCents / 2n;
    // negatives (as signed cents)
    return [0n, -half, -maxNegAbsCents];
  }, [maxNegAbsCents]);

  function fmtUsdAccountingFromCentsSafe(centsStr?: string) {
    if (!centsStr) return { text: "—", isNeg: false };
    return fmtUsdAccountingFromCents(centsStr);
  }

  function centsToNumber(centsStr: string) {
    try {
      return Number(BigInt(centsStr)) / 100;
    } catch {
      return 0;
    }
  }

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
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;
    if (!sp.get("accountId")) {
      router.replace(`/dashboard?businessId=${selectedBusinessId}&accountId=all`);
    }
  }, [businessesQ.isLoading, selectedBusinessId, router, sp]);

  const [dashErr, setDashErr] = useState<{ title: string; detail: string } | null>(null);
  const [topCats, setTopCats] = useState<Array<{ label: string; cents: string; count: number }>>([]);
  const [balancesByAccountId, setBalancesByAccountId] = useState<Record<string, string>>({});
  const [dashLoading, setDashLoading] = useState(false);

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

    let cancelled = false;

    (async () => {
      setDashLoading(true);
      setDashErr(null);

      try {
        const [pnl, cashflow, issues, cats, acctSummary] = await Promise.all([
          getPnlSummary(selectedBusinessId, { from, to, accountId: selectedAccountId, ytd: period === "ytd" }),
          getCashflowSeries(selectedBusinessId, { from, to, accountId: selectedAccountId, ytd: period === "ytd" }),
          getIssuesCount(selectedBusinessId, { status: "OPEN", accountId: selectedAccountId }),
          getCategories(selectedBusinessId, { from, to, accountId: selectedAccountId }),
          // As-of: today (dashboard is “current-ish”)
          getAccountsSummary(selectedBusinessId, { asOf: to, accountId: "all", includeArchived: false }),
        ]);

        if (cancelled) return;

        setKpis({
          income: pnl.period.income_cents,
          expense: pnl.period.expense_cents,
          net: pnl.period.net_cents,
          cashIn: cashflow.totals.cash_in_cents,
          cashOut: cashflow.totals.cash_out_cents,
          issues: issues.count,
        });

        // Real cashflow chart buckets (monthly)
        const monthAbbr = (ym: string) => {
          // ym: YYYY-MM
          const m = Number(String(ym).slice(5, 7));
          const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          return names[m - 1] ?? ym;
        };

        const m = (cashflow.monthly ?? []).map((r: any) => {
          const ym = String(r.month);
          return {
            key: ym,
            label: monthAbbr(ym),
            cashInCents: String(r.cash_in_cents ?? "0"),
            cashOutCents: String(r.cash_out_cents ?? "0"),
            netCents: String(r.net_cents ?? "0"),
          };
        });
        setCashSeries(m);

        const map: Record<string, string> = {};
        for (const r of (acctSummary?.rows ?? [])) {
          map[String(r.account_id)] = String(r.balance_cents ?? "0");
        }
        setBalancesByAccountId(map);
        // Top categories: sort by absolute amount; show signed accounting value
        const absBig = (s: string) => {
          try {
            const n = BigInt(s);
            return n < 0n ? -n : n;
          } catch {
            return 0n;
          }
        };

        const rows = (cats.rows ?? [])
          .map((r: any) => ({
            label: String(r.category ?? "Category"),
            cents: String(r.amount_cents ?? "0"),
            count: Number(r.count ?? 0),
          }))
          .sort((a: any, b: any) => {
            const aa = absBig(a.cents);
            const bb = absBig(b.cents);
            if (bb === aa) return b.count - a.count;
            return bb > aa ? 1 : -1;
          })
          .slice(0, 6);

        setTopCats(rows);
      } catch (e: any) {
        if (cancelled) return;

        const detail = appErrorMessageOrNull(e) ?? "Something went wrong. Try again.";
        const status = extractHttpStatus(e);

        if (status === 401) setDashErr({ title: "Signed out", detail });
        else if (status === 403) setDashErr({ title: "Access denied", detail });
        else setDashErr({ title: "Dashboard failed to load", detail });

        // Keep existing UI stable; just show banner.
      } finally {
        if (!cancelled) setDashLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedBusinessId, selectedAccountId, period]);

  // Tooltip state (single source of truth)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Auth handled by AppShell

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

      {/* Explicit empty + error states */}
      {!selectedBusinessId && !businessesQ.isLoading ? (
        <EmptyStateCard
          title="No business yet"
          description="Create a business to start using BynkBook."
          primary={{ label: "Create business", href: "/settings?tab=business" }}
          secondary={{ label: "Reload", onClick: () => router.refresh() }}
        />
      ) : null}

      {selectedBusinessId && !accountsQ.isLoading && activeAccountOptions.length === 0 ? (
        <EmptyStateCard
          title="No accounts yet"
          description="Add an account to start importing and categorizing transactions."
          primary={{ label: "Add account", href: "/settings?tab=accounts" }}
          secondary={{ label: "Reload", onClick: () => router.refresh() }}
        />
      ) : null}

      {dashErr ? <InlineBanner title={dashErr.title} message={dashErr.detail} onRetry={() => setPeriod((p) => p)} /> : null}

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

                {cashSeries.length >= 2 && hasMultiMonth ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-start">
                      {/* Shared viewport: labels + plot align to the exact same 160px coordinate space */}
                      <div className="w-14 pr-3 text-[10px] text-slate-500">
                          {(() => {
                            const H = 160;

                            const posMaxDollars = Number(maxPosCents) / 100;
                            const negMaxDollars = Number(maxNegAbsCents) / 100;
                            const total = Math.max(1, posMaxDollars + negMaxDollars);
                            const posPx = (H * posMaxDollars) / total;
                            const zeroY = posPx;

                            const positions = [
                              { cents: maxPosCents, y: 0 },
                              { cents: maxPosCents / 2n, y: zeroY / 2 },
                              { cents: 0n, y: zeroY },
                              { cents: -(maxNegAbsCents / 2n), y: zeroY + (H - zeroY) / 2 },
                              { cents: -maxNegAbsCents, y: H },
                            ];

                            return (
                              <div className="h-40 relative">
                                {positions.map((p) => {
                                  const fm = fmtUsdAccountingFromCentsSafe(p.cents.toString());
                                  const isZero = p.cents === 0n;

                                  return (
                                    <div
                                      key={p.cents.toString()}
                                      className={`absolute right-2 leading-none ${p.cents === 0n ? "text-slate-600" : fm.isNeg ? "text-rose-600" : ""}`}
                                      style={{
                                        top: isZero ? `${p.y - 6}px` : `${p.y}px`,
                                        transform: isZero ? "translateY(0)" : "translateY(-50%)",
                                      }}
                                    >
                                      {fm.text}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </div>

                      {/* Plot (single coordinate space for bars + line + dots + hover) */}
                      <div className="flex-1 pl-1">
                        {(() => {
                          const H = 160;

                          const posMaxDollars = Number(maxPosCents) / 100;
                          const negMaxDollars = Number(maxNegAbsCents) / 100;

                          // Allocate vertical space proportional to magnitude (smart asymmetric axis)
                          const total = Math.max(1, posMaxDollars + negMaxDollars);
                          const posPx = (H * posMaxDollars) / total;
                          const negPx = H - posPx;

                          const zeroY = posPx; // 0 line (bars merge here)

                          const posScale = posPx / Math.max(1, posMaxDollars);
                          const negScale = negPx / Math.max(1, negMaxDollars);
                          const n = cashSeries.length;
                          const W = Math.max(1, n * 100); // fixed chart width, stable every render
                          const colW = W / n;
                          const barW = 14;
                          const DOT_R = 5;

                          const xPx = (i: number) => (i + 0.5) * colW;
                          const yPxNet = (net: number) => {
                            const y = net >= 0 ? zeroY - net * posScale : zeroY - net * negScale; // net negative pushes down
                            return Math.max(2, Math.min(H - 2, y));
                          };

                          const points = cashSeries.map((r, i) => ({ x: xPx(i), y: yPxNet(centsToNumber(r.netCents)) }));
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
                                <div className="absolute left-0 right-0 border-t border-slate-200/70" style={{ top: `${zeroY / 2}px` }} />
                                <div className="absolute left-0 right-0 border-t border-slate-400" style={{ top: `${zeroY}px` }} />
                                <div className="absolute left-0 right-0 border-t border-slate-200/70" style={{ top: `${zeroY + (H - zeroY) / 2}px` }} />
                                <div className="absolute left-0 right-0 border-t border-slate-200" style={{ top: `${H}px` }} />
                              </div>

                              {/* One SVG: bars + line + dots + hit regions */}
                              <svg
                                className="absolute inset-0"
                                viewBox={`0 0 ${W} ${H}`}
                                preserveAspectRatio="none"
                              >
                                {/* Hit regions */}
                                {cashSeries.map((r, i) => (
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

                                {/* Bars (true zero-axis: green up from 0, purple down from 0) */}
                                {cashSeries.map((r, i) => {
                                  // Use the SAME zero line as the grid/net line (do NOT override it here)
                                  const scaleIn = posScale;
                                  const scaleOut = negScale;

                                  const cashIn = Math.max(0, centsToNumber(r.cashInCents)); // positive
                                  const cashOutAbs = Math.max(0, Math.abs(centsToNumber(r.cashOutCents))); // expenses negative

                                  const inPx = cashIn * scaleIn;
                                  const outPx = cashOutAbs * scaleOut;

                                  const x = xPx(i) - barW / 2;

                                  // Green: from zero line up
                                  const inTop = zeroY - inPx;
                                  const inH = inPx;

                                  // Purple: from zero line down
                                  const outTop = zeroY;
                                  const outH = outPx;

                                  const rx = 6;

                                  return (
                                    <g key={`bars-${r.key}`}>
                                      {/* Cash In (rounded top) */}
                                      {inH > 0 ? (
                                        <path
                                          d={[
                                            `M ${x} ${inTop + rx}`,
                                            `A ${rx} ${rx} 0 0 1 ${x + rx} ${inTop}`,
                                            `H ${x + barW - rx}`,
                                            `A ${rx} ${rx} 0 0 1 ${x + barW} ${inTop + rx}`,
                                            `V ${inTop + inH}`,
                                            `H ${x}`,
                                            `Z`,
                                          ].join(" ")}
                                          fill="rgba(52,211,153,0.75)"
                                        />
                                      ) : null}

                                      {/* Cash Out (rounded bottom) */}
                                      {outH > 0 ? (
                                        <path
                                          d={[
                                            `M ${x} ${outTop}`,
                                            `H ${x + barW}`,
                                            `V ${outTop + outH - rx}`,
                                            `A ${rx} ${rx} 0 0 1 ${x + barW - rx} ${outTop + outH}`,
                                            `H ${x + rx}`,
                                            `A ${rx} ${rx} 0 0 1 ${x} ${outTop + outH - rx}`,
                                            `Z`,
                                          ].join(" ")}
                                          fill="rgba(167,139,250,0.75)"
                                        />
                                      ) : null}
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

                                const r = cashSeries[hoverIdx];

                                return (
                                  <div className="absolute z-20 pointer-events-none" style={{ left, top, width: TOOLTIP_W }}>
                                    <div className="rounded-lg border border-slate-200 bg-white shadow-sm px-3 py-2 text-xs">
                                      <div className="font-medium text-slate-900">{r.label}</div>

                                      <div className="mt-1 flex items-center justify-between gap-3">
                                        <span className="text-slate-600">Cash in</span>
                                        <span className="font-medium text-emerald-700">{fmtUsdAccountingFromCentsSafe(r.cashInCents).text}</span>
                                      </div>

                                      <div className="flex items-center justify-between gap-3">
                                        <span className="text-slate-600">Cash out</span>
                                        <span className="font-medium text-rose-600">{fmtUsdAccountingFromCentsSafe(r.cashOutCents).text}</span>
                                      </div>

                                      <div className="mt-1 flex items-center justify-between gap-3">
                                        <span className="text-slate-600">Net</span>
                                        {(() => {
                                          const fm = fmtUsdAccountingFromCentsSafe(r.netCents);
                                          return <span className={`font-semibold ${fm.isNeg ? "text-rose-600" : "text-slate-900"}`}>{fm.text}</span>;
                                        })()}
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
                          {cashSeries.map((r) => (
                            <div key={r.key} className="flex-1 text-center text-[10px] text-slate-500">
                              {r.label}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 text-[11px] text-muted-foreground">
                      Basis: Cash (Entries). Types: Income/Expense only.
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-600">
                    No multi-month trend for this range.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Top Categories (real aggregate) */}
          {topCats.length > 0 ? (
            <Card>
              <CHeader className="pb-2">
                <div className="flex items-center justify-between gap-4">
                  <CardTitle className="text-sm font-medium">Top Categories</CardTitle>
                  <div className="text-xs text-muted-foreground">
                    {selectedAccountLabel} •{" "}
                    {period === "90d" ? "Last 90 days" : period === "30d" ? "Last 30 days" : "Year to date"}
                  </div>
                </div>
              </CHeader>

              <CardContent className="pt-0">
                <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                  {topCats.map((c, idx) => {
                    const fm = fmtUsdAccountingFromCentsSafe(c.cents);
                    return (
                      <div key={`${c.label}-${idx}`} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 last:border-b-0">
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate">{c.label}</div>
                          <div className="text-[11px] text-muted-foreground">{c.count} entries</div>
                        </div>
                        <div className={`text-sm font-semibold tabular-nums ${fm.isNeg ? "text-rose-600" : "text-slate-900"}`}>{fm.text}</div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ) : null}
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
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      if (!selectedBusinessId) return;
                      const params = new URLSearchParams();
                      params.set("businessId", selectedBusinessId);
                      params.set("accountId", String(a.id));
                      router.push(`/ledger?${params.toString()}`);
                    }}
                    className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-200 last:border-b-0 hover:bg-slate-50"
                    title="Open ledger"
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
                        {(() => {
                          const cents = balancesByAccountId[String(a.id)];
                          const fm = fmtUsdAccountingFromCentsSafe(cents ?? "0");
                          return fm.text;
                        })()}
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </div>
                  </button>
                ))}

                {activeAccountOptions.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-muted-foreground">No accounts yet.</div>
                ) : null}

                <div className="px-3 py-2 text-[11px] text-muted-foreground bg-slate-50 border-t border-slate-200">
                  Balances shown reflect current app data.
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

          {/* AI Insights hidden until real (no placeholders) */}
          {null}
        </div>
      </div>
    </div>
  );
}
