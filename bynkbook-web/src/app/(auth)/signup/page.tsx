"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signUp, signInWithRedirect } from "aws-amplify/auth";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function SignupInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextUrl = useMemo(() => sp.get("next") ?? "/dashboard", [sp]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Create account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            className="w-full"
            variant="outline"
            onClick={async () => {
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

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pw">Password</Label>
            <Input
              id="pw"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          {err ? <div className="text-sm text-red-600">{err}</div> : null}

          <Button
            className="w-full"
            disabled={busy || !email.trim() || !password.trim()}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                const res = await signUp({
                  username: email,
                  password,
                  options: { userAttributes: { email } },
                });

                if (res?.nextStep?.signUpStep === "CONFIRM_SIGN_UP") {
                  router.replace(
                    `/confirm-signup?email=${encodeURIComponent(email)}&next=${encodeURIComponent(nextUrl)}`
                  );
                  return;
                }

                router.replace(`/login?next=${encodeURIComponent(nextUrl)}`);
              } catch (e: any) {
                setErr(e?.message ?? "Sign up failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Creating…" : "Create account"}
          </Button>

          <div className="text-xs text-slate-600">
            Already have an account?{" "}
            <button
              className="text-slate-800 hover:underline"
              onClick={() => router.replace(`/login?next=${encodeURIComponent(nextUrl)}`)}
              type="button"
            >
              Sign in
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center p-6 text-sm text-slate-600">Loading…</div>}>
      <SignupInner />
    </Suspense>
  );
}
