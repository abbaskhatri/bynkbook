import * as React from "react";
import { surfaceCardSoft, ringFocus } from "./tokens";

type AppDialogProps = {
  open: boolean;
  title?: React.ReactNode;
  children: React.ReactNode;
  onClose?: () => void;
  footer?: React.ReactNode;
};

export function AppDialog({ open, title, children, onClose, footer }: AppDialogProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <div className={[surfaceCardSoft, "w-full max-w-lg"].join(" ")}>
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
                aria-label="Close dialog"
              >
                ✕
              </button>
            ) : null}
          </div>

          <div className="px-4 py-3">{children}</div>

          {footer ? (
            <div className="px-4 py-3 border-t border-slate-200">{footer}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
