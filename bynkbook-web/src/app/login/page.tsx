"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser, signIn } from "aws-amplify/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  // If already signed in, never show login. Redirect instantly.
  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        router.replace("/dashboard"); // we will change this to /dashboard once Dashboard exists
        return;
      } catch {
        // not signed in -> stay on login
      } finally {
        setCheckingSession(false);
      }
    })();
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await signIn({ username, password });

      if (result.isSignedIn) {
        router.replace("/dashboard"); // we will change this to /dashboard once Dashboard exists
        return;
      }

      setError(`Additional step required: ${result.nextStep.signInStep}`);
    } catch (err: any) {
      const msg = err?.message || "Sign in failed";

      // If Amplify says you're already signed in, route forward.
      if (/already a signed in user/i.test(msg)) {
        router.replace("/dashboard"); // we will change this to /dashboard once Dashboard exists
        return;
      }

      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>BynkBook</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground">Checking session…</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>BynkBook Sign In</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Email / Username</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            {error ? <div className="text-sm text-red-600">{error}</div> : null}

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
