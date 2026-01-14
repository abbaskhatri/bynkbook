"use client";

import * as React from "react";
import { surfaceCardSoft, ringFocus } from "./tokens";

type AppDialogSize = "sm" | "md" | "lg" | "xl";

type AppDialogProps = {
  open: boolean;
  title?: React.ReactNode;
  children: React.ReactNode;
  onClose?: () => void;
  footer?: React.ReactNode;

  /** Sizing tokens (default: md) */
  size?: AppDialogSize;

  /**
   * Overlay click closes only when onClose exists.
   * If true, overlay click will NOT close (useful for sensitive flows).
   */
  disableOverlayClose?: boolean;
};

const dialogWidthBySize: Record<AppDialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function AppDialog({
  open,
  title,
  children,
  onClose,
  footer,
  size = "md",
  disableOverlayClose = false,
}: AppDialogProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Safe initial focus (no focus trap requirement yet)
  React.useEffect(() => {
    if (!open) return;
    // Defer to ensure element exists in DOM
    const t = window.setTimeout(() => {
      containerRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // ESC closes only if onClose exists
  React.useEffect(() => {
    if (!open) return;
    if (!onClose) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const widthClass = dialogWidthBySize[size] ?? dialogWidthBySize.md;

  const handleOverlayClick = () => {
    if (!onClose) return;
    if (disableOverlayClose) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={handleOverlayClick}
        aria-hidden="true"
      />

      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div
          ref={containerRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          className={[
            surfaceCardSoft,
            "w-full",
            widthClass,
            "max-h-[85vh] flex flex-col",
          ].join(" ")}
        >
          {/* Header (fixed) */}
          <div className="shrink-0 px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900 truncate">
              {title}
            </div>

            {onClose ? (
              <button
                type="button"
                className={[
                  "h-7 w-8 inline-flex items-center justify-center rounded-md border border-slate-200 bg-white",
                  ringFocus,
                ].join(" ")}
                onClick={onClose}
                aria-label="Close dialog"
              >
                ✕
              </button>
            ) : null}
          </div>

          {/* Body (scroll only here) */}
          <div className="flex-1 overflow-auto px-4 py-3">{children}</div>

          {/* Footer (fixed) */}
          {footer ? (
            <div className="shrink-0 px-4 py-3 border-t border-slate-200">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
