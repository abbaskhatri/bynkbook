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
    <section className={cn("rounded-md border p-3 shadow-[0_8px_22px_rgba(15,23,42,0.045)]", toneClasses[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            {title}
          </div>
          <div className="mt-1.5 break-words text-xl font-semibold leading-6 tabular-nums">{value}</div>
        </div>
        {icon ? (
          <div className="mobile-token-card-control inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground shadow-sm">
            {icon}
          </div>
        ) : null}
      </div>
      {detail ? <div className="mt-2 line-clamp-2 text-[12px] leading-4 text-muted-foreground">{detail}</div> : null}
    </section>
  );
}
