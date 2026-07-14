"use client";

import { type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { AppDatePicker } from "@/components/primitives/AppDatePicker";
import { tabButtonClass } from "@/components/primitives/tokens";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";

import { closeThroughDate, previewClosedPeriods } from "@/lib/api/closedPeriods";

type RangeMode = "MONTH" | "WEEK" | "CUSTOM";

function addDays(ymd: string, n: number) {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthEndYmd(month: string) {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const d = days[Math.max(1, Math.min(12, m)) - 1] ?? 30;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function MetricTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2">
      <div className="truncate text-[11px] text-bb-text-muted">{label}</div>
      <div className="mt-1 text-base font-semibold leading-6 text-bb-text tabular-nums">{value}</div>
    </div>
  );
}

export type CloseThroughControlProps = {
  businessId: string | null;
  todayYmd: string;
  loading: boolean;
  canClose: boolean;
  canReopen: boolean;
  onError: (message: string | null) => void;
  onLoadingChange: (loading: boolean) => void;
  refresh: () => Promise<void>;
};

export function CloseThroughControl({
  businessId,
  todayYmd,
  loading,
  canClose,
  canReopen,
  onError,
  onLoadingChange,
  refresh,
}: CloseThroughControlProps) {
  const [mode, setMode] = useState<RangeMode>("MONTH");
  const [monthMode, setMonthMode] = useState<string>(""); // YYYY-MM
  const [weekStart, setWeekStart] = useState<string>(todayYmd);
  const [customFrom, setCustomFrom] = useState<string>(todayYmd);
  const [customTo, setCustomTo] = useState<string>(todayYmd);

  const effective = useMemo(() => {
    if (mode === "MONTH") {
      const m = monthMode || todayYmd.slice(0, 7);
      return { from: `${m}-01`, to: monthEndYmd(m) };
    }
    if (mode === "WEEK") {
      return { from: weekStart, to: addDays(weekStart, 6) };
    }
    return { from: customFrom, to: customTo };
  }, [mode, monthMode, weekStart, customFrom, customTo, todayYmd]);

  const [preview, setPreview] = useState<any>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [override, setOverride] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);

  const monthsAffected: string[] = preview?.months_affected ?? [];
  const stats = preview?.stats ?? null;
  const isClean = !!stats?.is_clean;

  const runPreview = async () => {
    if (!businessId) return;

    setPreviewBusy(true);
    onError(null);
    setPreview(null);
    setConfirmOverride(false);

    try {
      const res = await previewClosedPeriods({
        businessId,
        accountId: "all",
        from: effective.from,
        to: effective.to,
      });
      setPreview(res);
    } catch (e: any) {
      onError(appErrorMessageOrNull(e) ?? "Preview failed");
    } finally {
      setPreviewBusy(false);
    }
  };

  const doClose = async () => {
    if (!businessId) return;
    if (!preview) return;
    if (!monthsAffected.length) return;

    if (!isClean && !override) return;

    if (!isClean && override && !confirmOverride) {
      setConfirmOverride(true);
      return;
    }

    onLoadingChange(true);
    onError(null);
    try {
      // One close-through call; backend expands months itself.
      await closeThroughDate(businessId, effective.to);
      setPreview(null);
      setConfirmOverride(false);
      await refresh();
    } catch (e: any) {
      onError(appErrorMessageOrNull(e) ?? "Close failed");
    } finally {
      onLoadingChange(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-semibold text-bb-text-muted">Close through</div>

          {/* Mode tabs */}
          <div className="flex gap-2">
            {(
              [
                { k: "MONTH", label: "Month" },
                { k: "WEEK", label: "Week" },
                { k: "CUSTOM", label: "Custom" },
              ] as const
            ).map((t) => (
              <button
                key={t.k}
                type="button"
                onClick={() => {
                  setMode(t.k);
                  setPreview(null);
                  setConfirmOverride(false);
                  setOverride(false);
                }}
                className={tabButtonClass(mode === t.k)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Range inputs */}
          <div className="grid grid-cols-1 items-end gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {mode === "MONTH" ? (
              <div className="space-y-1.5 sm:col-span-2">
                <div className="text-xs font-medium text-bb-text-muted">Month</div>

                <AppDatePicker
                  value={monthMode ? `${monthMode}-01` : ""}
                  onChange={(next) => {
                    // Store as YYYY-MM (month selector), derived from picked date
                    setMonthMode(next ? next.slice(0, 7) : "");
                  }}
                  placeholder="Select month"
                  disabled={loading || !businessId || !canClose}
                  allowClear
                  buttonClassName="h-9 text-sm"
                />
              </div>
            ) : mode === "WEEK" ? (
              <>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-bb-text-muted">Week start</div>
                  <AppDatePicker
                    value={weekStart}
                    onChange={(next) => setWeekStart(next)}
                    disabled={loading || !businessId || !canClose}
                    allowClear={false}
                    buttonClassName="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-bb-text-muted">Week end</div>
                  <AppDatePicker
                    value={effective.to}
                    onChange={() => {
                      /* read-only */
                    }}
                    disabled
                    allowClear={false}
                    buttonClassName="h-9 text-sm"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-bb-text-muted">From</div>
                  <AppDatePicker
                    value={customFrom}
                    onChange={(next) => setCustomFrom(next)}
                    disabled={loading || !businessId || !canClose}
                    allowClear={false}
                    buttonClassName="h-9 text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="text-xs font-medium text-bb-text-muted">To</div>
                  <AppDatePicker
                    value={customTo}
                    onChange={(next) => setCustomTo(next)}
                    disabled={loading || !businessId || !canClose}
                    allowClear={false}
                    buttonClassName="h-9 text-sm"
                  />
                </div>
              </>
            )}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="h-9 px-4"
              onClick={runPreview}
              disabled={loading || previewBusy || !businessId || !canClose}
            >
              {previewBusy ? "Loading…" : "Preview"}
            </Button>
          </div>

          <div className="text-xs text-bb-text-muted">
            Effective range:{" "}
            <span className="font-medium tabular-nums">{effective.from}</span> →{" "}
            <span className="font-medium tabular-nums">{effective.to}</span>
            {"  "}•{"  "}Today: <span className="font-medium tabular-nums">{todayYmd}</span>
          </div>

          {effective.to > todayYmd ? (
            <div className="text-[11px] text-bb-status-warning-fg">
              <span className="font-semibold">Can&rsquo;t close beyond today.</span> Choose an end date on or before today.
            </div>
          ) : null}
        </div>
        <div className="text-xs text-bb-text-muted">
          {canReopen ? "You can reopen months (OWNER only)." : "Only OWNER can reopen months."}{" "}
          {canClose ? "" : "Only OWNER/ADMIN can close periods."}
        </div>
      </div>

      {/* Preview box */}
      <div className="rounded-md border border-bb-border overflow-hidden">
        <div className="bg-bb-surface-soft px-3 h-9 flex items-center justify-between">
          <div className="text-xs font-semibold text-bb-text">Close readiness</div>
          <div
            className={`text-xs font-semibold ${
              preview ? (isClean ? "text-primary" : "text-bb-status-warning-fg") : "text-bb-text-muted"
            }`}
          >
            {preview ? (isClean ? "Clean (recommended)" : "Not clean") : "Preview to see totals"}
          </div>
        </div>

        <div className="px-3 py-3">
          {!preview ? (
            <div className="text-sm text-bb-text-muted">Preview to see totals and recommendation.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <MetricTile label="Total" value={stats.entries_total} />
              <MetricTile label="Reconciled" value={stats.entries_reconciled} />
              <MetricTile label="Unreconciled" value={stats.entries_unreconciled} />
              <MetricTile label="Cash book (exempt)" value={stats.entries_reconciliation_exempt ?? 0} />
              <MetricTile label="Open issues" value={stats.issues_open} />
            </div>
          )}
        </div>
      </div>

      {/* Months affected + override */}
      {preview ? (
        <div className="space-y-2">
          <div className="text-sm text-bb-text">
            Months affected:{" "}
            <span className="font-medium text-bb-text">
              {monthsAffected.length ? monthsAffected.join(", ") : "—"}
            </span>
          </div>

          {!isClean ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => {
                  setOverride(e.target.checked);
                  setConfirmOverride(false);
                }}
                className="h-4 w-4 rounded border border-bb-input-border"
              />
              <span className="text-sm">Override and close anyway</span>
            </label>
          ) : null}

          {!isClean && override ? (
            <div className="rounded-md border border-bb-status-warning-border bg-bb-status-warning-bg px-3 py-2 text-sm text-bb-status-warning-fg">
              This period is not clean.{" "}
              {confirmOverride ? "Click Close again to proceed." : "Click Close to confirm override."}
            </div>
          ) : null}

          <div className="flex justify-end">
            <Button
              className="h-9 px-3 text-sm"
              disabled={
                loading ||
                !preview ||
                !monthsAffected.length ||
                effective.to > todayYmd ||
                (!isClean && !override)
              }
              onClick={doClose}
              title={!preview ? "Run preview first" : undefined}
            >
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
