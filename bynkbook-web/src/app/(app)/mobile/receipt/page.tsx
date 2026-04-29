import { Suspense } from "react";

import MobileReceiptPageClient from "./page-client";

export default function MobileReceiptPage() {
  return (
    <Suspense fallback={null}>
      <MobileReceiptPageClient />
    </Suspense>
  );
}
