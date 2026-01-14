"use client";

import React, { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { configureAmplify } from "@/lib/auth/amplify";

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

            // Kill refetch storms:
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            refetchOnMount: false,

            // Fail fast; UI stays responsive via optimistic updates.
            retry: 0,
          },
          mutations: { retry: 0 },
        },
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
