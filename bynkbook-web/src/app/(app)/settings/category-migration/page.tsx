import { Suspense } from "react";
import { RouteLoading } from "@/components/app/route-loading";
import CategoryMigrationPageClient from "./page-client";

export default function CategoryMigrationPage() {
  return (
    <Suspense fallback={<RouteLoading label="Loading category migration" />}>
      <CategoryMigrationPageClient />
    </Suspense>
  );
}
