import { Suspense } from "react";

import MobileReviewPageClient from "./page-client";

export default function MobileReviewPage() {
  return (
    <Suspense fallback={null}>
      <MobileReviewPageClient />
    </Suspense>
  );
}
