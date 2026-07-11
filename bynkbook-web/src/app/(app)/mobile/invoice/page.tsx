import { Suspense } from "react";
import { RouteLoading } from "@/components/app/route-loading";

import MobileInvoicePageClient from "./page-client";

export default function MobileInvoicePage() {
  return (
    <Suspense fallback={<RouteLoading label="Loading invoice entry" />}>
      <MobileInvoicePageClient />
    </Suspense>
  );
}
