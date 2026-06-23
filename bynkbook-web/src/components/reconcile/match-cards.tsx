// Pure presentational components extracted from reconcile/page-client.tsx.
// No state, no closures over component data — just JSX with explicit props.
// Behavior must be identical to the previous in-file definitions.

import { RefreshCw } from "lucide-react";
import {
  type MatchSignalTone,
  absBig,
  accountLabelFor,
  bankCategoryLabel,
  compactText,
  entryCategoryLabel,
  extractCheckRefFromBankTransaction,
  extractEntryRefFromEntry,
  formatUsdFromCents,
  matchSignalChips,
  matchSignalMeta,
  toBigIntSafe,
  ymdFromBankTxn,
} from "@/lib/reconcile/helpers";

export function TinySpinner() {
  return <span className="inline-block h-3 w-3 animate-spin rounded-full border border-bb-text-muted border-t-transparent" />;
}

export function UpdatingOverlay({ label = "Updating…" }: { label?: string }) {
  return (
    <div className="absolute inset-0 z-20 flex items-start justify-center bg-bb-surface-card/55 backdrop-blur-[1px]">
      <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-bb-border bg-bb-surface-card px-3 py-1 text-xs font-medium text-bb-text shadow-sm">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function MatchSignalChip({ label, tone = "default", title }: { label: string; tone?: MatchSignalTone; title?: string }) {
  const cls =
    tone === "success"
      ? "border-primary/20 bg-primary/10 text-primary"
      : tone === "warning"
        ? "border-bb-status-warning-border bg-bb-status-warning-bg text-bb-status-warning-fg"
        : tone === "danger"
          ? "border-bb-status-danger-border bg-bb-status-danger-bg text-bb-status-danger-fg"
          : "border-bb-border bg-bb-surface-card text-bb-text";

  return (
    <span
      title={title}
      className={`inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

export function MatchSideCard({
  label,
  title,
  date,
  amountCents,
  refText,
  account,
  categoryOrStatus,
}: {
  label: string;
  title: string;
  date: string;
  amountCents: unknown;
  refText?: string;
  account?: string;
  categoryOrStatus?: string;
}) {
  const amount = toBigIntSafe(amountCents);
  return (
    <div className="min-w-0 rounded-md border border-bb-border bg-bb-surface-card p-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-bb-text-muted">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-bb-text" title={title}>
        {compactText(title)}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div className="min-w-0">
          <div className="text-bb-text-muted">Date</div>
          <div className="truncate text-bb-text">{compactText(date)}</div>
        </div>
        <div className="text-right">
          <div className="text-bb-text-muted">Amount</div>
          <div className={`tabular-nums font-semibold ${amount < 0n ? "text-bb-amount-negative" : "text-bb-text"}`}>
            {formatUsdFromCents(amount)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-bb-text-muted">Account</div>
          <div className="truncate text-bb-text" title={account}>
            {compactText(account)}
          </div>
        </div>
        <div className="min-w-0 text-right">
          <div className="text-bb-text-muted">Ref</div>
          <div className="truncate text-bb-text" title={refText}>
            {compactText(refText)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-bb-text-muted">Category/status</div>
          <div className="truncate text-bb-text" title={categoryOrStatus}>
            {compactText(categoryOrStatus)}
          </div>
        </div>
      </div>
    </div>
  );
}

export function MatchPairPreview({
  bank,
  bankTxns,
  entries,
  accountName,
  direction,
  similarCandidateCount,
  aiConfidence,
}: {
  bank: any | null;
  bankTxns?: any[];
  entries: any[];
  accountName?: string;
  direction: "bankToEntry" | "entryToBank";
  similarCandidateCount: number;
  aiConfidence?: number | null;
}) {
  const banks = bank ? [bank] : (bankTxns ?? []);
  const firstBank = banks[0] ?? null;
  if (!firstBank && entries.length === 0) return null;
  const firstEntry = entries[0] ?? null;
  const isSinglePair = Boolean(firstBank && firstEntry && entries.length === 1 && banks.length === 1);
  const meta = isSinglePair ? matchSignalMeta(firstBank, firstEntry, direction) : null;
  const chips = meta ? matchSignalChips(meta, similarCandidateCount, aiConfidence) : [];
  const entryTotal = entries.reduce((sum, e) => sum + absBig(toBigIntSafe(e?.amount_cents)), 0n);
  const bankTotal = banks.reduce((sum, t) => sum + absBig(toBigIntSafe(t?.amount_cents)), 0n);

  return (
    <div className="mb-3 rounded-md border border-bb-border bg-bb-surface-soft p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-bb-text">Review the match pair</div>
          <div className="text-[11px] text-bb-text-muted">Confirm exactly which ledger and bank records will be linked.</div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {chips.map((chip) => (
            <MatchSignalChip key={`${chip.label}-${chip.title ?? ""}`} {...chip} />
          ))}
          {!isSinglePair && entries.length > 1 ? <MatchSignalChip label={`${entries.length} ledger entries`} tone="warning" /> : null}
          {!isSinglePair && banks.length > 1 ? <MatchSignalChip label={`${banks.length} bank transactions`} tone="warning" /> : null}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        <MatchSideCard
          label={entries.length > 1 ? "Ledger entries" : "Ledger entry"}
          title={
            entries.length > 1
              ? entries.map((e) => compactText(e?.payee, "Entry")).join(", ")
              : compactText(firstEntry?.payee, "Select a ledger entry")
          }
          date={entries.length > 1 ? `${entries.length} selected` : compactText(firstEntry?.date)}
          amountCents={entries.length > 1 ? entryTotal : firstEntry?.amount_cents ?? 0n}
          refText={entries.length > 1 ? "Multiple" : extractEntryRefFromEntry(firstEntry)}
          account={accountLabelFor(firstEntry, accountName)}
          categoryOrStatus={entries.length > 1 ? "Selected" : entryCategoryLabel(firstEntry)}
        />

        <div className="hidden items-center justify-center text-[11px] font-semibold text-bb-text-subtle md:flex">to</div>

        <MatchSideCard
          label={banks.length > 1 ? "Bank transactions" : "Bank transaction"}
          title={
            banks.length > 1
              ? banks.map((t) => compactText(t?.name, "Bank transaction")).join(", ")
              : compactText(firstBank?.name, "Select a bank transaction")
          }
          date={banks.length > 1 ? `${banks.length} selected` : ymdFromBankTxn(firstBank)}
          amountCents={banks.length > 1 ? bankTotal : firstBank?.amount_cents ?? 0n}
          refText={banks.length > 1 ? "Multiple" : extractCheckRefFromBankTransaction(firstBank)}
          account={accountLabelFor(firstBank, accountName)}
          categoryOrStatus={banks.length > 1 ? "Selected" : bankCategoryLabel(firstBank)}
        />
      </div>
    </div>
  );
}
