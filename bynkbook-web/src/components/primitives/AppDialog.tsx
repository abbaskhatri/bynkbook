"use client";

import * as React from "react";
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
};

const dialogWidthBySize: Record<AppDialogSize, string> = {
  xs: "sm:min-w-[22rem] max-w-[24rem]",
  sm: "sm:min-w-[24rem] max-w-[28rem]",
  md: "sm:min-w-[28rem] max-w-[34rem]",
  lg: "sm:min-w-[34rem] max-w-[42rem]",
  xl: "sm:min-w-[42rem] max-w-[56rem]",
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
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px] transition-opacity duration-200"
        onClick={handleOverlayClick}
        aria-hidden="true"
      />

      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-x-hidden">
        <div
          ref={containerRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          className={[
            surfaceCardSoft,
            "w-auto min-w-0 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-slate-200/90 bg-white shadow-2xl",
            "max-h-[85vh] flex flex-col overflow-hidden",
            "transition-all duration-200 ease-out",
            "animate-in fade-in zoom-in-95",
            widthClass,
          ].join(" ")}
        >
          <div className="shrink-0 px-3.5 py-2.5 border-b border-slate-200/80 flex items-start justify-between gap-3 bg-white/95">
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
                aria-label="Close dialog"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden px-3.5 py-2.5">{children}</div>

          {footer ? (
            <div className="shrink-0 px-3.5 py-2.5 border-t border-slate-200/80 bg-slate-50/70">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
