import { Suspense } from "react";

import MobileInvoicePageClient from "./page-client";

export default function MobileInvoicePage() {
  return (
    <Suspense fallback={null}>
      <MobileInvoicePageClient />
    </Suspense>
  );
}
