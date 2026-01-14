"use client";

import * as React from "react";

type StatusTone = "default" | "success" | "warning" | "danger" | "info";

type StatusChipProps = {
  label: React.ReactNode;
  tone?: StatusTone;
  className?: string;
};

const toneClasses: Record<StatusTone, string> = {
  default: "bg-slate-100 text-slate-700 border-slate-200",
  success: "bg-emerald-50 text-emerald-700 border-emerald-200",
  warning: "bg-amber-50 text-amber-700 border-amber-200",
  danger: "bg-rose-50 text-rose-700 border-rose-200",
  info: "bg-sky-50 text-sky-700 border-sky-200",
};

export function StatusChip({ label, tone = "default", className }: StatusChipProps) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 px-2 h-6 rounded-full text-[11px] font-medium border",
        toneClasses[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </span>
  );
}
