"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { useBusinesses } from "@/lib/queries/useBusinesses";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {Target} from "lucide-react";

export default function GoalsPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    (async () => {
      try { await getCurrentUser(); setAuthReady(true); } catch { router.replace("/login"); }
    })();
  }, [router]);

  const businessesQ = useBusinesses();
  const bizIdFromUrl = sp.get("businessId") ?? sp.get("businessesId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  useEffect(() => {
    if (!authReady) return;
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;
    if (!sp.get("businessId")) router.replace(`/goals?businessId=${selectedBusinessId}`);
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);

  if (!authReady) return <Skeleton className="h-10 w-64" />;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader icon={<Target className="h-4 w-4" />} title="Goals" />
        </div>
        <div className="mt-2 h-px bg-slate-200" />
      </div>

      {/* KPI tiles (Phase 3 UI-only: static) */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {[
          { label: "Total Goals", tone: "border-slate-200 bg-white text-slate-900", value: "0" },
          { label: "Active", tone: "border-blue-200 bg-blue-50 text-blue-700", value: "0" },
          { label: "Achieved", tone: "border-emerald-200 bg-emerald-50 text-emerald-700", value: "0" },
          { label: "At Risk", tone: "border-amber-200 bg-amber-50 text-amber-700", value: "0" },
          { label: "Failed", tone: "border-red-200 bg-red-50 text-red-700", value: "0" },
        ].map((kpi) => (
          <Card key={kpi.label} className={kpi.tone}>
            <CardContent className="py-4 text-center">
              <div className="text-3xl font-semibold leading-none">{kpi.value}</div>
              <div className="mt-1 text-xs text-slate-600">{kpi.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Empty state */}
        <Card>
          <CardContent className="py-14">
            <div className="flex flex-col items-center text-center gap-3">
              <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center">
                <Target className="h-8 w-8 text-slate-400" />
              </div>

              <div className="text-lg font-semibold text-slate-900">No goals yet</div>
              <div className="text-sm text-slate-600 max-w-md">
                Create goals to track spending caps, savings targets, and revenue objectives.
              </div>

              <button
                type="button"
                disabled
                title="Coming soon"
                className="h-9 px-4 text-sm rounded-md bg-emerald-600 text-white opacity-50 cursor-not-allowed"
              >
                + Create First Goal
              </button>
            </div>
          </CardContent>
        </Card>

        {/* AI Suggestions (Phase 3 gated) */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">AI Suggestions</CardTitle>
              <button
                type="button"
                disabled
                title="Coming soon"
                className="h-7 w-7 rounded-md border border-slate-200 bg-white opacity-50 cursor-not-allowed"
              >
                ↻
              </button>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-800">
              No active goals found. Create goals to track your business targets.
            </div>

            <div className="flex flex-col items-center justify-center text-center py-10 text-sm text-slate-600">
              <div className="text-3xl mb-2">✨</div>
              No suggestions at this time. Your goals look good!
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
