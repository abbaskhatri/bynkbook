"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { useBusinesses } from "@/lib/queries/useBusinesses";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/app/page-header";
import { UploadPanel } from "@/components/uploads/UploadPanel";
import { UploadsList } from "@/components/uploads/UploadsList";
import {Users} from "lucide-react";

export default function VendorsPageClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const [openUpload, setOpenUpload] = useState(false);

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
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader
            icon={<Users className="h-4 w-4" />}
            title="Vendors"
            subtitle="Manage your vendors and track accounts payable"
            right={
              <div className="flex items-center gap-2">
<button
  type="button"
  className="h-7 px-3 text-xs rounded-md border border-slate-200 bg-white hover:bg-slate-50"
  onClick={() => setOpenUpload(true)}
>
  Upload Invoices
</button>


                <button
                  type="button"
                  disabled
                  title="Coming soon"
                  className="h-7 px-3 text-xs rounded-md bg-emerald-600 text-white opacity-50 cursor-not-allowed"
                >
                  + Add Vendor
                </button>
                
              <UploadsList
  title="Invoice uploads"
  businessId={selectedBusinessId ?? ""}
  type="INVOICE"
  limit={20}
/>

      <UploadPanel
        open={openUpload}
        onClose={() => setOpenUpload(false)}
        type="INVOICE"
        ctx={{ businessId: selectedBusinessId ?? undefined }}
        allowMultiple={true}
      />

              </div>
            }
          />
        </div>

        <div className="mt-2 h-px bg-slate-200" />

        {/* Search vendors (inside header box) */}
        <div className="px-3 py-2 flex items-center justify-end">
          <div className="w-full max-w-[260px]">
            <input
              className="h-7 w-full px-2 text-xs bg-white border border-slate-200 rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 focus-visible:ring-offset-0"
              placeholder="Search vendors..."
            />
          </div>
        </div>
      </div>

      {/* KPI tiles (Phase 3 UI-only: static) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:max-w-[70%]">
        <Card className="border-red-200 h-[96px]">
          <CardContent className="h-full p-3 flex flex-col justify-center">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
              <span className="text-slate-500">$</span> Total Open
            </div>
            <div className="mt-1 text-[24px] font-semibold text-slate-900 leading-none">$0.00</div>
          </CardContent>
        </Card>

        <Card className="h-[96px]">
          <CardContent className="h-full p-3 flex flex-col justify-center">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
              <span className="text-slate-500">🧾</span> Open Invoices
            </div>
            <div className="mt-1 text-[24px] font-semibold text-slate-900 leading-none">0</div>
          </CardContent>
        </Card>

        <Card className="h-[96px]">
          <CardContent className="h-full p-3 flex flex-col justify-center">
            <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-600 uppercase tracking-wide">
              <span className="text-slate-500">⚠</span> Overdue
            </div>
            <div className="mt-1 text-[24px] font-semibold text-slate-900 leading-none">0</div>
          </CardContent>
        </Card>
      </div>

      {/* Search moved into header box */}

      {/* Empty state */}
      <Card>
        <CardContent className="py-16">
          <div className="flex flex-col items-center text-center gap-3">
            <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center">
              <Users className="h-8 w-8 text-slate-400" />
            </div>

            <div className="text-lg font-semibold text-slate-900">No vendors yet</div>
            <div className="text-sm text-slate-600 max-w-md">
              Add your first vendor to start tracking invoices.
            </div>

            <button
              type="button"
              disabled
              title="Coming soon"
              className="h-9 px-4 text-sm rounded-md border border-slate-200 bg-white opacity-50 cursor-not-allowed"
            >
              + Add Vendor
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
