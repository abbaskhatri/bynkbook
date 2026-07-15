"use client";

import type { ReactNode } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

type FinancialRecordRowProps = {
  title: ReactNode;
  amount: ReactNode;
  date?: ReactNode;
  category?: ReactNode;
  status?: ReactNode;
  direction?: "positive" | "negative" | "neutral";
  needsAttention?: boolean;
  onClick?: () => void;
  actionLabel?: string;
};

export function FinancialRecordRow({
  title,
  amount,
  date,
  category,
  status,
  direction = "neutral",
  needsAttention = false,
  onClick,
  actionLabel = "Open record",
}: FinancialRecordRowProps) {
  const Component = onClick ? "button" : "div";

  return (
    <Component
      {...(onClick ? { type: "button" as const, onClick, "aria-label": actionLabel } : {})}
      className={cn(
        "grid min-h-[5.5rem] w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded-xl border border-bb-border bg-bb-surface-card px-4 py-3 text-left shadow-sm",
        onClick && "transition-colors hover:bg-bb-table-row-hover"
      )}
    >
      <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-bb-text">
        {needsAttention ? <AlertTriangle className="h-4 w-4 shrink-0 text-bb-status-warning-fg" aria-label="Needs attention" /> : null}
        <span className="truncate">{title}</span>
      </span>
      <span
        className={cn(
          "whitespace-nowrap text-sm font-semibold tabular-nums",
          direction === "positive" && "text-bb-amount-positive",
          direction === "negative" && "text-bb-amount-negative",
          direction === "neutral" && "text-bb-text"
        )}
      >
        {amount}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-bb-text-muted">
        {date ? <span className="whitespace-nowrap">{date}</span> : null}
        {date && category ? <span aria-hidden="true">•</span> : null}
        {category ? <span className="truncate">{category}</span> : null}
      </span>
      <span className="flex items-center justify-end gap-1.5 text-[11px] font-medium text-bb-text-muted">
        {status}
        {onClick ? <ChevronRight className="h-4 w-4" aria-hidden="true" /> : null}
      </span>
    </Component>
  );
}
