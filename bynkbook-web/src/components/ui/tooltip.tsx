"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

type TooltipSide = "top" | "right" | "bottom" | "left";

type AppTooltipProps = {
  content?: React.ReactNode;
  children?: React.ReactNode;
  side?: TooltipSide;
  disabled?: boolean;
  className?: string;
  contentClassName?: string;
  delayMs?: number;
};

const OFFSET = 8;

function positionTooltip(rect: DOMRect, side: TooltipSide) {
  if (side === "right") {
    return {
      left: rect.right + OFFSET,
      top: rect.top + rect.height / 2,
      transform: "translateY(-50%)",
    };
  }

  if (side === "bottom") {
    return {
      left: rect.left + rect.width / 2,
      top: rect.bottom + OFFSET,
      transform: "translateX(-50%)",
    };
  }

  if (side === "left") {
    return {
      left: rect.left - OFFSET,
      top: rect.top + rect.height / 2,
      transform: "translate(-100%, -50%)",
    };
  }

  return {
    left: rect.left + rect.width / 2,
    top: rect.top - OFFSET,
    transform: "translate(-50%, -100%)",
  };
}

export function AppTooltip({
  content,
  children,
  side = "top",
  disabled = false,
  className,
  contentClassName,
  delayMs = 180,
}: AppTooltipProps) {
  const id = React.useId();
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const timerRef = React.useRef<number | null>(null);
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<React.CSSProperties | null>(null);
  const hasContent = !disabled && content !== undefined && content !== null && content !== "";

  const close = React.useCallback(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setOpen(false);
  }, []);

  const updatePosition = React.useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords(positionTooltip(rect, side));
  }, [side]);

  const openWithDelay = React.useCallback(() => {
    if (!hasContent) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      updatePosition();
      setOpen(true);
    }, delayMs);
  }, [delayMs, hasContent, updatePosition]);

  const openNow = React.useCallback(() => {
    if (!hasContent) return;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    updatePosition();
    setOpen(true);
  }, [hasContent, updatePosition]);

  React.useEffect(() => close, [close]);

  React.useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  return (
    <span
      ref={ref}
      className={cn("inline-flex min-w-0", className)}
      aria-describedby={open ? id : undefined}
      onPointerEnter={openWithDelay}
      onPointerLeave={close}
      onFocusCapture={openNow}
      onBlurCapture={close}
    >
      {children}
      {open && hasContent && coords && typeof document !== "undefined"
        ? createPortal(
            <div
              id={id}
              role="tooltip"
              style={coords}
              className={cn(
                "fixed z-[10000] max-w-[18rem] rounded-md border border-bb-border bg-bb-surface-elevated px-2.5 py-1.5 text-[11px] font-medium leading-4 text-bb-text shadow-[0_14px_34px_rgba(15,23,42,0.22)] dark:shadow-[0_18px_42px_rgba(0,0,0,0.45)]",
                "pointer-events-none whitespace-normal break-words",
                contentClassName,
              )}
            >
              {content}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
