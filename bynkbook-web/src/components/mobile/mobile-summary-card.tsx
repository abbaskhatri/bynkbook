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
  neutral: "border-slate-200 bg-white text-slate-900",
  positive: "border-emerald-200 bg-emerald-50/60 text-emerald-950",
  warning: "border-amber-200 bg-amber-50/70 text-amber-950",
  danger: "border-rose-200 bg-rose-50/70 text-rose-950",
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
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
            {title}
          </div>
          <div className="mt-2 truncate text-2xl font-semibold leading-none">{value}</div>
        </div>
        {icon ? (
          <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-white/70 bg-white/80 text-slate-600 shadow-sm">
            {icon}
          </div>
        ) : null}
      </div>
      {detail ? <div className="mt-3 text-sm leading-5 text-slate-600">{detail}</div> : null}
    </section>
  );
}
