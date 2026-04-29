import { Suspense } from "react";

import MobileVendorsPageClient from "./page-client";

export default function MobileVendorsPage() {
  return (
    <Suspense fallback={null}>
      <MobileVendorsPageClient />
    </Suspense>
  );
}
