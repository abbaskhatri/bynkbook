"use client";

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
import { BarChart3, LineChart, PieChart as PieIcon } from "lucide-react";

import {
  ChartContainer,
  MoneyXAxis,
  MoneyYAxis,
  MoneyGrid,
  MoneyTooltip,
  formatUsdAccountingFromCents,
} from "@/components/charts/ChartContainer";

type CashBarPoint = {
  ym: string;
  label: string;
  cashIn: number;
  cashOutAbs: number;
};

type CashPositionPoint = {
  ym: string;
  label: string;
  endingCash: number;
  endingCashPos: number;
  endingCashNeg: number;
};

type ExpensePiePoint = {
  label: string;
  value: number;
};

type ExpenseRankedPoint = {
  label: string;
  absCents: string;
  pct: number;
};

export type DashboardChartPanelsProps = {
  cashflowLoading: boolean;
  cashPositionLoading: boolean;
  categoriesLoading: boolean;
  cashBarsData: CashBarPoint[];
  cashPosData: CashPositionPoint[];
  expensePieData: ExpensePiePoint[];
  expenseRanked: ExpenseRankedPoint[];
  expenseTotalAbsCents: string;
};

function monthAbbr(raw: string) {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const s = String(raw ?? "").trim();

  if (/^\d{4}-\d{2}$/.test(s)) {
    const m = Number(s.slice(5, 7));
    return `${names[m - 1] ?? s} ${s.slice(2, 4)}`;
  }

  return s || "-";
}

const expensePieFills = [
  "var(--bb-emerald-600)",
  "var(--bb-blue-500)",
  "var(--bb-amber-500)",
  "var(--bb-green-600)",
  "var(--bb-red-600)",
];

function expensePieFillFor(label: string, i: number) {
  const t = (label ?? "").toLowerCase();
  if (t.includes("uncategorized")) return "var(--bb-slate-400)";
  return expensePieFills[i % expensePieFills.length];
}

export default function DashboardChartPanels({
  cashflowLoading,
  cashPositionLoading,
  categoriesLoading,
  cashBarsData,
  cashPosData,
  expensePieData,
  expenseRanked,
  expenseTotalAbsCents,
}: DashboardChartPanelsProps) {
  return (
    <>
      <ChartContainer
        title="Cash Flow"
        subtitle="Cash In vs Cash Out by month"
        right={
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bb-status-success-bg">
            <BarChart3 className="h-7 w-7 text-bb-status-success-fg" strokeWidth={2} />
          </div>
        }
        height="sm"
        loading={cashflowLoading}
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

      <ChartContainer
        title="Cash Position"
        subtitle="Ending cash balance by month (cash-basis)"
        right={
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bb-status-success-bg">
            <LineChart className="h-7 w-7 text-bb-status-success-fg" strokeWidth={2} />
          </div>
        }
        height="sm"
        loading={cashPositionLoading}
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

      <ChartContainer
        title="Category Breakdown"
        subtitle="Top expense categories"
        right={
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bb-status-success-bg">
            <PieIcon className="h-7 w-7 text-bb-status-success-fg" strokeWidth={2} />
          </div>
        }
        height="md"
        noResponsive
        loading={categoriesLoading}
        empty={
          expensePieData.length === 0
            ? { title: "No category spend in this period", description: "Try a wider date range to see your breakdown." }
            : undefined
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
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
                  {expensePieData.map((d, i) => (
                    <Cell key={i} fill={expensePieFillFor(String(d.label ?? ""), i)} />
                  ))}
                </Pie>

                <text x="50%" y="48%" textAnchor="middle" fill="var(--bb-text-muted)" fontSize="11">
                  Total
                </text>
                <text x="50%" y="58%" textAnchor="middle" fill="var(--bb-amount-neutral)" fontSize="14" fontWeight="600">
                  {formatUsdAccountingFromCents(-BigInt(String(expenseTotalAbsCents ?? "0"))).text}
                </text>
              </PieChart>
            </div>
          </div>

          <div>
            <div className="-mt-1 divide-y divide-bb-border-muted">
              {expenseRanked.map((r, idx) => (
                <div key={`${r.label}-${idx}`} className="py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-medium text-foreground/90">
                      {r.label}
                    </div>

                    <div className="flex items-baseline gap-3 text-right tabular-nums">
                      <div className="text-sm font-semibold text-bb-amount-neutral">
                        {formatUsdAccountingFromCents(-BigInt(r.absCents)).text}
                      </div>
                      <div className="text-[12px] text-muted-foreground">
                        {(r.pct * 100).toFixed(0)}%
                      </div>
                    </div>
                  </div>

                  <div className="mt-1.5 h-2 rounded-full bg-muted overflow-hidden">
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
    </>
  );
}
