"use client";

import { type ReactElement, useEffect, useRef, useState } from "react";
import { PieChart as PieIcon } from "lucide-react";
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

type RangeMode = "weekly" | "monthly" | "yearly" | "custom";

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

function formatBucketLabel(raw: string) {
  const s = String(raw ?? "").trim();
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  if (/^\d{4}$/.test(s)) return s;

  if (/^\d{4}-\d{2}$/.test(s)) {
    const m = Number(s.slice(5, 7));
    return `${mon[m - 1] ?? s} ${s.slice(2, 4)}`;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const m = Number(s.slice(5, 7));
    const d = s.slice(8, 10);
    return `${mon[m - 1] ?? s} ${d}`;
  }

  const wk = s.match(/^(\d{4})-W?(\d{1,2})$/i);
  if (wk) {
    const yy = wk[1].slice(2, 4);
    const ww = wk[2].padStart(2, "0");
    return `W${ww} ${yy}`;
  }

  return s || "—";
}

function normalizeMonthKeysForChart(rawMonths: string[], rangeToYmd: string) {
  const months = (rawMonths ?? []).map((m) => String(m ?? "").trim());
  if (months.length === 0) return months;

  const ok = (s: string) =>
    /^\d{4}$/.test(s) ||
    /^\d{4}-\d{2}$/.test(s) ||
    /^\d{4}-\d{2}-\d{2}$/.test(s) ||
    /^\d{4}-W?\d{1,2}$/i.test(s);

  if (months.every(ok)) return months;

  const end = new Date(`${rangeToYmd}T00:00:00`);
  const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

  const n = months.length;
  return months.map((_, i) => {
    const d = new Date(endMonth.getFullYear(), endMonth.getMonth() - (n - 1 - i), 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

function NoTrendNote() {
  return <div className="text-xs text-bb-text-muted">No trend data for this range.</div>;
}

function compactUsdTickFromCentsNumber(v: number) {
  const neg = v < 0;
  const abs = Math.abs(v);
  const dollars = abs / 100;
  let body: string;

  if (dollars >= 1_000_000) body = `$${(dollars / 1_000_000).toFixed(dollars >= 10_000_000 ? 0 : 1)}M`;
  else if (dollars >= 1_000) body = `$${(dollars / 1_000).toFixed(dollars >= 10_000 ? 0 : 1)}K`;
  else body = `$${Math.round(dollars)}`;

  return neg ? `(${body})` : body;
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

export function ComboBarLineChart({
  months,
  barA,
  barB,
  line,
  aLabel,
  bLabel,
  lineLabel,
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
          tickFormatter={(v: any) => formatBucketLabel(String(v))}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "var(--bb-chart-axis)" }}
          tickFormatter={(v) => compactUsdTickFromCentsNumber(Number(v))}
          width={72}
        />

        <Tooltip
          formatter={(value: any, name: any) => [tooltipFmt(value), String(name)]}
          labelFormatter={(label: any) => formatBucketLabel(String(label))}
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

export function DonutBreakdown({
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
    "rgb(147 51 234)",
    "rgb(14 165 233)",
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
