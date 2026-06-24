"use client";

import * as React from "react";
import { AppTooltip } from "@/components/ui/tooltip";

type HintWrapProps = {
  disabled: boolean;
  reason: string | null;
  children: React.ReactNode;
  className?: string;
};

/**
 * Disabled buttons often don't show tooltips consistently.
 * We avoid JSX tags entirely so VS Code cannot complain about JSX.IntrinsicElements.
 */
export function HintWrap({ disabled, reason, children, className }: HintWrapProps) {
  if (!disabled || !reason) {
    return React.createElement(React.Fragment, null, children);
  }

  return React.createElement(AppTooltip, { content: reason, className: className ?? "inline-flex" }, children);
}
