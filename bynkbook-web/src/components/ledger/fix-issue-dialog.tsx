"use client";

import { useMemo, useState } from "react";
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
      size="lg"
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
              <Button
                onClick={() => doResolve("LEGITIMIZE")}
                disabled={busy || relevant.issueIds.length === 0}
                title="Resolve duplicate issue only (no merge in this sprint)"
              >
                {busy ? "Saving…" : "Legitimize"}
              </Button>
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
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-slate-200 text-xs text-slate-600">
                  <th className="text-left font-medium px-3 py-2">Date</th>
                  <th className="text-left font-medium px-3 py-2">Payee</th>
                  <th className="text-left font-medium px-3 py-2">Method</th>
                  <th className="text-left font-medium px-3 py-2">Category</th>
                  <th className="text-right font-medium px-3 py-2">Amount</th>
                </tr>
              </thead>
              <tbody>
                {affectedRows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 tabular-nums">{r.date}</td>
                    <td className="px-3 py-2">{r.payee}</td>
                    <td className="px-3 py-2">{r.methodDisplay}</td>
                    <td className="px-3 py-2">{r.category || "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.amountStr}</td>
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
          <div className="text-xs text-slate-600">
            No merge in this sprint. Use <span className="font-medium">Legitimize</span> if these are valid.
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
