import { Suspense } from "react";
import { RouteLoading } from "@/components/app/route-loading";
import VendorsPageClient from "./page-client";

export default function VendorsPage() {
  return (
    <Suspense fallback={<RouteLoading label="Loading vendors" />}>
      <VendorsPageClient />
    </Suspense>
  );
}
