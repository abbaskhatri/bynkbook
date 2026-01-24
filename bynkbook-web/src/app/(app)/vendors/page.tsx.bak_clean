"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { useBusinesses } from "@/lib/queries/useBusinesses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function VendorsPage() {
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
    if (!sp.get("businessId")) router.replace(`/vendors?businessId=${selectedBusinessId}`);
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);

  if (!authReady) return <Skeleton className="h-10 w-64" />;

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold">Vendors</h1>
        <p className="text-sm text-muted-foreground">Business-scoped (MVP)</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Coming soon</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <div>Vendors will be business-wide (no account selector).</div>
          <div>Phase 3 is UI-only; this is an MVP shell.</div>
        </CardContent>
      </Card>
    </div>
  );
}
