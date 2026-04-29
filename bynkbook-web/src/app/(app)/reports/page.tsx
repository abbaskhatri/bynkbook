import { Suspense } from "react";
import ReportsPageClient from "./page-client";

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-bb-text-muted">Loading…</div>}>
      <ReportsPageClient />
    </Suspense>
  );
}
