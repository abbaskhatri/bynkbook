import { Suspense } from "react";
import CategoryReviewPageClient from "./page-client";

export default function CategoryReviewPage() {
  return (
    <Suspense fallback={null}>
      <CategoryReviewPageClient />
    </Suspense>
  );
}
