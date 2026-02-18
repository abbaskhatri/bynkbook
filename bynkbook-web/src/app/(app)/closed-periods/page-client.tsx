"use client";

import { useMemo, useState } from "react";
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
import { listClosedPeriods, reopenPeriod } from "@/lib/api/closedPeriods";

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

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const bannerMsg = err || appErrorMessageOrNull(businessesQ.error) || null;

  const [rows, setRows] = useState<any[]>([]);

  async function refresh() {
    if (!businessId) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await listClosedPeriods(businessId);
      setRows(res.periods ?? []);
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
      await refresh();
    } catch (e: any) {
      setErr(appErrorMessageOrNull(e) ?? "Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  // Auto-load once businessId is known (matches your repo pattern)
  useState(() => {
    if (businessId && rows.length === 0 && !loading && !err) {
      refresh();
    }
  });

  return (
    <div className="flex flex-col gap-2 overflow-hidden max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader icon={<Lock className="h-4 w-4" />} title="Closed periods" />
        </div>

        <div className="mt-2 h-px bg-slate-200" />

        <div className="px-3 py-2">
          <FilterBar
            left={<div className="text-xs text-slate-600">Close periods from Ledger → “Close period”.</div>}
            right={
              <Button variant="outline" className="h-7 px-3 text-xs" onClick={refresh} disabled={loading || !businessId}>
                Refresh
              </Button>
            }
          />
        </div>

        <div className="px-3 pb-2">
          <InlineBanner title="Can’t load closed periods" message={bannerMsg} onRetry={businessId ? refresh : () => {}} />
        </div>

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
          <CardTitle className="text-sm">Closed months</CardTitle>
        </CardHeader>
        <CardContent>
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
                      disabled={!canReopen || loading}
                      title={!canReopen ? "Only OWNER can reopen" : "Reopen month"}
                      onClick={() => onReopen(r.month)}
                    >
                      Reopen
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!canReopen ? <div className="mt-2 text-xs text-slate-500">Only OWNER can reopen periods.</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
