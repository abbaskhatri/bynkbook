"use client";

import * as React from "react";
import { X } from "lucide-react";
import { surfaceCardSoft, ringFocus } from "./tokens";

type PanelSize = "sm" | "md" | "lg";

type AppSidePanelProps = {
  open: boolean;
  title?: React.ReactNode;
  children: React.ReactNode;
  onClose?: () => void;
  footer?: React.ReactNode;
  size?: PanelSize;
  widthClassName?: string;
  disableOverlayClose?: boolean;
};

const panelWidthBySize: Record<PanelSize, string> = {
  sm: "sm:w-[400px]",
  md: "sm:w-[500px]",
  lg: "sm:w-[600px]",
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

  const widthClass = widthClassName ?? (panelWidthBySize[size] ?? panelWidthBySize.md);

  const handleOverlayClick = () => {
    if (!onClose || disableOverlayClose) return;
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px] transition-opacity duration-200"
        onClick={handleOverlayClick}
        aria-hidden="true"
      />

      <div className="absolute inset-0 flex min-w-0 items-stretch justify-end overflow-hidden">
        <div
          ref={containerRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          className={[
            surfaceCardSoft,
            "h-full max-h-full w-full max-w-[calc(100vw-1rem)] rounded-none border-l border-slate-200/90 bg-white shadow-2xl",
            "transition-transform duration-200 ease-out animate-in slide-in-from-right",
            widthClass,
            "flex min-h-0 flex-col overflow-hidden",
          ].join(" ")}
        >
          <div className="shrink-0 px-4 py-3 sm:px-5 sm:py-4 border-b border-slate-200/80 flex items-start justify-between gap-3 bg-white/95">
            <div className="min-w-0 text-sm font-semibold text-slate-900 leading-6">
              {title}
            </div>

            {onClose ? (
              <button
                type="button"
                className={[
                  "h-8 w-8 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors duration-200",
                  "hover:bg-slate-50 hover:text-slate-800",
                  ringFocus,
                ].join(" ")}
                onClick={onClose}
                aria-label="Close panel"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-3 sm:px-5 sm:py-4">{children}</div>

          <div className="min-w-0 shrink-0 overflow-x-hidden px-4 py-3 sm:px-5 sm:py-4 border-t border-slate-200/80 bg-slate-50/70">
            {footer ?? null}
          </div>
        </div>
      </div>
    </div>
  );
}
