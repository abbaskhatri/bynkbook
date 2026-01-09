import * as React from "react";
import { surfaceCardSoft, ringFocus } from "./tokens";

type AppSidePanelProps = {
  open: boolean;
  title?: React.ReactNode;
  children: React.ReactNode;
  onClose?: () => void;
  footer?: React.ReactNode;
  widthClassName?: string; // e.g., "w-[520px]"
};

export function AppSidePanel({
  open,
  title,
  children,
  onClose,
  footer,
  widthClassName = "w-[520px]",
}: AppSidePanelProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-stretch justify-end">
        <div className={[surfaceCardSoft, "h-full", widthClassName].join(" ")}>
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900 truncate">{title}</div>
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

          <div className="px-4 py-3 overflow-auto h-[calc(100%-56px-56px)]">
            {children}
          </div>

          {footer ? (
            <div className="px-4 py-3 border-t border-slate-200">{footer}</div>
          ) : (
            <div className="px-4 py-3 border-t border-slate-200" />
          )}
        </div>
      </div>
    </div>
  );
}
