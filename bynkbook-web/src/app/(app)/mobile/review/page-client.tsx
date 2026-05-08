"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Building2,
  FileText,
  Landmark,
  ReceiptText,
  Tags,
  Users,
} from "lucide-react";

import { InlineBanner } from "@/components/app/inline-banner";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { MobileTaskCard } from "@/components/mobile/mobile-task-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getActivity } from "@/lib/api/activity";
import { getVendorsApSummary } from "@/lib/api/ap";
import { getAttentionSummary } from "@/lib/api/attentionSummary";
import { attentionSummaryKey } from "@/lib/queries/attentionSummary";
import {
  hrefWithMobileContext,
  useMobileWorkspaceContext,
} from "@/lib/mobile/workspaceContext";
import {
  useMobileOpenIssues,
  useMobileUncategorizedEntries,
} from "@/lib/mobile/reviewQueues";
import { useIdleReady } from "@/lib/useIdleReady";

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function firstOfMonthYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function formatUsdFromCents(value: string | number | bigint | null | undefined) {
  let cents: bigint;
  try {
    cents = BigInt(String(value ?? "0"));
  } catch {
    return "$0.00";
  }

  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const dollars = abs / 100n;
  const pennies = abs % 100n;
  const core = `$${dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${pennies
    .toString()
    .padStart(2, "0")}`;

  return negative ? `(${core})` : core;
}

function formatEvent(raw: string) {
  const s = String(raw || "").replace(/_/g, " ").toLowerCase();
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MobileReviewPageClient() {
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

  const range = useMemo(() => ({ from: firstOfMonthYmd(), to: todayYmd() }), []);
  const enabled = !!businessId && !contextError;
  const accountEnabled = contextReady;
  const secondaryReady = useIdleReady(enabled, 1200);
  const uncategorizedQueue = useMobileUncategorizedEntries({
    businessId,
    accountId,
    enabled: contextReady,
  });
  const issuesQueue = useMobileOpenIssues({
    businessId,
    accountId,
    enabled: contextReady,
  });

  const attentionSummaryQ = useQuery({
    queryKey: attentionSummaryKey(businessId, accountId),
    queryFn: () =>
      getAttentionSummary({
        businessId: businessId as string,
        accountId: accountId as string,
      }),
    enabled: accountEnabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const apSummaryQ = useQuery({
    queryKey: ["mobileReview", "apSummary", businessId, range.to],
    queryFn: () => getVendorsApSummary({ businessId: businessId as string, asOf: range.to, limit: 200 }),
    enabled: secondaryReady,
    staleTime: 45_000,
    placeholderData: (prev) => prev,
  });

  const activityQ = useQuery({
    queryKey: ["mobileReview", "activity", businessId, accountId ?? "all"],
    queryFn: () =>
      getActivity(businessId as string, {
        limit: 1,
        accountId: accountId ?? undefined,
      }),
    enabled: secondaryReady,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const uncategorizedCount = uncategorizedQueue.rows.length;
  const openIssues = issuesQueue.rows.length;
  const bankUnmatchedCount = Number(attentionSummaryQ.data?.bank_unmatched_count ?? 0) || 0;
  const apVendors = apSummaryQ.data?.vendors ?? [];
  const apOpenVendorCount = apVendors.filter((vendor) => {
    try {
      return BigInt(String(vendor.total_open_cents ?? "0")) > 0n;
    } catch {
      return false;
    }
  }).length;

  const apTotalOpenCents = useMemo(() => {
    let total = 0n;
    for (const vendor of apVendors) {
      try {
        total += BigInt(String(vendor.total_open_cents ?? "0"));
      } catch {}
    }
    return total.toString();
  }, [apVendors]);

  const lastActivity = activityQ.data?.items?.[0] ?? null;
  const uncategorizedHref = hrefWithMobileContext({ path: "/mobile/uncategorized", businessId, accountId });
  const issuesHref = hrefWithMobileContext({ path: "/mobile/issues", businessId, accountId });
  const reconcileHref = hrefWithMobileContext({ path: "/reconcile", businessId, accountId });
  const receiptHref = hrefWithMobileContext({ path: "/mobile/receipt", businessId, accountId });
  const invoiceHref = hrefWithMobileContext({ path: "/mobile/invoice", businessId, accountId });
  const vendorsHref = hrefWithMobileContext({ path: "/mobile/vendors", businessId, accountId });
  const activityHref = businessId ? `/settings?businessId=${businessId}&tab=activity` : "/settings?tab=activity";
  const homeHref = hrefWithMobileContext({ path: "/mobile", businessId, accountId });

  const bannerMessage =
    businessesQ.error || accountsQ.error
      ? "Mobile review could not load workspace context."
      : attentionSummaryQ.error ||
          uncategorizedQueue.query.error ||
          issuesQueue.query.error ||
          apSummaryQ.error ||
          activityQ.error
        ? "Some review cards could not refresh. Existing desktop pages are unchanged."
        : null;

  if (contextLoading) {
    return (
      <MobileShell businessId={businessId} accountId={accountId}>
        <div className="space-y-4">
          <section className="rounded-md border border-border bg-card p-4 shadow-sm">
            <Skeleton className="h-5 w-40 rounded-md" />
            <Skeleton className="mt-3 h-8 w-40 rounded-md" />
            <Skeleton className="mt-3 h-7 w-full rounded-md" />
          </section>
          <Skeleton className="h-[88px] w-full rounded-md" />
          <Skeleton className="h-[88px] w-full rounded-md" />
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
                Review Queue
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
              href={homeHref}
              prefetch
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted/50"
            >
              Home
            </Link>
          </div>
        </section>

        {bannerMessage ? (
          <InlineBanner title="Mobile review is partially unavailable" message={bannerMessage} />
        ) : null}

        <section className="space-y-3">
          <div className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Queues
          </div>
          {uncategorizedQueue.query.isLoading ? (
            <Skeleton className="h-[88px] w-full rounded-md" />
          ) : (
            <MobileTaskCard
              title="Uncategorized entries"
              description="Card review for entries that still need a category."
              href={uncategorizedHref}
              metric={String(uncategorizedCount)}
              icon={<Tags className="h-5 w-5" />}
              tone={uncategorizedCount > 0 ? "warning" : "neutral"}
              disabled={!accountId}
            />
          )}

          {issuesQueue.query.isLoading ? (
            <Skeleton className="h-[88px] w-full rounded-md" />
          ) : (
            <MobileTaskCard
              title="Open issues"
              description="Read-only cards for duplicate and stale check review."
              href={issuesHref}
              metric={String(openIssues)}
              icon={<AlertTriangle className="h-5 w-5" />}
              tone={openIssues > 0 ? "danger" : "neutral"}
              disabled={!accountId}
            />
          )}

          {attentionSummaryQ.isLoading ? (
            <Skeleton className="h-[88px] w-full rounded-md" />
          ) : (
            <MobileTaskCard
              title="Bank reconcile"
              description="Review unmatched bank transactions for this account."
              href={reconcileHref}
              metric={String(bankUnmatchedCount)}
              icon={<Landmark className="h-5 w-5" />}
              tone={bankUnmatchedCount > 0 ? "warning" : "neutral"}
              disabled={!accountId}
            />
          )}

          <MobileTaskCard
            title="Receipt upload"
            description="Capture a receipt for review only. No ledger entry is created automatically."
            href={receiptHref}
            icon={<ReceiptText className="h-5 w-5" />}
            disabled={!businessId}
          />
          <MobileTaskCard
            title="Invoice upload"
            description="Capture invoices for review only. No vendor or AP bill is created automatically."
            href={invoiceHref}
            icon={<FileText className="h-5 w-5" />}
            disabled={!businessId}
          />

          {!secondaryReady ? (
            <MobileTaskCard
              title="Vendors and AP"
              description="Open vendor AP balances after the primary review queues."
              href={vendorsHref}
              icon={<Users className="h-5 w-5" />}
              disabled={!businessId}
            />
          ) : apSummaryQ.isLoading ? (
            <Skeleton className="h-[88px] w-full rounded-md" />
          ) : (
            <MobileTaskCard
              title="Vendors and AP"
              description={`${formatUsdFromCents(apTotalOpenCents)} outstanding across ${apOpenVendorCount} vendor${
                apOpenVendorCount === 1 ? "" : "s"
              }.`}
              href={vendorsHref}
              metric={String(apOpenVendorCount)}
              icon={<Users className="h-5 w-5" />}
              disabled={!businessId}
            />
          )}

          {!secondaryReady ? (
            <MobileTaskCard
              title="Recent activity"
              description="Open the activity log for the latest workspace events."
              href={activityHref}
              icon={<Activity className="h-5 w-5" />}
              disabled={!businessId}
            />
          ) : activityQ.isLoading ? (
            <Skeleton className="h-[88px] w-full rounded-md" />
          ) : (
            <MobileTaskCard
              title="Recent activity"
              description={
                lastActivity
                  ? `${formatEvent(lastActivity.event_type)} at ${new Date(
                      lastActivity.created_at
                    ).toLocaleString()}.`
                  : "Open the activity log for the latest workspace events."
              }
              href={activityHref}
              icon={<Activity className="h-5 w-5" />}
              disabled={!businessId}
            />
          )}
        </section>
      </div>
    </MobileShell>
  );
}
