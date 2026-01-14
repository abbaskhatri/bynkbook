"use client";

import { Suspense } from "react";
import TopNavInner from "./top-nav-inner";

export function TopNav() {
  return (
    <Suspense fallback={null}>
      <TopNavInner />
    </Suspense>
  );
}
