"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
// Auth handled by AppShell

import { useQuery } from "@tanstack/react-query";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";
import { useIdleReady } from "@/lib/useIdleReady";
import { usePreferredAccountId } from "@/lib/accountSelection";
import { getPnlSummary, getCashflowSeries, getCategories, getAccountsSummary } from "@/lib/api/reports";
import { getAttentionSummary } from "@/lib/api/attentionSummary";
import { attentionSummaryKey } from "@/lib/queries/attentionSummary";

import { aiExplainReport, aiAnomalies, aiChatAggregates } from "@/lib/api/ai";

import { AppDatePicker } from "@/components/primitives/AppDatePicker";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

import {
  LayoutDashboard,
  Wallet,
  Timer,
  TrendingUp,
  TrendingDown,
  Sigma,
  Landmark,
  AlertTriangle,
  Tag,
  Sparkles,
  CalendarDays,
  ArrowRight,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";

import { EmptyStateCard } from "@/components/app/empty-state";
import { InlineBanner } from "@/components/app/inline-banner";
import { OnboardingChecklist } from "@/components/dashboard/onboarding-checklist";
import { appErrorMessageOrNull, extractHttpStatus } from "@/lib/errors/app-error";
import { formatUsdSafe } from "@/lib/money";
import { aiUserMessage } from "@/lib/errors/ai";
import Link from "next/link";

const DashboardChartPanels = dynamic(() => import("./dashboard-chart-panels"), {
  loading: () => <DashboardChartPanelsFallback />,
});

function DashboardChartPanelsFallback() {
  return (
    <>
      {[
        { title: "Cash Flow", height: "h-[130px]" },
        { title: "Cash Position", height: "h-[130px]" },
        { title: "Category Breakdown", height: "h-[200px]" },
      ].map((panel) => (
        <Card key={panel.title} className="rounded-[10px] border border-bb-border bg-bb-surface-card shadow-sm">
          <CHeader className="py-1">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-base font-semibold text-foreground/90">{panel.title}</div>
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="h-10 w-10 rounded-lg" />
            </div>
          </CHeader>
          <CardContent className="px-3 pb-1 pt-0.5">
            <Skeleton className={`${panel.height} w-full rounded-md`} />
          </CardContent>
        </Card>
      ))}
    </>
  );
}

type PeriodMode = "THIS_MONTH" | "LAST_MONTH" | "LAST_3_MONTHS" | "YTD" | "CUSTOM";

type Money = { text: string; isNeg: boolean };

function isoYmd(d: Date) {
  return d.toISOString().slice(0, 10);
}
function ymOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function firstOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function lastOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function addMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}
function monthAbbr(raw: string) {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const s = String(raw ?? "").trim();

  if (/^\d{4}-\d{2}$/.test(s)) {
    const m = Number(s.slice(5, 7));
    return `${names[m - 1] ?? s} ${s.slice(2, 4)}`;
  }

  return s || "—";
}

function normalizeMonthKey(raw: any) {
  const s = String(raw ?? "").trim();

  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  return "";
}

function absBig(n: bigint) {
  return n < 0n ? -n : n;
}

function fmtUsdAccountingFromCents(centsStr?: string): Money {
  if (!centsStr) return { text: "—", isNeg: false };
  let n: bigint;
  try {
    n = BigInt(centsStr);
  } catch {
    return { text: "—", isNeg: false };
  }
  const isNeg = n < 0n;
  const a = isNeg ? -n : n;

  const dollars = a / 100n;
  const cents = a % 100n;

  const dollarsStr = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents2 = cents.toString().padStart(2, "0");
  const base = `$${dollarsStr}.${cents2}`;
  return { text: isNeg ? `(${base})` : base, isNeg };
}

function centsToNumber(centsStr: string) {
  try {
    return Number(BigInt(centsStr)) / 100;
  } catch {
    return 0;
  }
}

function moneyClassFromCents(centsStr?: string) {
  try {
    if (!centsStr) return "text-bb-amount-neutral";
    return BigInt(centsStr) < 0n ? "text-bb-amount-negative" : "text-bb-amount-neutral";
  } catch {
    return "text-bb-amount-neutral";
  }
}

type DashboardCommandTone = "danger" | "success" | "warning";

const commandToneClasses: Record<DashboardCommandTone, { bg: string; fg: string; border: string }> = {
  danger: {
    bg: "bg-bb-status-danger-bg",
    fg: "text-bb-status-danger-fg",
    border: "hover:border-bb-status-danger-fg/25 hover:bg-bb-status-danger-bg/70",
  },
  success: {
    bg: "bg-bb-status-success-bg",
    fg: "text-bb-status-success-fg",
    border: "hover:border-bb-status-success-fg/25 hover:bg-bb-status-success-bg/70",
  },
  warning: {
    bg: "bg-bb-status-warning-bg",
    fg: "text-bb-status-warning-fg",
    border: "hover:border-bb-status-warning-fg/25 hover:bg-bb-status-warning-bg/70",
  },
};

function DashboardCommandAction({
  href,
  icon: Icon,
  label,
  count,
  meta,
  tone,
  loading,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  count: number;
  meta: string;
  tone: DashboardCommandTone;
  loading: boolean;
}) {
  const classes = commandToneClasses[tone];

  return (
    <Link
      href={href}
      prefetch={false}
      className={`group flex min-h-[76px] items-center gap-3 rounded-lg border border-bb-border bg-bb-surface-card px-3 py-3 text-left shadow-sm transition-colors ${classes.border}`}
    >
      <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${classes.bg}`}>
        <Icon className={`h-4 w-4 ${classes.fg}`} strokeWidth={2.2} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-tight text-foreground">
          {loading ? <Skeleton className="h-4 w-28" /> : `${count} ${label}`}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">{meta}</span>
      </span>

      <ArrowRight className="h-4 w-4 shrink-0 text-bb-text-subtle opacity-60 transition-transform group-hover:translate-x-0.5 group-hover:opacity-100" />
    </Link>
  );
}

export default function DashboardPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const accountsQ = useAccounts(selectedBusinessId);

  const spKey = sp.toString();

  useEffect(() => {
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;
    const params = new URLSearchParams(spKey);
    if (!params.get("businessId")) router.replace(`/dashboard?businessId=${selectedBusinessId}`);
  }, [businessesQ.isLoading, selectedBusinessId, router, spKey]);

  // Period selector (top-right; controls ALL widgets)
  const [periodMode, setPeriodMode] = useState<PeriodMode>("LAST_3_MONTHS");
  const [customFrom, setCustomFrom] = useState<string>(() => isoYmd(firstOfMonth(new Date())));
  const [customTo, setCustomTo] = useState<string>(() => isoYmd(new Date()));

  const range = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (periodMode === "THIS_MONTH") {
      const from = isoYmd(firstOfMonth(today));
      const to = isoYmd(today);
      return { from, to, mode: periodMode };
    }

    if (periodMode === "LAST_MONTH") {
      const lm = addMonths(today, -1);
      const from = isoYmd(firstOfMonth(lm));
      const to = isoYmd(lastOfMonth(lm));
      return { from, to, mode: periodMode };
    }

    if (periodMode === "LAST_3_MONTHS") {
      const start = addMonths(today, -2);
      const from = isoYmd(firstOfMonth(start));
      const to = isoYmd(today);
      return { from, to, mode: periodMode };
    }

    if (periodMode === "YTD") {
      const from = `${today.getFullYear()}-01-01`;
      const to = isoYmd(today);
      return { from, to, mode: periodMode };
    }

    // CUSTOM
    const from = customFrom || isoYmd(firstOfMonth(today));
    const to = customTo || isoYmd(today);
    return { from, to, mode: periodMode };
  }, [periodMode, customFrom, customTo]);

  const dashEnabled = !!selectedBusinessId;

  // Defer non-critical widgets (Next actions badge) until idle so primary
  // dashboard content (P&L chart, Cashflow chart, account cards) gets the
  // network bandwidth on first paint.
  const dashIdleReady = useIdleReady(dashEnabled, 1200);

  // Account scope selector: All accounts vs a specific account
  const [accountScopeId, setAccountScopeId] = useState<string>("all");
  const preferredAccountId = usePreferredAccountId({
    businessId: selectedBusinessId,
    accounts: accountsQ.data ?? [],
    accountIdFromUrl: sp.get("accountId"),
  });

  const issuesAccountScopeId = useMemo(() => {
    if (accountScopeId && accountScopeId !== "all") return accountScopeId;
    return preferredAccountId;
  }, [accountScopeId, preferredAccountId]);

  const issuesHref = useMemo(() => {
    if (!selectedBusinessId) return "/issues";

    const params = new URLSearchParams();
    params.set("businessId", selectedBusinessId);
    if (issuesAccountScopeId) params.set("accountId", issuesAccountScopeId);

    return `/issues?${params.toString()}`;
  }, [selectedBusinessId, issuesAccountScopeId]);

  const categoryReviewHref = useMemo(() => {
    if (!selectedBusinessId) return "/category-review";

    const params = new URLSearchParams();
    params.set("businessId", selectedBusinessId);
    if (issuesAccountScopeId) params.set("accountId", issuesAccountScopeId);

    return `/category-review?${params.toString()}`;
  }, [selectedBusinessId, issuesAccountScopeId]);

  const reconcileHref = useMemo(() => {
    if (!selectedBusinessId) return "/reconcile";

    const params = new URLSearchParams();
    params.set("businessId", selectedBusinessId);
    if (issuesAccountScopeId) params.set("accountId", issuesAccountScopeId);

    return `/reconcile?${params.toString()}`;
  }, [selectedBusinessId, issuesAccountScopeId]);

  // Keep-last-good: preserve previous data while fetching new period.
  const pnlQ = useQuery({
    queryKey: ["dashboardExec", "pnlSummary", selectedBusinessId, accountScopeId, range.from, range.to, range.mode,],
    queryFn: () =>
      getPnlSummary(selectedBusinessId as string, {
        from: range.from,
        to: range.to,
        accountId: accountScopeId,
        ytd: range.mode === "YTD",
      }),
    enabled: dashEnabled,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });

  const cashflowQ = useQuery({
    queryKey: ["dashboardExec", "cashflowSeries", selectedBusinessId, accountScopeId, range.from, range.to, range.mode],
    queryFn: () =>
      getCashflowSeries(selectedBusinessId as string, {
        from: range.from,
        to: range.to,
        accountId: accountScopeId,
        ytd: range.mode === "YTD",
      }),
    enabled: dashEnabled,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });

  const categoriesQ = useQuery({
    queryKey: ["dashboardExec", "categories", selectedBusinessId, accountScopeId, range.from, range.to, range.mode],
    queryFn: () => getCategories(selectedBusinessId as string, { from: range.from, to: range.to, accountId: accountScopeId }),
    enabled: dashEnabled,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const attentionSummaryQ = useQuery({
    queryKey: attentionSummaryKey(selectedBusinessId, issuesAccountScopeId),
    queryFn: () => getAttentionSummary({ businessId: selectedBusinessId as string, accountId: issuesAccountScopeId }),
    enabled: dashEnabled && !!issuesAccountScopeId && dashIdleReady,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });

  const attentionLoading = attentionSummaryQ.isLoading && !attentionSummaryQ.data;
  const openIssuesN = Number(attentionSummaryQ.data?.issue_count ?? 0) || 0;
  const uncategorizedN = Number(attentionSummaryQ.data?.uncategorized_count ?? 0) || 0;
  const bankUnmatchedN = Number(attentionSummaryQ.data?.bank_unmatched_count ?? 0) || 0;
  const nextActionsN = openIssuesN + uncategorizedN + bankUnmatchedN;

  // Always fetch "all accounts" summary (for account picker options + business cash balance)
  const accountsAllQ = useQuery({
    queryKey: ["dashboardExec", "accountsSummaryAll", selectedBusinessId, range.to],
    queryFn: () =>
      getAccountsSummary(selectedBusinessId as string, {
        asOf: range.to,
        accountId: "all",
        includeArchived: false,
      }),
    enabled: dashEnabled,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });

  // Scoped summary for the selected account (or all)
  const accountsSummaryQ = useQuery({
    queryKey: ["dashboardExec", "accountsSummary", selectedBusinessId, range.to, accountScopeId],
    queryFn: () =>
      getAccountsSummary(selectedBusinessId as string, {
        asOf: range.to,
        accountId: accountScopeId,
        includeArchived: false,
      }),
    enabled: dashEnabled,
    staleTime: 20_000,
    placeholderData: (prev) => prev,
  });

  const [aiInsightsRequested, setAiInsightsRequested] = useState(false);
  // Collapsible AI panel: when collapsed, only a single CTA shows.
  // When expanded, the three sub-cards (Summary, Anomalies, Ask AI) appear.
  // Defaults to collapsed so the dashboard isn't visually dominated by AI cards.
  const [aiPanelExpanded, setAiPanelExpanded] = useState(false);

    // ---------- Bundle F: AI narrative + anomalies (read-only) ----------
  const aiNarrativeQ = useQuery({
    queryKey: ["aiNarrative", selectedBusinessId, accountScopeId, range.from, range.to, range.mode],
    enabled: aiInsightsRequested && !!selectedBusinessId && !!range?.from && !!range?.to,
    placeholderData: (prev) => prev ?? null,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const summary = {
        pnl: pnlQ.data ?? null,
        cashflow: cashflowQ.data ?? null,
        categories: categoriesQ.data ?? null,
        accounts: accountsSummaryQ.data ?? null,
      };

      return aiExplainReport({
        businessId: selectedBusinessId as string,
        reportTitle: "AI Summary",
        period: { mode: range.mode, from: range.from, to: range.to, accountId: accountScopeId ?? "all" },
        summary,
      });
    },
  });

  const aiAnomaliesQ = useQuery({
    queryKey: ["aiAnomalies", selectedBusinessId, accountScopeId, range.from, range.to],
    enabled: aiInsightsRequested && !!selectedBusinessId && !!range?.from && !!range?.to,
    placeholderData: (prev) => prev ?? null,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      return aiAnomalies({
        businessId: selectedBusinessId as string,
        accountId: accountScopeId && accountScopeId !== "all" ? accountScopeId : undefined,
        from: range.from,
        to: range.to,
      });
    },
  });

  // Delegates to lib/errors/ai. Dashboard's wording assumes the prod
  // limit is a per-business daily cap (matches the API's actual quota model).
  function dashboardAiMessage(err: any, fallback = "AI is unavailable right now.") {
    return aiUserMessage(err, {
      fallback,
      quotaMessage: "AI daily limit reached for this business. Try again tomorrow.",
    });
  }

  const ai429 =
    String((aiNarrativeQ.error as any)?.message ?? "").includes("429") ||
    String((aiAnomaliesQ.error as any)?.message ?? "").includes("429");

  function requestAiInsights() {
    if (!selectedBusinessId) return;

    if (!aiInsightsRequested) {
      setAiInsightsRequested(true);
      return;
    }

    void aiNarrativeQ.refetch();
    void aiAnomaliesQ.refetch();
  }

  const dashErr = useMemo(() => {
    const errs = [pnlQ.error, cashflowQ.error, categoriesQ.error, accountsSummaryQ.error].filter(Boolean) as any[];
    if (errs.length === 0) return null;

    const first = errs[0];
    const status = extractHttpStatus(first);
    const detail = appErrorMessageOrNull(first) ?? "Something went wrong. Try again.";
    if (status === 401) return { title: "Signed out", detail };
    if (status === 403) return { title: "Access denied", detail };
    return { title: "Dashboard failed to load", detail };
  }, [pnlQ.error, cashflowQ.error, categoriesQ.error, accountsSummaryQ.error]);

  const refetchAll = () => {
    void pnlQ.refetch();
    void cashflowQ.refetch();
    void categoriesQ.refetch();
    void accountsSummaryQ.refetch();
  };

  const dashboardInitialLoading =
    businessesQ.isLoading ||
    (dashEnabled &&
      ((pnlQ.isLoading && !pnlQ.data) ||
        (cashflowQ.isLoading && !cashflowQ.data) ||
        (categoriesQ.isLoading && !categoriesQ.data) ||
        (accountsSummaryQ.isLoading && !accountsSummaryQ.data)));
  const showDashboardBody = !!selectedBusinessId || businessesQ.isLoading;
  const showAttentionLoading = dashboardInitialLoading || attentionLoading;

  // ---- Derivations (deterministic only) ----
  const cashBalanceCents = useMemo(() => {
    let s = 0n;
    for (const r of accountsSummaryQ.data?.rows ?? []) {
      try {
        s += BigInt(String((r as any).balance_cents ?? "0"));
      } catch {
        // ignore
      }
    }
    return String(s);
  }, [accountsSummaryQ.data]);

  const revenueCents = pnlQ.data?.period?.income_cents ?? null;
  const expensesCents = pnlQ.data?.period?.expense_cents ?? null;
  const netCents = pnlQ.data?.period?.net_cents ?? null;

  // Monthly cash ending series for Cash Position:
  // - If backend provides ending_cash_cents (or similar), use it.
  // - Else compute cumulative net and offset so the last point matches cashBalanceCents.
  const cashMonthly = useMemo(() => {
    const rows = (cashflowQ.data?.monthly ?? []) as any[];
    if (!Array.isArray(rows) || rows.length < 1) return [] as any[];

    const monthKeyOf = (raw: any) => {
      const s = String(raw ?? "").trim();

      // Preferred: YYYY-MM
      if (/^\d{4}-\d{2}$/.test(s)) return s;

      // Also accept YYYY-MM-DD and normalize to YYYY-MM
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);

      // Do NOT accept/return weekday strings like "Fri Aug".
      // Return empty marker to trigger a deterministic synthetic timeline.
      return "";
    };

    const mapped = [...rows].map((r) => ({
      ...r,
      month: monthKeyOf(r.month ?? r.ym ?? r.date ?? r.period),
    }));

    const allValidYm = mapped.length > 0 && mapped.every((r) => /^\d{4}-\d{2}$/.test(String(r.month)));

    const sorted = allValidYm
      ? mapped.sort((a, b) => (String(a.month) > String(b.month) ? 1 : -1))
      : (() => {
        // Synthetic month keys ending at range.to month, preserving row order.
        const end = new Date(`${range.to}T00:00:00`);
        const endMonth = new Date(end.getFullYear(), end.getMonth(), 1);

        const n = mapped.length;
        return mapped.map((r, i) => {
          const d = new Date(endMonth.getFullYear(), endMonth.getMonth() - (n - 1 - i), 1);
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          return { ...r, month: ym };
        });
      })();

    let cashEnd: bigint;
    try {
      cashEnd = BigInt(String(cashBalanceCents ?? "0"));
    } catch {
      cashEnd = 0n;
    }

    // Prefer server-provided ending cash if present.
    const serverEnding = sorted.every((r) => r.ending_cash_cents != null);
    if (serverEnding) {
      return sorted.map((r) => ({
        ym: String(r.month),
        label: monthAbbr(String(r.month)),
        endingCashCents: String(r.ending_cash_cents ?? "0"),
        cashInCents: String(r.cash_in_cents ?? "0"),
        cashOutCents: String(r.cash_out_cents ?? "0"),
        netCents: String(r.net_cents ?? "0"),
      }));
    }

    // Otherwise: cumulative net (per bucket) and offset to match real ending cash.
    const cum: bigint[] = [];
    let run = 0n;
    for (const r of sorted) {
      try {
        run += BigInt(String(r.net_cents ?? "0"));
      } catch {
        // ignore
      }
      cum.push(run);
    }

    const lastCum = cum[cum.length - 1] ?? 0n;
    const offset = cashEnd - lastCum;

    return sorted.map((r, i) => {
      const ending = (cum[i] ?? 0n) + offset;
      return {
        ym: String(r.month),
        label: monthAbbr(String(r.month)),
        endingCashCents: String(ending),
        cashInCents: String(r.cash_in_cents ?? "0"),
        cashOutCents: String(r.cash_out_cents ?? "0"),
        netCents: String(r.net_cents ?? "0"),
      };
    });
  }, [cashflowQ.data, cashBalanceCents, range.to]);

  // ---------- Bundle F: Ask Your Business (aggregates-only chat) ----------
  type ChatMsg = { role: "user" | "assistant"; text: string; ts: number };

  const [chatQ, setChatQ] = useState("");
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatErr, setChatErr] = useState<string | null>(null);

  // Persist Ask AI chat in sessionStorage so accidental refresh doesn't
  // lose the conversation. Keyed by businessId + period scope; clears
  // automatically when the user closes the tab.
  const chatStorageKey = useMemo(() => {
    if (!selectedBusinessId) return null;
    return `bynkbook.askAi.chat.${selectedBusinessId}.${range.mode}.${range.from}.${range.to}`;
  }, [selectedBusinessId, range.mode, range.from, range.to]);

  // Hydrate from sessionStorage on key change (entering business / changing period).
  useEffect(() => {
    if (!chatStorageKey) return;
    try {
      const raw = window.sessionStorage.getItem(chatStorageKey);
      if (!raw) {
        setChatMsgs([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setChatMsgs(parsed as ChatMsg[]);
    } catch {
      /* corrupt or unavailable storage; start empty */
    }
  }, [chatStorageKey]);

  // Persist whenever messages change.
  useEffect(() => {
    if (!chatStorageKey) return;
    try {
      window.sessionStorage.setItem(chatStorageKey, JSON.stringify(chatMsgs));
    } catch {
      /* quota exceeded or unavailable; silently degrade */
    }
  }, [chatStorageKey, chatMsgs]);

  const chatAggregates = useMemo(() => {
    return {
      period: { mode: range.mode, from: range.from, to: range.to, accountId: accountScopeId ?? "all" },
      pnl: pnlQ.data ?? null,
      cashflow: cashflowQ.data ?? null,
      categories: categoriesQ.data ?? null,
      accounts: accountsSummaryQ.data ?? null,
      // Links the assistant can use (app-relative only)
      links: {
        dashboard: "/dashboard",
        ledger: `/ledger?businessId=${selectedBusinessId ?? ""}&accountId=${accountScopeId ?? "all"}&from=${range.from}&to=${range.to}`,
        reports: `/reports?businessId=${selectedBusinessId ?? ""}&accountId=${accountScopeId ?? "all"}&from=${range.from}&to=${range.to}`,
        reconcile: `/reconcile?businessId=${selectedBusinessId ?? ""}&accountId=${accountScopeId ?? "all"}`,
      },
    };
  }, [range, accountScopeId, selectedBusinessId, pnlQ.data, cashflowQ.data, categoriesQ.data, accountsSummaryQ.data]);

  async function sendChat() {
    if (!selectedBusinessId) return;
    const q = chatQ.trim();
    if (!q) return;

    setChatErr(null);
    setChatBusy(true);
    setChatMsgs((m) => [...m, { role: "user", text: q, ts: Date.now() }]);
    setChatQ("");

    try {
      const res: any = await aiChatAggregates({
        businessId: selectedBusinessId,
        question: q,
        aggregates: chatAggregates,
      });

      if (!res?.ok) throw new Error(res?.error || "Chat failed");

      setChatMsgs((m) => [...m, { role: "assistant", text: String(res.answer ?? ""), ts: Date.now() }]);
    } catch (e: any) {
      setChatErr(dashboardAiMessage(e, "AI is unavailable right now."));
    } finally {
      setChatBusy(false);
    }
  }

  // Area chart animation: tween values over 200ms when series length matches.
  const [animCashMonthly, setAnimCashMonthly] = useState(cashMonthly);

  const cashBarsData = useMemo(() => {
    return (animCashMonthly ?? []).map((r: any) => {
      const cashIn = centsToNumber(String(r.cashInCents ?? "0")); // dollars (>=0)
      const cashOutAbs = Math.abs(centsToNumber(String(r.cashOutCents ?? "0"))); // dollars (abs)
      return {
        ym: String(r.ym ?? ""),
        label: String(r.label ?? ""),
        cashIn,
        cashOutAbs,
      };
    });
  }, [animCashMonthly]);

  const cashPosData = useMemo(() => {
    return (animCashMonthly ?? []).map((r: any) => {
      const endingCash = centsToNumber(String(r.endingCashCents ?? "0")); // dollars
      return {
        ym: String(r.ym ?? ""),
        label: String(r.label ?? ""),
        endingCash,
        endingCashPos: Math.max(endingCash, 0),
        endingCashNeg: Math.min(endingCash, 0),
      };
    });
  }, [animCashMonthly]);

  const prevCashMonthlyRef = useRef(cashMonthly);

  useEffect(() => {
    const prev = prevCashMonthlyRef.current;
    const next = cashMonthly;

    // If shape changes, snap (still keep-last-good visually during fetch).
    if (!prev || !next || prev.length !== next.length || prev.length < 2) {
      prevCashMonthlyRef.current = next;
      setAnimCashMonthly(next);
      return;
    }

    // If values unchanged, do nothing.
    const same = prev.every(
      (p: any, i: number) =>
        p.ym === next[i].ym &&
        String(p.endingCashCents) === String(next[i].endingCashCents) &&
        String(p.cashInCents) === String(next[i].cashInCents) &&
        String(p.cashOutCents) === String(next[i].cashOutCents) &&
        String(p.netCents) === String(next[i].netCents)
    );
    if (same) return;

    const start = performance.now();
    const dur = 200;

    const centsNum = (s: any) => {
      try {
        return Number(BigInt(String(s ?? "0")));
      } catch {
        return 0;
      }
    };

    const prevEnd = prev.map((r: any) => centsNum(r.endingCashCents));
    const nextEnd = next.map((r: any) => centsNum(r.endingCashCents));

    const prevIn = prev.map((r: any) => centsNum(r.cashInCents));
    const nextIn = next.map((r: any) => centsNum(r.cashInCents));

    const prevOut = prev.map((r: any) => centsNum(r.cashOutCents));
    const nextOut = next.map((r: any) => centsNum(r.cashOutCents));

    const prevNet = prev.map((r: any) => centsNum(r.netCents));
    const nextNet = next.map((r: any) => centsNum(r.netCents));

    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / dur);
      const ease = 1 - Math.pow(1 - k, 3); // easeOutCubic

      const blended = next.map((r: any, i: number) => {
        const lerp = (a: number, b: number) => a + (b - a) * ease;

        const endC = BigInt(Math.round(lerp(prevEnd[i], nextEnd[i])));
        const inC = BigInt(Math.round(lerp(prevIn[i], nextIn[i])));
        const outC = BigInt(Math.round(lerp(prevOut[i], nextOut[i])));
        const netC = BigInt(Math.round(lerp(prevNet[i], nextNet[i])));

        return {
          ...r,
          endingCashCents: String(endC),
          cashInCents: String(inC),
          cashOutCents: String(outC),
          netCents: String(netC),
        };
      });

      setAnimCashMonthly(blended);

      if (k < 1) raf = requestAnimationFrame(tick);
      else {
        prevCashMonthlyRef.current = next;
        setAnimCashMonthly(next);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cashMonthly]);

  const runway = useMemo(() => {
    // avg monthly expenses (last 3 full months) derived from pnl monthly buckets if present.
    const monthly = (pnlQ.data?.monthly ?? []) as any[];
    const sorted = [...monthly].map((r) => ({ ...r, month: String(r.month) })).sort((a, b) => (a.month > b.month ? 1 : -1));

    // Use last 3 *full* months if possible. For simplicity, take last 3 buckets excluding current partial month when mode includes current month.
    // Deterministic rule: if we have >=4 buckets and range includes current month, drop the last bucket from avg calc.
    const nowYm = ymOf(new Date());
    const includesCurrent = sorted.some((r) => String(r.month) === nowYm) && (range.mode === "THIS_MONTH" || range.mode === "LAST_3_MONTHS" || range.mode === "YTD" || range.mode === "CUSTOM");

    const usable = includesCurrent && sorted.length >= 4 ? sorted.slice(0, -1) : sorted;
    const last3 = usable.slice(-3);

    let expSumAbs = 0n;
    let n = 0n;

    for (const r of last3) {
      try {
        const e = BigInt(String(r.expense_cents ?? "0"));
        expSumAbs += absBig(e);
        n += 1n;
      } catch {
        // ignore
      }
    }

    if (n === 0n) return { display: "—", tooltip: null as string | null };

    // average monthly expense in cents
    const avg = expSumAbs / n;
    if (avg <= 0n) return { display: "—", tooltip: null };

    let cash: bigint;
    try {
      cash = BigInt(String(cashBalanceCents ?? "0"));
    } catch {
      cash = 0n;
    }

    if (cash <= 0n) return { display: "0.0", tooltip: "Runway: 0.0 months" };

    const months = Number(cash) / Number(avg);
    if (!Number.isFinite(months)) return { display: "—", tooltip: null };

    const uncapped = Math.round(months * 10) / 10; // 1 decimal
    const capped = uncapped > 24 ? "24+ months" : `${uncapped.toFixed(1)} months`;
    const tip = uncapped > 24 ? `Runway: ${uncapped.toFixed(1)} months (display capped)` : `Runway: ${uncapped.toFixed(1)} months`;

    return { display: capped, tooltip: tip };
  }, [pnlQ.data, cashBalanceCents, range.mode]);

  const topExpenseCats = useMemo(() => {
    const cats: any = categoriesQ.data;
    const rows = Array.isArray(cats?.rows) ? cats.rows : [];
    const items = rows
      .map((r: any) => ({
        label: String(r.category ?? r.category_name ?? r.name ?? r.label ?? "Category"),
        cents: String(r.amount_cents ?? r.total_cents ?? r.spent_cents ?? r.value_cents ?? r.cents ?? "0"),
      }))
      .filter((x: any) => x && typeof x.cents === "string")
      .filter((x: any) => {
        try {
          return absBig(BigInt(x.cents)) > 0n;
        } catch {
          return false;
        }
      });

    // Expenses only: take absolute value for ranking; keep original sign for display (should be negative).
    const abs = (s: string) => {
      try {
        return absBig(BigInt(s));
      } catch {
        return 0n;
      }
    };

    const sorted = items.sort((a: any, b: any) => (abs(b.cents) > abs(a.cents) ? 1 : abs(b.cents) < abs(a.cents) ? -1 : 0));

    const top = sorted.slice(0, 6);
    const rest = sorted.slice(6);

    let other = 0n;
    for (const r of rest) {
      try {
        other += absBig(BigInt(r.cents));
      } catch {
        // ignore
      }
    }

    // total for pct calc
    let total = 0n;
    for (const r of sorted) {
      try {
        total += absBig(BigInt(r.cents));
      } catch {
        // ignore
      }
    }

    const withOther =
      other > 0n
        ? [
          ...top.map((t: any) => ({ ...t, absCents: abs(t.cents) })),
          { label: "Other", cents: String(other), absCents: other },
        ]
        : top.map((t: any) => ({ ...t, absCents: abs(t.cents) }));

    if (total <= 0n) return { rows: [] as any[], totalAbs: 0n };
    return { rows: withOther, totalAbs: total };
  }, [categoriesQ.data]);

  const expensePieData = useMemo(() => {
    const rows = topExpenseCats?.rows ?? [];
    if (!Array.isArray(rows) || rows.length === 0) return [] as any[];
    return rows.map((r: any) => ({
      label: String(r.label ?? "Category"),
      // dollars (positive) for pie geometry; tooltip renders as negative accounting.
      value: Math.max(0, centsToNumber(String(r.absCents ?? "0"))),
    }));
  }, [topExpenseCats]);
  const expenseRanked = useMemo(() => {
    const rows = topExpenseCats.rows ?? [];
    const total = topExpenseCats.totalAbs ?? 0n;

    return rows
      .slice(0, 8)
      .map((r: any) => {
        let absC = 0n;
        try {
          absC = BigInt(String(r.absCents ?? "0"));
        } catch {
          absC = 0n;
        }
        const pct = total > 0n ? Number(absC) / Number(total) : 0;
        return {
          label: String(r.label ?? "Category"),
          absCents: String(absC),
          pct: Number.isFinite(pct) ? pct : 0,
        };
      });
  }, [topExpenseCats]);

  const monthlySummary = useMemo(() => {
    const pnlMonthly = (pnlQ.data?.monthly ?? []) as any[];

    const pnlSorted = [...pnlMonthly]
      .map((r) => ({
        ...r,
        month: normalizeMonthKey(r.month),
      }))
      .filter((r) => !!r.month)
      .sort((a, b) => (a.month > b.month ? 1 : -1));

    const cashByYm: Record<string, string> = {};
    for (const r of cashMonthly) {
      const ym = normalizeMonthKey(r.ym);
      if (ym) cashByYm[ym] = String(r.endingCashCents ?? "0");
    }

    const rows = pnlSorted.map((r, idx) => {
      const ym = normalizeMonthKey(r.month);
      const ending = ym ? cashByYm[ym] ?? null : null;

      let deltaCash: string | null = null;
      if (ending && idx > 0) {
        const prevYm = normalizeMonthKey(pnlSorted[idx - 1].month);
        const prevEnd = prevYm ? cashByYm[prevYm] ?? null : null;
        if (prevEnd) {
          try {
            deltaCash = String(BigInt(ending) - BigInt(prevEnd));
          } catch {
            deltaCash = null;
          }
        }
      }

      return {
        ym,
        label: monthAbbr(ym),
        revenue_cents: String(r.income_cents ?? "0"),
        expenses_cents: String(r.expense_cents ?? "0"),
        net_cents: String(r.net_cents ?? "0"),
        delta_cash_cents: deltaCash,
        ending_cash_cents: ending,
      };
    });

    return rows;
  }, [pnlQ.data, cashMonthly]);

  const monthlySummaryLabel = useMemo(() => {
    const count = monthlySummary.length;
    if (count <= 1) return "1 month";
    return `Last ${count} months`;
  }, [monthlySummary]);

  const aiSummaryFallback = useMemo(() => {
    const lines: string[] = [];

    lines.push(`This report covers the period from ${range.from} to ${range.to}.`);

    if (revenueCents != null && expensesCents != null && netCents != null) {
      lines.push(
        `Revenue is ${fmtUsdAccountingFromCents(String(revenueCents)).text}, expenses are ${fmtUsdAccountingFromCents(String(expensesCents)).text}, and net is ${fmtUsdAccountingFromCents(String(netCents)).text}.`
      );
    }

    lines.push(`Ending cash as of ${range.to} is ${fmtUsdAccountingFromCents(String(cashBalanceCents)).text}.`);

    const firstCat = topExpenseCats.rows[0];
    if (firstCat && topExpenseCats.totalAbs > 0n) {
      const pct = Math.round((Number(firstCat.absCents) / Number(topExpenseCats.totalAbs)) * 100);
      lines.push(`Largest expense category is ${firstCat.label} at ${pct}% of tracked expense composition.`);
    }

    if (monthlySummary.length >= 2) {
      const last = monthlySummary[monthlySummary.length - 1];
      const prev = monthlySummary[monthlySummary.length - 2];
      try {
        const lastNet = BigInt(String(last.net_cents ?? "0"));
        const prevNet = BigInt(String(prev.net_cents ?? "0"));
        const delta = lastNet - prevNet;
        lines.push(
          `Net changed by ${fmtUsdAccountingFromCents(String(delta)).text} versus the prior month bucket.`
        );
      } catch {
        // ignore
      }
    }

    lines.push("Used fields: Revenue, Expenses, Net, Ending Cash, Largest Expense Category.");

    return lines.join(" ");
  }, [range.from, range.to, revenueCents, expensesCents, netCents, cashBalanceCents, topExpenseCats, monthlySummary]);

  const aiSummaryText = useMemo(() => {
    const raw = String(aiNarrativeQ.data?.answer ?? "").trim();
    const hasRealData =
      revenueCents != null ||
      expensesCents != null ||
      netCents != null ||
      (accountsSummaryQ.data?.rows?.length ?? 0) > 0 ||
      (categoriesQ.data?.rows?.length ?? 0) > 0;

    const looksWrong =
      /does not contain any financial data/i.test(raw) ||
      /no information available about profit and loss/i.test(raw) ||
      /no financial insights can be drawn/i.test(raw);

    if (raw && !(hasRealData && looksWrong)) return raw;
    return aiSummaryFallback;
  }, [
    aiNarrativeQ.data,
    aiSummaryFallback,
    revenueCents,
    expensesCents,
    netCents,
    accountsSummaryQ.data,
    categoriesQ.data,
  ]);

  // Deterministic insights (max 3)
  const insights = useMemo(() => {
    const out: Array<{ title: string; value: string; tone?: "default" | "good" | "bad" }> = [];

    // 1) Net change vs prior period (if we have a prior period from same duration)
    // Simple deterministic: compare last month vs previous month when mode is THIS_MONTH/LAST_MONTH/LAST_3_MONTHS.
    if (monthlySummary.length >= 2) {
      const last = monthlySummary[monthlySummary.length - 1];
      const prev = monthlySummary[monthlySummary.length - 2];

      try {
        const lastNet = BigInt(last.net_cents);
        const prevNet = BigInt(prev.net_cents);
        const delta = lastNet - prevNet;

        const pct = prevNet === 0n ? null : Number(delta) / Number(prevNet);
        if (pct !== null && Number.isFinite(pct)) {
          const pctText = `${(pct * 100).toFixed(0)}%`;
          out.push({
            title: "Net vs prior month",
            value: `${pct >= 0 ? "+" : ""}${pctText}`,
            tone: pct >= 0 ? "good" : "bad",
          });
        }
      } catch {
        // ignore
      }
    }

    // 2) Cash streak (>=2 decreases)
    if (monthlySummary.length >= 3) {
      let streak = 0;
      for (let i = monthlySummary.length - 1; i >= 1; i--) {
        const cur = monthlySummary[i].ending_cash_cents;
        const prev = monthlySummary[i - 1].ending_cash_cents;
        if (!cur || !prev) break;
        try {
          if (BigInt(cur) < BigInt(prev)) streak++;
          else break;
        } catch {
          break;
        }
      }
      if (streak >= 2) {
        out.push({ title: "Cash declining streak", value: `${streak} months`, tone: "bad" });
      }
    }

    // 3) Largest expense category (from donut data)
    const firstCat = topExpenseCats.rows[0];
    if (firstCat && topExpenseCats.totalAbs > 0n) {
      const pct = Number(firstCat.absCents) / Number(topExpenseCats.totalAbs);
      if (Number.isFinite(pct)) {
        out.push({
          title: "Largest expense category",
          value: `${firstCat.label} (${(pct * 100).toFixed(0)}%)`,
          tone: "default",
        });
      }
    }

    return out.slice(0, 3);
  }, [monthlySummary, topExpenseCats]);

  const periodCapsule = (
    <div className="h-6 px-1.5 rounded-lg border border-bb-border bg-bb-surface-card flex items-center">
      <CapsuleSelect
        variant="flat"
        value={periodMode}
        onValueChange={(v) => setPeriodMode(v as PeriodMode)}
        options={[
          { value: "THIS_MONTH", label: "This Month" },
          { value: "LAST_MONTH", label: "Last Month" },
          { value: "LAST_3_MONTHS", label: "Last 3 Months" },
          { value: "YTD", label: "YTD" },
          { value: "CUSTOM", label: "Custom" },
        ]}
        placeholder="This Month"
      />
    </div>
  );

  return (
    <div className="space-y-5 max-w-none">
      <div className="px-1">
          <PageHeader
            icon={<LayoutDashboard className="h-4 w-4" />}
            title="Dashboard"
            afterTitle={
              <div className="h-7 px-1.5 rounded-md border border-bb-border bg-bb-surface-card flex items-center">
                <CapsuleSelect
                  variant="flat"
                  value={accountScopeId}
                  onValueChange={(v) => setAccountScopeId(String(v))}
                  options={[
                    { value: "all", label: "All accounts" },
                    ...((accountsAllQ.data?.rows ?? []) as any[])
                      .filter((r: any) => r && r.account_id)
                      .map((r: any) => ({
                        value: String(r.account_id),
                        label: String(r.name ?? "Account"),
                      })),
                  ]}
                  placeholder="All accounts"
                />
              </div>
            }
            right={
              <div className="flex items-center gap-2">
                {periodCapsule}

                {periodMode === "CUSTOM" ? (
                  <div className="flex items-center gap-2">
                    <div className="w-[155px]">
                      <AppDatePicker
                        value={customFrom}
                        onChange={(next) => setCustomFrom(next)}
                        allowClear={false}
                      />
                    </div>

                    <span className="text-xs text-bb-text-subtle">→</span>

                    <div className="w-[155px]">
                      <AppDatePicker
                        value={customTo}
                        onChange={(next) => setCustomTo(next)}
                        allowClear={false}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            }
          />
      </div>

      {!selectedBusinessId && !businessesQ.isLoading ? (
        <EmptyStateCard
          title="No business yet"
          description="Create a business to start using BynkBook."
          primary={{ label: "Create business", href: "/settings?tab=business" }}
          secondary={{ label: "Reload", onClick: () => void businessesQ.refetch() }}
        />
      ) : null}

      {dashErr ? (
        <InlineBanner title={dashErr.title} message={dashErr.detail} onRetry={() => refetchAll()} />
      ) : null}

      {dashboardInitialLoading ? (
        <div className="flex items-center justify-between rounded-[10px] border border-bb-border bg-bb-surface-card px-3 py-2 text-sm text-muted-foreground shadow-sm">
          <span>Loading dashboard</span>
          <Skeleton className="h-3 w-28" />
        </div>
      ) : null}

      {showDashboardBody ? (
        (() => {
          // Format each KPI once (was being called twice — once for .text, once for .isNeg).
          const cashKpi = fmtUsdAccountingFromCents(cashBalanceCents);
          const revenueKpi = fmtUsdAccountingFromCents(revenueCents ?? undefined);
          const expensesKpi = fmtUsdAccountingFromCents(expensesCents ?? undefined);
          const netKpi = fmtUsdAccountingFromCents(netCents ?? undefined);

          // Onboarding checklist signals: derived from data already fetched.
          // accountsAllQ.data.rows is the list of accounts (empty for new biz).
          // categoriesQ.data.rows is the categories list.
          // pnlQ.data has period totals — any non-zero amount means at least
          // one entry exists in this period; otherwise we fall back to
          // "any non-empty categories series" as a softer hint.
          const onboardingAccountsCount = (accountsAllQ.data?.rows ?? []).length;
          const onboardingCategoriesCount = (categoriesQ.data?.rows ?? []).length;
          const onboardingHasEntries =
            !!(pnlQ.data?.period?.income_cents && pnlQ.data.period.income_cents !== "0") ||
            !!(pnlQ.data?.period?.expense_cents && pnlQ.data.period.expense_cents !== "0") ||
            (Array.isArray(pnlQ.data?.monthly) && pnlQ.data.monthly.length > 0);

          const selectedAccountLabel =
            accountScopeId === "all"
              ? "All accounts"
              : String(
                  ((accountsAllQ.data?.rows ?? []) as any[]).find(
                    (row: any) => String(row.account_id ?? "") === accountScopeId
                  )?.name ?? "Selected account"
                );

          const commandStatus = showAttentionLoading
            ? null
            : nextActionsN > 0
              ? `${nextActionsN} open`
              : "All clear";

          return (
        <>
      {/* Onboarding checklist — only renders for businesses with incomplete setup */}
      <OnboardingChecklist
        businessId={selectedBusinessId ?? ""}
        accountsCount={onboardingAccountsCount}
        categoriesCount={onboardingCategoriesCount}
        hasEntries={onboardingHasEntries}
      />

      {/* Command Center */}
      <Card className="overflow-hidden rounded-lg border border-bb-border bg-bb-surface-elevated shadow-sm !gap-0 !py-0">
        <CardContent className="p-0">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 p-4 md:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Today&apos;s bookkeeping
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <h2 className="text-lg font-semibold leading-tight text-foreground">Command center</h2>
                    {!showAttentionLoading && nextActionsN === 0 ? (
                      <CheckCircle2 className="h-4 w-4 text-bb-status-success-fg" strokeWidth={2.2} />
                    ) : null}
                  </div>
                </div>

                <div className="inline-flex h-7 w-fit items-center justify-center rounded-full border border-bb-border bg-bb-surface-card px-3 text-xs font-medium text-foreground/80">
                  {commandStatus ? commandStatus : <Skeleton className="h-3 w-12" />}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <DashboardCommandAction
                  href={issuesHref}
                  icon={AlertTriangle}
                  label="Open issues"
                  count={openIssuesN}
                  meta="Resolve exceptions"
                  tone="danger"
                  loading={showAttentionLoading}
                />
                <DashboardCommandAction
                  href={categoryReviewHref}
                  icon={Tag}
                  label="Uncategorized"
                  count={uncategorizedN}
                  meta="Assign categories"
                  tone="success"
                  loading={showAttentionLoading}
                />
                <DashboardCommandAction
                  href={reconcileHref}
                  icon={Landmark}
                  label="Bank unmatched"
                  count={bankUnmatchedN}
                  meta="Review activity"
                  tone="warning"
                  loading={showAttentionLoading}
                />
              </div>
            </div>

            <div className="border-t border-bb-border bg-bb-surface-soft/80 p-4 md:p-5 lg:border-l lg:border-t-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Period</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{range.from} to {range.to}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md border border-bb-border bg-bb-surface-card px-3 py-2">
                  <div className="text-muted-foreground">Scope</div>
                  <div className="mt-1 truncate font-medium text-foreground" title={selectedAccountLabel}>
                    {selectedAccountLabel}
                  </div>
                </div>
                <div className="rounded-md border border-bb-border bg-bb-surface-card px-3 py-2">
                  <div className="text-muted-foreground">Net</div>
                  <div className={`mt-1 truncate font-semibold tabular-nums ${netKpi.isNeg ? "text-bb-amount-negative" : "text-bb-amount-positive"}`}>
                    {dashboardInitialLoading || pnlQ.isFetching ? <Skeleton className="h-4 w-20" /> : netKpi.text}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Strip */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {[
          {
            label: "Cash Balance",
            value: cashKpi.text,
            isNeg: cashKpi.isNeg,
            sub: `As of ${range.to}`,
            tooltip: null as string | null,
            icon: Wallet,
            accent: "bg-primary",
            iconBg: "bg-bb-status-success-bg",
            iconFg: "text-bb-status-success-fg",
          },
          {
            label: "Cash Runway",
            value: runway.display,
            isNeg: false,
            sub: "based on 3-mo avg expenses",
            tooltip: runway.tooltip,
            icon: Timer,
            accent: "bg-primary",
            iconBg: "bg-bb-status-success-bg",
            iconFg: "text-bb-status-success-fg",
          },
          {
            label: "Revenue",
            value: revenueKpi.text,
            isNeg: revenueKpi.isNeg,
            sub: "Cash-basis",
            tooltip: null as string | null,
            icon: TrendingUp,
            accent: "bg-bb-amount-positive",
            iconBg: "bg-bb-status-success-bg",
            iconFg: "text-bb-status-success-fg",
          },
          {
            label: "Expenses",
            value: expensesKpi.text,
            isNeg: expensesKpi.isNeg,
            sub: "Cash-basis",
            tooltip: null as string | null,
            icon: TrendingDown,
            accent: "bg-bb-amount-negative",
            iconBg: "bg-bb-status-danger-bg",
            iconFg: "text-bb-status-danger-fg",
          },
          {
            label: "Net",
            value: netKpi.text,
            isNeg: netKpi.isNeg,
            sub: "Revenue − Expenses",
            tooltip: null as string | null,
            icon: Sigma,
            accent: "bg-primary",
            iconBg: "bg-bb-status-success-bg",
            iconFg: "text-bb-status-success-fg",
          },
        ].map((k) => {
          const Icon = k.icon;
          const loading = dashboardInitialLoading || pnlQ.isFetching || cashflowQ.isFetching || accountsSummaryQ.isFetching;

          return (
            <Card key={k.label} className="flex flex-col gap-3 py-3 rounded-lg border border-bb-border bg-bb-surface-card text-card-foreground shadow-sm overflow-hidden">
              <CardContent className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${k.iconBg}`}>
                    <Icon className={`h-4 w-4 ${k.iconFg}`} strokeWidth={2.2} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">{k.label}</div>

                    <div
                      className={`mt-1 text-[20px] leading-tight font-semibold tabular-nums ${k.isNeg ? "text-bb-amount-negative" : "text-bb-amount-neutral"}`}
                      title={k.tooltip ?? undefined}
                    >
                      {loading ? (
                        <span className="inline-block align-middle">
                          <Skeleton className="h-6 w-24" />
                        </span>
                      ) : (
                        k.value
                      )}
                    </div>

                    <div className="mt-1 text-[11px] text-muted-foreground truncate">{k.sub}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Base44 layout: Left stack (same heights) + Right stack (same width) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* LEFT: charts stack */}
        <div className="lg:col-span-2 space-y-4">
          <DashboardChartPanels
            cashflowLoading={dashboardInitialLoading || cashflowQ.isFetching}
            cashPositionLoading={dashboardInitialLoading || cashflowQ.isFetching || accountsSummaryQ.isFetching}
            categoriesLoading={dashboardInitialLoading || categoriesQ.isFetching}
            cashBarsData={cashBarsData}
            cashPosData={cashPosData}
            expensePieData={expensePieData}
            expenseRanked={expenseRanked}
            expenseTotalAbsCents={String(topExpenseCats.totalAbs ?? 0n)}
          />
        </div>

        {/* RIGHT: cards stack */}
        <div className="space-y-4">
          {/* Account Balances (Base44 structure) */}
          <Card className="rounded-lg border border-bb-border shadow-sm overflow-hidden bg-bb-surface-card flex flex-col !gap-0 !py-0">
            <CHeader className="p-0 px-4 py-2 border-b border-bb-border !gap-0">
              <div className="flex items-center justify-between leading-none">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-bb-status-success-bg">
                    <Landmark className="h-4 w-4 text-bb-status-success-fg" strokeWidth={2.2} />
                  </div>
                  <CardTitle className="text-sm font-semibold text-foreground leading-none">Account Balances</CardTitle>
                </div>

                <div className="text-[11px] text-muted-foreground leading-none">As of {range.to}</div>
              </div>
            </CHeader>

            <CardContent className="p-0">
              {dashboardInitialLoading ? (
                <div className="px-4 py-3 space-y-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (accountsSummaryQ.data?.rows ?? []).length === 0 ? (
                <div className="px-4 py-3 text-sm text-muted-foreground">No accounts found.</div>
              ) : (
                <div className="-mt-1 divide-y divide-bb-border-muted">
                  {(accountsSummaryQ.data?.rows ?? []).slice(0, 6).map((r: any, idx: number) => (
                    <div
                      key={`${String(r.account_id ?? "")}-${String(r.name ?? "")}-${idx}`}
                      className="flex items-center justify-between px-4 py-1.5"
                    >
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <Landmark className="w-4 h-4 text-bb-text-subtle flex-shrink-0" />
                        <div className="min-w-0 leading-tight">
                          <div className="font-medium text-[13px] truncate text-foreground">
                            {String(r.name ?? "Account")}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {String(r.type ?? "")}
                          </div>
                        </div>
                      </div>

                      <div className={`text-sm font-semibold tabular-nums ${moneyClassFromCents(String(r.balance_cents ?? "0"))}`}>
                        {fmtUsdAccountingFromCents(String(r.balance_cents ?? "0")).text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* AI Insights */}
          <Card className="rounded-lg border border-bb-border shadow-sm overflow-hidden bg-bb-surface-card flex flex-col !gap-0 !py-0">
            <CHeader className="p-0 px-4 py-2 border-b border-bb-border !gap-0">
              <div className="flex items-center justify-between leading-none">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-bb-status-success-bg">
                    <Sparkles className="h-4 w-4 text-bb-status-success-fg" strokeWidth={2.2} />
                  </div>
                  <CardTitle className="text-sm font-semibold text-foreground leading-none">AI Insights</CardTitle>
                </div>

                <div className="text-xs text-muted-foreground leading-none">Suggestion-only</div>
              </div>
            </CHeader>

            <CardContent className="p-0">
              {pnlQ.isLoading || cashflowQ.isLoading || accountsSummaryQ.isLoading ? (
                <div className="px-4 py-4 space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : insights.length === 0 ? (
                <div className="px-4 py-4 text-sm text-muted-foreground">No notable signals for this period.</div>
              ) : (
                <div className="-mt-1 divide-y divide-bb-border-muted">
                  {insights.slice(0, 3).map((it) => (
                    <div key={it.title} className="px-4 py-3">
                      <div className="text-xs text-muted-foreground">{it.title}</div>
                      <div
                        className={`mt-0.5 text-sm font-semibold tabular-nums ${it.tone === "good" ? "text-bb-amount-positive" : it.tone === "bad" ? "text-bb-amount-negative" : "text-bb-amount-neutral"
                          }`}
                      >
                        {it.value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Collapsible AI Assistant — bundles AI Summary, Anomalies, and Ask AI
              so the three sub-cards do not visually dominate the dashboard. */}
          <Card className="rounded-lg border border-bb-border shadow-sm overflow-hidden bg-bb-surface-card flex flex-col !gap-0 !py-0">
            <CHeader className="p-0 px-4 py-2 border-b border-bb-border flex flex-row items-center justify-between">
              <button
                type="button"
                className="flex items-center gap-2 text-left"
                onClick={() => setAiPanelExpanded((v) => !v)}
                aria-expanded={aiPanelExpanded}
              >
                <Sparkles className="h-4 w-4 text-primary" />
                <CardTitle className="text-sm">AI Assistant</CardTitle>
                <span className="text-[11px] text-muted-foreground">{aiPanelExpanded ? "Hide" : "Show"}</span>
              </button>
              <Button
                variant={aiInsightsRequested ? "outline" : "default"}
                className="h-7 px-2 text-xs"
                onClick={() => {
                  if (!aiPanelExpanded) setAiPanelExpanded(true);
                  requestAiInsights();
                }}
                disabled={!selectedBusinessId || aiNarrativeQ.isFetching || aiAnomaliesQ.isFetching}
              >
                {aiInsightsRequested ? "Refresh" : "Generate insights"}
              </Button>
            </CHeader>
            {!aiPanelExpanded ? (
              <CardContent className="px-3 py-2 text-[11px] text-muted-foreground">
                Summary, anomaly detection, and Q&A — all read-only, opt-in to control AI cost.
              </CardContent>
            ) : null}
          </Card>

          {aiPanelExpanded ? (
            <>
                {/* AI Summary (read-only; aggregates only) */}
      <Card className="rounded-lg border border-bb-border shadow-sm overflow-hidden bg-bb-surface-card flex flex-col !gap-0 !py-0">
        <CHeader className="p-0 px-4 py-2 border-b border-bb-border flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">AI Summary</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {aiNarrativeQ.isFetching && aiNarrativeQ.data?.ok ? <div className="text-[11px] text-muted-foreground">Updating…</div> : null}
            <Button
              variant="outline"
              className="h-7 px-2 text-xs"
              onClick={requestAiInsights}
              disabled={!selectedBusinessId || aiNarrativeQ.isFetching || aiAnomaliesQ.isFetching}
            >
              {aiInsightsRequested ? "Refresh AI insights" : "Generate insights"}
            </Button>
          </div>
        </CHeader>

        <CardContent className="space-y-2">
          <div className="text-[11px] text-muted-foreground">Read-only guidance based on dashboard totals and trends.</div>

          {!aiInsightsRequested ? (
            <div className="text-sm text-foreground/70">Generate insights when you want read-only AI guidance for this dashboard range.</div>
          ) : ai429 ? (
            <div className="rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-3 py-2 text-sm text-bb-status-warning-fg">
              {dashboardAiMessage(aiNarrativeQ.error)}
            </div>
          ) : aiNarrativeQ.isLoading && !aiNarrativeQ.data ? (
            <div className="space-y-2">
              <div className="h-4 w-2/3 rounded bg-muted animate-pulse" />
              <div className="h-4 w-full rounded bg-muted animate-pulse" />
              <div className="h-4 w-5/6 rounded bg-muted animate-pulse" />
            </div>
          ) : aiNarrativeQ.data?.ok ? (
            <div className="text-sm text-foreground/80 whitespace-pre-wrap">{aiSummaryText}</div>
          ) : (
            <div className="text-sm text-foreground/70">{dashboardAiMessage(aiNarrativeQ.error, "AI summary is unavailable right now.")}</div>
          )}
        </CardContent>
      </Card>

      {/* AI Anomalies (deterministic; read-only) */}
      <Card className="rounded-lg border border-bb-border shadow-sm overflow-hidden bg-bb-surface-card flex flex-col !gap-0 !py-0">
        <CHeader className="p-0 px-4 py-2 border-b border-bb-border flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-bb-status-warning-fg" />
            <CardTitle className="text-sm">Anomalies</CardTitle>
          </div>
          {aiAnomaliesQ.isFetching && aiAnomaliesQ.data?.ok ? <div className="text-[11px] text-muted-foreground">Updating…</div> : null}
        </CHeader>

        <CardContent className="space-y-2">
          {!aiInsightsRequested ? (
            <div className="text-sm text-foreground/70">Generate insights to check this range for unusual transactions.</div>
          ) : aiAnomaliesQ.isLoading && !aiAnomaliesQ.data ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <div className="h-4 w-48 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-full rounded bg-muted animate-pulse" />
                </div>
              ))}
            </div>
          ) : aiAnomaliesQ.data?.ok && Array.isArray(aiAnomaliesQ.data.anomalies) && aiAnomaliesQ.data.anomalies.length ? (
            <div className="divide-y divide-bb-border-muted rounded-md border border-bb-border overflow-hidden">
              {aiAnomaliesQ.data.anomalies.slice(0, 5).map((a: any) => {
                const medianCentsStr = a?.baseline?.median_abs_cents;
                const medianDisplay =
                  medianCentsStr !== undefined && medianCentsStr !== null
                    ? formatUsdSafe(medianCentsStr)
                    : "—";
                const ledgerHref =
                  a?.entryId && selectedBusinessId
                    ? `/ledger?businessId=${encodeURIComponent(selectedBusinessId)}${
                        accountScopeId && accountScopeId !== "all"
                          ? `&accountId=${encodeURIComponent(accountScopeId)}`
                          : ""
                      }`
                    : null;
                return (
                  <div key={a.entryId} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-foreground">{a.title ?? "Anomaly"}</div>
                        <div className="mt-0.5 text-[11px] text-foreground/70">{a.reason ?? ""}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          Baseline median: {medianDisplay} • Sample: {a?.baseline?.sample_size ?? "—"} • Confidence:{" "}
                          {typeof a?.confidence === "number" ? Math.round(a.confidence * 100) + "%" : "—"}
                        </div>
                      </div>
                      {ledgerHref ? (
                        <Link
                          href={ledgerHref}
                          prefetch={false}
                          className="text-[11px] font-medium text-primary hover:underline shrink-0"
                          title="Open ledger to inspect this entry"
                        >
                          View ledger →
                        </Link>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-foreground/70">No unusual transactions detected in the current range.</div>
          )}
        </CardContent>
      </Card>

            {/* Ask AI (aggregates-only; read-only) */}
      <Card className="rounded-lg border border-bb-border shadow-sm overflow-hidden bg-bb-surface-card flex flex-col !gap-0 !py-0">
        <CHeader className="p-0 px-4 py-2 border-b border-bb-border flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-sm">Ask AI</CardTitle>
          </div>
          {chatBusy ? <div className="text-[11px] text-muted-foreground">Thinking…</div> : null}
        </CHeader>

        <CardContent className="space-y-2">
          {chatErr ? (
            <div className="rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-3 py-2 text-sm text-bb-status-warning-fg">
              {chatErr}
            </div>
          ) : null}

          <div className="rounded-md border border-bb-border bg-bb-surface-card p-2 h-44 overflow-auto space-y-2">
            {chatMsgs.length === 0 ? (
              <div className="text-sm text-foreground/70">
                Ask about cash flow, income and expenses, trends, or top categories. AI answers are read-only and based on the current dashboard range.
              </div>
            ) : (
              chatMsgs.map((m, i) => (
                <div key={i} className={m.role === "user" ? "text-sm text-foreground" : "text-sm text-foreground/80"}>
                  <span className="text-[11px] font-semibold text-muted-foreground mr-2">
                    {m.role === "user" ? "You" : "AI"}
                  </span>
                  <span className="whitespace-pre-wrap">{m.text}</span>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center gap-2">
            <input
              value={chatQ}
              onChange={(e) => setChatQ(e.target.value)}
              placeholder="Ask AI: Why did net income change?"
              className="h-9 flex-1 rounded-md border border-bb-input-border bg-bb-input-bg px-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
              disabled={chatBusy}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendChat();
                }
              }}
            />
            <Button className="h-9 px-3" disabled={chatBusy || !chatQ.trim()} onClick={() => void sendChat()}>
              Ask AI
            </Button>
          </div>

          <div className="text-[11px] text-muted-foreground">
            Uses dashboard aggregates only • No ledger dump • Includes links in answers when possible
          </div>
        </CardContent>
      </Card>
            </>
          ) : null}

          {/* Monthly Summary (Base44 card structure) */}
          <Card className="rounded-lg border border-bb-border shadow-sm overflow-hidden bg-bb-surface-card flex flex-col !gap-0 !py-0">
            <CHeader className="p-0 px-4 py-2 border-b border-bb-border !gap-0">
              <div className="flex items-center justify-between leading-none">
                <div className="flex items-center gap-3">
                  <div className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-bb-status-success-bg">
                    <CalendarDays className="h-4 w-4 text-bb-status-success-fg" strokeWidth={2.2} />
                  </div>
                  <CardTitle className="text-sm font-semibold text-foreground leading-none">Monthly Summary</CardTitle>
                </div>

                <div className="text-xs text-muted-foreground leading-none">{monthlySummaryLabel}</div>
              </div>
            </CHeader>

            <CardContent className="p-0">
              {monthlySummary.length === 0 ? (
                <div className="px-4 py-4">
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : (
                <div>
                  <div className="grid grid-cols-3 items-center px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground border-b border-bb-border">
                    <div>Month</div>
                    <div className="text-right">Net</div>
                    <div className="text-right">End Cash</div>
                  </div>

                  <div className="-mt-1 divide-y divide-bb-border-muted">
                    {monthlySummary.slice(-4).map((r) => (
                      <div key={r.ym} className="grid grid-cols-3 items-center px-4 py-3 text-sm">
                        <div className="text-foreground/80">{r.label}</div>
                        <div className={`text-right tabular-nums ${moneyClassFromCents(r.net_cents)}`}>
                          {fmtUsdAccountingFromCents(r.net_cents).text}
                        </div>
                        <div className="text-right tabular-nums">
                          {r.ending_cash_cents ? (
                            <span className={moneyClassFromCents(r.ending_cash_cents)}>
                              {fmtUsdAccountingFromCents(r.ending_cash_cents).text}
                            </span>
                          ) : (
                            <span className="text-bb-text-subtle">—</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
        </>
          );
        })()
      ) : null}
    </div>
  );
}
