"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { AppDialog } from "@/components/primitives/AppDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inputH7, selectTriggerClass } from "@/components/primitives/tokens";

export type FixIssueKind = "DUPLICATE" | "MISSING_CATEGORY" | "STALE_CHECK";

export function FixIssueDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  entry: {
    id: string;
    date: string;
    payee: string;
    amountStr: string;
    methodDisplay?: string;
    category?: string;
  } | null;

  kind: FixIssueKind | null;

  // Used to show both issues if applicable (e.g., DUP + STALE on same row)
  flags?: { dup?: boolean; stale?: boolean; missing?: boolean } | null;

  // Missing category
  categoryOptions?: string[];
  onSaveCategory?: (category: string) => void;

  // Duplicate actions (placeholders for now)
  onMerge?: () => void;
  onMarkLegit?: () => void;

  // Stale action (placeholder for now)
  onAcknowledge?: () => void;

  // Optional placeholder text for dup group candidates
  dupCandidatesText?: string;
}) {
  const {
    open,
    onOpenChange,
    entry,
    kind,
    flags,
    categoryOptions = [],
    onSaveCategory,
    onMerge,
    onMarkLegit,
    onAcknowledge,
    dupCandidatesText,
  } = props;

  const [catDraft, setCatDraft] = useState("");

  useEffect(() => {
    if (!open) {
      setCatDraft("");
      return;
    }
    // Initialize category draft when dialog opens
    setCatDraft((entry?.category || "").trim());
  }, [open, entry?.category]);

  const header = useMemo(() => {
    if (!kind) return "Fix Issue";
    if (kind === "MISSING_CATEGORY") return "Fix: Missing category";
    if (kind === "STALE_CHECK") return "Fix: Stale check";
    return "Fix: Duplicate";
  }, [kind]);

  const desc = useMemo(() => {
    const parts: string[] = [];
    if (flags?.dup) parts.push("Duplicate");
    if (flags?.stale) parts.push("Stale check");
    if (flags?.missing) parts.push("Missing category");
    const issues = parts.length ? parts.join(" • ") : null;

    const meta = entry
      ? `${entry.date} • ${entry.payee || "—"} • ${entry.amountStr || "—"}${
          entry.methodDisplay ? ` • ${entry.methodDisplay}` : ""
        }`
      : "";

    return issues ? `${issues}\n${meta}` : meta;
  }, [flags?.dup, flags?.stale, flags?.missing, entry]);

  const showActions = !!entry && !!kind;

  return (
    <AppDialog
      open={open}
      onClose={() => onOpenChange(false)}
      size="lg"
      disableOverlayClose={false}
      title={
        kind === "DUPLICATE"
          ? "Fix Issue: Duplicate"
          : kind === "STALE_CHECK"
            ? "Fix Issue: Stale check"
            : kind === "MISSING_CATEGORY"
              ? "Fix Issue: Missing category"
              : "Fix Issue"
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-7 px-3 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>

          {showActions && kind === "DUPLICATE" ? (
            <>
              <Button
                type="button"
                variant="outline"
                className="h-7 px-3 text-xs"
                onClick={() => {
                  onMarkLegit?.();
                  onOpenChange(false);
                }}
              >
                Legitimate
              </Button>

              <Button
                type="button"
                className="h-7 px-3 text-xs"
                onClick={() => {
                  onMerge?.();
                  onOpenChange(false);
                }}
              >
                Merge
              </Button>
            </>
          ) : showActions && kind === "STALE_CHECK" ? (
            <Button
              type="button"
              className="h-7 px-3 text-xs"
              onClick={() => {
                onAcknowledge?.();
                onOpenChange(false);
              }}
            >
              Acknowledge
            </Button>
          ) : showActions && kind === "MISSING_CATEGORY" ? (
            <Button
              type="button"
              className="h-7 px-3 text-xs"
              onClick={() => {
                onSaveCategory?.(catDraft === "__UNCATEGORIZED__" ? "" : catDraft);
                onOpenChange(false);
              }}
            >
              Apply
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-7 px-3 text-xs"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          )}
        </div>
      }
    >

         {/* Body */}
         <div className="px-4 pt-3 pb-3 space-y-2 flex-1 min-h-0">
          {/* No noisy banners in Phase 3 polish (instant + quiet). */}

          {/* Issue Details card */}
          <div className="rounded-lg border bg-slate-50 p-2">
            <div className="text-xs font-semibold text-slate-900">Issue Details</div>
            <div className="mt-1 text-xs text-slate-700">
              {kind === "DUPLICATE"
                ? (dupCandidatesText ? dupCandidatesText : desc)
                : kind === "STALE_CHECK"
                  ? (flags?.stale ? desc : "Stale check")
                  : kind === "MISSING_CATEGORY"
                    ? "Category missing or uncategorized."
                    : desc}
            </div>
          </div>

          {/* Entry Information card */}
          <div className="rounded-lg border bg-slate-50 p-2">
            <div className="text-xs font-semibold text-slate-900">Entry Information</div>

            <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">Date:</span>
                <span className="font-medium text-slate-900">{entry?.date || "—"}</span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">Amount:</span>
                <span className="font-medium text-slate-900">{entry?.amountStr || "—"}</span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">Payee:</span>
                <span className="font-medium text-slate-900 truncate">{entry?.payee || "—"}</span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-600">Method:</span>
                <span className="font-medium text-slate-900">{entry?.methodDisplay || "—"}</span>
              </div>
            </div>
          </div>

          {/* Action section */}
          {showActions && kind === "DUPLICATE" ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-900">Duplicate candidates</div>

              <div className="rounded-lg border bg-white p-2 text-xs text-slate-700 max-h-[160px] overflow-y-auto">
                {dupCandidatesText || "Not loaded yet"}
              </div>
            </div>
          ) : null}

          {showActions && kind === "MISSING_CATEGORY" ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-900">Category</div>

              <Select value={catDraft} onValueChange={(v) => setCatDraft(v)}>
                <SelectTrigger className={selectTriggerClass + " h-7"}>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent side="bottom" align="start">
                  <SelectItem value="__UNCATEGORIZED__">Uncategorized</SelectItem>
                  {categoryOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {showActions && kind === "STALE_CHECK" ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-900">Acknowledge</div>
              <div className="text-xs text-slate-700">
                This check is old. If it is no longer relevant, acknowledge it for now.
              </div>
            </div>
          ) : null}
        </div>
    </AppDialog>
  );
}
