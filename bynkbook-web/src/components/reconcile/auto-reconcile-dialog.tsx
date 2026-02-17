"use client";

import { useEffect, useMemo, useState } from "react";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Button } from "@/components/ui/button";
import { createMatchGroupsBatch } from "@/lib/api/match-groups";

const DAY_WINDOW = 3;
const SPLIT_MAX = 5;

type Suggestion = {
  id: string; // stable key
  bankTxnId: string;
  entryIds: string[]; // 1 for 1-to-1, many for split
  kind: "ONE_TO_ONE" | "SPLIT" | "COMBINE";
  reasons: string[];
  bank: any;
  entries: any[];
};

function toBigIntSafe(v: any): bigint {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    const s = String(v ?? "").trim();
    if (!s) return 0n;
    return BigInt(s);
  } catch {
    return 0n;
  }
}

function absBig(n: bigint) {
  return n < 0n ? -n : n;
}

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

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return { y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(5, 7)), d: Number(ymd.slice(8, 10)) };
}

function daysBetween(a: string, b: string): number | null {
  const A = parseYmd(a);
  const B = parseYmd(b);
  if (!A || !B) return null;
  const da = Date.UTC(A.y, A.m - 1, A.d);
  const db = Date.UTC(B.y, B.m - 1, B.d);
  return Math.round((db - da) / 86400000);
}

function withinWindow(entryDate: string, bankDate: string, win: number): boolean {
  const diff = daysBetween(entryDate, bankDate);
  if (diff === null) return false;
  return Math.abs(diff) <= win;
}

function norm(s: any) {
  return String(s ?? "").trim().toLowerCase();
}

function badge(text: string, tone: "default" | "success" | "danger" = "default", title?: string) {
  const cls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "danger"
        ? "border-red-200 bg-red-50 text-red-700"
        : "border-slate-200 bg-white text-slate-700";

  return (
    <span
      title={title}
      className={`inline-flex items-center h-6 px-2 rounded-md border text-[11px] ${cls}`}
    >
      {text}
    </span>
  );
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
    if (!bankTxns?.length || !expectedEntries?.length) return [];

    const entries = expectedEntries.slice(0, 250); // safety cap
    const entriesByAbs = new Map<string, any[]>();

    for (const e of entries) {
      const amt = absBig(toBigIntSafe(e.amount_cents)).toString();
      const arr = entriesByAbs.get(amt) ?? [];
      arr.push(e);
      entriesByAbs.set(amt, arr);
    }

    const out: Suggestion[] = [];
    const usedEntryIds = new Set<string>();

    function tryOneToOne(t: any) {
      const bankAbs = absBig(toBigIntSafe(t.amount_cents));
      const candidates = entriesByAbs.get(bankAbs.toString()) ?? [];
      if (!candidates.length) return;

      const bankDate = String(t.posted_date ?? "").slice(0, 10);
      const bankDesc = norm(t.name ?? "");

      const scored = candidates
        .filter((e) => !usedEntryIds.has(e.id))
        .map((e) => {
          const entryDate = String(e.date ?? "").slice(0, 10);
          const inWin = withinWindow(entryDate, bankDate, DAY_WINDOW);
          const payee = norm(e.payee ?? "");
          const payeeHit = payee && bankDesc && (bankDesc.includes(payee) || payee.includes(bankDesc));
          const diff = daysBetween(entryDate, bankDate);
          return { e, inWin, payeeHit, diffAbs: diff === null ? 9999 : Math.abs(diff) };
        })
        .filter((x) => x.inWin)
        .sort((a, b) => {
          if (a.payeeHit !== b.payeeHit) return a.payeeHit ? -1 : 1;
          if (a.diffAbs !== b.diffAbs) return a.diffAbs - b.diffAbs;
          return String(a.e.id).localeCompare(String(b.e.id));
        });

      if (!scored.length) return;
      const best = scored[0].e;

      const reasons = [`Exact amount match`, `Date within ±${DAY_WINDOW}d`];
      const payee = norm(best.payee ?? "");
      if (payee && bankDesc && (bankDesc.includes(payee) || payee.includes(bankDesc))) reasons.push(`Payee/description match`);

      usedEntryIds.add(best.id);
      out.push({
        id: `1:${t.id}:${best.id}`,
        bankTxnId: t.id,
        entryIds: [best.id],
        kind: "ONE_TO_ONE",
        reasons,
        bank: t,
        entries: [best],
      });
    }

    function trySplit(t: any) {
      const bankAbs = absBig(toBigIntSafe(t.amount_cents));
      if (bankAbs <= 0n) return;

      const bankDate = String(t.posted_date ?? "").slice(0, 10);

      const candidates = entries
        .filter((e) => !usedEntryIds.has(e.id))
        .filter((e) => withinWindow(String(e.date ?? "").slice(0, 10), bankDate, DAY_WINDOW))
        .map((e) => ({ e, abs: absBig(toBigIntSafe(e.amount_cents)) }))
        .filter((x) => x.abs > 0n)
        .sort((a, b) => {
          if (a.abs !== b.abs) return a.abs > b.abs ? -1 : 1;
          return String(a.e.id).localeCompare(String(b.e.id));
        });

      if (candidates.length < 2) return;

      const picked: any[] = [];
      let found: any[] | null = null;

      function dfs(i: number, sum: bigint) {
        if (found) return;
        if (picked.length > SPLIT_MAX) return;
        if (sum === bankAbs && picked.length >= 2) {
          found = [...picked];
          return;
        }
        if (sum > bankAbs) return;
        if (i >= candidates.length) return;

        picked.push(candidates[i].e);
        dfs(i + 1, sum + candidates[i].abs);
        picked.pop();

        dfs(i + 1, sum);
      }

      dfs(0, 0n);
      if (!found) return;

      const foundEntries = found as any[];

      for (const e of foundEntries) usedEntryIds.add(e.id);

      out.push({
        id: `s:${t.id}:${foundEntries.map((e) => e.id).join(",")}`,
        bankTxnId: t.id,
        entryIds: foundEntries.map((e) => e.id),
        kind: "SPLIT",
        reasons: [`Entries sum exactly to bank amount`, `All entries within ±${DAY_WINDOW}d`, `≤${SPLIT_MAX} entries`],
        bank: t,
        entries: foundEntries,
      });
    }

    function tryCombine(e: any) {
      // COMBINE: multiple bank txns sum to one entry (≤5 txns), all within ±3d
      const entryAbs = absBig(toBigIntSafe(e.amount_cents));
      if (entryAbs <= 0n) return;

      const entryDate = String(e.date ?? "").slice(0, 10);

      const candidates = banks
        .filter((t: any) => !bankAlreadySuggested.has(t.id)) // don't use banks already used by 1-to-1/split suggestions
        .filter((t: any) => withinWindow(entryDate, String(t.posted_date ?? "").slice(0, 10), DAY_WINDOW))
        .map((t: any) => ({ t, abs: absBig(toBigIntSafe(t.amount_cents)) }))
        .filter((x: any) => x.abs > 0n)
        .sort((a: any, b: any) => {
          if (a.abs !== b.abs) return a.abs > b.abs ? -1 : 1;
          return String(a.t.id).localeCompare(String(b.t.id));
        });

      if (candidates.length < 2) return;

      const picked: any[] = [];
      let found: any[] | null = null;

      function dfs(i: number, sum: bigint) {
        if (found) return;
        if (picked.length > 5) return;
        if (sum === entryAbs && picked.length >= 2) {
          found = [...picked];
          return;
        }
        if (sum > entryAbs) return;
        if (i >= candidates.length) return;

        picked.push(candidates[i].t);
        dfs(i + 1, sum + candidates[i].abs);
        picked.pop();

        dfs(i + 1, sum);
      }

      dfs(0, 0n);
      if (!found) return;

      const foundBanks = found as any[];

      // mark these bank txns as used so we don't suggest them again in other combine suggestions
      for (const t of foundBanks) bankAlreadySuggested.add(String(t.id));

      out.push({
        id: `c:${e.id}:${foundBanks.map((t) => t.id).join(",")}`,
        bankTxnId: String(foundBanks[0].id), // anchor (display only)
        entryIds: [String(e.id)],
        kind: "COMBINE",
        reasons: [`Bank txns sum exactly to entry amount`, `All bank txns within ±${DAY_WINDOW}d`, `≤5 bank txns`],
        bank: foundBanks[0], // display anchor
        entries: [e],
        // We'll also attach banks list via a hidden field for apply below (we keep it in the object)
      } as any);
      (out[out.length - 1] as any).bankTxnIds = foundBanks.map((t) => String(t.id));
    }

    const banks = bankTxns
      .slice(0, 600)
      .sort((a, b) => {
        const da = String(a.posted_date ?? "");
        const db = String(b.posted_date ?? "");
        if (da !== db) return da.localeCompare(db);
        return String(a.id).localeCompare(String(b.id));
      });

    for (const t of banks) tryOneToOne(t);

    const bankAlreadySuggested = new Set(out.map((s) => s.bankTxnId));
    for (const t of banks) {
      if (bankAlreadySuggested.has(t.id)) continue;
      trySplit(t);
    }

    // COMBINE pass (banks → 1 entry), deterministic and capped
    const eligibleEntries = entries
      .filter((e: any) => !usedEntryIds.has(e.id))
      .slice()
      .sort((a: any, b: any) => {
        const da = String(a.date ?? "");
        const db = String(b.date ?? "");
        if (da !== db) return da.localeCompare(db);
        return String(a.id).localeCompare(String(b.id));
      });

    for (const e of eligibleEntries) {
      // @ts-ignore - helper defined above
      tryCombine(e);
    }

    return out;
  }, [open, bankTxns, expectedEntries]);

  const counts = useMemo(() => {
    const total = suggestions.length;
    const one = suggestions.filter((s) => s.kind === "ONE_TO_ONE").length;
    const split = suggestions.filter((s) => s.kind === "SPLIT").length;
    const combine = suggestions.filter((s) => s.kind === "COMBINE").length;
    return { total, one, split, combine };
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

    setSelected(new Set(suggestions.map((s) => s.id)));
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
      // Deterministic apply order: ONE_TO_ONE then SPLIT, and within each by posted_date asc then id
      const selectedSuggestions = suggestions
        .filter((s) => selected.has(s.id))
        .slice()
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === "ONE_TO_ONE" ? -1 : 1;
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
        const bankTxnIds = Array.isArray((s as any).bankTxnIds) ? (s as any).bankTxnIds : [String(s.bankTxnId)];
        return {
          client_id: s.id,
          bankTransactionIds: bankTxnIds.map((x: any) => String(x)),
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
      title="Auto-reconcile"
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-600">
            {applySummary ? applySummary : counts.total === 0 ? "No suggestions found." : `${counts.total} suggestions`}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="h-7 px-3 text-xs"
              onClick={() => onOpenChange(false)}
              disabled={applyBusy}
            >
              Close
            </Button>

            {!confirmStep ? (
              <Button
                className="h-7 px-3 text-xs"
                disabled={!canWrite || selected.size === 0 || counts.total === 0}
                title={!canWrite ? canWriteReason : "Review then confirm"}
                onClick={() => setConfirmStep(true)}
              >
                Continue ({selected.size})
              </Button>
            ) : (
              <Button
                className="h-7 px-3 text-xs"
                disabled={!canWrite || selected.size === 0 || counts.total === 0 || applyBusy}
                title={!canWrite ? canWriteReason : "Confirm and apply selected suggestions"}
                onClick={applySelected}
              >
                {applyBusy ? "Applying…" : `Confirm apply (${selected.size})`}
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col max-h-[70vh]">
        <div className="px-3 py-2 flex items-center gap-3 text-xs text-slate-600 border-b border-slate-200">
          <span>
            1-to-1: <span className="font-medium text-slate-900">{counts.one}</span>
          </span>
          <span>
            Split: <span className="font-medium text-slate-900">{counts.split}</span>
          </span>
          <span>
            Combine: <span className="font-medium text-slate-900">{(counts as any).combine ?? 0}</span>
          </span>
          <span className="ml-auto text-[11px] text-slate-500">
            Deterministic suggestions (no AI). Review before applying.
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {suggestions.length === 0 ? (
            <div className="p-3 text-sm text-slate-600">
              No deterministic suggestions found for the current unmatched bank transactions and expected entries.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
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

                return (
                  <div key={s.id} className="px-3 py-2 flex gap-3 items-start">
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
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-medium text-slate-900 truncate">{bankName || "Bank transaction"}</div>
                        <div className="text-xs text-slate-500 tabular-nums">{bankDate}</div>
                        <div
                          className={`ml-auto text-xs tabular-nums font-semibold ${
                            bankAmtFmt.isNeg ? "text-red-600" : "text-slate-900"
                          }`}
                        >
                          {bankAmtFmt.text}
                        </div>
                      </div>

                      <div className="mt-1 text-xs text-slate-600">
                        Suggested:{" "}
                        <span className="font-medium text-slate-900">
                          {s.kind === "COMBINE"
                            ? `${(s as any).bankTxnIds?.length ?? 1} bank txns`
                            : s.kind === "ONE_TO_ONE"
                              ? "1 entry"
                              : `${s.entryIds.length} entries`}
                        </span>
                        {" · "}
                        <span className="text-slate-700">
                          {s.kind === "COMBINE"
                            ? ((s as any).bankTxnIds ?? [s.bankTxnId])
                                .map((id: any) => {
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

                      <div className="mt-2 flex flex-wrap gap-2">
                        {s.reasons.map((r) => (
                          <span key={r}>{badge(r)}</span>
                        ))}
                        {stBadge}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {confirmStep ? (
          <div className="px-3 py-2 border-t border-slate-200 text-xs text-slate-600">
            Confirm apply will create matches for the selected suggestions. Nothing is applied silently.
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
