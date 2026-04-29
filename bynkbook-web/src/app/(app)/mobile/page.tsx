import { Suspense } from "react";

import MobilePageClient from "./page-client";

export default function MobilePage() {
  return (
    <Suspense fallback={null}>
      <MobilePageClient />
    </Suspense>
  );
}
