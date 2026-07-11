import { Suspense } from "react";
import { RouteLoading } from "@/components/app/route-loading";
import CategoryReviewPageClient from "./page-client";

export default function CategoryReviewPage() {
  return (
    <Suspense fallback={<RouteLoading label="Loading category review" />}>
      <CategoryReviewPageClient />
    </Suspense>
  );
}
