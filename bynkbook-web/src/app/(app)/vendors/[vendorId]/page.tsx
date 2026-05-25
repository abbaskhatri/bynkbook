import { Suspense } from "react";
import VendorDetailPageClient from "./page-client";

export default function VendorDetailPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-bb-text-muted">Loading…</div>}>
      <VendorDetailPageClient />
    </Suspense>
  );
}