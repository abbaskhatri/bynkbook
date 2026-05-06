"use client";

import type React from "react";
import { Building2 } from "lucide-react";

export function AccountingScopePills({
  businessName,
  businessLoading = false,
  accountControl,
}: {
  businessName?: string | null;
  businessLoading?: boolean;
  accountControl: React.ReactNode;
}) {
  const businessLabel = businessLoading ? "Loading..." : businessName || "Business";

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span
        title={`Business: ${businessLabel}`}
        className="inline-flex h-6 max-w-[14rem] items-center gap-1.5 rounded-lg border border-bb-border bg-bb-surface-card px-2 text-xs text-bb-text"
      >
        <Building2 className="h-3.5 w-3.5 shrink-0 text-bb-text-muted" />
        <span className="text-bb-text-muted">Business</span>
        <span className="min-w-0 truncate font-medium">{businessLabel}</span>
      </span>

      <div title="Account" className="min-w-0">
        {accountControl}
      </div>
    </div>
  );
}
