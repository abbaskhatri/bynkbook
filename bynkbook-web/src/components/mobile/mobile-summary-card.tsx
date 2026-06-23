import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type MobileSummaryCardProps = {
  title: string;
  value: string;
  detail?: string;
  icon?: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "danger";
};

const toneClasses = {
  neutral: "mobile-token-card text-card-foreground",
  positive: "mobile-token-card mobile-token-card--success text-card-foreground",
  warning: "mobile-token-card mobile-token-card--warning text-card-foreground",
  danger: "mobile-token-card mobile-token-card--danger text-card-foreground",
};

export function MobileSummaryCard({
  title,
  value,
  detail,
  icon,
  tone = "neutral",
}: MobileSummaryCardProps) {
  return (
    <section className={cn("rounded-md border p-3.5 shadow-sm", toneClasses[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {title}
          </div>
          <div className="mt-2 break-words text-xl font-semibold leading-6 tabular-nums">{value}</div>
        </div>
        {icon ? (
          <div className="mobile-token-card-control inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground shadow-sm">
            {icon}
          </div>
        ) : null}
      </div>
      {detail ? <div className="mt-2 text-[13px] leading-5 text-muted-foreground">{detail}</div> : null}
    </section>
  );
}
