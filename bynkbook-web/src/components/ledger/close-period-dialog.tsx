"use client";

import { useMemo, useState } from "react";
import { AppDialog } from "@/components/primitives/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { previewClosedPeriods, closePeriod } from "@/lib/api/closedPeriods";

type RangeMode = "MONTH" | "WEEK" | "CUSTOM";

function todayYmdLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function monthNow() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

// String-only days-in-month (no Date.UTC)
function isLeapYear(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function lastDayOfMonth(yyyyMm: string) {
  const y = Number(yyyyMm.slice(0, 4));
  const m = Number(yyyyMm.slice(5, 7)); // 1-12
  const days = [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const d = days[m - 1] ?? 30;
  return String(d).padStart(2, "0");
}

function monthToRange(yyyyMm: string) {
  const from = `${yyyyMm}-01`;
  const to = `${yyyyMm}-${lastDayOfMonth(yyyyMm)}`;
  return { from, to };
}

// Week helper: day math for +6 is acceptable (does not compute month ends)
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

export function ClosePeriodDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businessId: string;
  accountId: string;
  accountName?: string | null;
}) {
  const { open, onOpenChange, businessId, accountId, accountName } = props;

  const [mode, setMode] = useState<RangeMode>("MONTH");
  const [month, setMonth] = useState(monthNow());
  const [weekStart, setWeekStart] = useState(todayYmdLocal());
  const [from, setFrom] = useState(todayYmdLocal());
  const [to, setTo] = useState(todayYmdLocal());

  const effective = useMemo(() => {
    if (mode === "MONTH") return monthToRange(month);
    if (mode === "WEEK") return { from: weekStart, to: addDays(weekStart, 6) };
    return { from, to };
  }, [mode, month, weekStart, from, to]);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [override, setOverride] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);

  const stats = preview?.stats ?? null;
  const monthsAffected: string[] = preview?.months_affected ?? [];
  const isClean = !!stats?.is_clean;

  async function runPreview() {
    setLoading(true);
    setErr(null);
    setPreview(null);
    setConfirmOverride(false);

    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effective.from)) throw new Error("Invalid From date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(effective.to)) throw new Error("Invalid To date");

      const res = await previewClosedPeriods({
        businessId,
        accountId,
        from: effective.from,
        to: effective.to,
      });
      setPreview(res);
    } catch (e: any) {
      setErr(e?.message ?? "Preview failed");
    } finally {
      setLoading(false);
    }
  }

  async function doClose() {
    if (!preview) return;
    if (!monthsAffected.length) return;

    if (!isClean && !override) return;
    if (!isClean && override && !confirmOverride) {
      setConfirmOverride(true);
      return;
    }

    setLoading(true);
    setErr(null);

    try {
      // Backend close is month-based; close each month explicitly
      for (const m of monthsAffected) {
        await closePeriod(businessId, m);
      }
      onOpenChange(false);
    } catch (e: any) {
      setErr(e?.message ?? "Close failed");
    } finally {
      setLoading(false);
    }
  }

  const closeDisabled =
    !preview ||
    monthsAffected.length === 0 ||
    loading ||
    (!isClean && !override) ||
    (!isClean && override && !confirmOverride);

  return (
    <AppDialog
      open={open}
      onClose={() => onOpenChange(false)}
      title="Close period"
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-slate-600">
            Account: <span className="font-medium text-slate-900">{accountName ?? "Selected account"}</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" className="h-7 px-3 text-xs" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button
              className="h-7 px-3 text-xs"
              onClick={doClose}
              disabled={closeDisabled}
              title={!preview ? "Run preview first" : undefined}
            >
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Mode tabs */}
        <div className="flex gap-2">
          {[
            { k: "MONTH", label: "Month" },
            { k: "WEEK", label: "Week" },
            { k: "CUSTOM", label: "Custom" },
          ].map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => {
                setMode(t.k as RangeMode);
                setPreview(null);
                setErr(null);
                setConfirmOverride(false);
              }}
              className={`h-7 px-3 rounded-md text-xs font-medium transition ${
                mode === t.k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Range inputs */}
        <div className="flex flex-wrap items-end gap-2">
          {mode === "MONTH" ? (
            <div className="space-y-1">
              <div className="text-[11px] text-slate-600">Month</div>
              <Input type="month" className="h-7 w-[170px] text-xs" value={month} onChange={(e) => setMonth(e.target.value)} />
            </div>
          ) : mode === "WEEK" ? (
            <>
              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">Week start</div>
                <Input type="date" className="h-7 w-[170px] text-xs" value={weekStart} onChange={(e) => setWeekStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">Week end</div>
                <Input type="date" className="h-7 w-[170px] text-xs" value={effective.to} readOnly />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">From</div>
                <Input type="date" className="h-7 w-[170px] text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1">
                <div className="text-[11px] text-slate-600">To</div>
                <Input type="date" className="h-7 w-[170px] text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </>
          )}

          <Button variant="outline" className="h-7 px-3 text-xs" onClick={runPreview} disabled={loading}>
            {loading ? "Loading…" : "Preview"}
          </Button>

          {err ? <div className="text-xs text-red-600">{err}</div> : null}
        </div>

        {/* Stats */}
        <div className="rounded-md border border-slate-200 overflow-hidden">
          <div className="bg-slate-50 px-3 h-9 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-700">Reconciliation</div>
            <div className={`text-xs font-semibold ${preview ? (isClean ? "text-emerald-700" : "text-amber-700") : "text-slate-500"}`}>
              {preview ? (isClean ? "Clean (recommended)" : "Not clean") : "Run preview"}
            </div>
          </div>

          <div className="px-3 py-3">
            {!preview ? (
              <div className="text-sm text-slate-600">Preview to see totals and recommendation.</div>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="text-[11px] text-slate-600">Total</div>
                  <div className="text-sm font-semibold">{stats.entries_total}</div>
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="text-[11px] text-slate-600">Reconciled</div>
                  <div className="text-sm font-semibold">{stats.entries_reconciled}</div>
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="text-[11px] text-slate-600">Unreconciled</div>
                  <div className="text-sm font-semibold">{stats.entries_unreconciled}</div>
                </div>
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="text-[11px] text-slate-600">Open issues</div>
                  <div className="text-sm font-semibold">{stats.issues_open}</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Months affected + override */}
        {preview ? (
          <div className="space-y-2">
            <div className="text-sm text-slate-700">
              Months affected:{" "}
              <span className="font-medium text-slate-900">{monthsAffected.length ? monthsAffected.join(", ") : "—"}</span>
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
                  className="h-4 w-4 rounded border border-slate-300"
                />
                <span className="text-sm">Override and close anyway</span>
              </label>
            ) : null}

            {!isClean && override && confirmOverride ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Override confirmed. Click Close again to proceed.
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}
