"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function TermsPage() {
  const router = useRouter();

return (
  <div className="min-h-screen bg-slate-50 px-6 py-10 relative overflow-hidden">
    <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-emerald-200/30 blur-3xl" />
    <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-sky-200/30 blur-3xl" />
      <div className="mx-auto max-w-3xl">
        <Card className="border-slate-200">
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Terms of Service</CardTitle>
            <div className="text-sm text-slate-600">Last updated: {new Date().toISOString().slice(0, 10)}</div>
          </CardHeader>

          <CardContent className="space-y-4">
            <div className="prose prose-slate max-w-none">
              <p>These terms govern use of BynkBook. By using the app, you agree to these terms.</p>
              <ul>
                <li>Use the service responsibly.</li>
                <li>Keep your credentials secure.</li>
                <li>We may update these terms over time.</li>
              </ul>
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