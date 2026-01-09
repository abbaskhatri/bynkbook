import * as React from "react";
import { ringFocus } from "./tokens";

type ActiveAccountPillProps = {
  label: React.ReactNode;
  onClick?: () => void;
  rightIcon?: React.ReactNode;
  className?: string;
  title?: string;
};

export function ActiveAccountPill({
  label,
  onClick,
  rightIcon,
  className,
  title,
}: ActiveAccountPillProps) {
  const isButton = typeof onClick === "function";

  const base =
    "h-7 inline-flex items-center gap-2 px-2 rounded-full border border-slate-200 bg-white text-xs text-slate-900 " +
    ringFocus;

  if (isButton) {
    return (
      <button
        type="button"
        className={[base, "hover:bg-slate-50", className].filter(Boolean).join(" ")}
        onClick={onClick}
        title={title}
      >
        <span className="truncate max-w-[240px]">{label}</span>
        {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
      </button>
    );
  }

  return (
    <div className={[base, className].filter(Boolean).join(" ")} title={title}>
      <span className="truncate max-w-[240px]">{label}</span>
      {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
    </div>
  );
}
