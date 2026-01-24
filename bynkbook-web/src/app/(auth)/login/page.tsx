"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser, signIn, confirmSignIn, signInWithRedirect } from "aws-amplify/auth";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const nextUrl = useMemo(() => sp.get("next") ?? "/dashboard", [sp]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // For NEW_PASSWORD_REQUIRED flows (temp password)
  const [needsNewPassword, setNeedsNewPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        router.replace(nextUrl);
      } catch {
        // not signed in
      } finally {
        setCheckingSession(false);
      }
    })();
  }, [router, nextUrl]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const result = await signIn({ username, password });

      if (result.isSignedIn) {
        router.replace(nextUrl);
        return;
      }

      if (result?.nextStep?.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
        setNeedsNewPassword(true);
        return;
      }

      setError(`Additional step required: ${result.nextStep.signInStep}`);
    } catch (err: any) {
      const msg = err?.message ?? "Sign in failed";

      if (/already a signed in user/i.test(msg)) {
        router.replace(nextUrl);
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
        <div className="text-sm text-slate-600">Loading…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>

        <CardContent>
          {needsNewPassword ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSubmitting(true);
                setError(null);

                try {
                  await confirmSignIn({ challengeResponse: newPassword });
                  router.replace(nextUrl);
                } catch (err: any) {
                  setError(err?.message ?? "Failed to set new password");
                } finally {
                  setSubmitting(false);
                }
              }}
              className="space-y-4"
            >
              <div className="text-sm text-slate-700">A new password is required for this account.</div>

              <div className="space-y-2">
                <Label htmlFor="newPassword">New password</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>

              {error ? <div className="text-sm text-red-600">{error}</div> : null}

              <Button type="submit" className="w-full" disabled={submitting || !newPassword.trim()}>
                {submitting ? "Saving…" : "Set new password"}
              </Button>

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-slate-600 hover:text-slate-800"
                  onClick={() => {
                    setNeedsNewPassword(false);
                    setNewPassword("");
                    setError(null);
                  }}
                >
                  Back to sign in
                </button>

                <button
                  type="button"
                  className="text-slate-600 hover:text-slate-800"
                  onClick={() => router.replace(`/forgot-password?next=${encodeURIComponent(nextUrl)}`)}
                >
                  Forgot password
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <Button
                type="button"
                className="w-full"
                variant="outline"
                onClick={async () => {
                  // Preserve deep-link intent across OAuth redirect
                  if (typeof window !== "undefined") window.sessionStorage.setItem("bb_auth_next", nextUrl);
                  await signInWithRedirect({ provider: "Google" });
                }}
              >
                Continue with Google
              </Button>

              <div className="flex items-center gap-3">
                <div className="h-px bg-slate-200 flex-1" />
                <div className="text-xs text-slate-500">or</div>
                <div className="h-px bg-slate-200 flex-1" />
              </div>

              <form onSubmit={onSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
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

              <div className="flex items-center justify-between text-xs">
                <button
                  type="button"
                  className="text-slate-600 hover:text-slate-800"
                  onClick={() => router.replace(`/forgot-password?next=${encodeURIComponent(nextUrl)}`)}
                >
                  Forgot password
                </button>

                <button
                  type="button"
                  className="text-slate-600 hover:text-slate-800"
                  onClick={() => router.replace(`/signup?next=${encodeURIComponent(nextUrl)}`)}
                >
                  Create account
                </button>
              </div>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center p-6 text-sm text-slate-600">Loading…</div>}>
      <LoginInner />
    </Suspense>
  );
}
