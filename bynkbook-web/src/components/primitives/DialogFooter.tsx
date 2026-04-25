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
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0 flex flex-wrap items-center gap-2">{left}</div>
      <div className="min-w-0 flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
        {right}
      </div>
    </div>
  );
}
