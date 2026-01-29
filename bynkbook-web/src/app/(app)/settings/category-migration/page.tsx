import { Suspense } from "react";
import CategoryMigrationPageClient from "./page-client";

export default function CategoryMigrationPage() {
  return (
    <Suspense fallback={null}>
      <CategoryMigrationPageClient />
    </Suspense>
  );
}
