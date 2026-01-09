"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser, signOut } from "aws-amplify/auth";

import { useBusinesses } from "@/lib/queries/useBusinesses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsPage() {
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

    if (!sp.get("businessId")) {
      router.replace(`/settings?businessId=${selectedBusinessId}`);
    }
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

  if (!authReady) {
    return <div><Skeleton className="h-10 w-64" /></div>;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground">Business-scoped (MVP)</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Account</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div className="text-sm text-muted-foreground">Sign out of BynkBook.</div>
          <Button variant="outline" onClick={onSignOut}>Sign out</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Coming soon</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <div>Settings will include company profile, integrations, exports, team roles, and preferences.</div>
          <div>Phase 3 is UI-only; this is an MVP shell.</div>
        </CardContent>
      </Card>
    </div>
  );
}
