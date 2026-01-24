import { Suspense } from "react";
import OAuthCallbackClient from "./page-client";

export default function OAuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="text-sm text-slate-600">Finishing sign-in…</div>
        </div>
      }
    >
      <OAuthCallbackClient />
    </Suspense>
  );
}
