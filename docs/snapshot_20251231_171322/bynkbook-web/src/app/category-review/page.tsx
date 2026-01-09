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

export default function CategoryReviewPage() {
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
      router.replace(`/category-review?businessId=${selectedBusinessId}`);
      return;
    }

    if (accountsQ.isLoading) return;

    if (selectedAccountId && !accountIdFromUrl) {
      router.replace(`/category-review?businessId=${selectedBusinessId}&accountId=${selectedAccountId}`);
    }
  }, [authReady, businessesQ.isLoading, selectedBusinessId, accountsQ.isLoading, selectedAccountId, accountIdFromUrl, router, sp]);

  if (!authReady) return <Skeleton className="h-10 w-64" />;

  const opts = (accountsQ.data ?? [])
    .filter((a) => !a.archived_at)
    .map((a) => ({ value: a.id, label: a.name }));

  const capsule = (
    <CapsuleSelect
      loading={accountsQ.isLoading}
      value={selectedAccountId || (opts[0]?.value ?? "")}
      onValueChange={(v) => router.replace(`/category-review?businessId=${selectedBusinessId}&accountId=${v}`)}
      options={opts}
      placeholder="Select account"
    />
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeader title="Category Review" subtitle="Account-scoped (MVP)" inlineAfterTitle={capsule} />

      <Card>
        <CHeader><CardTitle>Coming soon</CardTitle></CHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <div>This page will be used to review and correct categories for entries.</div>
          <div>Category is not exposed by locked Phase 3 endpoints yet, so this is an MVP shell.</div>
        </CardContent>
      </Card>
    </div>
  );
}
