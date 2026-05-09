"use client";

import type React from "react";

export function AccountingScopePills({
  accountControl,
}: {
  businessName?: string | null;
  businessLoading?: boolean;
  accountControl: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <div title="Account scope" className="min-w-0">
        {accountControl}
      </div>
    </div>
  );
}
