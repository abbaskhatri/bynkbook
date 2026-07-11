"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useId } from "react";
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
  const titleId = useId();

  const widthClass = widthClassName ?? (panelWidthBySize[size] ?? panelWidthBySize.md);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose?.(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-bb-overlay backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out data-[state=open]:fade-in" />
        <div className="pointer-events-none fixed inset-0 z-50 flex min-w-0 items-stretch justify-end overflow-hidden">
          <DialogPrimitive.Content
          aria-labelledby={titleId}
          onEscapeKeyDown={(event) => { if (!onClose) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (disableOverlayClose || !onClose) event.preventDefault(); }}
          className={[
            surfaceCardSoft,
            "pointer-events-auto",
            "h-full max-h-full w-full max-w-[calc(100vw-1rem)] rounded-none border-l border-bb-border bg-bb-dialog-bg shadow-[0_24px_80px_rgba(15,23,42,0.24)] dark:shadow-[0_28px_90px_rgba(0,0,0,0.48)]",
            "transition-transform duration-200 ease-out animate-in slide-in-from-right",
            widthClass,
            "flex min-h-0 flex-col overflow-hidden",
          ].join(" ")}
        >
          <div className="shrink-0 px-4 py-3 sm:px-5 sm:py-4 border-b border-bb-border-muted flex items-start justify-between gap-3 bg-bb-surface-card">
            <DialogPrimitive.Title id={titleId} className="min-w-0 text-sm font-semibold text-bb-text leading-6">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Side panel</DialogPrimitive.Description>

            {onClose ? (
              <button
                type="button"
                className={[
                  "h-8 w-8 inline-flex items-center justify-center rounded-md border border-bb-border bg-bb-surface-elevated text-bb-text-muted shadow-sm transition-colors duration-200",
                  "hover:bg-bb-table-row-hover hover:text-bb-text",
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

          {footer ? (
            <div className="min-w-0 shrink-0 overflow-x-hidden px-4 py-3 sm:px-5 sm:py-4 border-t border-bb-border-muted bg-bb-surface-soft">
              {footer}
            </div>
          ) : null}
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
