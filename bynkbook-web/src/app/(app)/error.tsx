"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto my-12 w-full max-w-lg rounded-lg border border-bb-border bg-bb-surface-card p-6 shadow-sm">
      <h1 className="text-lg font-semibold text-bb-text">This page couldn’t load</h1>
      <p className="mt-2 text-sm leading-6 text-bb-text-muted">
        Try loading the page again, or return to your dashboard. If you were saving a change, check its status before submitting it again.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button variant="outline" asChild><Link href="/dashboard">Go to dashboard</Link></Button>
      </div>
    </div>
  );
}
