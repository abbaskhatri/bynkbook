import { Suspense } from "react";
import LedgerPageClient from "./page-client";
import { Skeleton } from "@/components/ui/skeleton";

function LedgerSkeleton() {
  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <div className="rounded-xl border border-bb-border bg-bb-surface-card shadow-sm p-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-3 w-56" />
      </div>
      <div className="rounded-xl border border-bb-border bg-bb-surface-card p-3 flex items-center gap-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="flex-1 rounded-xl border border-bb-border bg-bb-surface-card overflow-hidden">
        <div className="p-3 space-y-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function LedgerPage() {
  return (
    <Suspense fallback={<LedgerSkeleton />}>
      <LedgerPageClient />
    </Suspense>
  );
}
