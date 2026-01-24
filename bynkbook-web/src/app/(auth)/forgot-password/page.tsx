"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { resetPassword } from "aws-amplify/auth";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function ForgotPasswordInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextUrl = useMemo(() => sp.get("next") ?? "/dashboard", [sp]);

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Reset password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </div>

          {err ? <div className="text-sm text-red-600">{err}</div> : null}
          {msg ? <div className="text-sm text-slate-700">{msg}</div> : null}

          <Button
            className="w-full"
            disabled={busy || !email.trim()}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              setMsg(null);
              try {
                await resetPassword({ username: email });
                setMsg("Code sent. Continue to enter your code and new password.");
                router.replace(`/reset-password?email=${encodeURIComponent(email)}&next=${encodeURIComponent(nextUrl)}`);
              } catch (e: any) {
                setErr(e?.message ?? "Failed to start reset");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Sending…" : "Send reset code"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center p-6 text-sm text-slate-600">Loading…</div>}>
      <ForgotPasswordInner />
    </Suspense>
  );
}
