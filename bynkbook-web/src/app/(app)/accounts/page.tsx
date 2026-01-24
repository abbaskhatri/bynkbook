import { Suspense } from "react";
import AccountsRedirectClient from "./redirect-client";

export default function AccountsPage() {
  return (
    <Suspense fallback={null}>
      <AccountsRedirectClient />
    </Suspense>
  );
}
