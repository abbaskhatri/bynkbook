"use client";

import Link from "next/link";
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
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          {title ? <div className="text-sm font-semibold text-rose-900">{title}</div> : null}
          <div className="text-sm text-rose-800">{message}</div>
        </div>

        {(actionLabel && actionHref) || onRetry ? (
          <div className="flex items-center gap-2">
            {actionLabel && actionHref ? (
              <Button asChild variant="outline" className="h-7">
                <Link href={actionHref}>{actionLabel}</Link>
              </Button>
            ) : null}

            {onRetry ? (
              <Button variant="outline" className="h-7" onClick={onRetry}>
                Retry
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
