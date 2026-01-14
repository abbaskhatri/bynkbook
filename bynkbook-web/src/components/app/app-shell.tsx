"use client";

import { Suspense } from "react";
import AppShellInner from "./app-shell-inner";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <AppShellInner>{children}</AppShellInner>
    </Suspense>
  );
}
