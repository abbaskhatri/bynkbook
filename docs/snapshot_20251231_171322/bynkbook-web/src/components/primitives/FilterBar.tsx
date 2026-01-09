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
        "w-full flex items-center justify-between gap-2",
        "py-2",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="min-w-0 flex items-center gap-2 flex-wrap">{left}</div>
      <div className="shrink-0 flex items-center gap-2">{right}</div>
    </div>
  );
}
