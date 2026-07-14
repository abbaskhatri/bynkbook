"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowRightLeft,
  BrainCircuit,
  CalendarCheck2,
  CheckCircle2,
  CircleAlert,
  Landmark,
  RefreshCw,
  TrendingUp,
} from "lucide-react";

import { PageHeader } from "@/components/app/page-header";
import { InlineBanner } from "@/components/app/inline-banner";
import { AppDialog } from "@/components/primitives/AppDialog";
import { DialogFooter } from "@/components/primitives/DialogFooter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBusinesses } from "@/lib/queries/useBusinesses";
import { applyTransferPair, getOperationsOverview, type OperationsBankAccount, type TransferCandidate } from "@/lib/api/operations";
import { formatUsdSafe, toBigIntSafe } from "@/lib/money";

function statusClasses(tone: "good" | "warning" | "danger" | "muted") {
  if (tone === "good") return "border-bb-status-success-border bg-bb-status-success-bg text-bb-status-success-fg";
  if (tone === "warning") return "border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg";
  if (tone === "danger") return "border-bb-status-danger-border bg-bb-status-danger-bg text-bb-status-danger-fg";
  return "border-bb-border bg-bb-surface-soft text-bb-text-muted";
}

function StatusPill({ children, tone = "muted" }: { children: React.ReactNode; tone?: "good" | "warning" | "danger" | "muted" }) {
  return <span className={`inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(tone)}`}>{children}</span>;
}

function bankHealthLabel(account: OperationsBankAccount) {
  if (String(account.account_type ?? "").toUpperCase() === "CASH") return { label: "Cash book", tone: "muted" as const };
  if (account.health === "HEALTHY") return { label: "Healthy", tone: "good" as const };
  if (account.health === "SYNCING") return { label: "Syncing", tone: "warning" as const };
  if (account.health === "STALE") return { label: "Sync stale", tone: "warning" as const };
  if (account.health === "NEVER_SYNCED") return { label: "Not synced", tone: "warning" as const };
  if (account.health === "NEEDS_ATTENTION") return { label: "Needs attention", tone: "danger" as const };
  return { label: "Not connected", tone: "muted" as const };
}

function StatCard(props: { icon: React.ReactNode; label: string; value: string; meta: string; tone?: "good" | "warning" | "danger" }) {
  const tone = props.tone ?? "good";
  return (
    <Card className="min-w-0">
      <CardContent className="flex items-start gap-3">
        <div className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${statusClasses(tone)}`}>{props.icon}</div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-bb-text-muted">{props.label}</div>
          <div className="mt-1 truncate text-xl font-semibold tabular-nums text-bb-text">{props.value}</div>
          <div className="mt-1 text-xs leading-5 text-bb-text-muted">{props.meta}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function ForecastChart({ rows }: { rows: Array<{ week_start: string; net_cents: string; ending_cash_cents: string }> }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(Number(row.net_cents ?? 0))));
  return (
    <div className="grid grid-cols-[repeat(13,minmax(0,1fr))] items-end gap-1 rounded-lg border border-bb-border bg-bb-surface-soft px-3 pb-3 pt-5" aria-label="13-week projected net cash flow">
      {rows.map((row, index) => {
        const net = Number(row.net_cents ?? 0);
        const height = Math.max(8, Math.round((Math.abs(net) / max) * 86));
        return (
          <div key={row.week_start} className="group flex min-w-0 flex-col items-center justify-end gap-1">
            <div className="sr-only">Week of {row.week_start}: net {formatUsdSafe(row.net_cents)}</div>
            <div
              className={`w-full max-w-8 rounded-t-sm transition-opacity group-hover:opacity-80 ${net < 0 ? "bg-bb-status-danger-fg/70" : "bg-primary/70"}`}
              style={{ height }}
              title={`${row.week_start}: ${formatUsdSafe(row.net_cents)} net; ${formatUsdSafe(row.ending_cash_cents)} ending cash`}
            />
            <span className="text-[9px] tabular-nums text-bb-text-muted">{index % 2 === 0 ? row.week_start.slice(5) : ""}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function OperationsPageClient() {
  const searchParams = useSearchParams();
  const businessesQ = useBusinesses();
  const queryClient = useQueryClient();
  const businessIdFromUrl = searchParams.get("businessId") ?? searchParams.get("businessesId");
  const businessId = businessIdFromUrl ?? businessesQ.data?.[0]?.id ?? null;
  const [selectedCandidate, setSelectedCandidate] = useState<TransferCandidate | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const overviewQ = useQuery({
    queryKey: ["operationsOverview", businessId],
    enabled: !!businessId,
    queryFn: () => getOperationsOverview(String(businessId)),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const pairMutation = useMutation({
    mutationFn: async (candidate: TransferCandidate) => {
      if (!businessId) throw new Error("Choose a business first.");
      return applyTransferPair({ businessId, candidate });
    },
    onSuccess: async () => {
      setSelectedCandidate(null);
      setActionMessage("Transfer paired, both ledger legs created, and both bank transactions matched.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["operationsOverview", businessId] }),
        queryClient.invalidateQueries({ queryKey: ["bankTransactions", businessId], exact: false }),
        queryClient.invalidateQueries({ queryKey: ["entries", businessId], exact: false }),
      ]);
    },
  });

  const data = overviewQ.data;
  const closeBlockerTotal = data
    ? Object.values(data.close_readiness.blockers).reduce((sum, count) => sum + Number(count ?? 0), 0)
    : 0;
  const forecastEnding = data?.forecast.weeks.at(-1)?.ending_cash_cents ?? data?.forecast.starting_cash_cents ?? "0";
  const highestForecastAbs = useMemo(
    () => Math.max(1, ...(data?.forecast.weeks ?? []).map((row) => Math.abs(Number(row.net_cents ?? 0)))),
    [data?.forecast.weeks]
  );

  return (
    <div className="flex w-full max-w-[1500px] flex-col gap-3 pb-8">
      <div className="bb-page-command-surface rounded-xl px-3 py-3">
        <PageHeader
          icon={<TrendingUp className="h-4 w-4" />}
          title="Financial operations"
          subtitle="One review surface for bank health, close readiness, recurring cash expectations, category learning, and transfer pairs."
          right={
            <Button variant="outline" className="h-9" onClick={() => void overviewQ.refetch()} disabled={!businessId || overviewQ.isFetching}>
              <RefreshCw className={`h-4 w-4 ${overviewQ.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          }
        />
      </div>

      {overviewQ.error ? (
        <InlineBanner title="Financial operations did not load" message="The underlying books were not changed. Retry this read-only overview." onRetry={() => void overviewQ.refetch()} />
      ) : null}
      {actionMessage ? <InlineBanner title="Transfer completed" message={actionMessage} /> : null}
      {pairMutation.error ? <InlineBanner title="Transfer was not created" message={pairMutation.error instanceof Error ? pairMutation.error.message : "Review the pair and try again."} /> : null}

      {!data && overviewQ.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_unused, index) => <Skeleton key={index} className="h-28 rounded-lg" />)}
        </div>
      ) : data ? (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Operations summary">
            <StatCard
              icon={data.close_readiness.ready ? <CheckCircle2 className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}
              label="Month-end readiness"
              value={data.close_readiness.ready ? "Ready" : `${closeBlockerTotal} blockers`}
              meta={data.close_readiness.ready ? "No operational blockers detected." : "Review before closing the period."}
              tone={data.close_readiness.ready ? "good" : "warning"}
            />
            <StatCard
              icon={<Landmark className="h-4 w-4" />}
              label="Bank connection health"
              value={`${data.bank_health.healthy_count} healthy`}
              meta={`${data.bank_health.attention_count} need review • ${data.bank_health.not_connected_count} manual • ${data.bank_health.pending_count} pending`}
              tone={data.bank_health.attention_count ? "warning" : "good"}
            />
            <StatCard
              icon={<BrainCircuit className="h-4 w-4" />}
              label="Category intelligence"
              value={`${data.categorization.safe_reuse_rules} safe rules`}
              meta={`${data.categorization.uncategorized_count} uncategorized across active accounts • ${data.categorization.acceptance_rate == null ? "learning" : `${data.categorization.acceptance_rate}% accepted`}`}
              tone={data.categorization.uncategorized_count ? "warning" : "good"}
            />
            <StatCard
              icon={<ArrowRightLeft className="h-4 w-4" />}
              label="Transfer pairing"
              value={`${data.transfer_candidates.length} candidates`}
              meta={data.transfer_candidates.length ? "Equal-and-opposite posted activity ready for review." : "No unmatched cross-account pairs detected."}
              tone={data.transfer_candidates.length ? "warning" : "good"}
            />
          </section>

          <section className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.55fr)]">
            <Card className="min-w-0">
              <CardHeader className="border-b border-bb-border">
                <CardTitle className="flex items-center gap-2"><Landmark className="h-4 w-4 text-primary" />Bank connection health</CardTitle>
                <CardDescription>Each ledger remains independent. Health is calculated from that ledger’s own connection, sync freshness, and pending/unmatched activity.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 pt-0">
                {data.bank_health.accounts.map((account) => {
                  const status = bankHealthLabel(account);
                  const isCashBook = String(account.account_type ?? "").toUpperCase() === "CASH";
                  const delta = account.bank_balance_cents == null ? null : toBigIntSafe(account.bank_balance_cents) - toBigIntSafe(account.ledger_balance_cents);
                  return (
                    <div key={account.account_id} className="grid gap-3 rounded-lg border border-bb-border px-3 py-3 md:grid-cols-[minmax(0,1.35fr)_repeat(3,minmax(110px,0.65fr))_auto] md:items-center">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-bb-text">{account.account_name}</span>
                          <StatusPill tone={status.tone}>{status.label}</StatusPill>
                        </div>
                        <div className="mt-1 truncate text-xs text-bb-text-muted">
                          {isCashBook
                            ? "Ledger-only account • Bank connection and reconciliation not applicable"
                            : [account.institution_name, account.mask ? `••••${account.mask}` : "", account.last_sync_at ? `Synced ${new Date(account.last_sync_at).toLocaleString()}` : "No completed sync", `${account.pending_count} pending`, `${account.unmatched_count} unmatched`].filter(Boolean).join(" • ")}
                        </div>
                      </div>
                      <div><div className="text-[10px] font-semibold uppercase tracking-wide text-bb-text-muted">Ledger</div><div className="mt-1 text-sm font-medium tabular-nums">{formatUsdSafe(account.ledger_balance_cents)}</div></div>
                      <div><div className="text-[10px] font-semibold uppercase tracking-wide text-bb-text-muted">Bank</div><div className="mt-1 text-sm font-medium tabular-nums">{account.bank_balance_cents == null ? "—" : formatUsdSafe(account.bank_balance_cents)}</div></div>
                      <div><div className="text-[10px] font-semibold uppercase tracking-wide text-bb-text-muted">Difference</div><div className={`mt-1 text-sm font-medium tabular-nums ${delta && delta !== 0n ? "text-bb-status-warning-fg" : ""}`}>{delta == null ? "—" : formatUsdSafe(delta)}</div></div>
                      <Button asChild variant="outline" className="h-9 justify-center md:w-auto">
                        <Link href={isCashBook
                          ? `/ledger?businessId=${encodeURIComponent(String(businessId))}&accountId=${encodeURIComponent(account.account_id)}`
                          : `/reconcile?businessId=${encodeURIComponent(String(businessId))}&accountId=${encodeURIComponent(account.account_id)}`}
                        >
                          {isCashBook ? "Open ledger" : "Review"} <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-bb-border">
                <CardTitle className="flex items-center gap-2"><CalendarCheck2 className="h-4 w-4 text-primary" />Close command center</CardTitle>
                <CardDescription>Operational blockers that should be resolved before locking a period.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(data.close_readiness.blockers).map(([key, value]) => (
                  <div key={key} className="flex min-h-9 items-center justify-between gap-3 rounded-md border border-bb-border-muted px-3 py-2">
                    <span className="text-xs capitalize text-bb-text-muted">{key.replace(/_/g, " ")}</span>
                    <StatusPill tone={value ? "warning" : "good"}>{value}</StatusPill>
                  </div>
                ))}
                <Button asChild className="mt-2 w-full">
                  <Link href={`/closed-periods?businessId=${encodeURIComponent(String(businessId))}`}>Open close workflow <ArrowRight className="h-4 w-4" /></Link>
                </Button>
              </CardContent>
            </Card>
          </section>

          <section className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
            <Card className="min-w-0">
              <CardHeader className="border-b border-bb-border">
                <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />13-week cash-flow forecast</CardTitle>
                <CardDescription>{data.forecast.methodology}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-md border border-bb-border px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-bb-text-muted">Starting cash accounts</div><div className="mt-1 font-semibold tabular-nums">{formatUsdSafe(data.forecast.starting_cash_cents)}</div></div>
                  <div className="rounded-md border border-bb-border px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-bb-text-muted">Week 13 cash</div><div className="mt-1 font-semibold tabular-nums">{formatUsdSafe(forecastEnding)}</div></div>
                  <div className="col-span-2 rounded-md border border-bb-border px-3 py-2 sm:col-span-1"><div className="text-[10px] uppercase tracking-wide text-bb-text-muted">Recurring patterns</div><div className="mt-1 font-semibold tabular-nums">{data.forecast.recurring.length}</div></div>
                </div>
                <ForecastChart rows={data.forecast.weeks} />
                <div className="sr-only">Forecast chart maximum weekly movement {formatUsdSafe(String(highestForecastAbs))}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b border-bb-border">
                <CardTitle className="flex items-center gap-2"><BrainCircuit className="h-4 w-4 text-primary" />What BynkBook has learned</CardTitle>
                <CardDescription>Only repeated, user-approved history becomes a safe automatic category reuse rule.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-md border border-bb-border px-3 py-3"><div className="text-2xl font-semibold tabular-nums">{data.categorization.learned_merchant_rules}</div><div className="mt-1 text-xs text-bb-text-muted">Learned merchant mappings</div></div>
                  <div className="rounded-md border border-bb-border px-3 py-3"><div className="text-2xl font-semibold tabular-nums">{data.categorization.safe_reuse_rules}</div><div className="mt-1 text-xs text-bb-text-muted">Safe deterministic rules</div></div>
                </div>
                <div className="text-xs leading-5 text-bb-text-muted">Protected transactions such as payroll, taxes, transfers, loans, Zelle, ACH, and owner activity remain review-first even when a category is suggested.</div>
                <Button asChild variant="outline" className="w-full"><Link href={`/category-review?businessId=${encodeURIComponent(String(businessId))}`}>Review categories <ArrowRight className="h-4 w-4" /></Link></Button>
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader className="border-b border-bb-border">
              <CardTitle className="flex items-center gap-2"><ArrowRightLeft className="h-4 w-4 text-primary" />Suggested inter-account transfers</CardTitle>
              <CardDescription>Pairs are detected from equal-and-opposite posted bank activity across separate ledgers. Nothing is created until you confirm a pair.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {data.transfer_candidates.length === 0 ? (
                <div className="rounded-lg border border-dashed border-bb-border px-4 py-8 text-center text-sm text-bb-text-muted">No unmatched transfer pairs detected.</div>
              ) : data.transfer_candidates.map((candidate) => (
                <div key={candidate.id} className="grid gap-3 rounded-lg border border-bb-border px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold"><span className="truncate">{candidate.from_account_name}</span><ArrowRight className="h-4 w-4 text-bb-text-muted" /><span className="truncate">{candidate.to_account_name}</span><StatusPill tone={candidate.confidence === "HIGH" ? "good" : "warning"}>{candidate.confidence}</StatusPill></div>
                    <div className="mt-1 text-xs leading-5 text-bb-text-muted">{candidate.reason}</div>
                  </div>
                  <div className="text-left md:text-right"><div className="text-sm font-semibold tabular-nums">{formatUsdSafe(candidate.amount_cents)}</div><div className="text-[11px] tabular-nums text-bb-text-muted">{candidate.outbound_date} → {candidate.inbound_date}</div></div>
                  <Button className="h-9" onClick={() => { setActionMessage(null); setSelectedCandidate(candidate); }}>Review pair</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ) : null}

      <AppDialog
        open={!!selectedCandidate}
        onClose={() => setSelectedCandidate(null)}
        title="Confirm transfer pair"
        size="md"
        footer={
          <DialogFooter right={<><Button variant="outline" onClick={() => setSelectedCandidate(null)} disabled={pairMutation.isPending}>Cancel</Button><Button onClick={() => selectedCandidate && pairMutation.mutate(selectedCandidate)} disabled={!selectedCandidate || pairMutation.isPending}>{pairMutation.isPending ? "Creating transfer…" : "Create and match transfer"}</Button></>}/>
        }
      >
        {selectedCandidate ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border border-bb-border bg-bb-surface-soft px-3 py-3">
              <div className="font-semibold">{selectedCandidate.from_account_name} → {selectedCandidate.to_account_name}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{formatUsdSafe(selectedCandidate.amount_cents)}</div>
              <div className="mt-2 text-xs leading-5 text-bb-text-muted">{selectedCandidate.reason}</div>
            </div>
            <p className="leading-6 text-bb-text-muted">BynkBook will create two linked TRANSFER ledger entries and match each posted bank transaction to its corresponding ledger. Existing ledger entries are not deleted.</p>
          </div>
        ) : null}
      </AppDialog>
    </div>
  );
}
