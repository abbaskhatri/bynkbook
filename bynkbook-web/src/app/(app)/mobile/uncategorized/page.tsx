import { Suspense } from "react";

import MobileUncategorizedPageClient from "./page-client";

export default function MobileUncategorizedPage() {
  return (
    <Suspense fallback={null}>
      <MobileUncategorizedPageClient />
    </Suspense>
  );
}
