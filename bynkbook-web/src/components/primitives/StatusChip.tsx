"use client";

import * as React from "react";

type StatusTone = "default" | "success" | "warning" | "danger" | "info";

type StatusChipProps = {
  label: React.ReactNode;
  tone?: StatusTone;
  className?: string;
};

const toneClasses: Record<StatusTone, string> = {
  default: "bg-bb-status-default-bg text-bb-status-default-fg border-bb-status-default-border",
  success: "bg-bb-status-success-bg text-bb-status-success-fg border-bb-status-success-border",
  warning: "bg-bb-status-warning-bg text-bb-status-warning-fg border-bb-status-warning-border",
  danger: "bg-bb-status-danger-bg text-bb-status-danger-fg border-bb-status-danger-border",
  info: "bg-bb-status-info-bg text-bb-status-info-fg border-bb-status-info-border",
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
