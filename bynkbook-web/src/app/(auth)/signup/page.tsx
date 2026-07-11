"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signUp, signInWithRedirect } from "aws-amplify/auth";
import { ArrowRight, BadgeCheck, Building2, LockKeyhole, ShieldCheck } from "lucide-react";

import BrandLogo from "@/components/app/BrandLogo";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { sanitizeAuthNext } from "@/lib/auth/sessionPolicy";

const GOOGLE_SIGN_IN_OPTIONS = {
  provider: "Google",
  options: { prompt: "SELECT_ACCOUNT" },
} as const;

function SignupInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const nextUrl = useMemo(() => sanitizeAuthNext(sp.get("next")), [sp]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
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
                    Create your secure workspace
                  </div>
                  <h1 className="mt-5 text-4xl font-semibold leading-tight text-white">
                    Start with cleaner books, safer workflows, and a more professional close.
                  </h1>
                  <p className="mt-4 max-w-lg text-base leading-7 text-slate-300">
                    BynkBook is designed for businesses that want fast reconciliation, clear ledgers, and audit-friendly operations from day one.
                  </p>
                </div>

                <div className="mt-8 grid gap-3">
                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-emerald-400/12 p-2 text-emerald-200">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Business-scoped access</div>
                      <div className="mt-1 text-sm text-slate-300">
                        Keep users, ledgers, reports, and workflows scoped to the right business from the start.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-sky-400/12 p-2 text-sky-200">
                      <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Accounting-safe controls</div>
                      <div className="mt-1 text-sm text-slate-300">
                        Closed periods, issue handling, exports, and admin actions designed with bookkeeping integrity in mind.
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-4">
                    <div className="mt-0.5 rounded-xl bg-violet-400/12 p-2 text-violet-200">
                      <BadgeCheck className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white">Professional workflow surface</div>
                      <div className="mt-1 text-sm text-slate-300">
                        A cleaner UI for ledger review, reconciliation, reports, vendors, and operational visibility.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative z-10 grid grid-cols-3 gap-3">
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Workflows</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Cleaner</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Close</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Safer</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Setup</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Faster</div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center">
            <Card className="w-full max-w-md overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/96 shadow-[0_24px_80px_rgba(15,23,42,0.28)] backdrop-blur dark:border-bb-border dark:bg-bb-surface-card/96 dark:shadow-[0_28px_90px_rgba(0,0,0,0.42)]">
              <CardContent className="p-0">
                <div className="border-b border-slate-200/80 px-6 pb-5 pt-6 dark:border-bb-border-muted sm:px-7">
                  <div className="flex justify-center lg:justify-start">
                    <BrandLogo size="md" priority />
                  </div>

                  <div className="mt-5">
                    <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-emerald-700 dark:border-bb-status-success-border dark:bg-bb-status-success-bg dark:text-bb-status-success-fg">
                      New account
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 dark:text-bb-text">
                      Create your BynkBook account
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-bb-text-muted">
                      Start with secure access, then create your business workspace and continue into the app.
                    </p>
                  </div>
                </div>

                <div className="px-6 py-6 sm:px-7">
                  <div className="space-y-5">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 w-full rounded-xl border-slate-200 bg-white text-slate-900 hover:bg-slate-50 dark:border-bb-border dark:bg-bb-surface-elevated dark:text-bb-text dark:hover:bg-bb-table-row-hover"
                      onClick={async () => {
                        if (typeof window !== "undefined") window.sessionStorage.setItem("bb_auth_next", nextUrl);
                        await signInWithRedirect(GOOGLE_SIGN_IN_OPTIONS);
                      }}
                    >
                      Continue with Google
                    </Button>

                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-slate-200 dark:bg-bb-border" />
                      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-bb-text-subtle">or</div>
                      <div className="h-px flex-1 bg-slate-200 dark:bg-bb-border" />
                    </div>

                    <form
                      className="space-y-4"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        setBusy(true);
                        setErr(null);
                        try {
                          const res = await signUp({
                            username: email.trim(),
                            password,
                            options: { userAttributes: { email: email.trim() } },
                          });
                          if (res?.nextStep?.signUpStep === "CONFIRM_SIGN_UP") {
                            router.replace(`/confirm-signup?email=${encodeURIComponent(email)}&next=${encodeURIComponent(nextUrl)}`);
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
                      <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input
                          id="email"
                          name="email"
                          type="email"
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          autoComplete="username"
                          autoCapitalize="none"
                          autoCorrect="off"
                          className="h-11 rounded-xl"
                          placeholder="name@company.com"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="pw">Password</Label>
                        <Input
                          id="pw"
                          name="password"
                          type="password"
                          required
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          autoComplete="new-password"
                          className="h-11 rounded-xl"
                          placeholder="Create a strong password"
                        />
                      </div>

                      {err ? (
                        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-bb-status-danger-border dark:bg-bb-status-danger-bg dark:text-bb-status-danger-fg">
                          {err}
                        </div>
                      ) : null}

                      <Button
                        type="submit"
                        className="h-11 w-full rounded-xl"
                        disabled={busy || !email.trim() || !password.trim()}
                      >
                        <span>{busy ? "Creating…" : "Create account"}</span>
                        {!busy ? <ArrowRight className="ml-2 h-4 w-4" /> : null}
                      </Button>
                    </form>

                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-bb-border dark:bg-bb-surface-soft">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 rounded-xl bg-slate-900 p-2 text-white dark:bg-primary dark:text-primary-foreground">
                          <LockKeyhole className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-900 dark:text-bb-text">Secure onboarding</div>
                          <div className="mt-1 text-sm text-slate-600 dark:text-bb-text-muted">
                            Your account is confirmed by email before you move into business creation and app setup.
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 dark:text-bb-text-subtle">
                      Already have an account?{" "}
                      <button
                        className="inline-flex min-h-11 items-center px-2 font-medium text-slate-900 hover:underline dark:text-bb-text"
                        onClick={() => router.replace(`/login?next=${encodeURIComponent(nextUrl)}`)}
                        type="button"
                      >
                        Sign in
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

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-950 px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-md">
            <Card className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)] dark:border-bb-border dark:bg-bb-surface-card dark:shadow-[0_28px_90px_rgba(0,0,0,0.42)]">
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
      <SignupInner />
    </Suspense>
  );
}
