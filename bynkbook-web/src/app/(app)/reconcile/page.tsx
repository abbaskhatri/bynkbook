import { Suspense } from "react";
import { RouteLoading } from "@/components/app/route-loading";
import ReconcilePageClient from "./page-client";

export default function ReconcilePage() {
  return (
    <Suspense fallback={<RouteLoading label="Loading reconciliation" />}>
      <ReconcilePageClient />
    </Suspense>
  );
}
