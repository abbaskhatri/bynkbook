"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";

import { PageHeader } from "@/components/app/page-header";
import { CapsuleSelect } from "@/components/app/capsule-select";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { BarChart3 } from "lucide-react";

export default function ReportsPageClient() {
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
  const selectedAccountOrAll = sp.get("accountId") ?? "all";

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const accountsQ = useAccounts(selectedBusinessId);

  useEffect(() => {
    if (!authReady) return;
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;

    if (!sp.get("businessId")) {
      router.replace(`/reports?businessId=${selectedBusinessId}&accountId=all`);
    }
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);

  if (!authReady) return <Skeleton className="h-10 w-64" />;

  const opts = (accountsQ.data ?? [])
    .filter((a) => !a.archived_at)
    .map((a) => ({ value: a.id, label: a.name }));

  const capsule = (
    <div className="h-6 px-1.5 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center">
      <CapsuleSelect
        variant="flat"
        loading={accountsQ.isLoading}
        value={selectedAccountOrAll}
        onValueChange={(v) => router.replace(`/reports?businessId=${selectedBusinessId}&accountId=${v}`)}
        options={opts}
        placeholder="All Accounts"
        includeAllOption
        allLabel="All Accounts"
      />
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
                    <PageHeader
            icon={<BarChart3 className="h-4 w-4" />}
            title="Reports"
            afterTitle={capsule}
            right={
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  disabled
                  className="h-7 px-3 text-xs opacity-50 cursor-not-allowed"
                  title="Coming soon"
                >
                  Export
                </Button>

                <Button
                  variant="outline"
                  disabled
                  className="h-7 px-3 text-xs opacity-50 cursor-not-allowed"
                  title="Coming soon"
                >
                  Download
                </Button>
              </div>
            }
          />
        </div>
        <div className="mt-2 h-px bg-slate-200" />
      </div>

      <Card>
        <CHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>Reports (Coming soon)</CardTitle>

            <Button
              variant="outline"
              disabled
              className="h-7 px-2 text-xs opacity-50 cursor-not-allowed"
              title="Coming soon"
            >
              Configure
            </Button>
          </div>
        </CHeader>

        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Charts and tables will be enabled once Reports endpoints are ready. For Phase 3, this page is gated to avoid
            broken UI and backend calls.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              "Profit & Loss",
              "Balance Sheet",
              "Cash Flow",
            ].map((name) => (
              <div key={name} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-900">{name}</div>
                <div className="mt-1 text-xs text-slate-600">Coming soon</div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              disabled
              className="h-7 px-3 text-xs opacity-50 cursor-not-allowed"
              title="Coming soon"
            >
              Run report
            </Button>

            <Button
              variant="outline"
              disabled
              className="h-7 px-3 text-xs opacity-50 cursor-not-allowed"
              title="Coming soon"
            >
              Export CSV
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
