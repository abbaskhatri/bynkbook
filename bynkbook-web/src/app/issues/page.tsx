import { Suspense } from "react";
import IssuesPageClient from "./page-client";

export default function IssuesPage() {
  return (
    <Suspense fallback={null}>
      <IssuesPageClient />
    </Suspense>
  );
}
