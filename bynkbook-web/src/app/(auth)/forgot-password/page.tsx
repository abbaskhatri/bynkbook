"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { resetPassword } from "aws-amplify/auth";
import { ArrowRight, KeyRound, MailCheck, ShieldCheck } from "lucide-react";

import BrandLogo from "@/components/app/BrandLogo";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function ForgotPasswordInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextUrl = useMemo(() => sp.get("next") ?? "/dashboard", [sp]);

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.18),transparent_30%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,#020617_0%,#0f172a_50%,#0b1120_100%)]" />
      <div className="pointer-events-none absolute -left-24 top-24 h-64 w-64 rounded-full bg-emerald-400/10 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-sky-400/10 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl items-center px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid w-full gap-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-12">
          <div className="hidden lg:flex">
            <div className="relative flex min-h-[680px] w-full flex-col justify-between overflow-hidden rounded-[32px] border border-white/10 bg-white/6 p-8 shadow-[0_30px_80px_rgba(2,6,23,0.55)] backdrop-blur-xl">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.14),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.16),transparent_26%)]" />

              <div className="relative z-10">
                <BrandLogo size="lg" tone="light" priority />

                <div className="mt-10 max-w-xl">
                  <div className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-200">
                    Account recovery
                  </div>
                  <h1 className="mt-5 text-4xl font-semibold leading-tight text-white">
                    Recover access securely and get back to work.
                  </h1>
                  <p className="mt-4 max-w-lg text-base leading-7 text-slate-300">
                    Start the password reset flow with your email, receive a code, and continue into a secure password update.
                  </p>
                </div>

                <div className="mt-8 grid gap-3">
                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-emerald-400/12 p-2 text-emerald-200">
                      <MailCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Email verification</div>
                      <div className="mt-1 text-sm text-slate-300">
                        Reset begins by sending a verification code to the account email address.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-sky-400/12 p-2 text-sky-200">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Secure recovery flow</div>
                      <div className="mt-1 text-sm text-slate-300">
                        The reset process moves through code confirmation before account access is restored.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-violet-400/12 p-2 text-violet-200">
                      <KeyRound className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Back into your workspace</div>
                      <div className="mt-1 text-sm text-slate-300">
                        Once the reset starts, continue directly into the password reset page and then back to sign in.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative z-10 grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Recovery</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Secure</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Reset</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Guided</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Access</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Restored</div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <Card className="w-full max-w-md overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/96 shadow-[0_24px_80px_rgba(15,23,42,0.28)] backdrop-blur">
              <CardContent className="p-0">
                <div className="border-b border-slate-200/80 px-6 pb-5 pt-6 sm:px-7">
                  <div className="flex justify-center lg:justify-start">
                    <BrandLogo size="md" priority />
                  </div>

                  <div className="mt-5">
                    <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-emerald-700">
                      Password reset
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                      Reset your password
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Enter the email for your account and we’ll start the secure reset flow.
                    </p>
                  </div>
                </div>

                <div className="px-6 py-6 sm:px-7">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="username"
                        className="h-11 rounded-xl"
                        placeholder="name@company.com"
                      />
                    </div>

                    {err ? (
                      <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {err}
                      </div>
                    ) : null}

                    {msg ? (
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        {msg}
                      </div>
                    ) : null}

                    <Button
                      className="h-11 w-full rounded-xl"
                      disabled={busy || !email.trim()}
                      onClick={async () => {
                        setBusy(true);
                        setErr(null);
                        setMsg(null);
                        try {
                          await resetPassword({ username: email });
                          setMsg("Code sent. Continue to enter your code and new password.");
                          router.replace(
                            `/reset-password?email=${encodeURIComponent(email)}&next=${encodeURIComponent(nextUrl)}`
                          );
                        } catch (e: any) {
                          setErr(e?.message ?? "Failed to start reset");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <span>{busy ? "Sending…" : "Send reset code"}</span>
                      {!busy ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
                    </Button>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      After this step, you’ll continue to the reset page to enter your code and new password.
                    </div>

                    <div className="text-xs text-slate-600">
                      Remembered your password?{" "}
                      <button
                        className="font-medium text-slate-900 hover:underline"
                        onClick={() => router.replace(`/login?next=${encodeURIComponent(nextUrl)}`)}
                        type="button"
                      >
                        Back to sign in
                      </button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-md">
            <Card className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
              <CardContent className="space-y-4 p-6">
                <Skeleton className="h-8 w-36" />
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </CardContent>
            </Card>
          </div>
        </div>
      }
    >
      <ForgotPasswordInner />
    </Suspense>
  );
}