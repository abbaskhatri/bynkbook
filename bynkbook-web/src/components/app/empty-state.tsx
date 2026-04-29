"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export function EmptyStateCard({
  title,
  description,
  primary,
  secondary,
}: {
  title: string;
  description: string;
  primary: { label: string; href: string };
  secondary?: { label: string; onClick: () => void } | null;
}) {
  return (
    <div className="rounded-xl border border-bb-border bg-bb-surface-card shadow-sm p-4">
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-sm text-foreground/70">{description}</div>

      <div className="mt-3 flex items-center gap-2">
        <Button asChild className="h-7">
          <Link href={primary.href}>{primary.label}</Link>
        </Button>

        {secondary ? (
          <Button variant="outline" className="h-7" onClick={secondary.onClick}>
            {secondary.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
