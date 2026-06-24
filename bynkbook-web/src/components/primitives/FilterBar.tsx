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
        "w-full rounded-lg border border-bb-border bg-bb-surface-soft/70 px-2 py-2",
        "flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-w-0 flex flex-wrap items-center gap-2">{left}</div>
      <div className="min-w-0 flex flex-wrap items-center justify-start gap-2 lg:justify-end lg:shrink-0">
        {right}
      </div>
    </div>
  );
}
