"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { PageHeader } from "@/components/app/page-header";
import { FilterBar } from "@/components/primitives/FilterBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

import { InlineBanner } from "@/components/app/inline-banner";
import { EmptyStateCard } from "@/components/app/empty-state";
import { appErrorMessageOrNull } from "@/lib/errors/app-error";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { closeThroughDate, listClosedPeriods, reopenPeriod } from "@/lib/api/closedPeriods";
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
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader icon={<Lock className="h-4 w-4" />} title="Closed periods" />
        </div>

        <div className="mt-2 h-px bg-slate-200" />

        <div className="px-3 py-2">
          <FilterBar
            left={<div className="text-xs text-slate-600">Close periods are enforced on all mutations across the app.</div>}
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
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-[11px] font-semibold text-slate-600">Closed through</div>
            <div className="mt-0.5 text-sm tabular-nums">
              {closedThroughDate ? (
                <span className="font-medium">{closedThroughDate}</span>
              ) : (
                <span className="text-slate-600">Not closed</span>
              )}
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Any mutation with an effective date on or before this date is blocked.
            </div>
          </div>

          {/* Close-through control (month-end only) */}
          <div className="rounded-md border border-slate-200 px-3 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div className="flex flex-col gap-1">
                <div className="text-[11px] font-semibold text-slate-600">Close through (month end)</div>
                <div className="flex items-center gap-2">
                  <input
                    type="month"
                    value={closeMonth}
                    max={todayYmd.slice(0, 7)}
                    onChange={(e) => {
                      const v = e.target.value;
                      // Clamp: disallow selecting a month beyond current month (UI-only)
                      if (v && v > todayYmd.slice(0, 7)) {
                        setCloseMonth(todayYmd.slice(0, 7));
                      } else {
                        setCloseMonth(v);
                      }
                    }}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm"
                    disabled={loading || !businessId}
                  />
                  <Button
                    className="h-9 px-3 text-sm"
                    disabled={loading || !businessId || !closeMonth || !canClose || isCloseBeyondToday}
                    title={
                      !canClose
                        ? "Only OWNER or ADMIN can close periods"
                        : isCloseBeyondToday
                          ? "Can’t close beyond today"
                          : "Close through"
                    }
                    onClick={() => {
                      if (isCloseBeyondToday) return;
                      setConfirmCloseOpen(true);
                    }}
                  >
                    Close through
                  </Button>
                </div>
                <div className="text-xs text-slate-500">
                  Closing snaps to the last day of the selected month.
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                  <div>
                    Closing through:{" "}
                    <span className="font-medium tabular-nums">{closeMonth ? closeThroughYmd : "—"}</span>
                  </div>
                  <div>
                    Today: <span className="font-medium tabular-nums">{todayYmd}</span>
                  </div>
                </div>

                {isCloseBeyondToday ? (
                  <div className="mt-1 text-[11px] text-amber-700">
                    <span className="font-semibold">Can’t close beyond today.</span>{" "}
                    Select a month ending on or before today.
                  </div>
                ) : null}
              </div>

              <div className="text-xs text-slate-500">
                {canReopen
                  ? "You can reopen months (OWNER only)."
                  : "Only OWNER can reopen months."}{" "}
                {canClose ? "" : "Only OWNER/ADMIN can close periods."}
              </div>
            </div>
          </div>

          {/* Confirm modal (no placeholders) */}
          {confirmCloseOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-3">
              <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200">
                  <div className="text-sm font-semibold">Confirm close period</div>
                  <div className="mt-1 text-xs text-slate-600">
                    You are about to close through{" "}
                    <span className="font-medium tabular-nums">{closeMonth ? monthEndYmd(closeMonth) : "—"}</span>.
                  </div>
                </div>

                <div className="px-4 py-3">
                  <div className="text-xs text-slate-600">
                    This will block edits to any entries dated on or before that date. Reopening is restricted by role.
                  </div>
                </div>

                <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
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
              <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200">
                  <div className="text-sm font-semibold">Confirm reopen month</div>
                  <div className="mt-1 text-xs text-slate-600">
                    You are about to reopen{" "}
                    <span className="font-medium tabular-nums">{reopenMonth || "—"}</span>.
                  </div>
                </div>

                <div className="px-4 py-3">
                  <div className="text-xs text-slate-600">
                    Reopening restores the ability to modify entries in that month. This action is restricted to OWNER.
                  </div>
                </div>

                <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-end gap-2">
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
            className={reopenPulse ? "rounded-xl ring-2 ring-slate-300 ring-offset-2 ring-offset-white" : ""}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-medium">Closed months</div>
            </div>

            {loading && rows.length === 0 ? (
              <div className="text-sm text-slate-600">Loading…</div>
            ) : rows.length === 0 ? (
              <div className="text-sm text-slate-600">No closed periods yet.</div>
            ) : (
              <div className="rounded-md border border-slate-200 overflow-hidden">
                <div className="grid grid-cols-[140px_1fr_220px] bg-slate-50 text-[11px] font-semibold text-slate-600 px-3 h-9 items-center border-b border-slate-200">
                  <div>Month</div>
                  <div>Closed by</div>
                  <div className="text-right">Actions</div>
                </div>

                {rows.map((r: any) => (
                  <div
                    key={r.month}
                    className="grid grid-cols-[140px_1fr_220px] px-3 h-9 items-center border-b border-slate-100 text-sm"
                  >
                    <div className="tabular-nums">{r.month}</div>
                    <div className="truncate text-slate-600">{r.closed_by_user_id}</div>
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
            <div className="rounded-md border border-slate-200 overflow-hidden">
              <div className="bg-slate-50 px-3 h-9 flex items-center text-[11px] font-semibold text-slate-600 border-b border-slate-200">
                Recent period actions
              </div>
              <div className="divide-y divide-slate-100">
                {recentActions.map((a: any) => (
                  <div key={a.id ?? `${a.event_type}-${a.created_at}`} className="px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-slate-700">
                        <span className="font-medium">{a.event_type}</span>
                        {a?.payload_json?.through_date ? (
                          <span className="text-slate-500"> — through {String(a.payload_json.through_date)}</span>
                        ) : a?.payload_json?.month ? (
                          <span className="text-slate-500"> — {String(a.payload_json.month)}</span>
                        ) : null}
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums">{String(a.created_at ?? "")}</div>
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
