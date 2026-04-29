"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Landmark, Lightbulb, Tags } from "lucide-react";

import { InlineBanner } from "@/components/app/inline-banner";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { listCategories } from "@/lib/api/categories";
import type { Entry } from "@/lib/api/entries";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useEntries } from "@/lib/queries/useEntries";

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

function typeLabel(raw: string | null | undefined) {
  const normalized = String(raw ?? "").replace(/_/g, " ").toLowerCase();
  return normalized.replace(/\b\w/g, (c) => c.toUpperCase()) || "Entry";
}

function sourceLabel(raw: string | null | undefined) {
  const source = String(raw ?? "").trim().toUpperCase();
  if (source === "VENDOR_DEFAULT") return "Vendor default";
  if (source === "MEMORY") return "Learned from history";
  if (source === "HEURISTIC") return "Pattern match";
  if (source === "AI") return "AI suggestion";
  return raw ? typeLabel(raw) : null;
}

function isReviewableEntry(entry: Entry) {
  const t = String(entry.type ?? "").toUpperCase();
  const payee = String(entry.payee ?? "").trim().toLowerCase();
  return (
    !entry.deleted_at &&
    !entry.category_id &&
    t !== "TRANSFER" &&
    t !== "ADJUSTMENT" &&
    t !== "OPENING" &&
    !payee.startsWith("opening balance")
  );
}

export default function MobileUncategorizedPageClient() {
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

  const entriesQ = useEntries({
    businessId,
    accountId,
    limit: 150,
    includeDeleted: false,
  });

  const categoriesQ = useQuery({
    queryKey: ["mobileUncategorized", "categories", businessId],
    queryFn: () => listCategories(businessId as string, { includeArchived: false }),
    enabled: !!businessId,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const categoryNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const category of categoriesQ.data?.rows ?? []) map[String(category.id)] = category.name;
    return map;
  }, [categoriesQ.data]);

  const uncategorizedRows = useMemo(
    () =>
      (entriesQ.data ?? [])
        .filter(isReviewableEntry)
        .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))),
    [entriesQ.data]
  );

  const visibleRows = uncategorizedRows.slice(0, 40);
  const reviewHref = hrefWith({ path: "/mobile/review", businessId, accountId });
  const desktopHref = hrefWith({ path: "/category-review", businessId, accountId });

  const bannerMessage =
    businessesQ.error || accountsQ.error
      ? "Uncategorized review could not load workspace context."
      : entriesQ.error || categoriesQ.error
        ? "Uncategorized cards could not refresh. Existing desktop pages are unchanged."
        : null;

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
                Uncategorized
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
              prefetch
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-md border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted/50"
            >
              Queue
            </Link>
          </div>
        </section>

        {bannerMessage ? (
          <InlineBanner title="Uncategorized review is partially unavailable" message={bannerMessage} />
        ) : null}

        <section className="rounded-md border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Read-only queue</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Showing up to {visibleRows.length} of {uncategorizedRows.length} loaded uncategorized entries.
              </div>
            </div>
            <Link
              href={desktopHref}
              prefetch
              className="inline-flex h-10 items-center justify-center rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-muted/50"
            >
              Desktop
            </Link>
          </div>
        </section>

        <section className="space-y-3">
          {entriesQ.isLoading || categoriesQ.isLoading ? (
            <>
              <Skeleton className="h-[168px] w-full rounded-md" />
              <Skeleton className="h-[168px] w-full rounded-md" />
              <Skeleton className="h-[168px] w-full rounded-md" />
            </>
          ) : !accountId ? (
            <div className="rounded-md border border-border bg-card p-4 text-sm text-muted-foreground shadow-sm">
              Select an active account to view uncategorized entries.
            </div>
          ) : visibleRows.length === 0 ? (
            <div className="rounded-md border border-bb-status-success-border bg-bb-status-success-bg p-4 text-sm text-bb-status-success-fg shadow-sm">
              No uncategorized entries found in the loaded mobile slice.
            </div>
          ) : (
            visibleRows.map((entry) => {
              const suggestionId = entry.suggested_category_id ?? null;
              const suggestionName =
                entry.suggested_category_name ||
                (suggestionId ? categoryNameById[suggestionId] : "") ||
                "";
              const suggestionSource = sourceLabel(entry.suggested_category_source);
              const suggestionMeta = [
                entry.suggested_category_confidence
                  ? `${entry.suggested_category_confidence}% confidence`
                  : null,
                suggestionSource,
              ].filter(Boolean);

              return (
                <article
                  key={entry.id}
                  className="rounded-md border border-border bg-card p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                        {entry.date || "No date"}
                      </div>
                      <h2 className="mt-1 truncate text-base font-semibold text-foreground">
                        {entry.payee || "Unknown payee"}
                      </h2>
                      <div className="mt-1 text-xs text-muted-foreground">{typeLabel(entry.type)}</div>
                    </div>
                    <div
                      className={`shrink-0 text-right text-base font-semibold tabular-nums ${
                        String(entry.amount_cents).startsWith("-") ? "text-bb-amount-negative" : "text-bb-amount-neutral"
                      }`}
                    >
                      {formatUsdFromCents(entry.amount_cents)}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <div className="rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg p-3">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-bb-status-warning-fg">
                        <Tags className="h-4 w-4" />
                        Current category
                      </div>
                      <div className="mt-2 text-sm font-medium text-bb-status-warning-fg">Uncategorized</div>
                    </div>

                    <div className="rounded-md border border-border bg-muted/50 p-3">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        <Lightbulb className="h-4 w-4" />
                        Top suggestion
                      </div>
                      {suggestionName ? (
                        <>
                          <div className="mt-2 text-sm font-medium text-foreground">{suggestionName}</div>
                          {suggestionMeta.length ? (
                            <div className="mt-1 text-xs text-muted-foreground">{suggestionMeta.join(" · ")}</div>
                          ) : null}
                          {entry.suggested_category_reason ? (
                            <div className="mt-2 text-sm leading-5 text-muted-foreground">
                              {entry.suggested_category_reason}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <div className="mt-2 text-sm text-muted-foreground">
                          No saved suggestion available on this entry.
                        </div>
                      )}
                    </div>
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
