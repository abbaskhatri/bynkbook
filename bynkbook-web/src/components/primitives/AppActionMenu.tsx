"use client";

import * as React from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AppActionMenuItem = {
  label: string;
  description?: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
};

type AppActionMenuProps = {
  label?: string;
  title?: string;
  items: AppActionMenuItem[];
  align?: "left" | "right";
  className?: string;
};

export function AppActionMenu({
  label = "More",
  title,
  items,
  align = "right",
  className,
}: AppActionMenuProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        title={title ?? label}
        onClick={() => setOpen((next) => !next)}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
        <span>{label}</span>
      </Button>

      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute top-[calc(100%+6px)] z-50 w-64 overflow-hidden rounded-lg border border-bb-border bg-bb-surface-elevated p-1 shadow-lg",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={cn(
                  "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                  "hover:bg-bb-table-row-hover focus:bg-bb-table-row-hover focus:outline-none",
                  item.disabled && "cursor-not-allowed opacity-50",
                  item.danger && "text-bb-status-danger-fg"
                )}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {Icon ? <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : null}
                <span className="min-w-0">
                  <span className="block text-xs font-semibold leading-4">{item.label}</span>
                  {item.description ? (
                    <span className="mt-0.5 block text-[11px] leading-4 text-bb-text-muted">
                      {item.description}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
