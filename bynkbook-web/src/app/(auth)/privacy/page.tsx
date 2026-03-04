"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function PrivacyPage() {
  const router = useRouter();

return (
  <div className="min-h-screen bg-slate-50 px-6 py-10 relative overflow-hidden">
    <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl" />
    <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-sky-200/30 blur-3xl" />
      <div className="mx-auto max-w-3xl">
        <Card className="border-slate-200">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Privacy Policy</CardTitle>
            <div className="text-sm text-slate-600">Last updated: {new Date().toISOString().slice(0, 10)}</div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="space-y-3">
  <div className="rounded-lg border border-slate-200 bg-white p-3">
    <div className="text-xs font-semibold text-slate-900">Data scope</div>
    <div className="mt-1 text-sm text-slate-600">
      BynkBook scopes data to your business and enforces access by role.
    </div>
  </div>

  <div className="rounded-lg border border-slate-200 bg-white p-3">
    <div className="text-xs font-semibold text-slate-900">Security</div>
    <div className="mt-1 text-sm text-slate-600">
      Authentication is required to access the app. Keep your credentials secure.
    </div>
  </div>

  <div className="rounded-lg border border-slate-200 bg-white p-3">
    <div className="text-xs font-semibold text-slate-900">Questions</div>
    <div className="mt-1 text-sm text-slate-600">
      For privacy questions, contact support.
    </div>
  </div>

  <div className="text-[11px] text-slate-500">
    Note: This page is a summary. Your actual data handling depends on configured services and account settings.
  </div>
</div>

            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" className="h-9 px-3" onClick={() => router.replace("/login")}>
                Back to sign in
              </Button>
              <Button variant="ghost" className="h-9 px-3" onClick={() => router.replace("/")}>
                Home
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}