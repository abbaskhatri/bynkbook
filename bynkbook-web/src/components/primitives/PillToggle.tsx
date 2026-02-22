"use client";

import * as React from "react";
import { ringFocus } from "./tokens";

export type PillToggleProps = {
  label?: React.ReactNode;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  id?: string;
};

export function PillToggle({ label, checked, onCheckedChange, disabled = false, id }: PillToggleProps) {
  return (
    <div className="flex items-center gap-2">
      {label ? (
        <label
          htmlFor={id}
          className={[
            "text-xs select-none",
            disabled ? "text-slate-400" : "text-slate-700",
          ].join(" ")}
        >
          {label}
        </label>
      ) : null}

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
          "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
          checked ? "bg-violet-600 border-violet-600" : "bg-slate-200 border-slate-200",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          ringFocus,
        ].join(" ")}
        title={typeof label === "string" ? label : undefined}
      >
        <span
          aria-hidden="true"
          className={[
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-1",
          ].join(" ")}
        />
      </button>
    </div>
  );
}