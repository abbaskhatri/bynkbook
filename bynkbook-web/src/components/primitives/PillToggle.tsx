"use client";

import * as React from "react";
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
        // thinner + more compact than before
        "relative inline-flex h-5 w-9 items-center rounded-full border transition-colors",
        checked ? "bg-primary/15 border-primary/25" : "bg-slate-200 border-slate-200",
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        ringFocus,
      ].join(" ")}
      title={title}
    >
      <span
        aria-hidden="true"
        className={[
          "absolute left-0.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0",
        ].join(" ")}
      />
    </button>
  );
}