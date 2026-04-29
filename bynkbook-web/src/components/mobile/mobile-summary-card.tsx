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
  neutral: "mobile-token-card text-foreground",
  positive: "mobile-token-card mobile-token-card--success text-foreground",
  warning: "mobile-token-card mobile-token-card--warning text-foreground",
  danger: "mobile-token-card mobile-token-card--danger text-foreground",
};

export function MobileSummaryCard({
  title,
  value,
  detail,
  icon,
  tone = "neutral",
}: MobileSummaryCardProps) {
  return (
    <section className={cn("rounded-md border p-4 shadow-sm", toneClasses[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {title}
          </div>
          <div className="mt-2 truncate text-2xl font-semibold leading-none">{value}</div>
        </div>
        {icon ? (
          <div className="mobile-token-card-control inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-muted-foreground shadow-sm">
            {icon}
          </div>
        ) : null}
      </div>
      {detail ? <div className="mt-3 text-sm leading-5 text-muted-foreground">{detail}</div> : null}
    </section>
  );
}
