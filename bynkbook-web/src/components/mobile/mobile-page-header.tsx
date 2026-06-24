import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, Landmark } from "lucide-react";

import { cn } from "@/lib/utils";

type MobilePageHeaderProps = {
  eyebrow: string;
  title: string;
  businessName?: string | null;
  accountName?: string | null;
  actionHref?: string;
  actionLabel?: string;
  action?: ReactNode;
  className?: string;
};

export function MobilePageHeader({
  eyebrow,
  title,
  businessName,
  accountName,
  actionHref,
  actionLabel,
  action,
  className,
}: MobilePageHeaderProps) {
  const actionNode =
    action ??
    (actionHref && actionLabel ? (
      <Link
        href={actionHref}
        prefetch={false}
        className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-bb-border bg-bb-surface-card px-3 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-bb-table-row-hover"
      >
        {actionLabel}
      </Link>
    ) : null);

  return (
    <section className={cn("px-1 pt-1", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {eyebrow}
          </div>
          <h1 className="mt-1 truncate text-2xl font-semibold leading-tight text-foreground">
            {title}
          </h1>
        </div>
        {actionNode}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
        {businessName ? (
          <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-bb-border bg-bb-surface-card/78 px-2 py-1 shadow-sm">
            <Building2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{businessName}</span>
          </span>
        ) : null}
        {accountName ? (
          <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-bb-border bg-bb-surface-card/78 px-2 py-1 shadow-sm">
            <Landmark className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{accountName}</span>
          </span>
        ) : null}
      </div>
    </section>
  );
}
