"use client";

import * as React from "react";
import { useId } from "react";
import { X } from "lucide-react";
import { surfaceCardSoft, ringFocus } from "./tokens";

type AppDialogSize = "xs" | "sm" | "md" | "lg" | "xl";

type AppDialogProps = {
  open: boolean;
  title?: React.ReactNode;
  children: React.ReactNode;
  onClose?: () => void;
  footer?: React.ReactNode;
  size?: AppDialogSize;
  disableOverlayClose?: boolean;
  bodyClassName?: string;
};

const dialogWidthBySize: Record<AppDialogSize, string> = {
  xs: "sm:min-w-[22rem] sm:max-w-[24rem]",
  sm: "sm:min-w-[24rem] sm:max-w-[28rem]",
  md: "sm:min-w-[28rem] sm:max-w-[34rem]",
  lg: "sm:min-w-[34rem] sm:max-w-[42rem]",
  xl: "sm:min-w-[42rem] sm:max-w-[56rem]",
};

export function AppDialog({
  open,
  title,
  children,
  onClose,
  footer,
  size = "md",
  disableOverlayClose = false,
  bodyClassName,
}: AppDialogProps) {
  const titleId = useId();
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      containerRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  React.useEffect(() => {
    if (!open || !onClose) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const widthClass = dialogWidthBySize[size] ?? dialogWidthBySize.md;

  const handleOverlayClick = () => {
    if (!onClose || disableOverlayClose) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-x-hidden">
      <div
        className="absolute inset-0 bg-bb-overlay backdrop-blur-[2px] transition-opacity duration-200"
        onClick={handleOverlayClick}
        aria-hidden="true"
      />

      <div className="absolute inset-0 flex items-end justify-center overflow-x-hidden p-0 sm:items-center sm:p-4">
        <div
          ref={containerRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          className={[
            surfaceCardSoft,
            "w-full min-w-0 max-w-full sm:w-auto sm:max-w-[calc(100vw-2rem)] rounded-t-lg sm:rounded-lg border border-bb-border bg-bb-dialog-bg shadow-[0_24px_80px_rgba(15,23,42,0.24)]",
            "max-h-[calc(100dvh-0.75rem)] sm:max-h-[85vh] flex min-h-0 flex-col overflow-hidden",
            "transition-all duration-200 ease-out",
            "animate-in fade-in slide-in-from-bottom-4 sm:zoom-in-95 sm:slide-in-from-bottom-0",
            widthClass,
          ].join(" ")}
        >
          <div className="shrink-0 px-4 py-3 border-b border-bb-border-muted flex items-start justify-between gap-3 bg-bb-surface-card">
            <div id={titleId} className="min-w-0 text-base sm:text-sm font-semibold text-bb-text leading-6">
              {title}
            </div>

            {onClose ? (
              <button
                type="button"
                className={[
                  "h-8 w-8 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-elevated text-bb-text-muted shadow-sm transition-colors duration-200",
                  "hover:bg-bb-table-row-hover hover:text-bb-text",
                  ringFocus,
                ].join(" ")}
                onClick={onClose}
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div
            className={[
              "min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3 sm:overflow-x-auto sm:px-3.5 sm:py-2.5",
              bodyClassName,
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {children}
          </div>

          {footer ? (
            <div className="min-w-0 shrink-0 px-4 py-3 border-t border-bb-border-muted bg-bb-surface-soft [&>div]:flex-wrap [&>div]:gap-2 [&_button]:min-h-8 [&_button]:shrink-0 sm:px-3.5 sm:py-2.5">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
