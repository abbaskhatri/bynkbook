"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { useAccounts } from "@/lib/queries/useAccounts";

import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader as CHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        setAuthReady(true);
      } catch {
        router.replace("/login");
      }
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
    if (!sp.get("businessId")) router.replace(`/dashboard?businessId=${selectedBusinessId}`);
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);

  const accountsQ = useAccounts(selectedBusinessId);

  const activeAccounts = (accountsQ.data ?? []).filter((a) => !a.archived_at).length;
  const archivedAccounts = (accountsQ.data ?? []).filter((a) => !!a.archived_at).length;

  if (!authReady) return <Skeleton className="h-10 w-64" />;

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader title="Dashboard" subtitle="Business overview" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CHeader><CardTitle className="text-sm font-medium">Businesses</CardTitle></CHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{(businessesQ.data ?? []).length || 1}</div>
          </CardContent>
        </Card>

        <Card>
          <CHeader><CardTitle className="text-sm font-medium">Active accounts</CardTitle></CHeader>
          <CardContent>
            {accountsQ.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-semibold">{activeAccounts}</div>}
          </CardContent>
        </Card>

        <Card>
          <CHeader><CardTitle className="text-sm font-medium">Archived accounts</CardTitle></CHeader>
          <CardContent>
            {accountsQ.isLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-semibold">{archivedAccounts}</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
