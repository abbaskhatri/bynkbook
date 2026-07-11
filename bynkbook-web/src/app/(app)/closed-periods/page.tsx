import { Suspense } from "react";
import { RouteLoading } from "@/components/app/route-loading";
import ClosedPeriodsPageClient from "./page-client";

export default function ClosedPeriodsPage() {
  return (
    <Suspense fallback={<RouteLoading label="Loading closed periods" />}>
      <ClosedPeriodsPageClient />
    </Suspense>
  );
}
