import { Suspense } from "react";
import GoalsPageClient from "./page-client";

export default function GoalsPage() {
  return (
    <Suspense fallback={null}>
      <GoalsPageClient />
    </Suspense>
  );
}
