import { Suspense } from "react";
import ReportsPageClient from "./page-client";

export default function ReportsPage() {
  return (
    <Suspense fallback={null}>
      <ReportsPageClient />
    </Suspense>
  );
}
