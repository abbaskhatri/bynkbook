import * as React from "react";
import { textMuted } from "./tokens";

type PageHeaderProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
};

export function PageHeader({ title, subtitle, right, className }: PageHeaderProps) {
  return (
    <div className={["w-full flex items-start justify-between gap-3", className].filter(Boolean).join(" ")}>
      <div className="min-w-0">
        <div className="text-base font-semibold text-slate-900 leading-tight truncate">
          {title}
        </div>
        {subtitle ? (
          <div className={["mt-1 text-xs", textMuted].join(" ")}>
            {subtitle}
          </div>
        ) : null}
      </div>

      {right ? (
        <div className="shrink-0 flex items-center gap-2">
          {right}
        </div>
      ) : null}
    </div>
  );
}
