"use client";

import * as React from "react";

export type DialogFooterProps = {
  /** Left side content (e.g., toggle, helper text) */
  left?: React.ReactNode;
  /** Right side actions (e.g., Cancel + Submit) */
  right?: React.ReactNode;
};

export function DialogFooter({ left, right }: DialogFooterProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2">{left}</div>
      <div className="shrink-0 flex items-center gap-2">{right}</div>
    </div>
  );
}