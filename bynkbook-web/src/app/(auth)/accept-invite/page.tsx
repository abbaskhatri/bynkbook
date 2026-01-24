import { Suspense } from "react";
import AcceptInviteClient from "./page-client";

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteClient />
    </Suspense>
  );
}
