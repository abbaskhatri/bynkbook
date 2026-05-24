"use client";

import Link from "next/link";
import { AlertTriangle, Building2, Landmark } from "lucide-react";

import { InlineBanner } from "@/components/app/inline-banner";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { Skeleton } from "@/components/ui/skeleton";
import {
  hrefWithMobileContext,
  useMobileWorkspaceContext,
} from "@/lib/mobile/workspaceContext";
import { useMobileOpenIssues } from "@/lib/mobile/reviewQueues";
import type { EntryIssueRow } from "@/lib/api/issues";

import { formatUsd } from "@/lib/money";

function formatUsdFromCents(value: string | number | bigint | null | undefined) {
  if (value === null || value === undefined || value === "") return "Amount unavailable";
  try {
    return formatUsd(BigInt(String(value)));
  } catch {
    return "Amount unavailable";
  }
}

function labelize(raw: string | null | undefined) {
  const s = String(raw ?? "").replace(/_/g, " ").toLowerCase();
  return s.replace(/\b\w/g, (c) => c.toUpperCase()) || "Issue";
}

function issueExplanation(issue: EntryIssueRow) {
  const details = String(issue.details ?? "").trim();
  if (details) return details;

  const type = String(issue.issue_type ?? "").toUpperCase();
  if (type === "DUPLICATE") return "This entry may overlap another entry and should be reviewed on the full issue page.";
  if (type === "STALE_CHECK") return "This check appears stale and may need follow-up on the full issue page.";
  return "This issue needs review on the full issue page.";
}

export default function MobileIssuesPageClient() {
  const {
    businessesQ,
    accountsQ,
    business,
    businessId,
    account,
    accountId,
    contextError,
    contextReady,
    isLoading: contextLoading,
  } = useMobileWorkspaceContext();
  const issuesQueue = useMobileOpenIssues({
    businessId,
    accountId,
    enabled: contextReady,
  });
  const issuesQ = issuesQueue.query;
  const issues = issuesQueue.rows;

  const reviewHref = hrefWithMobileContext({ path: "/mobile/review", businessId, accountId });
  const desktopHref = hrefWithMobileContext({ path: "/issues", businessId, accountId });

  const bannerMessage =
    businessesQ.error || accountsQ.error
      ? "Issues review could not load workspace context."
      : issuesQ.error
        ? "Issue cards could not refresh. Existing desktop pages are unchanged."
        : null;

  if (contextLoading) {
    return (
      <MobileShell businessId={businessId} accountId={accountId}>
        <div className="space-y-4">
          <section className="rounded-md border border-border bg-card p-4 shadow-sm">
            <Skeleton className="h-5 w-40 rounded-md" />
            <Skeleton className="mt-3 h-8 w-28 rounded-md" />
            <Skeleton className="mt-3 h-7 w-full rounded-md" />
          </section>
          <Skeleton className="h-[176px] w-full rounded-md" />
          <Skeleton className="h-[176px] w-full rounded-md" />
        </div>
      </MobileShell>
    );
  }

  if (contextError) {
    return (
      <MobileShell businessId={businessId} accountId={accountId}>
        <InlineBanner
          title="Mobile context unavailable"
          message={contextError instanceof Error ? contextError.message : "Could not resolve a mobile business and account."}
        />
      </MobileShell>
    );
  }

  return (
    <MobileShell businessId={businessId} accountId={accountId}>
      <div className="space-y-4">
        <section className="rounded-md border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Mobile review
              </div>
              <h1 className="mt-2 truncate text-2xl font-semibold leading-tight text-foreground">
                Issues
              </h1>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{business?.name ?? "Business"}</span>
                </span>
                <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-1">
                  <Landmark className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{account?.name ?? "No active account"}</span>
                </span>
              </div>
            </div>
            <Link
              href={reviewHref}
              prefetch={false}
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted/50"
            >
              Queue
            </Link>
          </div>
        </section>

        {bannerMessage ? <InlineBanner title="Issues review is partially unavailable" message={bannerMessage} /> : null}

        <section className="rounded-md border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Open issue cards</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {issues.length > 0
                  ? `Showing ${issues.length} open duplicate or stale-check issues for this account.`
                  : "Loaded the same account-scoped open issue filter used by Review."}
              </div>
            </div>
            <Link
              href={desktopHref}
              prefetch={false}
              className="inline-flex h-10 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted/50"
            >
              Desktop
            </Link>
          </div>
        </section>

        <section className="space-y-3">
          {issuesQ.isLoading ? (
            <>
              <Skeleton className="h-[176px] w-full rounded-md" />
              <Skeleton className="h-[176px] w-full rounded-md" />
              <Skeleton className="h-[176px] w-full rounded-md" />
            </>
          ) : !accountId ? (
            <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground shadow-sm">
              Select an active account to view open issues.
            </div>
          ) : issues.length === 0 ? (
            <div className="rounded-md border border-bb-status-success-border bg-bb-status-success-bg p-4 text-sm text-bb-status-success-fg shadow-sm">
              No duplicate or stale-check issues found in the loaded mobile slice.
            </div>
          ) : (
            issues.map((issue) => {
              const amount = formatUsdFromCents(issue.entry_amount_cents);
              const isNegative = String(issue.entry_amount_cents ?? "").startsWith("-");
              return (
                <article
                  key={issue.id}
                  className="rounded-md border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-2 rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-2 py-1 text-xs font-semibold text-bb-status-warning-fg">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {labelize(issue.issue_type)}
                      </div>
                      <h2 className="mt-3 truncate text-base font-semibold text-foreground">
                        {issue.entry_payee || "Entry unavailable"}
                      </h2>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {issue.entry_date || "No date"}
                      </div>
                    </div>
                    <div
                      className={`shrink-0 text-right text-base font-semibold tabular-nums ${
                        isNegative ? "text-bb-amount-negative" : "text-bb-amount-neutral"
                      }`}
                    >
                      {amount}
                    </div>
                  </div>

                  <div className="mt-4 rounded-md border border-border bg-muted/50 p-3 text-sm leading-5 text-foreground">
                    {issueExplanation(issue)}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-2 py-1 font-medium text-bb-status-warning-fg">
                      Severity: {labelize(issue.severity || "warning")}
                    </span>
                    <span className="rounded-md border border-border bg-card px-2 py-1 font-medium text-foreground">
                      Status: {labelize(issue.status)}
                    </span>
                    {issue.entry_method ? (
                      <span className="rounded-md border border-border bg-card px-2 py-1 font-medium text-foreground">
                        Method: {labelize(issue.entry_method)}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4">
                    <Link
                      href={desktopHref}
                      prefetch={false}
                      className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted/50"
                    >
                      Open full issue page
                    </Link>
                  </div>
                </article>
              );
            })
          )}

        </section>
      </div>
    </MobileShell>
  );
}
