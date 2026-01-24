import { Suspense } from "react";
import DashboardPageClient from "./page-client";

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardPageClient />
    </Suspense>
  );
}
