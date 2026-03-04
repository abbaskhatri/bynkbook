"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        router.replace("/dashboard");
      } catch {
        // not signed in — stay on landing
      } finally {
        setChecking(false);
      }
    })();
  }, [router]);

  return (
    <div className="min-h-screen bg-slate-50 relative overflow-hidden">
      {/* decorative blobs (no images, no tint shell) */}
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-sky-200/40 blur-3xl" />

      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-3xl border-slate-200 shadow-sm">
          <CardHeader className="space-y-2 pb-4">
            <div className="inline-flex items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                v1.0
              </span>
              <span className="text-[11px] text-slate-500">Modern bookkeeping • Reconciliation-first</span>
            </div>

            <CardTitle className="text-2xl tracking-tight">BynkBook</CardTitle>
            <div className="text-sm text-slate-600">
              Bookkeeping you can trust — fast reconciliation, clean reports, and CPA-grade controls.
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {checking ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>

                <div className="pt-2 flex items-center justify-center gap-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <Button className="h-9" onClick={() => router.replace("/login")}>
                    Sign in
                  </Button>
                  <Button variant="outline" className="h-9" onClick={() => router.replace("/create-business")}>
                    Create business
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2">
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-xs font-semibold text-slate-900">Reconcile faster</div>
                    <div className="mt-1 text-[11px] text-slate-600">
                      Expected vs bank transactions, issue tracking, and clean period close.
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-xs font-semibold text-slate-900">CPA-grade controls</div>
                    <div className="mt-1 text-[11px] text-slate-600">
                      Closed period enforcement and audit-friendly workflows.
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="text-xs font-semibold text-slate-900">Instant-fast feel</div>
                    <div className="mt-1 text-[11px] text-slate-600">
                      Skeleton-first UI with last-good data during refetch.
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="text-[11px] text-slate-500">
                    Your data stays scoped to your business • Role-based access
                  </div>

                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <button type="button" className="hover:text-slate-700" onClick={() => router.replace("/privacy")}>
                      Privacy
                    </button>
                    <span className="text-slate-300">•</span>
                    <button type="button" className="hover:text-slate-700" onClick={() => router.replace("/terms")}>
                      Terms
                    </button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}