import * as React from "react";

type FilterBarProps = {
  left?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
};

export function FilterBar({ left, right, className }: FilterBarProps) {
  return (
    <div
      className={[
        "w-full rounded-md border border-bb-border bg-bb-surface-soft/70 px-2 py-1.5 shadow-[0_1px_0_rgba(255,255,255,0.7)_inset]",
        "flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex min-w-0 flex-wrap items-end gap-1.5">{left}</div>
      <div className="flex min-w-0 flex-wrap items-center justify-start gap-1.5 lg:shrink-0 lg:justify-end">
        {right}
      </div>
    </div>
  );
}
