"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Building2, Landmark } from "lucide-react";

import { InlineBanner } from "@/components/app/inline-banner";
import { MobileShell } from "@/components/mobile/mobile-shell";
import { Skeleton } from "@/components/ui/skeleton";
import {
  isIssuesPageIssueType,
  listAccountIssues,
  type EntryIssueRow,
} from "@/lib/api/issues";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useBusinesses } from "@/lib/queries/useBusinesses";

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
  if (value === null || value === undefined || value === "") return "Amount unavailable";

  let cents: bigint;
  try {
    cents = BigInt(String(value));
  } catch {
    return "Amount unavailable";
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

  const issuesQ = useQuery({
    queryKey: ["mobileIssues", businessId, accountId, "OPEN"],
    queryFn: () =>
      listAccountIssues({
        businessId: businessId as string,
        accountId: accountId as string,
        status: "OPEN",
        limit: 50,
      }),
    enabled: !!businessId && !!accountId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: (prev) => prev,
  });

  const issues = useMemo(
    () =>
      (issuesQ.data?.issues ?? [])
        .filter((issue) => isIssuesPageIssueType(issue.issue_type))
        .sort((a, b) => {
          const aDate = String(a.entry_date ?? a.detected_at ?? "");
          const bDate = String(b.entry_date ?? b.detected_at ?? "");
          return bDate.localeCompare(aDate);
        })
        .slice(0, 40),
    [issuesQ.data]
  );

  const reviewHref = hrefWith({ path: "/mobile/review", businessId, accountId });
  const desktopHref = hrefWith({ path: "/issues", businessId, accountId });

  const bannerMessage =
    businessesQ.error || accountsQ.error
      ? "Issues review could not load workspace context."
      : issuesQ.error
        ? "Issue cards could not refresh. Existing desktop pages are unchanged."
        : null;

  return (
    <MobileShell businessId={businessId} accountId={accountId}>
      <div className="space-y-4">
        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                Mobile review
              </div>
              <h1 className="mt-2 truncate text-2xl font-semibold leading-tight text-slate-950">
                Issues
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
              Queue
            </Link>
          </div>
        </section>

        {bannerMessage ? <InlineBanner title="Issues review is partially unavailable" message={bannerMessage} /> : null}

        <section className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-950">Open issue cards</div>
              <div className="mt-1 text-sm text-slate-600">
                Showing up to {issues.length} duplicate or stale-check issues.
              </div>
            </div>
            <Link
              href={desktopHref}
              prefetch
              className="inline-flex h-10 items-center justify-center rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
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
            <div className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
              Select an active account to view open issues.
            </div>
          ) : issues.length === 0 ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-4 text-sm text-emerald-950 shadow-sm">
              No duplicate or stale-check issues found in the loaded mobile slice.
            </div>
          ) : (
            issues.map((issue) => {
              const amount = formatUsdFromCents(issue.entry_amount_cents);
              const isNegative = String(issue.entry_amount_cents ?? "").startsWith("-");
              return (
                <article
                  key={issue.id}
                  className="rounded-md border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="inline-flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {labelize(issue.issue_type)}
                      </div>
                      <h2 className="mt-3 truncate text-base font-semibold text-slate-950">
                        {issue.entry_payee || "Entry unavailable"}
                      </h2>
                      <div className="mt-1 text-xs text-slate-500">
                        {issue.entry_date || "No date"}
                      </div>
                    </div>
                    <div
                      className={`shrink-0 text-right text-base font-semibold tabular-nums ${
                        isNegative ? "text-rose-700" : "text-slate-950"
                      }`}
                    >
                      {amount}
                    </div>
                  </div>

                  <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-5 text-slate-700">
                    {issueExplanation(issue)}
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md border border-yellow-200 bg-yellow-50 px-2 py-1 font-medium text-yellow-800">
                      Severity: {labelize(issue.severity || "warning")}
                    </span>
                    <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700">
                      Status: {labelize(issue.status)}
                    </span>
                    {issue.entry_method ? (
                      <span className="rounded-md border border-slate-200 bg-white px-2 py-1 font-medium text-slate-700">
                        Method: {labelize(issue.entry_method)}
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-4">
                    <Link
                      href={desktopHref}
                      prefetch
                      className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
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
