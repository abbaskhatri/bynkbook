import { Suspense } from "react";
import LedgerPageClient from "./page-client";

export default function LedgerPage() {
  return (
    <Suspense fallback={null}>
      <LedgerPageClient />
    </Suspense>
  );
}
