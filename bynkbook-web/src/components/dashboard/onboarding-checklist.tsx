"use client";

// First-time setup checklist. Renders at the top of the dashboard for
// businesses that haven't completed the basic onboarding steps. Auto-hides
// when:
//   1. The user clicks "Skip setup" (persisted per businessId via localStorage)
//   2. All steps are complete
//
// The component reads completion state from data the dashboard already
// loads (accounts, categories, entries) — it does not issue any new
// API requests of its own.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { AppTooltip } from "@/components/ui/tooltip";
import { Check, Circle, Sparkles, X } from "lucide-react";

export type OnboardingChecklistProps = {
  businessId: string;
  accountsCount: number;
  categoriesCount: number;
  hasEntries: boolean;
};

function dismissKey(businessId: string) {
  return `bynkbook.onboarding.dismissed.${businessId}`;
}

export function OnboardingChecklist({
  businessId,
  accountsCount,
  categoriesCount,
  hasEntries,
}: OnboardingChecklistProps) {
  // Defer reading localStorage until after mount to keep SSR/client output identical.
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!businessId) return;
    try {
      setDismissed(window.localStorage.getItem(dismissKey(businessId)) === "1");
    } catch {
      /* localStorage unavailable; treat as not dismissed */
    }
  }, [businessId]);

  function handleDismiss() {
    if (!businessId) {
      setDismissed(true);
      return;
    }
    try {
      window.localStorage.setItem(dismissKey(businessId), "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  const steps = useMemo(() => {
    const bizQs = `?businessId=${encodeURIComponent(businessId)}`;
    return [
      {
        key: "biz",
        label: "Created business",
        done: true, // they're seeing the dashboard, so this is implicit
        href: null,
      },
      {
        key: "account",
        label: "Add or connect an account",
        done: accountsCount > 0,
        href: `/settings${bizQs}&tab=accounts`,
      },
      {
        key: "categories",
        label: "Set up categories",
        done: categoriesCount > 0,
        href: `/settings${bizQs}&tab=bookkeeping`,
      },
      {
        key: "transactions",
        label: "Import or add transactions",
        done: hasEntries,
        href: `/ledger${bizQs}`,
      },
    ] as const;
  }, [businessId, accountsCount, categoriesCount, hasEntries]);

  const allDone = steps.every((s) => s.done);
  const completedCount = steps.filter((s) => s.done).length;

  // Don't render anything until mounted (avoid SSR/client hydration mismatch).
  if (!mounted) return null;
  if (dismissed) return null;
  // If everything is already done before they see this, nothing to show.
  if (allDone) return null;
  if (!businessId) return null;

  return (
    <Card className="rounded-xl border border-bb-border bg-bb-surface-card shadow-sm overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-bb-status-success-bg shrink-0">
              <Sparkles className="h-5 w-5 text-bb-status-success-fg" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Welcome to BynkBook</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                {completedCount} of {steps.length} setup steps complete
              </div>
            </div>
          </div>

          <AppTooltip content="Hide this checklist for this business. You can still complete setup from each page." side="left">
            <button
              type="button"
              className="h-7 inline-flex items-center gap-1 px-2 text-[11px] rounded-md border border-bb-border text-foreground/70 hover:bg-bb-table-row-hover"
              onClick={handleDismiss}
              aria-label="Skip setup"
            >
              <X className="h-3 w-3" />
              Skip setup
            </button>
          </AppTooltip>
        </div>

        <ul className="mt-3 space-y-1.5">
          {steps.map((step) => (
            <li
              key={step.key}
              className="flex items-center justify-between gap-3 rounded-md border border-bb-border-muted bg-bb-surface-soft px-2.5 py-1.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                {step.done ? (
                  <Check className="h-4 w-4 text-bb-amount-positive shrink-0" aria-label="Complete" />
                ) : (
                  <Circle className="h-4 w-4 text-bb-text-subtle shrink-0" aria-label="Not started" />
                )}
                <span
                  className={
                    step.done
                      ? "text-xs text-foreground/70 line-through"
                      : "text-xs text-foreground"
                  }
                >
                  {step.label}
                </span>
              </div>

              {!step.done && step.href ? (
                <Link
                  href={step.href}
                  className="text-[11px] font-medium text-primary hover:underline shrink-0"
                >
                  Go →
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
