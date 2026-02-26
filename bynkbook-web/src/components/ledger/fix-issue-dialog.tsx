"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppDialog } from "@/components/primitives/AppDialog";
import { resolveIssue, type EntryIssueRow } from "@/lib/api/issues";
import { mergeEntry } from "@/lib/api/entries";

type Kind = "DUPLICATE" | "MISSING_CATEGORY" | "STALE_CHECK";

export function FixIssueDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  businessId: string;
  accountId: string;

  kind: Kind | null;
  entryId: string | null;

  // Data sources (provided by Ledger page)
  issues: EntryIssueRow[];
  rowsById: Record<
    string,
    {
      id: string;
      date: string;
      payee: string;
      amountStr: string;
      methodDisplay: string;
      category: string;
      categoryId: string | null;
    }
  >;

  categories: Array<{ id: string; name: string }>;

  onDidMutate?: () => void; // refresh hooks in Ledger
}) {
  const {
    open,
    onOpenChange,
    businessId,
    accountId,
    kind,
    entryId,
    issues,
    rowsById,
    categories,
    onDidMutate,
  } = props;

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pickedCategoryId, setPickedCategoryId] = useState<string>("");

  // Merge (Duplicate only)
  const [mergeSurvivorId, setMergeSurvivorId] = useState<string>("");
  const [mergeDuplicateId, setMergeDuplicateId] = useState<string>("");

  const relevant = useMemo(() => {
    if (!kind || !entryId) return { issueIds: [] as string[], entryIds: [] as string[] };

    if (kind === "DUPLICATE") {
      const base = issues.find((x) => x.entry_id === entryId && x.issue_type === "DUPLICATE");
      const g = base?.group_key ?? null;
      if (!g) return { issueIds: base ? [base.id] : [], entryIds: [entryId] };

      const groupIssues = issues.filter((x) => x.issue_type === "DUPLICATE" && x.group_key === g);
      const entryIds = Array.from(new Set(groupIssues.map((x) => x.entry_id)));
      const issueIds = groupIssues.map((x) => x.id);
      return { issueIds, entryIds };
    }

    if (kind === "STALE_CHECK") {
      const base = issues.find((x) => x.entry_id === entryId && x.issue_type === "STALE_CHECK");
      return { issueIds: base ? [base.id] : [], entryIds: [entryId] };
    }

    // MISSING_CATEGORY
    const base = issues.find((x) => x.entry_id === entryId && x.issue_type === "MISSING_CATEGORY");
    return { issueIds: base ? [base.id] : [], entryIds: [entryId] };
  }, [kind, entryId, issues]);

  const affectedRows = useMemo(() => {
    return relevant.entryIds
      .map((id) => rowsById[id])
      .filter(Boolean);
  }, [relevant.entryIds, rowsById]);

  // Seed merge selection for duplicates (must be an effect; no side-effects in useMemo)
  useEffect(() => {
    if (kind !== "DUPLICATE") return;

    const ids = Array.isArray(relevant.entryIds) ? relevant.entryIds : [];
    if (ids.length < 2) return;

    const s0 = ids[0] ?? "";
    const d0 = ids[1] ?? "";

    // Ensure current selections are valid; otherwise seed defaults
    const survivorOk = !!mergeSurvivorId && ids.includes(mergeSurvivorId);
    const dupOk = !!mergeDuplicateId && ids.includes(mergeDuplicateId);

    const nextSurvivor = survivorOk ? mergeSurvivorId : s0;
    let nextDup = dupOk ? mergeDuplicateId : d0;

    // Must never be the same
    if (nextDup === nextSurvivor) {
      nextDup = ids.find((x) => x !== nextSurvivor) ?? d0;
    }

    setMergeSurvivorId(nextSurvivor);
    setMergeDuplicateId(nextDup);
  }, [kind, relevant.entryIds, mergeSurvivorId, mergeDuplicateId]);

  const entryLabel = (id: string) => {
    const r = rowsById?.[id];
    if (!r) return id;

    const payee = String(r.payee ?? "").trim();
    const payeeShort = payee.length > 48 ? `${payee.slice(0, 45)}…` : payee;

    const date = String(r.date ?? "");
    const amt = String((r as any).amountStr ?? "");

    return `${date} • ${payeeShort} • ${amt}`;
  };

  const dialogSize = useMemo<"md" | "lg">(() => {
    if (kind !== "DUPLICATE") return "md";

    let maxPayeeLen = 0;
    let maxTokenLen = 0;

    for (const r of affectedRows) {
      const p = String(r.payee ?? "").trim();
      maxPayeeLen = Math.max(maxPayeeLen, p.length);
      for (const tok of p.split(/\s+/)) maxTokenLen = Math.max(maxTokenLen, tok.length);
    }

    // 3 scenarios:
    // - small: md
    // - medium/large: lg
    // Use BOTH overall length and longest-token length so "ACH CREDIT BANKCARD..." widens too.
    if (maxPayeeLen >= 18) return "lg";
    if (maxTokenLen >= 14) return "lg";
    return "md";
  }, [kind, affectedRows]);

  const title =
    kind === "DUPLICATE"
      ? "Potential duplicate"
      : kind === "STALE_CHECK"
        ? "Stale check"
        : "Missing category";

  async function doResolve(action: "LEGITIMIZE" | "ACK_STALE" | "FIX_MISSING_CATEGORY") {
    if (!kind || !entryId) return;
    setErr(null);

    if (action === "FIX_MISSING_CATEGORY" && !pickedCategoryId) {
      setErr("Pick a category first.");
      return;
    }

    setBusy(true);
    try {
      // Resolve all relevant issue ids (duplicate group resolves all in group; others resolve single)
      for (const issueId of relevant.issueIds) {
        await resolveIssue({
          businessId,
          accountId,
          issueId,
          action,
          category_id: action === "FIX_MISSING_CATEGORY" ? pickedCategoryId : undefined,
        });
      }

      onDidMutate?.();
      onOpenChange(false);
      setPickedCategoryId("");
    } catch (e: any) {
      setErr(e?.message || "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title={title}
      size={dialogSize}
      footer={
        <div className="flex items-center justify-between gap-2 w-full">
          <div className="text-xs text-red-600">{err ?? ""}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Close
            </Button>

            {kind === "MISSING_CATEGORY" ? (
              <>
                {/* No "Legitimize" for missing category — must fix the data */}
                <Button
                  onClick={() => doResolve("FIX_MISSING_CATEGORY")}
                  disabled={busy || relevant.issueIds.length === 0 || !pickedCategoryId}
                >
                  {busy ? "Saving…" : "Fix category"}
                </Button>
              </>
            ) : null}

            {kind === "STALE_CHECK" ? (
              <>
                {/* No "Legitimize" for missing category — must actually fix data */}
                <Button
                  onClick={() => doResolve("ACK_STALE")}
                  disabled={busy || relevant.issueIds.length === 0}
                >
                  {busy ? "Saving…" : "Acknowledge stale"}
                </Button>
              </>
            ) : null}

            {kind === "DUPLICATE" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => doResolve("LEGITIMIZE")}
                  disabled={busy || relevant.issueIds.length === 0}
                >
                  {busy ? "Saving…" : "Legitimize"}
                </Button>

                <Button
                  onClick={async () => {
                    if (!mergeSurvivorId || !mergeDuplicateId) {
                      setErr("Pick survivor and duplicate.");
                      return;
                    }
                    if (mergeSurvivorId === mergeDuplicateId) {
                      setErr("Survivor and duplicate must be different.");
                      return;
                    }

                    setBusy(true);
                    setErr(null);
                    try {
                      await mergeEntry({
                        businessId,
                        accountId,
                        survivorEntryId: mergeSurvivorId,
                        duplicateEntryId: mergeDuplicateId,
                        reason: "duplicate-issue-merge",
                      });

                      onDidMutate?.();
                      onOpenChange(false);
                      setPickedCategoryId("");
                      setMergeSurvivorId("");
                      setMergeDuplicateId("");
                    } catch (e: any) {
                      setErr(e?.message ?? "Merge failed");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy || relevant.entryIds.length < 2}
                >
                  {busy ? "Merging…" : "Merge"}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {kind === "MISSING_CATEGORY" ? (
          <div className="flex items-center gap-2">
            <div className="text-sm text-slate-700 w-28">Category</div>
            <div className="flex-1">
              <Select value={pickedCategoryId} onValueChange={setPickedCategoryId}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent align="start">
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ) : null}

        <div className="rounded-md border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700">
            Affected entries ({affectedRows.length})
          </div>
          <div className="overflow-x-hidden overflow-y-hidden">
            <table className="w-full text-sm table-fixed">
              <colgroup>
                {/* md: squeeze non-payee columns so Payee has room */}
                {/* lg: comfortable non-payee widths */}
                {dialogSize === "md" ? (
                  <>
                    <col style={{ width: 90 }} />
                    <col />
                    <col style={{ width: 84 }} />
                    <col style={{ width: 96 }} />
                    <col style={{ width: 98 }} />
                  </>
                ) : (
                  <>
                    <col style={{ width: 96 }} />
                    <col />
                    <col style={{ width: 96 }} />
                    <col style={{ width: 120 }} />
                    <col style={{ width: 110 }} />
                  </>
                )}
              </colgroup>

              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-xs text-slate-600">
                  <th className="text-left font-medium px-2 py-1">Date</th>
                  <th className="text-left font-medium px-2 py-1">Payee</th>
                  <th className="text-left font-medium px-2 py-1">Method</th>
                  <th className="text-left font-medium px-2 py-1">Category</th>
                  <th className="text-right font-medium px-2 py-1">Amount</th>
                </tr>
              </thead>
              <tbody>
                {affectedRows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="px-2 py-1 tabular-nums">{r.date}</td>
                    <td className="px-2 py-1 whitespace-normal break-normal">{r.payee}</td>
                    <td className="px-2 py-1">{r.methodDisplay}</td>
                    <td className="px-2 py-1">{r.category || "—"}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{r.amountStr}</td>
                  </tr>
                ))}
                {affectedRows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-sm text-slate-600" colSpan={5}>
                      No affected entries found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        {kind === "DUPLICATE" ? (
          <div className="space-y-2">
            <div className="text-xs text-slate-600">
              Merge will soft-delete the duplicate entry. Survivor amount stays unchanged.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="text-xs">
                <div className="text-[11px] text-slate-600 mb-1">Survivor</div>
                <Select value={mergeSurvivorId} onValueChange={setMergeSurvivorId}>
                  <SelectTrigger className="h-7 px-2 text-xs min-w-0 border-primary/30 bg-primary/5">
                    <span className="truncate" title={mergeSurvivorId ? entryLabel(mergeSurvivorId) : ""}>
                      {mergeSurvivorId ? entryLabel(mergeSurvivorId) : "Pick survivor"}
                    </span>
                  </SelectTrigger>
                  <SelectContent align="start" className="text-xs">
                    {relevant.entryIds.map((id) => (
                      <SelectItem key={id} value={id}>
                        {rowsById[id]?.date} • {rowsById[id]?.payee} • {rowsById[id]?.amountStr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-xs">
                <div className="text-[11px] text-slate-600 mb-1">Duplicate (will be deleted)</div>
                <Select value={mergeDuplicateId} onValueChange={setMergeDuplicateId}>
                  <SelectTrigger className="h-7 px-2 text-xs min-w-0 border-red-200 bg-red-50">
                    <span className="truncate" title={mergeDuplicateId ? entryLabel(mergeDuplicateId) : ""}>
                      {mergeDuplicateId ? entryLabel(mergeDuplicateId) : "Pick duplicate"}
                    </span>
                  </SelectTrigger>
                  <SelectContent align="start" className="text-xs">
                    {relevant.entryIds.map((id) => (
                      <SelectItem key={id} value={id}>
                        {rowsById[id]?.date} • {rowsById[id]?.payee} • {rowsById[id]?.amountStr}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
