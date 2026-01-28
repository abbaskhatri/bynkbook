import { Suspense } from "react";
import CategoriesPageClient from "./page-client";

export default function CategoriesPage() {
  return (
    <Suspense fallback={null}>
      <CategoriesPageClient />
    </Suspense>
  );
}
