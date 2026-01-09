"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, signOut } from "aws-amplify/auth";
import { apiFetch } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function MePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        await getCurrentUser();
        const data = await apiFetch("/v1/me");
        if (!cancelled) setMe(data);
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load /v1/me");
          router.replace("/login");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen p-6 flex items-start justify-center">
      <Card className="w-full max-w-2xl">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>/v1/me</CardTitle>
          <Button variant="outline" onClick={onSignOut}>
            Sign out
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : error ? (
            <div className="text-sm text-red-600">{error}</div>
          ) : (
            <pre className="text-xs overflow-auto p-3 rounded-md bg-muted">
              {JSON.stringify(me, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
