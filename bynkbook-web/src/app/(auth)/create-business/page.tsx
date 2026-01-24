import { Suspense } from "react";
import CreateBusinessClient from "./page-client";

export default function CreateBusinessPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="text-sm text-slate-600">Loading…</div>
        </div>
      }
    >
      <CreateBusinessClient />
    </Suspense>
  );
}
