import { Suspense } from "react";
import BudgetsPageClient from "./page-client";

export default function BudgetsPage() {
  return (
    <Suspense fallback={null}>
      <BudgetsPageClient />
    </Suspense>
  );
}
