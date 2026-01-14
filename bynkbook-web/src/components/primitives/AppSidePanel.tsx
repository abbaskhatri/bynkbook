"use client";

import * as React from "react";
import { surfaceCardSoft, ringFocus } from "./tokens";

type PanelSize = "sm" | "md" | "lg";

type AppSidePanelProps = {
  open: boolean;
  title?: React.ReactNode;
  children: React.ReactNode;
  onClose?: () => void;
  footer?: React.ReactNode;

  /** Width tokens (default: md) */
  size?: PanelSize;

  /**
   * Legacy escape hatch. Prefer `size`.
   * If provided, it overrides `size`.
   */
  widthClassName?: string; // e.g., "w-[520px]"

  /**
   * Overlay click closes only when onClose exists.
   * If true, overlay click will NOT close (useful for sensitive flows).
   */
  disableOverlayClose?: boolean;
};

const panelWidthBySize: Record<PanelSize, string> = {
  sm: "w-[420px]",
  md: "w-[520px]",
  lg: "w-[640px]",
};

export function AppSidePanel({
  open,
  title,
  children,
  onClose,
  footer,
  size = "md",
  widthClassName,
  disableOverlayClose = false,
}: AppSidePanelProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Safe initial focus (no focus trap requirement yet)
  React.useEffect(() => {
    if (!open) return;
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

  const widthClass = widthClassName ?? (panelWidthBySize[size] ?? panelWidthBySize.md);

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

      <div className="absolute inset-0 flex items-stretch justify-end">
        <div
          ref={containerRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          className={[surfaceCardSoft, "h-full", widthClass, "flex flex-col"].join(" ")}
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
                aria-label="Close panel"
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
          ) : (
            <div className="shrink-0 px-4 py-3 border-t border-slate-200" />
          )}
        </div>
      </div>
    </div>
  );
}
