"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import { useBusinesses } from "@/lib/queries/useBusinesses";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {PieChart} from "lucide-react";

export default function BudgetsPageClient() {
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
    if (!sp.get("businessId")) router.replace(`/budgets?businessId=${selectedBusinessId}`);
  }, [authReady, businessesQ.isLoading, selectedBusinessId, router, sp]);

  if (!authReady) return <Skeleton className="h-10 w-64" />;

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-3 pt-2">
          <PageHeader icon={<PieChart className="h-4 w-4" />} title="Budgets" />
        </div>
        <div className="mt-2 h-px bg-slate-200" />
      </div>

      <Card>
        <CardContent className="p-0">
          {/* Budget header row */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">Budget by Category</span>
              <div className="flex items-center gap-1 text-xs text-slate-500">
                <button
                  disabled
                  title="Coming soon"
                  className="h-6 w-6 flex items-center justify-center rounded-md border border-slate-200 opacity-50 cursor-not-allowed"
                >
                  ‹
                </button>
                <span className="px-2">January 2026</span>
                <button
                  disabled
                  title="Coming soon"
                  className="h-6 w-6 flex items-center justify-center rounded-md border border-slate-200 opacity-50 cursor-not-allowed"
                >
                  ›
                </button>
              </div>
            </div>

            <button
              disabled
              title="Coming soon"
              className="h-7 px-3 text-xs rounded-md bg-emerald-600 text-white opacity-50 cursor-not-allowed"
            >
              Save
            </button>
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] px-4 py-2 text-xs font-semibold text-slate-500 border-b border-slate-200">
            <div>Category</div>
            <div className="text-right">Budgeted</div>
            <div className="text-right">Actual</div>
            <div className="text-right">Difference</div>
            <div className="text-center">% Used</div>
            <div className="text-center">Status</div>
          </div>

          {/* Disabled rows (static, Phase 3 shell) */}
          {[
            "Bank Charges",
            "Equipment",
            "Insurance",
            "Loan Payment",
            "Maintenance",
            "Marketing",
            "Misc",
            "Office Expense",
            "Other",
            "Payroll",
            "Professional Fees",
          ].map((name) => (
            <div
              key={name}
              className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] px-4 py-2 text-sm border-b border-slate-100"
            >
              <div className="text-slate-900">{name}</div>
              <div className="text-right">
                <input
                  disabled
                  value="0"
                  className="h-6 w-20 text-right px-2 text-xs border border-slate-200 rounded-md bg-slate-50 opacity-50 cursor-not-allowed"
                />
              </div>
              <div className="text-right text-slate-700">$0.00</div>
              <div className="text-right text-slate-700">$0.00</div>
              <div className="flex items-center justify-center">
                <div className="h-2 w-20 bg-slate-200 rounded-full" />
              </div>
              <div className="text-center text-xs text-slate-500">0%</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
