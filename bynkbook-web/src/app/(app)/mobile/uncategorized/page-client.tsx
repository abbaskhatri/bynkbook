"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle, Lightbulb, Loader2, Tags } from "lucide-react";

import { InlineBanner } from "@/components/app/inline-banner";
import { MobilePageHeader } from "@/components/mobile/mobile-page-header";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { listCategories } from "@/lib/api/categories";
import { updateEntry } from "@/lib/api/entries";
import { attentionSummaryKey } from "@/lib/queries/attentionSummary";
import {
  hrefWithMobileContext,
  useMobileWorkspaceContext,
} from "@/lib/mobile/workspaceContext";
import { useMobileUncategorizedEntries } from "@/lib/mobile/reviewQueues";

import { formatUsdSafe } from "@/lib/money";

const formatUsdFromCents = (value: string | number | bigint | null | undefined) =>
  formatUsdSafe(value);

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

export default function MobileUncategorizedPageClient() {
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
  const uncategorizedQueue = useMobileUncategorizedEntries({
    businessId,
    accountId,
    enabled: contextReady,
  });
  const entriesQ = uncategorizedQueue.query;
  const queryClient = useQueryClient();
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [applyingIds, setApplyingIds] = useState<Set<string>>(new Set());
  const [applyErrors, setApplyErrors] = useState<Record<string, string>>({});

  const handleApply = useCallback(async (entryId: string, categoryId: string) => {
    setApplyingIds((prev) => new Set([...prev, entryId]));
    setApplyErrors((prev) => { const next = { ...prev }; delete next[entryId]; return next; });
    try {
      await updateEntry({ businessId: businessId!, accountId: accountId!, entryId, updates: { category_id: categoryId } });
      setAppliedIds((prev) => new Set([...prev, entryId]));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["entries", businessId, accountId], exact: false }),
        queryClient.invalidateQueries({ queryKey: attentionSummaryKey(businessId, accountId), exact: false }),
      ]);
      await entriesQ.refetch();
    } catch {
      setApplyErrors((prev) => ({ ...prev, [entryId]: "Apply failed — tap to retry." }));
    } finally {
      setApplyingIds((prev) => { const next = new Set(prev); next.delete(entryId); return next; });
    }
  }, [businessId, accountId, entriesQ, queryClient]);

  const categoriesQ = useQuery({
    queryKey: ["mobileUncategorized", "categories", businessId],
    queryFn: () => listCategories(businessId as string, { includeArchived: false }),
    enabled: contextReady,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const categoryNameById = useMemo(() => {
    const map: Record<string, string> = {};
    for (const category of categoriesQ.data?.rows ?? []) map[String(category.id)] = category.name;
    return map;
  }, [categoriesQ.data]);

  const uncategorizedRows = uncategorizedQueue.rows;

  const visibleRows = uncategorizedRows.filter((e) => !appliedIds.has(e.id)).slice(0, 40);
  const reviewHref = hrefWithMobileContext({ path: "/mobile/review", businessId, accountId });
  const desktopHref = hrefWithMobileContext({ path: "/category-review", businessId, accountId });

  const bannerMessage =
    businessesQ.error || accountsQ.error
      ? "Uncategorized review could not load workspace context."
      : entriesQ.error || categoriesQ.error
        ? "Uncategorized cards could not refresh. Existing desktop pages are unchanged."
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
          <Skeleton className="h-[168px] w-full rounded-md" />
          <Skeleton className="h-[168px] w-full rounded-md" />
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
          eyebrow="Mobile review"
          title="Uncategorized"
          businessName={business?.name ?? "Business"}
          accountName={account?.name ?? "No active account"}
          actionHref={reviewHref}
          actionLabel="Queue"
        />

        {bannerMessage ? (
          <InlineBanner title="Uncategorized review is partially unavailable" message={bannerMessage} />
        ) : null}

        <section className="rounded-md border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-foreground">Category queue</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {appliedIds.size > 0
                  ? `${appliedIds.size} applied this session · ${visibleRows.length} remaining.`
                  : uncategorizedRows.length > 0
                    ? `${visibleRows.length} uncategorized entries for this account.`
                    : "Loaded uncategorized entries for this account."}
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

                  {suggestionId ? (
                    <div className="mt-3">
                      {applyErrors[entry.id] ? (
                        <div className="mb-2 rounded-md border border-bb-status-danger-border bg-bb-status-danger-bg px-3 py-2 text-xs text-bb-status-danger-fg">
                          {applyErrors[entry.id]}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        disabled={applyingIds.has(entry.id)}
                        onClick={() => handleApply(entry.id, suggestionId)}
                        className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-bb-status-success-border bg-bb-status-success-bg px-3 text-sm font-medium text-bb-status-success-fg disabled:opacity-60"
                      >
                        {applyingIds.has(entry.id) ? (
                          <><Loader2 className="h-4 w-4 animate-spin" /> Applying…</>
                        ) : (
                          <><CheckCircle className="h-4 w-4" /> Apply — {suggestionName}</>
                        )}
                      </button>
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </section>
      </div>
    </MobileShell>
  );
}
