import { Suspense } from "react";
import ClosedPeriodsPageClient from "./page-client";

export default function ClosedPeriodsPage() {
  return (
    <Suspense fallback={null}>
      <ClosedPeriodsPageClient />
    </Suspense>
  );
}
