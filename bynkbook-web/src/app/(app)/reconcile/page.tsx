import { Suspense } from "react";
import ReconcilePageClient from "./page-client";

export default function ReconcilePage() {
  return (
    <Suspense fallback={null}>
      <ReconcilePageClient />
    </Suspense>
  );
}
