"use client";

import { Suspense } from "react";
import AppShellInner from "./app-shell-inner";
import BrandLogo from "./BrandLogo";
import { Skeleton } from "@/components/ui/skeleton";

function AppShellFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-md border border-bb-border bg-bb-surface-card p-6 shadow-sm">
        <BrandLogo variant="full" size="md" priority className="mb-6" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-4 w-56" />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<AppShellFallback />}>
      <AppShellInner>{children}</AppShellInner>
    </Suspense>
  );
}
