"use client";

import { useEffect, useMemo, useState } from "react";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Button } from "@/components/ui/button";
import { createMatchGroupsBatch } from "@/lib/api/match-groups";
import {
  buildReconcileSuggestions,
  type ReconcileSuggestion as Suggestion,
} from "@/lib/reconcile/matchSuggestions";

import { toBigIntSafe } from "@/lib/money";

// BigInt-safe accounting currency formatting (cents -> $#,###.##, negatives in parentheses)
function addCommas(intStr: string) {
  const s = intStr.replace(/^0+(?=\d)/, "");
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const idxFromEnd = s.length - i;
    out.push(s[i]);
    if (idxFromEnd > 1 && idxFromEnd % 3 === 1) out.push(",");
  }
  return out.join("");
}

function formatUsdAccountingFromCents(centsLike: any): { text: string; isNeg: boolean } {
  let n: bigint;
  try {
    n = toBigIntSafe(centsLike);
  } catch {
    return { text: "—", isNeg: false };
  }

  const isNeg = n < 0n;
  const abs = isNeg ? -n : n;

  const dollars = abs / 100n;
  const cents = abs % 100n;

  const dollarsStr = addCommas(dollars.toString());
  const cents2 = cents.toString().padStart(2, "0");

  const base = `$${dollarsStr}.${cents2}`;
  return { text: isNeg ? `(${base})` : base, isNeg };
}

function norm(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function suggestionKindLabel(kind: Suggestion["kind"]) {
  if (kind === "COMBINE") return "Many bank transactions to one entry";
  if (kind === "SPLIT") return "One bank transaction to several entries";
  return "One bank transaction to one entry";
}

// Deterministic "Why" line for suggestions.
// Prefer suggestion.reasons[] as the source of truth; only fall back if empty.
function getSuggestionWhy(s: any): string | null {
  const reasons = Array.isArray(s?.reasons) ? (s.reasons as any[]).map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  if (reasons.length > 0) {
    const pick = (pred: (r: string) => boolean) => reasons.find((r) => pred(r));
    // Stable priority: counterparty/memo/vendor signal > amount/date signal > first reason.
    const best =
      pick((r) => /payee|vendor|description/i.test(r)) ??
      pick((r) => /memo|note/i.test(r)) ??
      pick((r) => /exact amount|amount match/i.test(r)) ??
      pick((r) => /date/i.test(r)) ??
      reasons[0];
    return best || null;
  }

  // Fallback only if reasons[] is empty: derive from existing visible fields (no scoring).
  const kind = String(s?.kind ?? "").toUpperCase();
  const bank = s?.bank ?? null;
  const entries = Array.isArray(s?.entries) ? s.entries : [];

  // If we truly cannot derive anything meaningful, return null (avoid "Pattern match" unless unavoidable).
  const bankDesc = norm(bank?.name ?? bank?.description ?? bank?.memo ?? "");
  const entryPayee = norm(entries[0]?.payee ?? entries[0]?.vendor_name ?? "");
  if (bankDesc && entryPayee && (bankDesc.includes(entryPayee) || entryPayee.includes(bankDesc))) return "Payee/description match";

  if (kind === "COMBINE") return "Combined items";
  if (kind === "SPLIT") return "Split across entries";
  if (kind === "ONE_TO_ONE") return "One-to-one match";

  return null;
}

function badge(text: string, tone: "default" | "success" | "danger" = "default", title?: string) {
  const cls =
    tone === "success"
      ? "border-primary/20 bg-primary/10 text-primary"
      : tone === "danger"
        ? "border-bb-status-danger-border bg-bb-status-danger-bg text-bb-status-danger-fg"
        : "border-bb-border bg-bb-surface-card text-bb-text";

  return (
    <span
      title={title}
      className={`inline-flex items-center h-6 px-2 rounded-md border text-[11px] ${cls}`}
    >
      {text}
    </span>
  );
}

function qualityBadge(s: Suggestion) {
  return badge(s.quality === "READY" ? `${Math.round(s.confidence * 100)}% ready` : "Review", s.quality === "READY" ? "success" : "default");
}

export function AutoReconcileDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;

  businessId: string;
  accountId: string;

  bankTxns: any[];
  expectedEntries: any[];

  canWrite: boolean;
  canWriteReason: string;

  onApplied: () => Promise<void>;
}) {
  const {
    open,
    onOpenChange,
    businessId,
    accountId,
    bankTxns,
    expectedEntries,
    canWrite,
    canWriteReason,
    onApplied,
  } = props;

  // --------- Suggestion engine (deterministic) ----------
  const suggestions = useMemo<Suggestion[]>(() => {
    if (!open) return [];
    return buildReconcileSuggestions({
      bankTransactions: bankTxns,
      expectedEntries,
    });
  }, [open, bankTxns, expectedEntries]);

  const counts = useMemo(() => {
    const total = suggestions.length;
    const one = suggestions.filter((s) => s.kind === "ONE_TO_ONE").length;
    const split = suggestions.filter((s) => s.kind === "SPLIT").length;
    const combine = suggestions.filter((s) => s.kind === "COMBINE").length;
    const ready = suggestions.filter((s) => s.quality === "READY").length;
    const review = total - ready;
    return { total, one, split, combine, ready, review };
  }, [suggestions]);

  // ---------- Selection + confirmation ----------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmStep, setConfirmStep] = useState(false);

  // Per-row status
  const [rowStatus, setRowStatus] = useState<Record<string, "PENDING" | "APPLIED" | "FAILED">>({});
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [applyBusy, setApplyBusy] = useState(false);
  const [applySummary, setApplySummary] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setConfirmStep(false);
      setRowStatus({});
      setRowError({});
      setApplyBusy(false);
      setApplySummary(null);
      return;
    }

    setSelected(new Set(suggestions.filter((s) => s.quality === "READY").map((s) => s.id)));
    setConfirmStep(false);
    setRowStatus({});
    setRowError({});
    setApplyBusy(false);
    setApplySummary(null);
  }, [open, suggestions]);

  async function applySelected() {
    if (!canWrite) return;
    if (!businessId || !accountId) return;
    if (selected.size === 0) return;

    setApplyBusy(true);
    setApplySummary(null);

    // initialize statuses
    setRowStatus({});
    setRowError({});

    let okN = 0;
    let failN = 0;

    try {
      const kindRank: Record<Suggestion["kind"], number> = { ONE_TO_ONE: 0, SPLIT: 1, COMBINE: 2 };
      // Deterministic apply order: simplest suggestions first, then by posted_date asc then id.
      const selectedSuggestions = suggestions
        .filter((s) => selected.has(s.id))
        .slice()
        .sort((a, b) => {
          if (a.kind !== b.kind) return kindRank[a.kind] - kindRank[b.kind];
          const da = String(a.bank.posted_date ?? "");
          const db = String(b.bank.posted_date ?? "");
          if (da !== db) return da.localeCompare(db);
          return String(a.id).localeCompare(String(b.id));
        });

      for (const s of selectedSuggestions) {
        setRowStatus((prev) => ({ ...prev, [s.id]: "PENDING" }));
      }

      // Build ONE batch payload (1 item per suggestion = one MatchGroup)
      const items = selectedSuggestions.map((s) => {
        // SPLIT/ONE_TO_ONE: 1 bank txn id, many entry ids
        if (s.kind !== "COMBINE") {
          return {
            client_id: s.id,
            bankTransactionIds: [String(s.bankTxnId)],
            entryIds: (s.entries ?? []).map((e: any) => String(e.id)),
          };
        }

        // COMBINE: many bank txn ids (stored on suggestion), 1 entry id
        return {
          client_id: s.id,
          bankTransactionIds: s.bankTxnIds,
          entryIds: (s.entries ?? []).map((e: any) => String(e.id)),
        };
      });

      const res: any = await createMatchGroupsBatch({ businessId, accountId, items });
      const results = Array.isArray(res?.results) ? res.results : [];

      // Per-suggestion status keyed by client_id (stable)
      const bySuggestion = new Map<string, { ok: boolean; err: string | null }>();
      for (const r of results) {
        const cid = String(r?.client_id ?? "");
        if (!cid) continue;
        bySuggestion.set(cid, { ok: !!r?.ok, err: r?.ok ? null : String(r?.error ?? "Apply failed") });
      }

      for (const s of selectedSuggestions) {
        const r = bySuggestion.get(s.id) ?? { ok: false, err: "Apply failed" };
        if (r.ok) {
          okN += 1;
          setRowStatus((prev) => ({ ...prev, [s.id]: "APPLIED" }));
        } else {
          failN += 1;
          setRowStatus((prev) => ({ ...prev, [s.id]: "FAILED" }));
          setRowError((prev) => ({ ...prev, [s.id]: r.err ?? "Apply failed" }));
        }
      }

      // Refresh reconcile page after best-effort apply (even if some failures)
      await onApplied();

      setApplySummary(`Applied ${okN} suggestion${okN === 1 ? "" : "s"}${failN ? ` · ${failN} failed` : ""}`);
    } finally {
      setApplyBusy(false);
    }
  }

  return (
    <AppDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Match suggestions"
      description="Review deterministic bank-to-ledger matches before applying them."
      size="lg"
      footer={
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs leading-5 text-bb-text-muted">
            {applySummary
              ? applySummary
              : counts.total === 0
                ? "No suggestions found."
                : `${selected.size} selected · ${counts.ready} ready · ${counts.review} review`}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              variant="outline"
              className="w-full sm:w-auto"
              onClick={() => onOpenChange(false)}
              disabled={applyBusy}
            >
              Close
            </Button>

            {!confirmStep ? (
              <Button
                className="w-full sm:w-auto"
                disabled={!canWrite || selected.size === 0 || counts.total === 0}
                title={!canWrite ? canWriteReason : "Review selected suggestions"}
                onClick={() => setConfirmStep(true)}
              >
                Review selected ({selected.size})
              </Button>
            ) : (
              <Button
                className="w-full sm:w-auto"
                disabled={!canWrite || selected.size === 0 || counts.total === 0 || applyBusy}
                title={!canWrite ? canWriteReason : "Apply selected suggestions"}
                onClick={applySelected}
              >
                {applyBusy ? "Applying…" : `Apply ${selected.size}`}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col max-h-[70vh]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-bb-border px-3 py-2 text-xs text-bb-text-muted">
          <span>
            Selected: <span className="font-medium text-bb-text">{selected.size}</span>
          </span>
          <span>
            Ready: <span className="font-medium text-bb-text">{counts.ready}</span>
          </span>
          <span>
            Needs review: <span className="font-medium text-bb-text">{counts.review}</span>
          </span>
          <span>
            Simple: <span className="font-medium text-bb-text">{counts.one}</span>
          </span>
          <button
            type="button"
            className="h-6 rounded-md border border-bb-border bg-bb-surface-card px-2 text-[11px] text-bb-text hover:bg-bb-table-row-hover disabled:opacity-50"
            disabled={applyBusy || counts.ready === 0}
            onClick={() => setSelected(new Set(suggestions.filter((s) => s.quality === "READY").map((s) => s.id)))}
          >
            Ready
          </button>
          <button
            type="button"
            className="h-6 rounded-md border border-bb-border bg-bb-surface-card px-2 text-[11px] text-bb-text hover:bg-bb-table-row-hover disabled:opacity-50"
            disabled={applyBusy || counts.total === 0}
            onClick={() => setSelected(new Set(suggestions.map((s) => s.id)))}
          >
            All
          </button>
          <button
            type="button"
            className="h-6 rounded-md border border-bb-border bg-bb-surface-card px-2 text-[11px] text-bb-text hover:bg-bb-table-row-hover disabled:opacity-50"
            disabled={applyBusy || selected.size === 0}
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {suggestions.length === 0 ? (
            <div className="p-3 text-sm text-bb-text-muted">
              No clear matches found for the current unmatched bank transactions and expected entries.
            </div>
          ) : (
            <div className="divide-y divide-bb-border-muted">
              {suggestions.map((s) => {
                const checked = selected.has(s.id);
                const bankDate = String(s.bank.posted_date ?? "").slice(0, 10);
                const bankName = String(s.bank.name ?? "");
                const bankAmtFmt = formatUsdAccountingFromCents(s.bank.amount_cents);

                const st = rowStatus[s.id] ?? null;
                const stBadge =
                  st === "APPLIED"
                    ? badge("Applied", "success")
                    : st === "FAILED"
                      ? badge("Failed", "danger", rowError[s.id])
                      : st === "PENDING"
                        ? badge("Pending")
                        : null;

                const why = getSuggestionWhy(s);

                return (
                  <div key={s.id} className="flex items-start gap-3 px-3 py-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4"
                      checked={checked}
                      disabled={applyBusy}
                      onChange={(e) => {
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(s.id);
                          else next.delete(s.id);
                          return next;
                        });
                      }}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                        <div className="min-w-0 flex-1 basis-full text-sm font-medium text-bb-text sm:basis-auto sm:truncate">{bankName || "Bank transaction"}</div>
                        {qualityBadge(s)}
                        <div className="text-xs text-bb-text-muted tabular-nums">{bankDate}</div>
                        <div
                          className={`text-xs tabular-nums font-semibold sm:ml-auto ${
                            bankAmtFmt.isNeg ? "text-bb-amount-negative" : "text-bb-text"
                          }`}
                        >
                          {bankAmtFmt.text}
                        </div>
                      </div>

                      <div className="mt-1 text-xs leading-5 text-bb-text-muted">
                        Match:{" "}
                        <span className="font-medium text-bb-text">
                          {s.kind === "COMBINE"
                            ? `${s.bankTxnIds.length} bank transactions`
                            : s.kind === "ONE_TO_ONE"
                              ? "1 entry"
                              : `${s.entryIds.length} entries`}
                        </span>
                        {" · "}
                        <span className="text-bb-text">
                          {s.kind === "COMBINE"
                            ? s.bankTxnIds
                                .map((id) => {
                                  const bt = (bankTxns ?? []).find((x: any) => String(x.id) === String(id));
                                  const name = String(bt?.name ?? "Bank txn");
                                  const f = formatUsdAccountingFromCents(bt?.amount_cents);
                                  return `${name} (${f.text})`;
                                })
                                .join(", ")
                            : s.entries
                                .map((e: any) => {
                                  const f = formatUsdAccountingFromCents(e.amount_cents);
                                  return `${String(e.payee ?? "Entry")} (${f.text})`;
                                })
                                .join(", ")}
                      </span>
                      </div>

                      {why ? (
                        <div className="mt-1 text-[11px] text-bb-text-muted">
                          Why: <span className="text-bb-text-muted">{why}</span>
                        </div>
                      ) : null}

                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span>{badge(suggestionKindLabel(s.kind))}</span>
                        {stBadge}
                        {s.reasons.length || s.cautionReasons.length ? (
                          <details className="min-w-0">
                            <summary className="h-6 cursor-pointer list-none rounded-md border border-bb-border bg-bb-surface-card px-2 text-[11px] leading-6 text-bb-text hover:bg-bb-table-row-hover [&::-webkit-details-marker]:hidden">
                              Signals
                            </summary>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {s.reasons.map((r) => (
                                <span key={r}>{badge(r)}</span>
                              ))}
                              {s.cautionReasons.map((r) => (
                                <span key={r}>{badge(r)}</span>
                              ))}
                            </div>
                          </details>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {confirmStep ? (
          <div className="px-3 py-2 border-t border-bb-border text-xs text-bb-text-muted">
            Applying creates matches for the selected rows only. Nothing is applied silently.
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
