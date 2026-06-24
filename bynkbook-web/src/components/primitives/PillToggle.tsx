"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { ringFocus } from "./tokens";

export type PillToggleProps = {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
  title?: string;
};

export function PillToggle({ checked, onCheckedChange, disabled = false, id, title }: PillToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onCheckedChange(!checked);
      }}
      className={[
        "relative inline-flex h-5 w-9 items-center rounded-full border transition-all shadow-inner",
        checked ? "bg-primary border-primary" : "bg-bb-surface-soft border-bb-input-border hover:bg-bb-table-row-hover",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        ringFocus,
      ].join(" ")}
      title={title}
    >
      <span
        aria-hidden="true"
        className={[
          "absolute left-0.5 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded-full bg-bb-surface-elevated shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0",
        ].join(" ")}
      >
        {checked ? <Check className="h-2.5 w-2.5 text-primary" /> : null}
      </span>
    </button>
  );
}
