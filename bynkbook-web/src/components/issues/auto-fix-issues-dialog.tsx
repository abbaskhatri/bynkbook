"use client";

import { useEffect, useMemo, useState } from "react";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Button } from "@/components/ui/button";
import {
  bulkApplyIssues,
  bulkPreviewIssues,
  type BulkApplyIssuesResponse,
  type BulkIssuePreviewItem,
  type BulkPreviewIssuesResponse,
} from "@/lib/api/issues";

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

function addCommas(intStr: string) {
  const s = intStr.replace(/^0+(?=\d)/, "") || "0";
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
  const base = `$${addCommas(dollars.toString())}.${cents.toString().padStart(2, "0")}`;
  return { text: isNeg ? `(${base})` : base, isNeg };
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function pluralize(count: number, singular: string, plural?: string) {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

function sectionCard(title: string, count: number, body: React.ReactNode, tone: "default" | "success" | "warning" = "default") {
  const toneCls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50/60"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50/70"
        : "border-slate-200 bg-white";

  return (
    <section className={`rounded-2xl border ${toneCls}`}>
      <div className="flex items-center justify-between gap-3 border-b border-inherit/60 px-4 py-3">
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
          {count}
        </div>
      </div>
      <div className="p-3">{body}</div>
    </section>
  );
}

function actionLabel(action: string | null) {
  if (action === "ACK_STALE") return "Acknowledge stale";
  if (action === "LEGITIMIZE") return "Mark legitimate";
  return "Review manually";
}

function issueTypeLabel(issueType: string) {
  const v = String(issueType ?? "").toUpperCase();
  if (v === "STALE_CHECK") return "Stale check";
  if (v === "DUPLICATE") return "Duplicate";
  if (v === "MISSING_CATEGORY") return "Missing category";
  return v || "Issue";
}

function confidenceLabel(value: string | null | undefined) {
  const v = String(value ?? "").toUpperCase();
  if (v === "HIGH") return "High";
  if (v === "MEDIUM") return "Medium";
  return "Review";
}

function ItemRow({ item, showAction = true }: { item: BulkIssuePreviewItem; showAction?: boolean }) {
  const amount = formatUsdAccountingFromCents(item.amount_cents);
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-900">{item.payee || "Untitled payee"}</span>
            <span className="inline-flex h-5 items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-700">
              {issueTypeLabel(item.issue_type)}
            </span>
            {item.confidence_label ? (
              <span className="inline-flex h-5 items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-700">
                {confidenceLabel(item.confidence_label)}
              </span>
            ) : null}
            {showAction ? (
              <span className="inline-flex h-5 items-center rounded-md border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-700">
                {actionLabel(item.action)}
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span>{formatDate(item.date)}</span>
            <span>{item.method || "—"}</span>
            {item.group_key ? <span className="truncate">Group: {item.group_key}</span> : null}
          </div>

          {item.explanation ? (
            <div className="text-xs leading-5 text-slate-700">{item.explanation}</div>
          ) : item.details ? (
            <div className="text-xs leading-5 text-slate-600">{item.details}</div>
          ) : null}
        </div>

        <div className={`shrink-0 text-sm font-semibold ${amount.isNeg ? "text-red-600" : "text-slate-900"}`}>
          {amount.text}
        </div>
      </div>
    </div>
  );
}

function ItemsList({
  items,
  emptyText,
  showAction = true,
}: {
  items: BulkIssuePreviewItem[];
  emptyText: string;
  showAction?: boolean;
}) {
  if (!items.length) {
    return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">{emptyText}</div>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <ItemRow key={`${item.bucket}:${item.issue_id}`} item={item} showAction={showAction} />
      ))}
    </div>
  );
}

export function AutoFixIssuesDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId: string;
  accountId: string;
  issueIds: string[];
  onDidApply: () => Promise<void> | void;
}) {
  const { open, onOpenChange, businessId, accountId, issueIds, onDidApply } = props;

  const [preview, setPreview] = useState<BulkPreviewIssuesResponse | null>(null);
  const [applyResult, setApplyResult] = useState<BulkApplyIssuesResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stableIssueIds = useMemo(
    () => Array.from(new Set((issueIds ?? []).map((v) => String(v ?? "").trim()).filter(Boolean))),
    [issueIds]
  );

  const safeCount = preview?.safe_auto_fix?.length ?? 0;
  const likelyDuplicateCount = preview?.likely_duplicate?.length ?? 0;
  const needsReviewCount = preview?.needs_review?.length ?? 0;
  const unsupportedCount = preview?.unsupported?.length ?? 0;

  const safeIssueIds = useMemo(
    () =>
      Array.from(
        new Set(
          (preview?.safe_auto_fix ?? [])
            .map((item) => String(item.issue_id ?? "").trim())
            .filter(Boolean)
        )
      ),
    [preview]
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!open) return;
      setApplyResult(null);
      setError(null);

      if (!businessId || !accountId || stableIssueIds.length === 0) {
        setPreview(null);
        return;
      }

      try {
        setLoadingPreview(true);
        const res = await bulkPreviewIssues({
          businessId,
          accountId,
          issueIds: stableIssueIds,
        });
        if (!cancelled) setPreview(res);
      } catch (err: any) {
        if (!cancelled) {
          setPreview(null);
          setError(err?.message || "Failed to load issue preview.");
        }
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [open, businessId, accountId, stableIssueIds]);

  const footer = (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-slate-600">
        {applyResult
          ? `${applyResult.applied_count} ${pluralize(applyResult.applied_count, "issue")} applied.`
          : preview
            ? `${safeCount} ${pluralize(safeCount, "safe fix")} ready to apply.`
            : stableIssueIds.length > 0
              ? `${stableIssueIds.length} ${pluralize(stableIssueIds.length, "selected issue")} queued for preview.`
              : "No issues selected."}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={loadingPreview || applying}
        >
          {applyResult ? "Close" : "Cancel"}
        </Button>

        {!applyResult ? (
          <Button
            type="button"
            onClick={async () => {
              if (!businessId || !accountId || stableIssueIds.length === 0 || safeCount === 0) return;
              try {
                setApplying(true);
                setError(null);
                const result = await bulkApplyIssues({
                  businessId,
                  accountId,
                  issueIds: stableIssueIds,
                  safeIssueIds,
                });
                setApplyResult(result);
                await onDidApply();
              } catch (err: any) {
                setError(err?.message || "Failed to apply issue fixes.");
              } finally {
                setApplying(false);
              }
            }}
            disabled={loadingPreview || applying || !preview || safeCount === 0}
          >
            {applying ? "Applying..." : `Apply ${safeCount} Safe ${pluralize(safeCount, "Fix")}`}
          </Button>
        ) : null}
      </div>
    </div>
  );

  return (
    <AppDialog
      open={open}
      onClose={loadingPreview || applying ? undefined : () => onOpenChange(false)}
      title="Auto Fix Issues"
      size="xl"
      footer={footer}
      disableOverlayClose={loadingPreview || applying}
    >
      <div className="space-y-4">
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {loadingPreview ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              Loading deterministic preview…
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="h-24 rounded-2xl border border-slate-200 bg-slate-50" />
              <div className="h-24 rounded-2xl border border-slate-200 bg-slate-50" />
              <div className="h-24 rounded-2xl border border-slate-200 bg-slate-50" />
            </div>
          </div>
        ) : null}

        {!loadingPreview && !preview && !error ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Select one or more issues to preview bulk fixes.
          </div>
        ) : null}

        {preview ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-slate-900">Preview summary</div>
                <span className="inline-flex h-6 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
                  Requested {preview.requested_count}
                </span>
                <span className="inline-flex h-6 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
                  Open {preview.valid_open_selected_count}
                </span>
                <span className="inline-flex h-6 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
                  Safe {safeCount}
                </span>
                <span className="inline-flex h-6 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
                  Likely duplicate {likelyDuplicateCount}
                </span>
                <span className="inline-flex h-6 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
                  Needs review {needsReviewCount}
                </span>
                <span className="inline-flex h-6 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
                  Unsupported {unsupportedCount}
                </span>
              </div>

              <div className="mt-3 space-y-1.5">
                {(preview.summary_lines ?? []).map((line, idx) => (
                  <div key={`preview-line-${idx}`} className="text-sm text-slate-700">
                    {line}
                  </div>
                ))}
              </div>
            </section>

            {applyResult ? (
              <section className="rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
                <div className="text-sm font-semibold text-slate-900">Apply result</div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-6 items-center rounded-md border border-emerald-200 bg-white px-2 text-[11px] font-medium text-slate-700">
                    Applied {applyResult.applied_count}
                  </span>
                  <span className="inline-flex h-6 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
                    Skipped {applyResult.skipped_count}
                  </span>
                  <span className="inline-flex h-6 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700">
                    Blocked {applyResult.blocked_count}
                  </span>
                </div>
                <div className="mt-3 space-y-1.5">
                  {(applyResult.summary_lines ?? []).map((line, idx) => (
                    <div key={`apply-line-${idx}`} className="text-sm text-slate-700">
                      {line}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <div className="grid gap-4">
              {sectionCard(
                "Safe to apply now",
                safeCount,
                <ItemsList
                  items={preview.safe_auto_fix ?? []}
                  emptyText="No selected issues are eligible for safe bulk apply."
                />,
                "success"
              )}

              {sectionCard(
                "Likely duplicate — review before apply",
                likelyDuplicateCount,
                <div className="space-y-3">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    These look like posted-twice transactions. Merge and consolidation decisions remain manual.
                  </div>
                  <ItemsList
                    items={preview.likely_duplicate ?? []}
                    emptyText="No selected issues look like likely duplicates."
                    showAction={false}
                  />
                </div>,
                "warning"
              )}

              {sectionCard(
                "Needs review",
                needsReviewCount,
                <ItemsList
                  items={preview.needs_review ?? []}
                  emptyText="No selected issues need additional review."
                  showAction={false}
                />
              )}

              {sectionCard(
                "Unsupported in bulk",
                unsupportedCount,
                <ItemsList
                  items={preview.unsupported ?? []}
                  emptyText="No unsupported selected issues."
                  showAction={false}
                />
              )}
            </div>
          </>
        ) : null}
      </div>
    </AppDialog>
  );
}