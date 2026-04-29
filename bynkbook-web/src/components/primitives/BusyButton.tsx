"use client";

import * as React from "react";
import { ringFocus } from "./tokens";

type BusyButtonVariant = "primary" | "secondary" | "danger";
type BusyButtonSize = "sm" | "md";

export type BusyButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> & {
  busy?: boolean;
  busyLabel?: React.ReactNode;
  variant?: BusyButtonVariant;
  size?: BusyButtonSize;
  disabled?: boolean;
};

function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={[
        "inline-block animate-spin rounded-full border border-current border-t-transparent",
        className,
      ].join(" ")}
    />
  );
}

const sizeClass: Record<BusyButtonSize, string> = {
  sm: "h-7 px-2 text-xs",
  md: "h-8 px-3 text-xs",
};

const variantClass: Record<BusyButtonVariant, string> = {
  primary:
    "border-primary/20 bg-primary/10 text-primary hover:bg-primary/15",
  secondary:
    "border-bb-border bg-bb-surface-card text-bb-text hover:bg-bb-table-row-hover disabled:bg-bb-surface-card",
  danger:
    "border-bb-status-danger-border bg-bb-status-danger-bg text-bb-status-danger-fg hover:bg-bb-status-danger-bg disabled:bg-bb-status-danger-bg",
};

export function BusyButton({
  busy = false,
  busyLabel,
  variant = "secondary",
  size = "md",
  className = "",
  disabled = false,
  children,
  ...props
}: BusyButtonProps) {
  const isDisabled = disabled || busy;

  return (
    <button
      type={props.type ?? "button"}
      {...props}
      disabled={isDisabled}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-md border",
        sizeClass[size],
        variantClass[variant],
        "disabled:opacity-50 disabled:cursor-not-allowed",
        ringFocus,
        className,
      ].join(" ")}
    >
      {busy ? (
        <>
          <Spinner className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
          <span>{busyLabel ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
