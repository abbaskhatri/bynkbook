"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyStateCard({
  title,
  description,
  primary,
  secondary,
}: {
  title: string;
  description: string;
  primary: { label: string; href: string } | { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void } | null;
}) {
  return (
    <div className="rounded-lg border border-dashed border-bb-border bg-bb-surface-card/90 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-sm leading-5 text-foreground/70">{description}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 pl-11">
        {"href" in primary ? (
          <Button asChild size="sm">
            <Link href={primary.href}>{primary.label}</Link>
          </Button>
        ) : (
          <Button size="sm" onClick={primary.onClick}>
            {primary.label}
          </Button>
        )}

        {secondary ? (
          <Button variant="outline" size="sm" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
