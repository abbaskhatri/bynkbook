import { Suspense } from "react";
import { RouteLoading } from "@/components/app/route-loading";

import MobileReceiptPageClient from "./page-client";

export default function MobileReceiptPage() {
  return (
    <Suspense fallback={<RouteLoading label="Loading receipt entry" />}>
      <MobileReceiptPageClient />
    </Suspense>
  );
}
