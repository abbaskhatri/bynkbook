"use client";

export function Pill({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center h-6 max-w-[320px] rounded-md border border-bb-border bg-bb-surface-card px-2.5 text-xs font-semibold leading-none text-bb-text shadow-sm"
      style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
    >
      {children}
    </span>
  );
}
