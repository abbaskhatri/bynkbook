import { Suspense } from "react";
import VendorsPageClient from "./page-client";

export default function VendorsPage() {
  return (
    <Suspense fallback={null}>
      <VendorsPageClient />
    </Suspense>
  );
}
