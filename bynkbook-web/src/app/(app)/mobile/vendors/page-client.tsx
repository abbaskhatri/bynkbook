"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2,
  CalendarClock,
  ChevronRight,
  FileText,
  Landmark,
  ReceiptText,
  Users,
} from "lucide-react";

import { InlineBanner } from "@/components/app/inline-banner";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { getVendorsApSummary } from "@/lib/api/ap";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useBusinesses } from "@/lib/queries/useBusinesses";

const MOBILE_VENDOR_LIMIT = 50;

function todayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function hrefWith(params: {
  path: string;
  businessId?: string | null;
  accountId?: string | null;
}) {
  const q = new URLSearchParams();
  if (params.businessId) q.set("businessId", params.businessId);
  if (params.accountId) q.set("accountId", params.accountId);
  const qs = q.toString();
  return qs ? `${params.path}?${qs}` : params.path;
}

function toBigIntOrNull(value: string | number | bigint | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(String(value));
  } catch {
    return null;
  }
}

function formatUsdFromCents(value: string | number | bigint | null | undefined) {
  const cents = toBigIntOrNull(value);
  if (cents === null) return "—";

  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const dollars = abs / 100n;
  const pennies = abs % 100n;
  const core = `$${dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${pennies
    .toString()
    .padStart(2, "0")}`;

  return negative ? `(${core})` : core;
}

function agingSignal(aging: {
  current?: string;
  days_30?: string;
  days_60?: string;
  days_90?: string;
} | null | undefined) {
  if (!aging) return { label: "Aging unknown", tone: "neutral" as const };

  const days90 = toBigIntOrNull(aging.days_90) ?? 0n;
  const days60 = toBigIntOrNull(aging.days_60) ?? 0n;
  const days30 = toBigIntOrNull(aging.days_30) ?? 0n;

  if (days90 > 0n) return { label: "90+ days past due", tone: "danger" as const };
  if (days60 > 0n) return { label: "61-90 days past due", tone: "danger" as const };
  if (days30 > 0n) return { label: "31-60 days past due", tone: "warning" as const };
  return { label: "Current or under 30 days", tone: "neutral" as const };
}

function totalOpen(aging: {
  current?: string;
  days_30?: string;
  days_60?: string;
  days_90?: string;
} | null | undefined) {
  if (!aging) return null;
  const parts = [aging.current, aging.days_30, aging.days_60, aging.days_90].map(toBigIntOrNull);
  if (parts.some((part) => part === null)) return null;
  return parts.reduce<bigint>((sum, part) => sum + (part ?? 0n), 0n);
}

function AgingPills({
  aging,
}: {
  aging:
    | {
        current?: string;
        days_30?: string;
        days_60?: string;
        days_90?: string;
      }
    | null
    | undefined;
}) {
  if (!aging) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-500">
        Aging: —
      </div>
    );
  }

  const buckets = [
    ["Now", aging.current],
    ["30", aging.days_30],
    ["60", aging.days_60],
    ["90+", aging.days_90],
  ] as const;

  return (
    <div className="grid grid-cols-4 gap-1">
      {buckets.map(([label, cents]) => (
        <div key={label} className="min-w-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-slate-500">
            {label}
          </div>
          <div className="mt-0.5 truncate text-xs font-semibold tabular-nums text-slate-900">
            {formatUsdFromCents(cents)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MobileVendorsPageClient() {
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

  const asOf = useMemo(() => todayYmd(), []);

  const apSummaryQ = useQuery({
    queryKey: ["mobileVendors", "apSummary", businessId, asOf, MOBILE_VENDOR_LIMIT],
    queryFn: () =>
      getVendorsApSummary({
        businessId: businessId as string,
        asOf,
        limit: MOBILE_VENDOR_LIMIT,
      }),
    enabled: !!businessId,
    staleTime: 45_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  const vendors = useMemo(
    () =>
      (apSummaryQ.data?.vendors ?? [])
        .map((vendor) => {
          const total = toBigIntOrNull(vendor.total_open_cents) ?? totalOpen(vendor.aging);
          return { ...vendor, totalOpen: total };
        })
        .filter((vendor) => vendor.totalOpen === null || vendor.totalOpen > 0n)
        .sort((a, b) => {
          const aTotal = a.totalOpen ?? -1n;
          const bTotal = b.totalOpen ?? -1n;
          if (aTotal === bTotal) return String(a.vendor_name).localeCompare(String(b.vendor_name));
          return bTotal > aTotal ? 1 : -1;
        })
        .slice(0, MOBILE_VENDOR_LIMIT),
    [apSummaryQ.data]
  );

  const reviewHref = hrefWith({ path: "/mobile/review", businessId, accountId });
  const invoiceHref = hrefWith({ path: "/mobile/invoice", businessId, accountId });
  const desktopVendorsHref = hrefWith({ path: "/vendors", businessId });

  const totalOpenCents = useMemo(() => {
    let total = 0n;
    let hasKnown = false;
    for (const vendor of vendors) {
      if (vendor.totalOpen === null) continue;
      total += vendor.totalOpen;
      hasKnown = true;
    }
    return hasKnown ? total.toString() : null;
  }, [vendors]);

  const bannerMessage =
    businessesQ.error || accountsQ.error
      ? "Mobile vendors could not load workspace context."
      : apSummaryQ.error
        ? "Vendor AP cards could not refresh. Existing desktop vendor pages are unchanged."
        : null;

  return (
    <MobileShell businessId={businessId} accountId={accountId}>
      <div className="space-y-4">
        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                Mobile vendors
              </div>
              <h1 className="mt-2 truncate text-2xl font-semibold leading-tight text-slate-950">
                Vendors and AP
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
              href={reviewHref}
              prefetch
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Review
            </Link>
          </div>
        </section>

        {bannerMessage ? (
          <InlineBanner
            title="Mobile vendors are partially unavailable"
            message={bannerMessage}
            onRetry={() => void apSummaryQ.refetch()}
          />
        ) : null}

        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600">
              <Users className="h-4 w-4" />
            </div>
            <div className="mt-3 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
              Open vendors
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">
              {apSummaryQ.isLoading ? "—" : vendors.length}
            </div>
          </div>

          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <div className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600">
              <ReceiptText className="h-4 w-4" />
            </div>
            <div className="mt-3 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">
              Open AP
            </div>
            <div className="mt-1 truncate text-2xl font-semibold tabular-nums text-slate-950">
              {apSummaryQ.isLoading ? "—" : formatUsdFromCents(totalOpenCents)}
            </div>
          </div>
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-950">Read-only AP cards</div>
              <div className="mt-1 text-sm text-slate-600">
                Showing up to {MOBILE_VENDOR_LIMIT} vendors with open balances as of {apSummaryQ.data?.as_of ?? asOf}.
              </div>
            </div>
            <Link
              href={invoiceHref}
              prefetch
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <FileText className="mr-2 h-4 w-4" />
              Invoice
            </Link>
          </div>
        </section>

        <section className="space-y-3">
          {apSummaryQ.isLoading ? (
            <>
              <Skeleton className="h-[192px] w-full rounded-md" />
              <Skeleton className="h-[192px] w-full rounded-md" />
              <Skeleton className="h-[192px] w-full rounded-md" />
            </>
          ) : !businessId ? (
            <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
              Select a business to view vendor balances.
            </div>
          ) : vendors.length === 0 ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-950 shadow-sm">
              No open vendor balances
            </div>
          ) : (
            vendors.map((vendor) => {
              const signal = agingSignal(vendor.aging);
              const detailHref = hrefWith({
                path: `/vendors/${vendor.vendor_id}`,
                businessId,
              });

              return (
                <Link key={vendor.vendor_id} href={detailHref} prefetch className="block">
                  <article className="rounded-md border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-semibold text-slate-950">
                          {vendor.vendor_name || "Unknown vendor"}
                        </h2>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span
                            className={
                              signal.tone === "danger"
                                ? "rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700"
                                : signal.tone === "warning"
                                  ? "rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800"
                                  : "rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700"
                            }
                          >
                            {signal.label}
                          </span>
                          <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
                            Open bills: —
                          </span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-slate-500">
                          Open AP
                        </div>
                        <div className="mt-1 text-base font-semibold tabular-nums text-slate-950">
                          {formatUsdFromCents(vendor.totalOpen?.toString() ?? null)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <AgingPills aging={vendor.aging} />
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">Last activity: —</span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 font-medium text-slate-700">
                        Desktop detail
                        <ChevronRight className="h-4 w-4" />
                      </span>
                    </div>
                  </article>
                </Link>
              );
            })
          )}
        </section>

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <Link
            href={desktopVendorsHref}
            prefetch
            className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open desktop vendors
          </Link>
        </section>
      </div>
    </MobileShell>
  );
}
