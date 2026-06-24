"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InlineBanner({
  title,
  message,
  onRetry,
  actionLabel,
  actionHref,
}: {
  title?: string;
  message: string | null;
  onRetry?: (() => void) | null;
  actionLabel?: string | null;
  actionHref?: string | null;
}) {
  if (!message) return null;

  return (
    <div className="rounded-lg border border-bb-status-danger-border bg-bb-status-danger-bg px-3 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bb-status-danger-fg" />
          <div className="min-w-0">
            {title ? <div className="text-sm font-semibold text-bb-status-danger-fg">{title}</div> : null}
            <div className="text-sm leading-5 text-bb-status-danger-fg">{message}</div>
          </div>
        </div>

        {(actionLabel && actionHref) || onRetry ? (
          <div className="flex shrink-0 items-center gap-2">
            {actionLabel && actionHref ? (
              <Button asChild variant="outline" size="sm">
                <Link href={actionHref}>{actionLabel}</Link>
              </Button>
            ) : null}

            {onRetry ? (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
