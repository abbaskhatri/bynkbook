import { Suspense } from "react";
import { RouteLoading } from "@/components/app/route-loading";
import AcceptInviteClient from "./page-client";

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<RouteLoading label="Loading invitation" />}>
      <AcceptInviteClient />
    </Suspense>
  );
}
