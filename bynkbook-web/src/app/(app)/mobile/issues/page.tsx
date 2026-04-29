import { Suspense } from "react";

import MobileIssuesPageClient from "./page-client";

export default function MobileIssuesPage() {
  return (
    <Suspense fallback={null}>
      <MobileIssuesPageClient />
    </Suspense>
  );
}
