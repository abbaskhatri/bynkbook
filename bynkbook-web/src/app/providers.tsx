"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "aws-amplify/auth/enable-oauth-listener";
import { configureAmplify } from "@/lib/auth/amplify";
import { ThemeProvider } from "@/lib/theme";
import { invalidateFinancialReads, subscribeFinancialWrites } from "@/lib/queries/financialFreshness";

const PerfOverlay = dynamic(
  () => import("@/components/app/perf-overlay").then((mod) => mod.PerfOverlay),
  { ssr: false }
);

// Configure immediately so auth checks never race.
configureAmplify();

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Keep data "fresh" so navigation doesn't refetch and feel slow.
            staleTime: 5 * 60_000,
            gcTime: 60 * 60_000,

            // Refresh stale data on return or reconnect; avoid focus polling.
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            refetchOnMount: true,

            // Fail fast; UI stays responsive via optimistic updates.
            retry: 0,
          },
          mutations: { retry: 0 },
        },
      })
  );

  useEffect(() => subscribeFinancialWrites((scope) => {
    void invalidateFinancialReads(queryClient, scope);
  }), [queryClient]);

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        {children}
        {process.env.NODE_ENV !== "production" ? <PerfOverlay /> : null}
      </QueryClientProvider>
    </ThemeProvider>
  );
}
