"use client";

export function Pill({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center h-6 px-3 rounded-full border bg-muted text-sm leading-none max-w-[320px]"
      style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
    >
      {children}
    </span>
  );
}
