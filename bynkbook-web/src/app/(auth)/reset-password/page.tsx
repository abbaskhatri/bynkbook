"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmResetPassword } from "aws-amplify/auth";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function ResetPasswordInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const email = sp.get("email") ?? "";
  const nextUrl = useMemo(() => sp.get("next") ?? "/dashboard", [sp]);

  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Set new password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-slate-700">
            Enter the reset code sent to <span className="font-medium">{email || "your email"}</span>.
          </div>

          <div className="space-y-2">
            <Label htmlFor="code">Reset code</Label>
            <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="pw">New password</Label>
            <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
          </div>

          {err ? <div className="text-sm text-red-600">{err}</div> : null}

          <Button
            className="w-full"
            disabled={busy || !email.trim() || !code.trim() || !pw.trim()}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await confirmResetPassword({ username: email, confirmationCode: code, newPassword: pw });
                router.replace(`/login?next=${encodeURIComponent(nextUrl)}`);
              } catch (e: any) {
                setErr(e?.message ?? "Failed to reset password");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save new password"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center p-6 text-sm text-slate-600">Loading…</div>}>
      <ResetPasswordInner />
    </Suspense>
  );
}
