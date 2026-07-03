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
  confidence: number;
  quality: "READY" | "REVIEW";
  reasons: string[];
  cautionReasons: string[];
  bank: any;
  entries: any[];
};

import { toBigIntSafe } from "@/lib/money";

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

function sameDirectionAmount(a: any, b: any) {
  const av = toBigIntSafe(a);
  const bv = toBigIntSafe(b);
  if (av === 0n || bv === 0n) return false;
  return (av < 0n && bv < 0n) || (av > 0n && bv > 0n);
}

function tokenSet(s: any) {
  return new Set(
    norm(s)
      .replace(/[0-9]/g, " ")
      .replace(/[^a-z\s]/g, " ")
      .split(/\s+/)
      .filter((part) => part.length >= 3)
  );
}

function textOverlap(a: any, b: any) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hits = 0;
  for (const item of A) {
    if (B.has(item)) hits += 1;
  }
  return hits;
}

function payeeMatchesBank(bank: any, entry: any) {
  const bankDesc = norm(bank?.name ?? bank?.description ?? bank?.memo ?? "");
  const payee = norm(entry?.payee ?? entry?.vendor_name ?? "");
  if (!bankDesc || !payee) return false;
  return bankDesc.includes(payee) || payee.includes(bankDesc) || textOverlap(bankDesc, payee) >= 2;
}

function suggestionKindLabel(kind: Suggestion["kind"]) {
  if (kind === "COMBINE") return "Many bank transactions to one entry";
  if (kind === "SPLIT") return "One bank transaction to several entries";
  return "One bank transaction to one entry";
}

function qualityForOneToOne(args: {
  bank: any;
  entry: any;
  dateDiffAbs: number;
  similarCandidateCount: number;
  payeeHit: boolean;
}) {
  const { bank, entry, dateDiffAbs, similarCandidateCount, payeeHit } = args;
  const refHit = checkSimpleRefMatch(bank, entry);
  const reasons = ["Exact amount", dateDiffAbs === 0 ? "Same date" : `Date within ${dateDiffAbs}d`];
  const cautionReasons: string[] = [];

  if (refHit) reasons.push("Reference match");
  else if (payeeHit) reasons.push("Similar payee");
  else cautionReasons.push("Payee is not clearly similar");

  if (similarCandidateCount > 1 && !refHit) cautionReasons.push(`${similarCandidateCount} possible entries`);

  const strong = similarCandidateCount === 1 && (refHit || payeeHit || dateDiffAbs <= 1);
  return {
    quality: strong ? "READY" as const : "REVIEW" as const,
    confidence: strong ? (refHit ? 0.98 : payeeHit ? 0.93 : 0.88) : 0.72,
    reasons,
    cautionReasons,
  };
}

function checkSimpleRefMatch(bank: any, entry: any) {
  const bankText = [
    bank?.check_number,
    bank?.checkNumber,
    bank?.name,
    bank?.description,
    bank?.memo,
  ].map((v) => String(v ?? "")).join(" ");
  const entryText = [
    entry?.ref,
    entry?.reference,
    entry?.reference_number,
    entry?.referenceNumber,
    entry?.memo,
  ].map((v) => String(v ?? "")).join(" ");

  const bankNums = new Set((bankText.match(/\b\d{2,8}\b/g) ?? []).map((x) => x.replace(/^0+/, "") || x));
  if (bankNums.size === 0) return false;
  for (const raw of entryText.match(/\b\d{2,8}\b/g) ?? []) {
    const normalized = raw.replace(/^0+/, "") || raw;
    if (bankNums.has(normalized)) return true;
  }
  return false;
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
    if (!bankTxns?.length || !expectedEntries?.length) return [];

    const entries = expectedEntries.slice(0, 250); // safety cap
    const entriesByAmount = new Map<string, any[]>();

    for (const e of entries) {
      const amt = toBigIntSafe(e.amount_cents).toString();
      if (amt === "0") continue;
      const arr = entriesByAmount.get(amt) ?? [];
      arr.push(e);
      entriesByAmount.set(amt, arr);
    }

    const out: Suggestion[] = [];
    const usedEntryIds = new Set<string>();

    function tryOneToOne(t: any) {
      if (t?.is_pending) return;
      const bankAmount = toBigIntSafe(t.amount_cents);
      if (bankAmount === 0n) return;
      const candidates = entriesByAmount.get(bankAmount.toString()) ?? [];
      if (!candidates.length) return;

      const bankDate = String(t.posted_date ?? "").slice(0, 10);

      const scored = candidates
        .filter((e) => !usedEntryIds.has(e.id))
        .map((e) => {
          const entryDate = String(e.date ?? "").slice(0, 10);
          const inWin = withinWindow(entryDate, bankDate, DAY_WINDOW);
          const diff = daysBetween(entryDate, bankDate);
          const diffAbs = diff === null ? 9999 : Math.abs(diff);
          const payeeHit = payeeMatchesBank(t, e);
          const refHit = checkSimpleRefMatch(t, e);
          return { e, inWin, payeeHit, refHit, diffAbs };
        })
        .filter((x) => x.inWin)
        .sort((a, b) => {
          if (a.refHit !== b.refHit) return a.refHit ? -1 : 1;
          if (a.payeeHit !== b.payeeHit) return a.payeeHit ? -1 : 1;
          if (a.diffAbs !== b.diffAbs) return a.diffAbs - b.diffAbs;
          return String(a.e.id).localeCompare(String(b.e.id));
        });

      if (!scored.length) return;
      const bestMeta = scored[0];
      const best = bestMeta.e;
      const quality = qualityForOneToOne({
        bank: t,
        entry: best,
        dateDiffAbs: bestMeta.diffAbs,
        similarCandidateCount: scored.length,
        payeeHit: bestMeta.payeeHit,
      });

      usedEntryIds.add(best.id);
      out.push({
        id: `1:${t.id}:${best.id}`,
        bankTxnId: t.id,
        entryIds: [best.id],
        kind: "ONE_TO_ONE",
        ...quality,
        bank: t,
        entries: [best],
      });
    }

    function trySplit(t: any) {
      if (t?.is_pending) return;
      const bankAmount = toBigIntSafe(t.amount_cents);
      const bankAbs = absBig(toBigIntSafe(t.amount_cents));
      if (bankAbs <= 0n) return;

      const bankDate = String(t.posted_date ?? "").slice(0, 10);

      const candidates = entries
        .filter((e) => !usedEntryIds.has(e.id))
        .filter((e) => sameDirectionAmount(bankAmount, e.amount_cents))
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
      bankAlreadySuggested.add(String(t.id));

      out.push({
        id: `s:${t.id}:${foundEntries.map((e) => e.id).join(",")}`,
        bankTxnId: t.id,
        entryIds: foundEntries.map((e) => e.id),
        kind: "SPLIT",
        confidence: 0.78,
        quality: "REVIEW",
        reasons: [`Exact total`, `Dates within ${DAY_WINDOW}d`, `${foundEntries.length} entries`],
        cautionReasons: ["Multiple ledger entries"],
        bank: t,
        entries: foundEntries,
      });
    }

    const banks = bankTxns
      .slice(0, 600)
      .sort((a, b) => {
        const da = String(a.posted_date ?? "");
        const db = String(b.posted_date ?? "");
        if (da !== db) return da.localeCompare(db);
        return String(a.id).localeCompare(String(b.id));
      });

    let bankAlreadySuggested = new Set<string>();

    function tryCombine(e: any) {
      // COMBINE: multiple bank txns sum to one entry (≤5 txns), all within ±3d
      const entryAbs = absBig(toBigIntSafe(e.amount_cents));
      if (entryAbs <= 0n) return;

      const entryDate = String(e.date ?? "").slice(0, 10);

      const candidates = banks
        .filter((t: any) => !bankAlreadySuggested.has(t.id)) // don't use banks already used by 1-to-1/split suggestions
        .filter((t: any) => !t?.is_pending)
        .filter((t: any) => sameDirectionAmount(e.amount_cents, t.amount_cents))
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
        confidence: 0.76,
        quality: "REVIEW",
        reasons: [`Exact total`, `Dates within ${DAY_WINDOW}d`, `${foundBanks.length} bank transactions`],
        cautionReasons: ["Multiple bank transactions"],
        bank: foundBanks[0], // display anchor
        entries: [e],
        // We'll also attach banks list via a hidden field for apply below (we keep it in the object)
      } as any);
      (out[out.length - 1] as any).bankTxnIds = foundBanks.map((t) => String(t.id));
    }

    for (const t of banks) tryOneToOne(t);

    bankAlreadySuggested = new Set(out.map((s) => s.bankTxnId));
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
      tryCombine(e);
    }

    return out;
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
      title="Match suggestions"
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
            Select ready
          </button>
          <button
            type="button"
            className="h-6 rounded-md border border-bb-border bg-bb-surface-card px-2 text-[11px] text-bb-text hover:bg-bb-table-row-hover disabled:opacity-50"
            disabled={applyBusy || counts.total === 0}
            onClick={() => setSelected(new Set(suggestions.map((s) => s.id)))}
          >
            Select all
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
                            ? `${(s as any).bankTxnIds?.length ?? 1} bank transactions`
                            : s.kind === "ONE_TO_ONE"
                              ? "1 entry"
                              : `${s.entryIds.length} entries`}
                        </span>
                        {" · "}
                        <span className="text-bb-text">
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

                      {why ? (
                        <div className="mt-1 text-[11px] text-bb-text-muted">
                          Why: <span className="text-bb-text-muted">{why}</span>
                        </div>
                      ) : null}

                      <div className="mt-2 flex flex-wrap gap-2">
                        <span>{badge(suggestionKindLabel(s.kind))}</span>
                        {s.reasons.map((r) => (
                          <span key={r}>{badge(r)}</span>
                        ))}
                        {s.cautionReasons.map((r) => (
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
          <div className="px-3 py-2 border-t border-bb-border text-xs text-bb-text-muted">
            Applying creates matches for the selected rows only. Nothing is applied silently.
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
