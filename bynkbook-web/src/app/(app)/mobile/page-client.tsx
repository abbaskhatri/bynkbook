"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  FileText,
  Landmark,
  ReceiptText,
  Sigma,
  Tags,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

import { InlineBanner } from "@/components/app/inline-banner";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobileSummaryCard } from "@/components/mobile/mobile-summary-card";
import { MobileTaskCard } from "@/components/mobile/mobile-task-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getActivity } from "@/lib/api/activity";
import { getVendorsApSummary } from "@/lib/api/ap";
import {
  getAccountsSummary,
  getPnlSummary,
} from "@/lib/api/reports";
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

import { formatUsdSafe } from "@/lib/money";

const formatUsdFromCents = (value: string | number | bigint | null | undefined) =>
  formatUsdSafe(value);

function formatEvent(raw: string) {
  const s = String(raw || "").replace(/_/g, " ").toLowerCase();
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MobilePageClient() {
  const {
    businessesQ,
    accountsQ,
    activeAccounts,
    business,
    businessId,
    account,
    accountId,
    contextError,
    contextReady,
    isLoading: contextLoading,
  } = useMobileWorkspaceContext();

  const range = useMemo(() => ({ from: firstOfMonthYmd(), to: todayYmd() }), []);
  const accountEnabled = contextReady;
  const secondaryReady = useIdleReady(contextReady, 1200);
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

  const accountsSummaryQ = useQuery({
    queryKey: ["mobileHome", "accountsSummary", businessId, range.to],
    queryFn: () =>
      getAccountsSummary(businessId as string, {
        asOf: range.to,
        accountId: "all",
        includeArchived: false,
      }),
    enabled: secondaryReady && !!businessId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const pnlQ = useQuery({
    queryKey: ["mobileHome", "pnlSummary", businessId, range.from, range.to],
    queryFn: () =>
      getPnlSummary(businessId as string, {
        from: range.from,
        to: range.to,
        accountId: "all",
        ytd: false,
      }),
    enabled: secondaryReady && !!businessId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
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
    queryKey: ["mobileHome", "apSummary", businessId, range.to],
    queryFn: () => getVendorsApSummary({ businessId: businessId as string, asOf: range.to, limit: 500 }),
    enabled: secondaryReady && !!businessId,
    staleTime: 45_000,
    placeholderData: (prev) => prev,
  });

  const activityQ = useQuery({
    queryKey: ["mobileHome", "activity", businessId, accountId ?? "all"],
    queryFn: () =>
      getActivity(businessId as string, {
        limit: 3,
        accountId: accountId ?? undefined,
      }),
    enabled: secondaryReady && !!businessId && !!accountId,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const cashBalanceCents = useMemo(() => {
    let total = 0n;
    for (const row of accountsSummaryQ.data?.rows ?? []) {
      try {
        total += BigInt(String(row.balance_cents ?? "0"));
      } catch {}
    }
    return total.toString();
  }, [accountsSummaryQ.data]);

  const uncategorizedCount = uncategorizedQueue.rows.length;
  const openIssues = issuesQueue.rows.length;
  const bankUnmatchedCount = Number(attentionSummaryQ.data?.bank_unmatched_count ?? 0) || 0;
  const apVendors = useMemo(() => apSummaryQ.data?.vendors ?? [], [apSummaryQ.data]);
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

  const categoryHref = hrefWithMobileContext({ path: "/mobile/uncategorized", businessId, accountId });
  const issuesHref = hrefWithMobileContext({ path: "/mobile/issues", businessId, accountId });
  const reconcileHref = hrefWithMobileContext({ path: "/reconcile", businessId, accountId });
  const receiptHref = hrefWithMobileContext({ path: "/mobile/receipt", businessId, accountId });
  const invoiceHref = hrefWithMobileContext({ path: "/mobile/invoice", businessId, accountId });
  const vendorsHref = hrefWithMobileContext({ path: "/mobile/vendors", businessId, accountId });
  const activityHref = businessId ? `/settings?businessId=${businessId}&tab=activity` : "/settings?tab=activity";
  const desktopDashboardHref = hrefWithMobileContext({ path: "/dashboard", businessId });

  const failedCards = [
    accountsSummaryQ.error ? "cash snapshot" : null,
    pnlQ.error ? "month-to-date profit" : null,
    uncategorizedQueue.query.error ? "category queue" : null,
    issuesQueue.query.error ? "issue queue" : null,
    apSummaryQ.error ? "vendor payables" : null,
    activityQ.error ? "recent activity" : null,
  ].filter(Boolean);

  const bannerMessage =
    businessesQ.error || accountsQ.error
      ? "Mobile home could not load workspace context."
      : failedCards.length
        ? `Could not refresh ${failedCards.join(", ")}. Existing desktop pages are unchanged.`
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
        <MobilePageHeader
          eyebrow="Mobile companion"
          title="Today"
          businessName={business?.name ?? "Business"}
          accountName={account?.name ?? "No active account"}
          actionHref={desktopDashboardHref}
          actionLabel="Desktop"
        />

        {bannerMessage ? (
          <InlineBanner title="Mobile home is partially unavailable" message={bannerMessage} />
        ) : null}

        <section className="space-y-3">
          <div className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Tasks
          </div>
          <MobileTaskCard
            title="Category Review"
            description="Review uncategorized entries for the selected account."
            href={categoryHref}
            metric={uncategorizedQueue.query.isLoading ? "..." : String(uncategorizedCount)}
            icon={<Tags className="h-5 w-5" />}
            tone={uncategorizedCount > 0 ? "warning" : "neutral"}
            disabled={!accountId}
          />
          <MobileTaskCard
            title="Issues"
            description="Open duplicate and stale check review for this account."
            href={issuesHref}
            metric={issuesQueue.query.isLoading ? "..." : String(openIssues)}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone={openIssues > 0 ? "danger" : "neutral"}
            disabled={!accountId}
          />
          <MobileTaskCard
            title="Bank Reconcile"
            description="Review unmatched bank transactions for the selected account."
            href={reconcileHref}
            metric={attentionSummaryQ.error ? "Open" : attentionSummaryQ.isLoading ? "..." : String(bankUnmatchedCount)}
            icon={<Landmark className="h-5 w-5" />}
            tone={bankUnmatchedCount > 0 ? "warning" : "neutral"}
            disabled={!accountId}
          />
          <MobileTaskCard
            title="Receipt Upload"
            description="Take a photo or choose a receipt file for review-only upload."
            href={receiptHref}
            icon={<ReceiptText className="h-5 w-5" />}
            disabled={!businessId}
          />
          <MobileTaskCard
            title="Invoice Upload"
            description="Capture invoice files for review only. No vendor or AP bill is created automatically."
            href={invoiceHref}
            icon={<FileText className="h-5 w-5" />}
            disabled={!businessId}
          />
          <MobileTaskCard
            title="Vendors and AP"
            description={
              apSummaryQ.data
                ? `Open AP vendors. ${formatUsdFromCents(apTotalOpenCents)} outstanding across ${apOpenVendorCount} vendor${
                    apOpenVendorCount === 1 ? "" : "s"
                  }.`
                : "Open AP vendor balances and invoice review."
            }
            href={vendorsHref}
            metric={apSummaryQ.data ? String(apOpenVendorCount) : undefined}
            icon={<Users className="h-5 w-5" />}
            disabled={!businessId}
          />
        </section>

        <section className="grid grid-cols-1 gap-3">
          <div className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Snapshot
          </div>
          {!secondaryReady || accountsSummaryQ.isLoading ? (
            <Skeleton className="h-[118px] w-full rounded-md" />
          ) : (
            <MobileSummaryCard
              title="Cash snapshot"
              value={formatUsdFromCents(cashBalanceCents)}
              detail={`${accountsSummaryQ.data?.rows?.length ?? activeAccounts.length} active account${
                (accountsSummaryQ.data?.rows?.length ?? activeAccounts.length) === 1 ? "" : "s"
              } as of ${range.to}.`}
              icon={<Landmark className="h-5 w-5" />}
              tone="positive"
            />
          )}

          {!secondaryReady || pnlQ.isLoading ? (
            <Skeleton className="h-[132px] w-full rounded-md" />
          ) : (
            <section className="rounded-md border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    Month to date
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {range.from} to {range.to}
                  </div>
                </div>
                <Sigma className="h-5 w-5 text-muted-foreground" />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-md border border-border bg-muted/50 p-3">
                  <TrendingUp className="h-4 w-4 text-bb-status-success-fg" />
                  <div className="mt-2 text-[11px] text-muted-foreground">Revenue</div>
                  <div className="mt-1 truncate text-sm font-semibold text-foreground">
                    {formatUsdFromCents(pnlQ.data?.period?.income_cents)}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-muted/50 p-3">
                  <TrendingDown className="h-4 w-4 text-bb-status-danger-fg" />
                  <div className="mt-2 text-[11px] text-muted-foreground">Expense</div>
                  <div className="mt-1 truncate text-sm font-semibold text-foreground">
                    {formatUsdFromCents(pnlQ.data?.period?.expense_cents)}
                  </div>
                </div>
                <div className="rounded-md border border-border bg-muted/50 p-3">
                  <Sigma className="h-4 w-4 text-muted-foreground" />
                  <div className="mt-2 text-[11px] text-muted-foreground">Net</div>
                  <div className="mt-1 truncate text-sm font-semibold text-foreground">
                    {formatUsdFromCents(pnlQ.data?.period?.net_cents)}
                  </div>
                </div>
              </div>
            </section>
          )}
        </section>

        <section className="rounded-md border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Recent Activity</div>
              <div className="mt-1 text-sm text-muted-foreground">Latest workspace events.</div>
            </div>
            <Link
              href={activityHref}
              prefetch={false}
              className="inline-flex h-10 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted/50"
            >
              View
            </Link>
          </div>

          <div className="mt-4 space-y-2">
            {!secondaryReady || activityQ.isLoading ? (
              <>
                <Skeleton className="h-12 w-full rounded-md" />
                <Skeleton className="h-12 w-full rounded-md" />
              </>
            ) : (activityQ.data?.items ?? []).length === 0 ? (
              <div className="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
                No recent activity yet.
              </div>
            ) : (
              (activityQ.data?.items ?? []).map((item) => (
                <div
                  key={item.id}
                  className="flex min-h-12 items-center gap-3 rounded-md border border-border bg-muted/50 p-3"
                >
                  <Activity className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">
                      {formatEvent(item.event_type)}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                      {new Date(item.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </MobileShell>
  );
}
