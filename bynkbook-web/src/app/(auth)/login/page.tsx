"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCurrentUser, signIn, confirmSignIn, signInWithRedirect } from "aws-amplify/auth";
import { ArrowRight, BadgeCheck, Building2, LockKeyhole, ShieldCheck } from "lucide-react";

import BrandLogo from "@/components/app/BrandLogo";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

function LoginInner() {
  const router = useRouter();
  const sp = useSearchParams();

  const nextUrl = useMemo(() => sp.get("next") ?? "/dashboard", [sp]);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
                    Modern bookkeeping for serious businesses
                  </div>
                  <h1 className="mt-5 text-4xl font-semibold leading-tight text-white">
                    Reconcile faster. Close confidently. Stay audit-ready.
                  </h1>
                  <p className="mt-4 max-w-lg text-base leading-7 text-slate-300">
                    BynkBook is built for clean ledgers, controlled close workflows, and professional financial operations without the clutter.
                  </p>
                </div>

                <div className="mt-8 grid gap-3">
                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-emerald-400/12 p-2 text-emerald-200">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Multi-business ready</div>
                      <div className="mt-1 text-sm text-slate-300">
                        Keep books, users, activity, and workflows cleanly scoped by business.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-sky-400/12 p-2 text-sky-200">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">CPA-grade controls</div>
                      <div className="mt-1 text-sm text-slate-300">
                        Closed periods, issue tracking, approval-safe flows, and audit visibility built in.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-violet-400/12 p-2 text-violet-200">
                      <BadgeCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Reconciliation-first UI</div>
                      <div className="mt-1 text-sm text-slate-300">
                        Expected vs bank matching, issue resolution, and ledger cleanup designed for speed.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative z-10 grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Close periods</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Safer</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Reconcile</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Faster</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Audit trail</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Cleaner</div>
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
                      Secure workspace access
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
                      {needsNewPassword ? "Set your new password" : "Sign in to BynkBook"}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {needsNewPassword
                        ? "This account requires a new password before you can continue."
                        : "Access your businesses, reconciliation workflows, and reports from one secure place."}
                    </p>
                  </div>
                </div>

                <div className="px-6 py-6 sm:px-7">
                  {checkingSession ? (
                    <div className="space-y-4">
                      <Skeleton className="h-10 w-full rounded-xl" />
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-px w-full" />
                        <Skeleton className="h-3 w-8" />
                        <Skeleton className="h-px w-full" />
                      </div>
                      <Skeleton className="h-10 w-full rounded-xl" />
                      <Skeleton className="h-10 w-full rounded-xl" />
                      <Skeleton className="h-10 w-full rounded-xl" />
                    </div>
                  ) : needsNewPassword ? (
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
                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        Choose a strong password to activate this account.
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="newPassword">New password</Label>
                        <Input
                          id="newPassword"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          autoComplete="new-password"
                          className="h-11 rounded-xl"
                        />
                      </div>

                      {error ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                          {error}
                        </div>
                      ) : null}

                      <Button type="submit" className="h-11 w-full rounded-xl" disabled={submitting || !newPassword.trim()}>
                        {submitting ? "Saving…" : "Set new password"}
                      </Button>

                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <button
                          type="button"
                          className="hover:text-slate-700"
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
                          className="hover:text-slate-700"
                          onClick={() => router.replace(`/forgot-password?next=${encodeURIComponent(nextUrl)}`)}
                        >
                          Forgot password
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="space-y-5">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 w-full rounded-xl border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
                        onClick={async () => {
                          if (typeof window !== "undefined") window.sessionStorage.setItem("bb_auth_next", nextUrl);
                          await signInWithRedirect({ provider: "Google" });
                        }}
                      >
                        Continue with Google
                      </Button>

                      <div className="flex items-center gap-3">
                        <div className="h-px flex-1 bg-slate-200" />
                        <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400">or</div>
                        <div className="h-px flex-1 bg-slate-200" />
                      </div>

                      <form onSubmit={onSubmit} className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="email">Email</Label>
                          <Input
                            id="email"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            autoComplete="username"
                            className="h-11 rounded-xl"
                            placeholder="name@company.com"
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <Label htmlFor="password">Password</Label>
                            <button
                              type="button"
                              className="text-xs font-medium text-slate-500 hover:text-slate-700"
                              onClick={() => router.replace(`/forgot-password?next=${encodeURIComponent(nextUrl)}`)}
                            >
                              Forgot password?
                            </button>
                          </div>
                          <Input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            autoComplete="current-password"
                            className="h-11 rounded-xl"
                            placeholder="Enter your password"
                          />
                        </div>

                        {error ? (
                          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                            {error}
                          </div>
                        ) : null}

                        <Button type="submit" className="h-11 w-full rounded-xl" disabled={submitting}>
                          <span>{submitting ? "Signing in…" : "Sign in"}</span>
                          {!submitting ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
                        </Button>
                      </form>

                      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 rounded-xl bg-slate-900 p-2 text-white">
                            <LockKeyhole className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-slate-900">Protected workspace</div>
                            <div className="mt-1 text-sm text-slate-600">
                              Access is scoped by business with audit-friendly workflows and secure session handling.
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <button
                          type="button"
                          className="hover:text-slate-700"
                          onClick={() => router.replace(`/signup?next=${encodeURIComponent(nextUrl)}`)}
                        >
                          Create account
                        </button>

                        <div className="flex items-center gap-3">
                          <button type="button" className="hover:text-slate-700" onClick={() => router.replace("/privacy")}>
                            Privacy
                          </button>
                          <span className="text-slate-300">•</span>
                          <button type="button" className="hover:text-slate-700" onClick={() => router.replace("/terms")}>
                            Terms
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
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
                <div className="flex items-center gap-3">
                  <Skeleton className="h-px w-full" />
                  <Skeleton className="h-3 w-8" />
                  <Skeleton className="h-px w-full" />
                </div>
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
                <Skeleton className="h-10 w-full rounded-xl" />
              </CardContent>
            </Card>
          </div>
        </div>
      }
    >
      <LoginInner />
    </Suspense>
  );
}