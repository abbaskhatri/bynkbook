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
import { Lock, Download, Plus, CalendarDays } from "lucide-react";
import {CalendarCheck2} from "lucide-react";

export default function ClosedPeriodsPageClient() {
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
  const accountIdFromUrl = sp.get("accountId");

  const selectedBusinessId = useMemo(() => {
    const list = businessesQ.data ?? [];
    if (bizIdFromUrl) return bizIdFromUrl;
    return list[0]?.id ?? null;
  }, [bizIdFromUrl, businessesQ.data]);

  const accountsQ = useAccounts(selectedBusinessId);

  const selectedAccountId = useMemo(() => {
    const list = accountsQ.data ?? [];
    if (accountIdFromUrl) return accountIdFromUrl;
    return list.find((a) => !a.archived_at)?.id ?? "";
  }, [accountsQ.data, accountIdFromUrl]);

  useEffect(() => {
    if (!authReady) return;
    if (businessesQ.isLoading) return;
    if (!selectedBusinessId) return;

    if (!sp.get("businessId")) {
      router.replace(`/closed-periods?businessId=${selectedBusinessId}`);
      return;
    }

    if (accountsQ.isLoading) return;

    if (selectedAccountId && !accountIdFromUrl) {
      router.replace(`/closed-periods?businessId=${selectedBusinessId}&accountId=${selectedAccountId}`);
    }
  }, [authReady, businessesQ.isLoading, selectedBusinessId, accountsQ.isLoading, selectedAccountId, accountIdFromUrl, router, sp]);

  if (!authReady) return <Skeleton className="h-10 w-64" />;

  const opts = (accountsQ.data ?? [])
    .filter((a) => !a.archived_at)
    .map((a) => ({ value: a.id, label: a.name }));

  const capsule = (
    <div className="h-6 px-1.5 rounded-lg border border-emerald-200 bg-emerald-50 flex items-center">
      <CapsuleSelect
        variant="flat"
        loading={accountsQ.isLoading}
        value={selectedAccountId || (opts[0]?.value ?? "")}
        onValueChange={(v) => router.replace(`/closed-periods?businessId=${selectedBusinessId}&accountId=${v}`)}
        options={opts}
        placeholder="Select account"
      />
    </div>
  );

  const closedCount = 0;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Unified header container (match Phase 3 standard) */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<Lock className="h-4 w-4" />}
            title="Closed Periods"
            afterTitle={capsule}
            right={
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  disabled
                  className="h-7 px-3 text-xs opacity-50 cursor-not-allowed"
                  title="Coming soon"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Export
                </Button>

                <Button
                  disabled
                  className="h-7 px-3 text-xs opacity-50 cursor-not-allowed"
                  title="Coming soon"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Close Period
                </Button>
              </div>
            }
          />
          <div className="mt-1 px-11 text-xs text-slate-500">
            {closedCount} periods closed
          </div>
        </div>
        <div className="mt-2 h-px bg-slate-200" />
      </div>

      {/* Empty state (old app style) */}
      <Card>
        <CardContent className="py-14">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center">
              <CalendarDays className="h-8 w-8 text-slate-400" />
            </div>

            <div className="text-lg font-semibold text-slate-900">No Closed Periods Yet</div>
            <div className="text-sm text-slate-600 max-w-md">
              You haven&apos;t closed any accounting periods. When you do, they will appear here.
            </div>

            <Button
              disabled
              className="h-9 px-4 text-sm opacity-50 cursor-not-allowed"
              title="Coming soon"
            >
              <Plus className="h-4 w-4 mr-2" />
              Close Period
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
