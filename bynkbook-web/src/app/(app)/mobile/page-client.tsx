"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Building2,
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
import { MobileSummaryCard } from "@/components/mobile/mobile-summary-card";
import { MobileTaskCard } from "@/components/mobile/mobile-task-card";
import { Skeleton } from "@/components/ui/skeleton";
import { getActivity } from "@/lib/api/activity";
import { getVendorsApSummary } from "@/lib/api/ap";
import {
  getAccountsSummary,
  getCategories,
  getPnlSummary,
} from "@/lib/api/reports";
import { getIssuesCount } from "@/lib/api/issues";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useBusinesses } from "@/lib/queries/useBusinesses";

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

function hrefWith(params: {
  path: string;
  businessId?: string | null;
  accountId?: string | null;
  extra?: Record<string, string>;
}) {
  const q = new URLSearchParams();
  if (params.businessId) q.set("businessId", params.businessId);
  if (params.accountId) q.set("accountId", params.accountId);
  for (const [key, value] of Object.entries(params.extra ?? {})) q.set(key, value);
  const qs = q.toString();
  return qs ? `${params.path}?${qs}` : params.path;
}

function formatEvent(raw: string) {
  const s = String(raw || "").replace(/_/g, " ").toLowerCase();
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MobilePageClient() {
  const sp = useSearchParams();
  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId") ?? null;
  const accountIdFromUrl = sp.get("accountId") ?? null;

  const business = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return list.find((item) => item.id === bizIdFromUrl) ?? list[0] ?? null;
    return list[0] ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const businessId = business?.id ?? bizIdFromUrl ?? null;
  const accountsQ = useAccounts(businessId);

  const activeAccounts = useMemo(
    () => (accountsQ.data ?? []).filter((account) => !account.archived_at),
    [accountsQ.data]
  );

  const accountId = useMemo(() => {
    if (accountIdFromUrl && accountIdFromUrl !== "all") return accountIdFromUrl;
    return activeAccounts[0]?.id ?? null;
  }, [accountIdFromUrl, activeAccounts]);

  const account = useMemo(() => {
    if (!accountId) return activeAccounts[0] ?? null;
    return activeAccounts.find((item) => item.id === accountId) ?? activeAccounts[0] ?? null;
  }, [accountId, activeAccounts]);

  const range = useMemo(() => ({ from: firstOfMonthYmd(), to: todayYmd() }), []);
  const enabled = !!businessId;
  const accountEnabled = !!businessId && !!accountId;

  const accountsSummaryQ = useQuery({
    queryKey: ["mobileHome", "accountsSummary", businessId, range.to],
    queryFn: () =>
      getAccountsSummary(businessId as string, {
        asOf: range.to,
        accountId: "all",
        includeArchived: false,
      }),
    enabled,
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
    enabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const categoriesQ = useQuery({
    queryKey: ["mobileHome", "categories", businessId, accountId, range.from, range.to],
    queryFn: () =>
      getCategories(businessId as string, {
        from: range.from,
        to: range.to,
        accountId: accountId as string,
      }),
    enabled: accountEnabled,
    staleTime: 45_000,
    placeholderData: (prev) => prev,
  });

  const issuesCountQ = useQuery({
    queryKey: ["mobileHome", "issuesCount", businessId, accountId, "OPEN"],
    queryFn: () =>
      getIssuesCount(businessId as string, {
        status: "OPEN",
        accountId: accountId as string,
      }),
    enabled: accountEnabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const apSummaryQ = useQuery({
    queryKey: ["mobileHome", "apSummary", businessId, range.to],
    queryFn: () => getVendorsApSummary({ businessId: businessId as string, asOf: range.to, limit: 500 }),
    enabled,
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
    enabled,
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

  const uncategorizedCount = useMemo(() => {
    const row = (categoriesQ.data?.rows ?? []).find((item) => {
      const label = String(item.category ?? "").toLowerCase();
      return item.category_id === null || label.includes("uncategorized");
    });
    return Number(row?.count ?? 0) || 0;
  }, [categoriesQ.data]);

  const openIssues = Number(issuesCountQ.data?.count ?? 0) || 0;
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

  const categoryHref = hrefWith({ path: "/mobile/uncategorized", businessId, accountId });
  const issuesHref = hrefWith({ path: "/mobile/issues", businessId, accountId });
  const ledgerHref = hrefWith({ path: "/ledger", businessId, accountId });
  const vendorsHref = hrefWith({ path: "/vendors", businessId });
  const activityHref = businessId ? `/settings?businessId=${businessId}&tab=activity` : "/settings?tab=activity";

  const bannerMessage =
    businessesQ.error || accountsQ.error
      ? "Mobile home could not load workspace context."
      : accountsSummaryQ.error || pnlQ.error || categoriesQ.error || issuesCountQ.error || apSummaryQ.error || activityQ.error
        ? "Some mobile cards could not refresh. Existing desktop pages are unchanged."
        : null;

  return (
    <MobileShell businessId={businessId} accountId={accountId}>
      <div className="space-y-4">
        <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                Mobile companion
              </div>
              <h1 className="mt-2 truncate text-2xl font-semibold leading-tight text-slate-950">
                Home
              </h1>
              <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
                <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                  <Building2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{business?.name ?? "Business"}</span>
                </span>
                <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
                  <Landmark className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{account?.name ?? "No active account"}</span>
                </span>
              </div>
            </div>
            <Link
              href={hrefWith({ path: "/dashboard", businessId })}
              prefetch
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Desktop
            </Link>
          </div>
        </div>

        {bannerMessage ? (
          <InlineBanner title="Mobile home is partially unavailable" message={bannerMessage} />
        ) : null}

        <div className="grid grid-cols-1 gap-3">
          {accountsSummaryQ.isLoading ? (
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

          {pnlQ.isLoading ? (
            <Skeleton className="h-[132px] w-full rounded-md" />
          ) : (
            <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
                    Month to date
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {range.from} to {range.to}
                  </div>
                </div>
                <Sigma className="h-5 w-5 text-slate-500" />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  <div className="mt-2 text-[11px] text-slate-500">Revenue</div>
                  <div className="mt-1 truncate text-sm font-semibold text-slate-950">
                    {formatUsdFromCents(pnlQ.data?.period?.income_cents)}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <TrendingDown className="h-4 w-4 text-rose-600" />
                  <div className="mt-2 text-[11px] text-slate-500">Expense</div>
                  <div className="mt-1 truncate text-sm font-semibold text-slate-950">
                    {formatUsdFromCents(pnlQ.data?.period?.expense_cents)}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                  <Sigma className="h-4 w-4 text-slate-600" />
                  <div className="mt-2 text-[11px] text-slate-500">Net</div>
                  <div className="mt-1 truncate text-sm font-semibold text-slate-950">
                    {formatUsdFromCents(pnlQ.data?.period?.net_cents)}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>

        <section className="space-y-3">
          <div className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Tasks
          </div>
          <MobileTaskCard
            title="Category Review"
            description="Review uncategorized entries for the selected account."
            href={categoryHref}
            metric={categoriesQ.isLoading ? "..." : String(uncategorizedCount)}
            icon={<Tags className="h-5 w-5" />}
            tone={uncategorizedCount > 0 ? "warning" : "neutral"}
            disabled={!accountId}
          />
          <MobileTaskCard
            title="Issues"
            description="Open duplicate and stale check review for this account."
            href={issuesHref}
            metric={issuesCountQ.isLoading ? "..." : String(openIssues)}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone={openIssues > 0 ? "danger" : "neutral"}
            disabled={!accountId}
          />
          <MobileTaskCard
            title="Receipt Upload"
            description="Go to the existing ledger upload entry point. Upload is not embedded on mobile home."
            href={ledgerHref}
            icon={<ReceiptText className="h-5 w-5" />}
            disabled={!accountId}
          />
          <MobileTaskCard
            title="Vendors and AP"
            description={`Open AP vendors. ${formatUsdFromCents(apTotalOpenCents)} outstanding across ${apOpenVendorCount} vendor${
              apOpenVendorCount === 1 ? "" : "s"
            }.`}
            href={vendorsHref}
            metric={apSummaryQ.isLoading ? "..." : String(apOpenVendorCount)}
            icon={<Users className="h-5 w-5" />}
            disabled={!businessId}
          />
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-950">Recent Activity</div>
              <div className="mt-1 text-sm text-slate-600">Latest workspace events.</div>
            </div>
            <Link
              href={activityHref}
              prefetch
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View
            </Link>
          </div>

          <div className="mt-4 space-y-2">
            {activityQ.isLoading ? (
              <>
                <Skeleton className="h-12 w-full rounded-md" />
                <Skeleton className="h-12 w-full rounded-md" />
              </>
            ) : (activityQ.data?.items ?? []).length === 0 ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                No recent activity yet.
              </div>
            ) : (
              (activityQ.data?.items ?? []).map((item) => (
                <div
                  key={item.id}
                  className="flex min-h-12 items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <Activity className="h-4 w-4 shrink-0 text-slate-500" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-900">
                      {formatEvent(item.event_type)}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
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
