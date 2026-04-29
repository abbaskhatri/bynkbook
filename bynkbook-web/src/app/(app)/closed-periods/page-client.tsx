"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/primitives/FilterBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock } from "lucide-react";

import { AppDatePicker } from "@/components/primitives/AppDatePicker";
import { AppDialog } from "@/components/primitives/AppDialog";
import { tabButtonClass } from "@/components/primitives/tokens";

import { InlineBanner } from "@/components/app/inline-banner";
import { EmptyStateCard } from "@/components/app/empty-state";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { closeThroughDate, listClosedPeriods, reopenPeriod, previewClosedPeriods } from "@/lib/api/closedPeriods";
import { getActivity } from "@/lib/api/activity";

export default function ClosedPeriodsPageClient() {
  const sp = useSearchParams();
  const businessesQ = useBusinesses();

  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId") ?? null;
  const businessId = bizIdFromUrl ?? (businessesQ.data?.[0]?.id ?? null);

  const myRole = useMemo(() => {
    if (!businessId) return null;
    const b = (businessesQ.data ?? []).find((x: any) => x?.id === businessId);
    return String(b?.role ?? "").toUpperCase();
  }, [businessId, businessesQ.data]);

  const canReopen = myRole === "OWNER";
  const canClose = myRole === "OWNER" || myRole === "ADMIN";

  const focus = (sp.get("focus") ?? "").toLowerCase();

  const reopenSectionRef = useRef<HTMLDivElement | null>(null);
  const [reopenPulse, setReopenPulse] = useState(false);

  // Deterministic reopen confirm
  const [reopenMonth, setReopenMonth] = useState<string>("");
  const [confirmReopenOpen, setConfirmReopenOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const bannerMsg = err || appErrorMessageOrNull(businessesQ.error) || null;

  const [rows, setRows] = useState<any[]>([]);
  const [closedThroughDate, setClosedThroughDate] = useState<string | null>(null);

  // Close-through UX
  const [closeMonth, setCloseMonth] = useState<string>(""); // YYYY-MM
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  // Recent close/reopen actions (real only; otherwise hidden)
  const [recentActions, setRecentActions] = useState<any[] | null>(null);

  useEffect(() => {
    if (focus !== "reopen") return;

    // Wait a tick for layout/render
    const t1 = window.setTimeout(() => {
      reopenSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      setReopenPulse(true);

      const t2 = window.setTimeout(() => setReopenPulse(false), 2000);
      return () => window.clearTimeout(t2);
    }, 50);

    return () => window.clearTimeout(t1);
  }, [focus]);

  async function refresh() {
    if (!businessId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await listClosedPeriods(businessId);
      setRows(res.periods ?? []);
      setClosedThroughDate(res.closed_through_date ?? null);

      // Load recent actions ONLY if Activity Log actually has real closed-period events
      try {
        const a1 = await getActivity(businessId, { limit: 10, eventType: "CLOSED_PERIOD_CLOSED" });
        const a2 = await getActivity(businessId, { limit: 10, eventType: "CLOSED_PERIOD_REOPENED" });
        const merged = [...(a1.items ?? []), ...(a2.items ?? [])]
          .sort((x: any, y: any) => String(y.created_at).localeCompare(String(x.created_at)))
          .slice(0, 10);

        setRecentActions(merged.length ? merged : null); // hide section if empty
      } catch {
        setRecentActions(null); // hide (no placeholders)
      }

    } catch (e: any) {
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function onReopen(m: string) {
    if (!businessId) return;
    setLoading(true);
    setErr(null);
    try {
      await reopenPeriod(businessId, m);
      setConfirmReopenOpen(false);
      setReopenMonth("");
      await refresh();
    } catch (e: any) {
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function todayYmdLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function monthEndYmd(month: string) {
    // month: YYYY-MM
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const leap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const d = days[Math.max(1, Math.min(12, m)) - 1] ?? 30;
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  const todayYmd = useMemo(() => todayYmdLocal(), []);
  const closeThroughYmd = useMemo(() => (closeMonth ? monthEndYmd(closeMonth) : ""), [closeMonth]);
  const isCloseBeyondToday = !!closeThroughYmd && closeThroughYmd > todayYmd;

  async function onConfirmClose() {
    if (!businessId || !closeMonth) return;
    setLoading(true);
    setErr(null);
    try {
      const through_date = monthEndYmd(closeMonth);
      await closeThroughDate(businessId, through_date);
      setConfirmCloseOpen(false);
      await refresh();
    } catch (e: any) {
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  // Auto-load once businessId is known (deterministic; avoids useState side-effects)
  useEffect(() => {
    if (!businessId) return;
    if (rows.length !== 0) return;
    if (loading) return;
    if (err) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  return (
    <div className="flex flex-col gap-2 overflow-hidden max-w-6xl">
      <div className="rounded-xl border border-bb-border bg-bb-surface-card shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader icon={<Lock className="h-4 w-4" />} title="Closed periods" />
        </div>

        <div className="mt-2 h-px bg-bb-border" />

        <div className="px-3 py-2">
          <FilterBar
            left={<div className="text-xs text-bb-text-muted">Close periods are enforced on all mutations across the app.</div>}
            right={
              <Button variant="outline" className="h-7 px-3 text-xs" onClick={refresh} disabled={loading || !businessId}>
                Refresh
              </Button>
            }
          />
        </div>

        {bannerMsg ? (
          <div className="px-3 pb-2">
            <InlineBanner title="Can’t load closed periods" message={bannerMsg} onRetry={businessId ? refresh : () => { }} />
          </div>
        ) : null}

        {!businessId && !businessesQ.isLoading ? (
          <div className="px-3 pb-2">
            <EmptyStateCard
              title="No business yet"
              description="Create a business to start using BynkBook."
              primary={{ label: "Create business", href: "/settings?tab=business" }}
              secondary={{ label: "Reload", onClick: () => window.location.reload() }}
            />
          </div>
        ) : null}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Close period</CardTitle>
        </CardHeader>

        <CardContent className="space-y-3">
          {/* Current status */}
          <div className="rounded-md border border-bb-border bg-bb-surface-soft px-3 py-2">
            <div className="text-[11px] font-semibold text-bb-text-muted">Closed through</div>
            <div className="mt-0.5 text-sm tabular-nums">
              {closedThroughDate ? (
                <span className="font-medium">{closedThroughDate}</span>
              ) : (
                <span className="text-bb-text-muted">Not closed</span>
              )}
            </div>
            <div className="mt-1 text-xs text-bb-text-muted">
              Any mutation with an effective date on or before this date is blocked.
            </div>
          </div>

          {/* Close-through control (Month / Week / Custom) */}
          <div className="rounded-md border border-bb-border px-3 py-3">
            {(() => {
              type RangeMode = "MONTH" | "WEEK" | "CUSTOM";

              // Local helpers (kept inside render block to avoid file-wide churn)
              const addDays = (ymd: string, n: number) => {
                const y = Number(ymd.slice(0, 4));
                const m = Number(ymd.slice(5, 7));
                const d = Number(ymd.slice(8, 10));
                const dt = new Date(y, m - 1, d);
                dt.setDate(dt.getDate() + n);
                const yyyy = dt.getFullYear();
                const mm = String(dt.getMonth() + 1).padStart(2, "0");
                const dd = String(dt.getDate()).padStart(2, "0");
                return `${yyyy}-${mm}-${dd}`;
              };

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
              }, [mode, monthMode, weekStart, customFrom, customTo]);

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
                setErr(null);
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
                  setErr(appErrorMessageOrNull(e) ?? "Preview failed");
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

                setLoading(true);
                setErr(null);
                try {
                  // One close-through call; backend expands months itself.
                  await closeThroughDate(businessId, effective.to);
                  setConfirmCloseOpen(false);
                  setPreview(null);
                  setConfirmOverride(false);
                  await refresh();
                } catch (e: any) {
                  setErr(appErrorMessageOrNull(e) ?? "Close failed");
                } finally {
                  setLoading(false);
                }
              };

              return (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                    <div className="flex flex-col gap-2">
                      <div className="text-[11px] font-semibold text-bb-text-muted">Close through</div>

                      {/* Mode tabs */}
                      <div className="flex gap-2">
                        {([
                          { k: "MONTH", label: "Month" },
                          { k: "WEEK", label: "Week" },
                          { k: "CUSTOM", label: "Custom" },
                        ] as const).map((t) => (
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
                      <div className="flex flex-wrap items-end gap-2">
                        {mode === "MONTH" ? (
                          <div className="space-y-1">
                            <div className="text-[11px] text-bb-text-muted">Month</div>

                            <div className="w-[170px]">
                              <AppDatePicker
                                value={monthMode ? `${monthMode}-01` : ""}
                                onChange={(next) => {
                                  // Store as YYYY-MM (month selector), derived from picked date
                                  setMonthMode(next ? next.slice(0, 7) : "");
                                }}
                                placeholder="Select month"
                                disabled={loading || !businessId || !canClose}
                                allowClear
                              />
                            </div>
                          </div>
                        ) : mode === "WEEK" ? (
                          <>
                            <div className="space-y-1">
                              <div className="text-[11px] text-bb-text-muted">Week start</div>
                              <div className="w-[170px]">
                                <AppDatePicker
                                  value={weekStart}
                                  onChange={(next) => setWeekStart(next)}
                                  disabled={loading || !businessId || !canClose}
                                  allowClear={false}
                                />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <div className="text-[11px] text-bb-text-muted">Week end</div>
                              <div className="w-[170px]">
                                <AppDatePicker
                                  value={effective.to}
                                  onChange={() => { /* read-only */ }}
                                  disabled
                                  allowClear={false}
                                />
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="space-y-1">
                              <div className="text-[11px] text-bb-text-muted">From</div>
                              <div className="w-[170px]">
                                <AppDatePicker
                                  value={customFrom}
                                  onChange={(next) => setCustomFrom(next)}
                                  disabled={loading || !businessId || !canClose}
                                  allowClear={false}
                                />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <div className="text-[11px] text-bb-text-muted">To</div>
                              <div className="w-[170px]">
                                <AppDatePicker
                                  value={customTo}
                                  onChange={(next) => setCustomTo(next)}
                                  disabled={loading || !businessId || !canClose}
                                  allowClear={false}
                                />
                              </div>
                            </div>
                          </>
                        )}

                        <Button variant="outline" className="h-7 px-3 text-xs" onClick={runPreview} disabled={loading || previewBusy || !businessId || !canClose}>
                          {previewBusy ? "Loading…" : "Preview"}
                        </Button>
                      </div>

                      <div className="text-xs text-bb-text-muted">
                        Effective range:{" "}
                        <span className="font-medium tabular-nums">{effective.from}</span>{" "}
                        → <span className="font-medium tabular-nums">{effective.to}</span>
                        {"  "}•{"  "}Today: <span className="font-medium tabular-nums">{todayYmd}</span>
                      </div>

                      {effective.to > todayYmd ? (
                        <div className="text-[11px] text-bb-status-warning-fg">
                          <span className="font-semibold">Can’t close beyond today.</span> Choose an end date on or before today.
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
                      <div className="text-xs font-semibold text-bb-text">Reconciliation</div>
                      <div className={`text-xs font-semibold ${preview ? (isClean ? "text-primary" : "text-bb-status-warning-fg") : "text-bb-text-muted"}`}>
                        {preview ? (isClean ? "Clean (recommended)" : "Not clean") : "Preview to see totals"}
                      </div>
                    </div>

                    <div className="px-3 py-3">
                      {!preview ? (
                        <div className="text-sm text-bb-text-muted">Preview to see totals and recommendation.</div>
                      ) : (
                        <div className="grid grid-cols-4 gap-3">
                          <div className="rounded-md border border-bb-border p-3">
                            <div className="text-[11px] text-bb-text-muted">Total</div>
                            <div className="text-sm font-semibold">{stats.entries_total}</div>
                          </div>
                          <div className="rounded-md border border-bb-border p-3">
                            <div className="text-[11px] text-bb-text-muted">Reconciled</div>
                            <div className="text-sm font-semibold">{stats.entries_reconciled}</div>
                          </div>
                          <div className="rounded-md border border-bb-border p-3">
                            <div className="text-[11px] text-bb-text-muted">Unreconciled</div>
                            <div className="text-sm font-semibold">{stats.entries_unreconciled}</div>
                          </div>
                          <div className="rounded-md border border-bb-border p-3">
                            <div className="text-[11px] text-bb-text-muted">Open issues</div>
                            <div className="text-sm font-semibold">{stats.issues_open}</div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Months affected + override */}
                  {preview ? (
                    <div className="space-y-2">
                      <div className="text-sm text-bb-text">
                        Months affected:{" "}
                        <span className="font-medium text-bb-text">{monthsAffected.length ? monthsAffected.join(", ") : "—"}</span>
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
                          This period is not clean. {confirmOverride ? "Click Close again to proceed." : "Click Close to confirm override."}
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
            })()}
          </div>

          {/* Confirm modal (no placeholders) */}
          {confirmCloseOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-3">
              <div className="w-full max-w-md rounded-xl border border-bb-border bg-bb-surface-card shadow-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-bb-border">
                  <div className="text-sm font-semibold">Confirm close period</div>
                  <div className="mt-1 text-xs text-bb-text-muted">
                    You are about to close through{" "}
                    <span className="font-medium tabular-nums">{closeMonth ? monthEndYmd(closeMonth) : "—"}</span>.
                  </div>
                </div>

                <div className="px-4 py-3">
                  <div className="text-xs text-bb-text-muted">
                    This will block edits to any entries dated on or before that date. Reopening is restricted by role.
                  </div>
                </div>

                <div className="px-4 py-3 border-t border-bb-border flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    className="h-9 px-3"
                    disabled={loading}
                    onClick={() => setConfirmCloseOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button className="h-9 px-3" disabled={loading || !closeMonth || isCloseBeyondToday} onClick={onConfirmClose}>
                    Confirm close
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Confirm reopen (OWNER only; deterministic month) */}
          {confirmReopenOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-3">
              <div className="w-full max-w-md rounded-xl border border-bb-border bg-bb-surface-card shadow-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-bb-border">
                  <div className="text-sm font-semibold">Confirm reopen month</div>
                  <div className="mt-1 text-xs text-bb-text-muted">
                    You are about to reopen{" "}
                    <span className="font-medium tabular-nums">{reopenMonth || "—"}</span>.
                  </div>
                </div>

                <div className="px-4 py-3">
                  <div className="text-xs text-bb-text-muted">
                    Reopening restores the ability to modify entries in that month. This action is restricted to OWNER.
                  </div>
                </div>

                <div className="px-4 py-3 border-t border-bb-border flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    className="h-9 px-3"
                    disabled={loading}
                    onClick={() => {
                      setConfirmReopenOpen(false);
                      setReopenMonth("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="h-9 px-3"
                    disabled={loading || !canReopen || !reopenMonth}
                    title={!canReopen ? "Only OWNER can reopen" : "Confirm reopen"}
                    onClick={() => onReopen(reopenMonth)}
                  >
                    Confirm reopen
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Closed months table */}
          <div
            ref={reopenSectionRef}
            className={reopenPulse ? "rounded-xl ring-2 ring-primary/30 ring-offset-2 ring-offset-bb-app-bg" : ""}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">Closed months</div>
            </div>

            {loading && rows.length === 0 ? (
              <div className="text-sm text-bb-text-muted">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="text-sm text-bb-text-muted">No closed periods yet.</div>
            ) : (
              <div className="rounded-md border border-bb-border overflow-hidden">
                <div className="grid grid-cols-[140px_1fr_220px] bg-bb-surface-soft text-[11px] font-semibold text-bb-text-muted px-3 h-9 items-center border-b border-bb-border">
                  <div>Month</div>
                  <div>Closed by</div>
                  <div className="text-right">Actions</div>
                </div>

                {rows.map((r: any) => (
                  <div
                    key={r.month}
                    className="grid grid-cols-[140px_1fr_220px] px-3 h-9 items-center border-b border-bb-border-muted text-sm"
                  >
                    <div className="tabular-nums">{r.month}</div>
                    <div className="truncate text-bb-text-muted">
                      {r.closed_by_user_id ? "Closed by team member" : "System"}
                    </div>
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        className="h-7 px-3 text-xs"
                        disabled={!canReopen || loading || !r?.month}
                        title={!canReopen ? "Only OWNER can reopen" : "Reopen month"}
                        onClick={() => {
                          setReopenMonth(String(r.month ?? ""));
                          setConfirmReopenOpen(true);
                        }}
                      >
                        Reopen
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent actions (ONLY if real events exist) */}
          {recentActions ? (
            <div className="rounded-md border border-bb-border overflow-hidden">
              <div className="bg-bb-surface-soft px-3 h-9 flex items-center text-[11px] font-semibold text-bb-text-muted border-b border-bb-border">
                Recent period actions
              </div>
              <div className="divide-y divide-bb-border-muted">
                {recentActions.map((a: any) => (
                  <div key={a.id ?? `${a.event_type}-${a.created_at}`} className="px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-bb-text">
                        <span className="font-medium">{a.event_type}</span>
                        {a?.payload_json?.through_date ? (
                          <span className="text-bb-text-muted"> — through {String(a.payload_json.through_date)}</span>
                        ) : a?.payload_json?.month ? (
                          <span className="text-bb-text-muted"> — {String(a.payload_json.month)}</span>
                        ) : null}
                      </div>
                      <div className="text-xs text-bb-text-muted tabular-nums">{String(a.created_at ?? "")}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
