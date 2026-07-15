import {
  checkRefsMatch,
  normalizeDesc,
  tokenOverlap,
  toBigIntSafe,
} from "./helpers";

export const READY_MATCH_WINDOW_DAYS = 3;
export const REVIEW_MATCH_WINDOW_DAYS = 14;
export const REFERENCE_MATCH_WINDOW_DAYS = 45;
export const MULTI_MATCH_WINDOW_DAYS = 3;

const MAX_MULTI_ITEMS = 5;
const MAX_MULTI_CANDIDATES = 24;

export type ReconcileSuggestionKind = "ONE_TO_ONE" | "SPLIT" | "COMBINE";
export type ReconcileSuggestionQuality = "READY" | "REVIEW";

export type ReconcileSuggestion = {
  id: string;
  bankTxnId: string;
  bankTxnIds: string[];
  entryIds: string[];
  kind: ReconcileSuggestionKind;
  confidence: number;
  quality: ReconcileSuggestionQuality;
  reasons: string[];
  cautionReasons: string[];
  bank: any;
  entries: any[];
  postingLagDays: number | null;
  candidateCount: number;
};

type OneToOneEdge = {
  bank: any;
  entry: any;
  bankId: string;
  entryId: string;
  postingLagDays: number;
  absDateDiffDays: number;
  refMatch: boolean;
  directDescriptionMatch: boolean;
  textOverlap: number;
};

function absBig(value: bigint) {
  return value < 0n ? -value : value;
}

function recordId(value: any) {
  return String(value?.id ?? "").trim();
}

function ymd(value: unknown) {
  const raw = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  const fromYmd = ymd(from);
  const toYmd = ymd(to);
  if (!fromYmd || !toYmd) return null;
  const fromMs = Date.parse(`${fromYmd}T00:00:00Z`);
  const toMs = Date.parse(`${toYmd}T00:00:00Z`);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  return Math.round((toMs - fromMs) / 86_400_000);
}

function bankDate(bank: any) {
  return ymd(bank?.posted_date ?? bank?.postedDate);
}

function entryDate(entry: any) {
  return ymd(entry?.date);
}

function bankDescription(bank: any) {
  return [
    bank?.name,
    bank?.merchant_name,
    bank?.original_description,
    bank?.description,
    bank?.memo,
  ].map((value) => String(value ?? "")).join(" ");
}

function entryDescription(entry: any) {
  return [entry?.payee, entry?.vendor_name, entry?.memo]
    .map((value) => String(value ?? ""))
    .join(" ");
}

function hasDirectDescriptionMatch(bank: any, entry: any) {
  const bankText = normalizeDesc(bankDescription(bank));
  const entryText = normalizeDesc(String(entry?.payee ?? entry?.vendor_name ?? ""));
  if (bankText.length < 4 || entryText.length < 4) return false;
  return bankText.includes(entryText) || entryText.includes(bankText);
}

function isPendingBank(bank: any) {
  return bank?.is_pending === true || bank?.isPending === true;
}

function isEligibleEntry(entry: any, asOfDate: string) {
  if (!recordId(entry)) return false;
  if (entry?.deleted_at || entry?.deletedAt) return false;
  if (entry?.is_adjustment === true || entry?.isAdjustment === true) return false;
  if (entry?.__optimistic_pending) return false;
  const date = entryDate(entry);
  if (!date || date > asOfDate) return false;
  return toBigIntSafe(entry?.amount_cents) !== 0n;
}

function compareEdges(a: OneToOneEdge, b: OneToOneEdge) {
  if (a.refMatch !== b.refMatch) return a.refMatch ? -1 : 1;
  if (a.directDescriptionMatch !== b.directDescriptionMatch) return a.directDescriptionMatch ? -1 : 1;
  if (a.textOverlap !== b.textOverlap) return b.textOverlap - a.textOverlap;
  if (a.absDateDiffDays !== b.absDateDiffDays) return a.absDateDiffDays - b.absDateDiffDays;
  if (a.postingLagDays !== b.postingLagDays) return a.postingLagDays - b.postingLagDays;
  return a.entryId.localeCompare(b.entryId);
}

function oneToOneReasons(edge: OneToOneEdge, candidateCount: number) {
  const reasons = ["Exact amount"];
  const cautionReasons: string[] = [];

  if (edge.postingLagDays === 0) reasons.push("Same date");
  else if (edge.postingLagDays > 0) reasons.push(`Posted ${edge.postingLagDays}d after ledger entry`);
  else reasons.push(`Ledger entry recorded ${Math.abs(edge.postingLagDays)}d after bank posting`);

  if (edge.refMatch) reasons.push("Reference match");
  else if (edge.directDescriptionMatch || edge.textOverlap > 0) reasons.push("Similar description");
  else cautionReasons.push("No reference or description match");

  if (edge.absDateDiffDays > READY_MATCH_WINDOW_DAYS) {
    cautionReasons.push("Delayed bank posting");
  }
  if (candidateCount > 1 && !edge.refMatch) {
    cautionReasons.push(`${candidateCount} possible ledger entries`);
  }

  return { reasons, cautionReasons };
}

function qualityForEdge(edge: OneToOneEdge, candidateEdges: OneToOneEdge[]) {
  const refMatches = candidateEdges.filter((candidate) => candidate.refMatch).length;
  const uniqueReference = edge.refMatch && refMatches === 1;
  const soleCandidate = candidateEdges.length === 1;
  const readyByIdentity =
    soleCandidate &&
    edge.absDateDiffDays <= READY_MATCH_WINDOW_DAYS &&
    (edge.directDescriptionMatch || edge.textOverlap >= 2 || edge.absDateDiffDays <= 1);
  const quality: ReconcileSuggestionQuality = uniqueReference || readyByIdentity ? "READY" : "REVIEW";

  const confidence = uniqueReference
    ? 0.99
    : quality === "READY"
      ? edge.directDescriptionMatch || edge.textOverlap >= 2
        ? 0.94
        : 0.9
      : edge.directDescriptionMatch || edge.textOverlap > 0
        ? 0.82
        : 0.74;

  return { quality, confidence };
}

function assignOneToOne(edgesByBankId: Map<string, OneToOneEdge[]>) {
  const assignedByBankId = new Map<string, OneToOneEdge>();
  const ownerByEntryId = new Map<string, string>();
  const bankIds = Array.from(edgesByBankId.keys()).sort((a, b) => {
    const aEdges = edgesByBankId.get(a) ?? [];
    const bEdges = edgesByBankId.get(b) ?? [];
    if (aEdges.length !== bEdges.length) return aEdges.length - bEdges.length;
    const aBest = aEdges[0];
    const bBest = bEdges[0];
    if (aBest && bBest) {
      const edgeOrder = compareEdges(aBest, bBest);
      if (edgeOrder !== 0) return edgeOrder;
    }
    return a.localeCompare(b);
  });

  function assign(bankId: string, visitedBanks: Set<string>, visitedEntries: Set<string>): boolean {
    if (visitedBanks.has(bankId)) return false;
    visitedBanks.add(bankId);

    for (const edge of edgesByBankId.get(bankId) ?? []) {
      if (visitedEntries.has(edge.entryId)) continue;
      visitedEntries.add(edge.entryId);
      const currentOwner = ownerByEntryId.get(edge.entryId);
      if (!currentOwner || assign(currentOwner, visitedBanks, visitedEntries)) {
        const previous = assignedByBankId.get(bankId);
        if (previous) ownerByEntryId.delete(previous.entryId);
        ownerByEntryId.set(edge.entryId, bankId);
        assignedByBankId.set(bankId, edge);
        return true;
      }
    }
    return false;
  }

  for (const bankId of bankIds) {
    assign(bankId, new Set(), new Set());
  }

  return assignedByBankId;
}

export function buildOneToOneSuggestions(args: {
  bankTransactions: any[];
  expectedEntries: any[];
  asOfDate?: string;
}) {
  const asOfDate = ymd(args.asOfDate) || todayYmd();
  const entriesByAmount = new Map<string, any[]>();
  for (const entry of args.expectedEntries ?? []) {
    if (!isEligibleEntry(entry, asOfDate)) continue;
    const amount = toBigIntSafe(entry?.amount_cents);
    const key = amount.toString();
    const rows = entriesByAmount.get(key) ?? [];
    rows.push(entry);
    entriesByAmount.set(key, rows);
  }

  const edgesByBankId = new Map<string, OneToOneEdge[]>();
  for (const bank of args.bankTransactions ?? []) {
    const bankId = recordId(bank);
    const postedDate = bankDate(bank);
    const amount = toBigIntSafe(bank?.amount_cents);
    if (!bankId || !postedDate || amount === 0n || isPendingBank(bank)) continue;

    const edges: OneToOneEdge[] = [];
    for (const entry of entriesByAmount.get(amount.toString()) ?? []) {
      const ledgerDate = entryDate(entry);
      const postingLagDays = daysBetween(ledgerDate, postedDate);
      if (postingLagDays === null) continue;
      const absDateDiffDays = Math.abs(postingLagDays);
      const refMatch = checkRefsMatch(bank, entry);
      const normalPostingWindow = postingLagDays >= -1 && postingLagDays <= REVIEW_MATCH_WINDOW_DAYS;
      const referencePostingWindow = refMatch && absDateDiffDays <= REFERENCE_MATCH_WINDOW_DAYS;
      if (!normalPostingWindow && !referencePostingWindow) continue;

      edges.push({
        bank,
        entry,
        bankId,
        entryId: recordId(entry),
        postingLagDays,
        absDateDiffDays,
        refMatch,
        directDescriptionMatch: hasDirectDescriptionMatch(bank, entry),
        textOverlap: Math.min(tokenOverlap(bankDescription(bank), entryDescription(entry)), 3),
      });
    }
    if (edges.length > 0) edgesByBankId.set(bankId, edges.sort(compareEdges));
  }

  const assignments = assignOneToOne(edgesByBankId);
  const suggestions: ReconcileSuggestion[] = [];
  for (const [bankId, edge] of assignments) {
    const candidateEdges = edgesByBankId.get(bankId) ?? [edge];
    const { quality, confidence } = qualityForEdge(edge, candidateEdges);
    const { reasons, cautionReasons } = oneToOneReasons(edge, candidateEdges.length);
    suggestions.push({
      id: `1:${bankId}:${edge.entryId}`,
      bankTxnId: bankId,
      bankTxnIds: [bankId],
      entryIds: [edge.entryId],
      kind: "ONE_TO_ONE",
      confidence,
      quality,
      reasons,
      cautionReasons,
      bank: edge.bank,
      entries: [edge.entry],
      postingLagDays: edge.postingLagDays,
      candidateCount: candidateEdges.length,
    });
  }

  return suggestions.sort((a, b) => {
    const dateOrder = bankDate(a.bank).localeCompare(bankDate(b.bank));
    return dateOrder || a.bankTxnId.localeCompare(b.bankTxnId);
  });
}

function sameDirection(a: unknown, b: unknown) {
  const left = toBigIntSafe(a);
  const right = toBigIntSafe(b);
  if (left === 0n || right === 0n) return false;
  return (left < 0n && right < 0n) || (left > 0n && right > 0n);
}

function withinMultiWindow(entry: any, bank: any) {
  const diff = daysBetween(entryDate(entry), bankDate(bank));
  return diff !== null && Math.abs(diff) <= MULTI_MATCH_WINDOW_DAYS;
}

function exactSubset<T>(rows: Array<{ row: T; amount: bigint }>, target: bigint): T[] | null {
  const picked: T[] = [];
  let found: T[] | null = null;

  function visit(index: number, sum: bigint) {
    if (found || picked.length > MAX_MULTI_ITEMS || sum > target) return;
    if (sum === target && picked.length >= 2) {
      found = [...picked];
      return;
    }
    if (index >= rows.length) return;

    picked.push(rows[index].row);
    visit(index + 1, sum + rows[index].amount);
    picked.pop();
    visit(index + 1, sum);
  }

  visit(0, 0n);
  return found as T[] | null;
}

export function buildReconcileSuggestions(args: {
  bankTransactions: any[];
  expectedEntries: any[];
  asOfDate?: string;
}) {
  const asOfDate = ymd(args.asOfDate) || todayYmd();
  const banks = (args.bankTransactions ?? [])
    .filter((bank) => recordId(bank) && !isPendingBank(bank) && toBigIntSafe(bank?.amount_cents) !== 0n)
    .slice()
    .sort((a, b) => bankDate(a).localeCompare(bankDate(b)) || recordId(a).localeCompare(recordId(b)));
  const entries = (args.expectedEntries ?? [])
    .filter((entry) => isEligibleEntry(entry, asOfDate))
    .slice()
    .sort((a, b) => entryDate(a).localeCompare(entryDate(b)) || recordId(a).localeCompare(recordId(b)));

  const suggestions = buildOneToOneSuggestions({
    bankTransactions: banks,
    expectedEntries: entries,
    asOfDate,
  });
  const usedBankIds = new Set(suggestions.flatMap((suggestion) => suggestion.bankTxnIds));
  const usedEntryIds = new Set(suggestions.flatMap((suggestion) => suggestion.entryIds));

  for (const bank of banks) {
    const bankId = recordId(bank);
    if (usedBankIds.has(bankId)) continue;
    const bankAmount = toBigIntSafe(bank?.amount_cents);
    const target = absBig(bankAmount);
    const candidates = entries
      .filter((entry) => !usedEntryIds.has(recordId(entry)))
      .filter((entry) => sameDirection(bankAmount, entry?.amount_cents))
      .filter((entry) => withinMultiWindow(entry, bank))
      .map((entry) => ({ row: entry, amount: absBig(toBigIntSafe(entry?.amount_cents)) }))
      .filter((candidate) => candidate.amount > 0n)
      .sort((a, b) => a.amount === b.amount
        ? recordId(a.row).localeCompare(recordId(b.row))
        : a.amount > b.amount ? -1 : 1)
      .slice(0, MAX_MULTI_CANDIDATES);
    const matchedEntries = exactSubset(candidates, target);
    if (!matchedEntries) continue;

    const entryIds = matchedEntries.map(recordId);
    usedBankIds.add(bankId);
    entryIds.forEach((id) => usedEntryIds.add(id));
    suggestions.push({
      id: `s:${bankId}:${entryIds.join(",")}`,
      bankTxnId: bankId,
      bankTxnIds: [bankId],
      entryIds,
      kind: "SPLIT",
      confidence: 0.78,
      quality: "REVIEW",
      reasons: ["Exact total", `Dates within ${MULTI_MATCH_WINDOW_DAYS}d`, `${entryIds.length} entries`],
      cautionReasons: ["Multiple ledger entries"],
      bank,
      entries: matchedEntries,
      postingLagDays: null,
      candidateCount: candidates.length,
    });
  }

  for (const entry of entries) {
    const entryId = recordId(entry);
    if (usedEntryIds.has(entryId)) continue;
    const entryAmount = toBigIntSafe(entry?.amount_cents);
    const target = absBig(entryAmount);
    const candidates = banks
      .filter((bank) => !usedBankIds.has(recordId(bank)))
      .filter((bank) => sameDirection(entryAmount, bank?.amount_cents))
      .filter((bank) => withinMultiWindow(entry, bank))
      .map((bank) => ({ row: bank, amount: absBig(toBigIntSafe(bank?.amount_cents)) }))
      .filter((candidate) => candidate.amount > 0n)
      .sort((a, b) => a.amount === b.amount
        ? recordId(a.row).localeCompare(recordId(b.row))
        : a.amount > b.amount ? -1 : 1)
      .slice(0, MAX_MULTI_CANDIDATES);
    const matchedBanks = exactSubset(candidates, target);
    if (!matchedBanks) continue;

    const bankTxnIds = matchedBanks.map(recordId);
    usedEntryIds.add(entryId);
    bankTxnIds.forEach((id) => usedBankIds.add(id));
    suggestions.push({
      id: `c:${entryId}:${bankTxnIds.join(",")}`,
      bankTxnId: bankTxnIds[0],
      bankTxnIds,
      entryIds: [entryId],
      kind: "COMBINE",
      confidence: 0.76,
      quality: "REVIEW",
      reasons: ["Exact total", `Dates within ${MULTI_MATCH_WINDOW_DAYS}d`, `${bankTxnIds.length} bank transactions`],
      cautionReasons: ["Multiple bank transactions"],
      bank: matchedBanks[0],
      entries: [entry],
      postingLagDays: null,
      candidateCount: candidates.length,
    });
  }

  return suggestions.sort((a, b) => {
    const kindOrder = { ONE_TO_ONE: 0, SPLIT: 1, COMBINE: 2 } as const;
    if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
    const dateOrder = bankDate(a.bank).localeCompare(bankDate(b.bank));
    return dateOrder || a.id.localeCompare(b.id);
  });
}
