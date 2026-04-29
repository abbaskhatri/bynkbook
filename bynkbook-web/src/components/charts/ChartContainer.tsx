"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { motionFast } from "@/components/primitives/tokens";
import { Skeleton } from "@/components/ui/skeleton";
import {
    ResponsiveContainer,
    Tooltip as RechartsTooltip,
    Legend as RechartsLegend,
    XAxis,
    YAxis,
    CartesianGrid,
} from "recharts";

type Height = "sm" | "md" | "lg";
const HEIGHT_PX: Record<Height, number> = { sm: 130, md: 200, lg: 260 };

export function addCommas(intStr: string) {
    const s = intStr.replace(/^0+(?=\d)/, "");
    const out: string[] = [];
    for (let i = 0; i < s.length; i++) {
        const idxFromEnd = s.length - i;
        out.push(s[i]);
        if (idxFromEnd > 1 && idxFromEnd % 3 === 1) out.push(",");
    }
    return out.join("");
}

// BigInt-safe accounting currency formatting (USD cents -> "$1,234.56" or "($1,234.56)")
export function formatUsdAccountingFromCents(
    centsStr: string | number | bigint | null | undefined
) {
    let n: bigint;
    try {
        if (typeof centsStr === "bigint") n = centsStr;
        else if (typeof centsStr === "number") n = BigInt(Math.trunc(centsStr));
        else n = BigInt(String(centsStr ?? "0"));
    } catch {
        return { text: "—", isNeg: false };
    }

    const isNeg = n < 0n;
    const abs = isNeg ? -n : n;

    const dollars = abs / 100n;
    const cents = abs % 100n;

    const body = `$${addCommas(String(dollars))}.${String(cents).padStart(2, "0")}`;
    return { text: isNeg ? `(${body})` : body, isNeg };
}

// Compact ticks for axes (USD cents -> "$1.2K", "($3.4M)")
export function formatUsdCompactAccountingFromCents(
    centsStr: string | number | bigint | null | undefined
) {
    let n: bigint;
    try {
        if (typeof centsStr === "bigint") n = centsStr;
        else if (typeof centsStr === "number") n = BigInt(Math.trunc(centsStr));
        else n = BigInt(String(centsStr ?? "0"));
    } catch {
        return "—";
    }

    const isNeg = n < 0n;
    const abs = isNeg ? -n : n;

    // Convert to dollars as number for compacting. Safe enough for axis ticks.
    const dollars = Number(abs) / 100;
    let body: string;

    if (!Number.isFinite(dollars)) {
        body = "$0";
    } else if (dollars >= 1_000_000) {
        const v = dollars / 1_000_000;
        body = `$${v >= 10 ? v.toFixed(0) : v.toFixed(1)}M`;
    } else if (dollars >= 1_000) {
        const v = dollars / 1_000;
        body = `$${v >= 10 ? v.toFixed(0) : v.toFixed(1)}K`;
    } else {
        body = `$${Math.round(dollars).toString()}`;
    }

    return isNeg ? `(${body})` : body;
}

export type ChartContainerProps = {
    title: string;
    subtitle?: string;
    height?: Height;
    loading?: boolean;
    empty?: { title: string; description?: string };
    right?: React.ReactNode;

    // If true, do NOT wrap children in Recharts ResponsiveContainer.
    // Use for non-chart layouts (e.g., donut + ranked list grids).
    noResponsive?: boolean;

    children: React.ReactNode;
};

export function ChartContainer({
    title,
    subtitle,
    height = "md",
    loading,
    empty,
    right,
    noResponsive,
    children,
}: ChartContainerProps) {
    const h = HEIGHT_PX[height];
    const [responsiveReady, setResponsiveReady] = React.useState(false);

    React.useEffect(() => {
        const id = window.requestAnimationFrame(() => setResponsiveReady(true));
        return () => window.cancelAnimationFrame(id);
    }, []);

    return (
        <Card className={`rounded-[10px] border border-bb-border bg-bb-surface-card text-card-foreground shadow-sm ${motionFast}`}>
            <CardHeader className="py-1">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle className="text-base font-semibold text-foreground/90">{title}</CardTitle>
                        {subtitle ? <div className="text-[11px] text-muted-foreground">{subtitle}</div> : null}
                    </div>
                    {right ? <div className="pt-0.5">{right}</div> : null}
                </div>
            </CardHeader>

            <CardContent className="px-3 pb-1 pt-0.5">
                {loading ? (
                    <Skeleton className="w-full rounded-md" style={{ height: h }} />
                ) : empty ? (
                    <div
                        className="flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-card"
                        style={{ height: h }}
                    >
                        <div className="max-w-[420px] px-4 text-center">
                            <div className="text-sm font-medium text-foreground/90">{empty.title}</div>
                            {empty.description ? (
                                <div className="mt-1 text-xs text-muted-foreground">{empty.description}</div>
                            ) : null}
                        </div>
                    </div>
                ) : noResponsive ? (
                    // Non-chart layouts should not be wrapped in ResponsiveContainer.
                    // Use minHeight so content can size naturally without getting clipped.
                    <div className="text-card-foreground" style={{ minHeight: h, minWidth: 0 }}>
                        {children}
                    </div>
                ) : (
                    <div className="text-card-foreground" style={{ height: h, minWidth: 0, minHeight: 0 }}>
                        {responsiveReady ? (
                            <ResponsiveContainer width="99%" height="99%">
                                {children as any}
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full w-full rounded-md bg-bb-surface-soft" />
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

/**
 * Standard axis + grid primitives for money charts.
 */
export function MoneyXAxis(props: React.ComponentProps<typeof XAxis>) {
    return (
        <XAxis
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={12}
            tick={{ fontSize: 11, fill: "var(--bb-chart-axis)" }}
            {...props}
        />
    );
}

export function MoneyYAxis(props: React.ComponentProps<typeof YAxis>) {
    return (
        <YAxis
            tickLine={false}
            axisLine={false}
            width={52}
            tick={{ fontSize: 11, fill: "var(--bb-chart-axis)" }}
            // values are in dollars; convert to cents for compact accounting ticks
            tickFormatter={(v: any) =>
                formatUsdCompactAccountingFromCents(BigInt(Math.trunc(Number(v) * 100)))
            }
            {...props}
        />
    );
}

export function MoneyGrid(props: React.ComponentProps<typeof CartesianGrid>) {
    return (
        <CartesianGrid
            stroke="var(--bb-chart-grid)"
            strokeDasharray="3 3"
            vertical={false}
            {...props}
        />
    );
}

export function MoneyTooltip({
    labelFormatter,
}: {
    labelFormatter?: (label: any) => string;
}) {
    return (
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
                // Recharts can pass string | number | undefined depending on payload.
                const dollars = Number(value ?? 0);
                const cents = Number.isFinite(dollars) ? BigInt(Math.trunc(dollars * 100)) : 0n;
                // Return a ReactNode (string is fine)
                return formatUsdAccountingFromCents(cents).text;
            }}
            labelFormatter={(label: any) =>
                labelFormatter ? labelFormatter(label) : String(label ?? "")
            }
        />
    );
}

export function DenseLegend() {
    return (
        <RechartsLegend
            verticalAlign="top"
            align="right"
            height={18}
            wrapperStyle={{ fontSize: 11, paddingBottom: 2 }}
        />
    );
}
