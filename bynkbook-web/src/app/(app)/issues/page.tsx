import { Suspense } from "react";
import { RouteLoading } from "@/components/app/route-loading";
import IssuesPageClient from "./page-client";

export default function IssuesPage() {
  return (
    <Suspense fallback={<RouteLoading label="Loading issues" />}>
      <IssuesPageClient />
    </Suspense>
  );
}
