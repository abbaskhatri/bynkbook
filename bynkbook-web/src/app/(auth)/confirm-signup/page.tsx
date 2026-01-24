"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmSignUp } from "aws-amplify/auth";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function ConfirmSignupInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const email = sp.get("email") ?? "";
  const nextUrl = useMemo(() => sp.get("next") ?? "/dashboard", [sp]);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Confirm your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-slate-700">
            Enter the confirmation code sent to <span className="font-medium">{email || "your email"}</span>.
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">Confirmation code</Label>
            <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
          </div>

          {err ? <div className="text-sm text-red-600">{err}</div> : null}

          <Button
            className="w-full"
            disabled={busy || !email.trim() || !code.trim()}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await confirmSignUp({ username: email, confirmationCode: code });
                router.replace(`/login?next=${encodeURIComponent(nextUrl)}`);
              } catch (e: any) {
                setErr(e?.message ?? "Confirmation failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Confirming…" : "Confirm"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ConfirmSignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center p-6 text-sm text-slate-600">Loading…</div>}>
      <ConfirmSignupInner />
    </Suspense>
  );
}
