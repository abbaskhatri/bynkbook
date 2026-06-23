import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

type MobileTaskCardProps = {
  title: string;
  description: string;
  href?: string;
  metric?: string;
  icon?: ReactNode;
  tone?: "neutral" | "warning" | "danger";
  disabled?: boolean;
};

const toneClasses = {
  neutral: "mobile-token-card",
  warning: "mobile-token-card mobile-token-card--warning",
  danger: "mobile-token-card mobile-token-card--danger",
};

export function MobileTaskCard({
  title,
  description,
  href,
  metric,
  icon,
  tone = "neutral",
  disabled = false,
}: MobileTaskCardProps) {
  const content = (
    <div
      className={cn(
        "flex min-h-[84px] items-center gap-3 rounded-md border p-3.5 text-card-foreground shadow-sm",
        toneClasses[tone],
        disabled ? "opacity-60" : "transition-colors hover:bg-muted/50"
      )}
    >
      {icon ? (
        <div className="mobile-token-card-control inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border text-muted-foreground">
          {icon}
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 text-[15px] font-semibold leading-5 text-card-foreground">{title}</div>
          {metric ? (
            <span className="mobile-token-card-control shrink-0 rounded-md border px-2 py-1 text-xs font-semibold tabular-nums text-card-foreground">
              {metric}
            </span>
          ) : null}
        </div>
        <div className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">{description}</div>
      </div>

      {disabled ? null : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </div>
  );

  if (disabled || !href) return content;

  return (
    <Link href={href} prefetch={false} className="block">
      {content}
    </Link>
  );
}
