"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { CategoryCombobox } from "@/components/categories/category-combobox";
import { AppDialog } from "@/components/primitives/AppDialog";
import { resolveIssue, type EntryIssueRow } from "@/lib/api/issues";
import { mergeEntry } from "@/lib/api/entries";
import { Loader2 } from "lucide-react";

type Kind = "DUPLICATE" | "MISSING_CATEGORY" | "STALE_CHECK";
type ActiveAction = "legitimize" | "merge" | "fix-category" | "ack-stale" | null;

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

  contextLoading?: boolean;
  contextError?: string | null;
  contextIncomplete?: boolean;
  onRetryContext?: () => void;

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
    contextLoading = false,
    contextError = null,
    contextIncomplete = false,
    onRetryContext,
    onDidMutate,
  } = props;

  const [activeAction, setActiveAction] = useState<ActiveAction>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pickedCategoryId, setPickedCategoryId] = useState<string>("");
  const busy = activeAction !== null;

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

  const dialogSize = useMemo<"xs" | "sm" | "md">(() => {
    if (kind === "STALE_CHECK") return "xs";
    if (kind !== "DUPLICATE") return "sm";

    let maxPayeeLen = 0;
    let maxTokenLen = 0;

    for (const r of affectedRows) {
      const p = String(r.payee ?? "").trim();
      maxPayeeLen = Math.max(maxPayeeLen, p.length);
      for (const tok of p.split(/\s+/)) maxTokenLen = Math.max(maxTokenLen, tok.length);
    }

    if (maxPayeeLen >= 26) return "md";
    if (maxTokenLen >= 18) return "md";
    return "sm";
  }, [kind, affectedRows]);

  const title =
    kind === "DUPLICATE"
      ? "Review potential duplicate"
      : kind === "STALE_CHECK"
        ? "Stale check"
        : "Missing category";

  const duplicateIssueDetails = useMemo(() => {
    if (kind !== "DUPLICATE") return "";
    return issues
      .filter((x) => x.issue_type === "DUPLICATE" && relevant.issueIds.includes(x.id))
      .map((x) => String(x.details ?? ""))
      .find(Boolean) ?? "";
  }, [kind, issues, relevant.issueIds]);

  const duplicateMentionsMatch = duplicateIssueDetails.toLowerCase().includes("matched");
  const duplicateContextBlocked = kind === "DUPLICATE" && (contextLoading || contextIncomplete);
  const duplicateContextMessage =
    kind === "DUPLICATE" && contextIncomplete
      ? "Full duplicate context is not available yet. Review is limited to currently loaded rows."
      : null;

  async function doResolve(
    action: "LEGITIMIZE" | "ACK_STALE" | "FIX_MISSING_CATEGORY",
    actionKey: Exclude<ActiveAction, "merge" | null>
  ) {
    if (!kind || !entryId) return;
    setErr(null);

    if (kind === "DUPLICATE" && duplicateContextBlocked) {
      setErr("Load the full duplicate context before resolving this issue.");
      return;
    }

    if (action === "FIX_MISSING_CATEGORY" && !pickedCategoryId) {
      setErr("Pick a category first.");
      return;
    }

    setActiveAction(actionKey);
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
      const msg =
        String(e?.message ?? "").toLowerCase().includes("closed_period")
          ? "This item is in a closed period and can’t be changed."
          : "Couldn’t resolve this issue. Please try again.";
      setErr(msg);
    } finally {
      setActiveAction(null);
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
          <div className="text-xs text-bb-status-danger-fg">{err ?? ""}</div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Close
            </Button>

            {kind === "MISSING_CATEGORY" ? (
              <>
                {/* No "Legitimize" for missing category — must fix the data */}
                <Button
                  onClick={() => doResolve("FIX_MISSING_CATEGORY", "fix-category")}
                  disabled={busy || relevant.issueIds.length === 0 || !pickedCategoryId}
                >
                  {activeAction === "fix-category" ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Saving…
                    </span>
                  ) : (
                    "Fix category"
                  )}
                </Button>
              </>
            ) : null}

            {kind === "STALE_CHECK" ? (
              <>
                {/* No "Legitimize" for missing category — must actually fix data */}
                <Button
                  onClick={() => doResolve("ACK_STALE", "ack-stale")}
                  disabled={busy || relevant.issueIds.length === 0}
                >
                  {activeAction === "ack-stale" ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Saving…
                    </span>
                  ) : (
                    "Acknowledge stale"
                  )}
                </Button>
              </>
            ) : null}

            {kind === "DUPLICATE" ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => doResolve("LEGITIMIZE", "legitimize")}
                  disabled={busy || duplicateContextBlocked || relevant.issueIds.length === 0}
                >
                  {activeAction === "legitimize" ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Saving…
                    </span>
                  ) : (
                    "Not a duplicate"
                  )}
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
                    if (duplicateContextBlocked) {
                      setErr("Load the full duplicate context before merging.");
                      return;
                    }

                    setActiveAction("merge");
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
                      const raw = String(e?.message ?? "Merge failed");

                      let payload: any = null;
                      const m = raw.match(/\{[\s\S]*\}$/);
                      if (m?.[0]) {
                        try {
                          payload = JSON.parse(m[0]);
                        } catch {
                          payload = null;
                        }
                      }

                      const code = String(payload?.code ?? "").toUpperCase();
                      const reason = String(payload?.reason ?? "").toUpperCase();
                      const rawUpper = raw.toUpperCase();

                      if (code === "MERGE_BLOCKED" && reason === "SOURCE_MISMATCH") {
                        setErr("Merge blocked: these entries have different source linkage. Review both entries first. If both are legitimate, keep them. If one is not needed, use the appropriate cleanup action after review.");
                      } else if (code === "MERGE_BLOCKED" && (reason === "ENTRY_RECONCILED" || rawUpper.includes("RECONCILED"))) {
                        setErr("Entry is reconciled; merge blocked. Unmatch it first if this is truly a duplicate, otherwise keep both or Legitimize.");
                      } else {
                        setErr(String(payload?.error ?? raw ?? "Merge failed"));
                      }
                    } finally {
                      setActiveAction(null);
                    }
                  }}
                  disabled={busy || duplicateContextBlocked || relevant.entryIds.length < 2}
                >
                  {activeAction === "merge" ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Merging…
                    </span>
                  ) : (
                    "Merge entries"
                  )}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {contextLoading || contextError || duplicateContextMessage ? (
          <div className="rounded-md border border-bb-border bg-bb-table-header px-3 py-2 text-xs text-bb-text">
            {contextLoading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading issue details…
              </span>
            ) : contextError ? (
              <span className="inline-flex items-center justify-between gap-3">
                <span>{contextError}</span>
                {onRetryContext ? (
                  <button
                    type="button"
                    className="font-medium text-bb-text hover:underline"
                    onClick={onRetryContext}
                  >
                    Retry
                  </button>
                ) : null}
              </span>
            ) : (
              duplicateContextMessage
            )}
          </div>
        ) : null}

        {kind === "MISSING_CATEGORY" ? (
          <div className="flex items-center gap-2">
            <div className="text-sm text-bb-text w-28">Category</div>
            <div className="flex-1">
              <CategoryCombobox
                options={categories}
                categoryId={pickedCategoryId || null}
                placeholder="Select category"
                inputClassName="h-8 w-full rounded-md border border-bb-input-border bg-bb-input-bg px-2 text-xs text-bb-text placeholder:text-bb-text-muted"
                onChange={(value, option) => {
                  if (option?.id) {
                    setPickedCategoryId(String(option.id));
                    return;
                  }

                  if (!value || pickedCategoryId) setPickedCategoryId("");
                }}
              />
            </div>
          </div>
        ) : null}

        <div className="rounded-md border border-bb-border overflow-hidden">
          <div className="bg-bb-table-header px-3 py-2 text-xs font-medium text-bb-text">
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

              <thead className="sticky top-0 bg-bb-surface-card">
                <tr className="border-b border-bb-border text-[11px] text-bb-text-muted">
                  <th className="text-left font-medium px-2 py-1.5">Date</th>
                  <th className="text-left font-medium px-2 py-1.5">Payee</th>
                  <th className="text-left font-medium px-2 py-1.5">Method</th>
                  <th className="text-left font-medium px-2 py-1.5">Category</th>
                  <th className="text-right font-medium px-2 py-1.5">Amount</th>
                </tr>
              </thead>
              <tbody>
                {affectedRows.map((r) => (
                  <tr key={r.id} className="border-b border-bb-border-muted text-xs">
                    <td className="px-2 py-1.5 tabular-nums">{r.date}</td>
                    <td className="px-2 py-1.5 whitespace-normal break-normal">{r.payee}</td>
                    <td className="px-2 py-1.5">{r.methodDisplay}</td>
                    <td className="px-2 py-1.5">{r.category || "—"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{r.amountStr}</td>
                  </tr>
                ))}
                {affectedRows.length === 0 ? (
                  <tr>
                    <td className="px-3 py-3 text-sm text-bb-text-muted" colSpan={5}>
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
            <div className="text-xs text-bb-text-muted">
              {duplicateMentionsMatch
                ? "One entry is bank-matched. Use Reconcile → revert if the bank entry should be removed. Otherwise select which entry to keep (Survivor) and which to delete (Duplicate to remove)."
                : "Select which entry to keep as the Survivor. The duplicate entry will be deleted. If both are legitimate, click \"Not a duplicate\" instead."}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="text-xs">
                <div className="text-[11px] text-bb-text-muted mb-1">Survivor</div>
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
                <div className="text-[11px] text-bb-text-muted mb-1">Duplicate to remove</div>
                <Select value={mergeDuplicateId} onValueChange={setMergeDuplicateId}>
                  <SelectTrigger className="h-7 px-2 text-xs min-w-0 border-bb-status-danger-border bg-bb-status-danger-bg">
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
