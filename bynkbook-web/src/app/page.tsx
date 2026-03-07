"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Building2,
  CheckCircle2,
  FileText,
  GitMerge,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import BrandLogo from "@/components/app/BrandLogo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const featureCards = [
  {
    icon: GitMerge,
    title: "Reconciliation-first workflows",
    body: "Expected vs bank matching, issue handling, and cleaner movement through unmatched to matched states.",
  },
  {
    icon: ShieldCheck,
    title: "CPA-grade controls",
    body: "Closed periods, audit visibility, safe destructive actions, and accounting-safe workflow boundaries.",
  },
  {
    icon: FileText,
    title: "Professional outputs",
    body: "Reports, exports, and print-ready views designed to look like a serious financial tool, not a prototype.",
  },
];

const trustCards = [
  {
    icon: Building2,
    title: "Business-scoped access",
    body: "Keep data, users, and activity cleanly isolated by business.",
  },
  {
    icon: BookOpen,
    title: "Ledger clarity",
    body: "Cleaner rows, issue resolution, and workflow polish across the accounting surface.",
  },
  {
    icon: LockKeyhole,
    title: "Controlled operations",
    body: "Safer close, safer deletes, and stronger admin surfaces for launch-grade operations.",
  },
];

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        router.replace("/dashboard");
      } catch {
        // not signed in
      } finally {
        setChecking(false);
      }
    })();
  }, [router]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(16,185,129,0.18),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(59,130,246,0.16),transparent_28%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,#020617_0%,#0f172a_42%,#f8fafc_42%,#f8fafc_100%)]" />
      <div className="pointer-events-none absolute left-0 top-24 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-0 h-80 w-80 rounded-full bg-sky-400/10 blur-3xl" />

      <div className="relative mx-auto w-full max-w-7xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4 rounded-full border border-white/10 bg-white/5 px-4 py-3 backdrop-blur xl:px-5">
          <BrandLogo size="md" tone="light" priority />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              className="rounded-full px-4 text-slate-200 hover:bg-white/10 hover:text-white"
              onClick={() => router.replace("/login")}
            >
              Sign in
            </Button>
            <Button className="rounded-full px-4" onClick={() => router.replace("/create-business")}>
              Create business
            </Button>
          </div>
        </header>

        <section className="pt-12 lg:pt-16">
          <div className="grid items-center gap-10 lg:grid-cols-[1.02fr_0.98fr]">
            <div className="max-w-2xl">
              <div className="inline-flex items-center rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-200">
                v1.0 • Modern bookkeeping • Reconciliation-first
              </div>

              <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
                Bookkeeping you can trust, with the speed your team expects.
              </h1>

              <p className="mt-5 max-w-xl text-base leading-8 text-slate-300 sm:text-lg">
                BynkBook combines clean ledger workflows, safer close controls, and audit-friendly operations in a product that feels fast and professional.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {checking ? (
                  <>
                    <Skeleton className="h-11 w-full rounded-full sm:w-40" />
                    <Skeleton className="h-11 w-full rounded-full sm:w-44" />
                  </>
                ) : (
                  <>
                    <Button className="h-11 rounded-full px-6" onClick={() => router.replace("/login")}>
                      Sign in
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 rounded-full border-white/15 bg-white/5 px-6 text-white hover:bg-white/10"
                      onClick={() => router.replace("/create-business")}
                    >
                      Create business
                    </Button>
                  </>
                )}
              </div>

              <div className="mt-8 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-4 backdrop-blur">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Reconcile</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Faster</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-4 backdrop-blur">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Close periods</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Safer</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-4 backdrop-blur">
                  <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Audit trail</div>
                  <div className="mt-2 text-2xl font-semibold text-white">Cleaner</div>
                </div>
              </div>
            </div>

            <div className="relative">
              <div className="rounded-[32px] border border-white/10 bg-white/6 p-4 shadow-[0_30px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl sm:p-5">
                <div className="rounded-[28px] border border-white/10 bg-slate-950/35 p-5">
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
                    <div>
                      <div className="text-sm font-semibold text-white">Close period</div>
                      <div className="mt-1 text-xs text-slate-400">Month-end controls with safer exports and print-ready outputs.</div>
                    </div>
                    <div className="rounded-full bg-emerald-400/12 px-3 py-1 text-xs font-semibold text-emerald-200">
                      Ready
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <GitMerge className="h-4 w-4 text-emerald-300" />
                        Match + AI
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="rounded-xl bg-white/8 px-3 py-2 text-xs text-slate-300">Unmatched → Matched movement feels instant and controlled.</div>
                        <div className="rounded-xl bg-white/8 px-3 py-2 text-xs text-slate-300">Issue handling stays visible without bloated workflows.</div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-white/6 p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-white">
                        <Sparkles className="h-4 w-4 text-sky-300" />
                        Reports + outputs
                      </div>
                      <div className="mt-3 space-y-2">
                        <div className="rounded-xl bg-white/8 px-3 py-2 text-xs text-slate-300">Accounting-format amounts and print-safe report headers.</div>
                        <div className="rounded-xl bg-white/8 px-3 py-2 text-xs text-slate-300">CSV + print actions that feel like a real financial tool.</div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-white/6 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <BadgeCheck className="h-4 w-4 text-violet-300" />
                      Built for professional operators
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-xl bg-white/8 px-3 py-3 text-xs text-slate-300">Closed-period enforcement</div>
                      <div className="rounded-xl bg-white/8 px-3 py-3 text-xs text-slate-300">Activity visibility</div>
                      <div className="rounded-xl bg-white/8 px-3 py-3 text-xs text-slate-300">Faster admin workflows</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="relative z-10 mt-16 rounded-[32px] border border-slate-200 bg-white p-6 text-slate-900 shadow-[0_18px_70px_rgba(15,23,42,0.08)] sm:p-8 lg:p-10">
          <div className="max-w-2xl">
            <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold tracking-wide text-slate-700">
              Why teams choose BynkBook
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
              Serious bookkeeping workflows without serious friction.
            </h2>
            <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
              The product is designed around accounting-safe behavior, fast surfaces, and operational polish that supports month-end work instead of getting in the way.
            </p>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {featureCards.map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5">
                <div className="inline-flex rounded-2xl bg-slate-900 p-2.5 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="mt-4 text-lg font-semibold text-slate-950">{title}</div>
                <div className="mt-2 text-sm leading-7 text-slate-600">{body}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 grid gap-4 lg:grid-cols-3">
          {trustCards.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-[28px] border border-slate-200 bg-white p-6 text-slate-900 shadow-[0_14px_50px_rgba(15,23,42,0.06)]">
              <div className="inline-flex rounded-2xl bg-emerald-50 p-2.5 text-emerald-700">
                <Icon className="h-5 w-5" />
              </div>
              <div className="mt-4 text-lg font-semibold">{title}</div>
              <div className="mt-2 text-sm leading-7 text-slate-600">{body}</div>
            </div>
          ))}
        </section>

        <section className="mt-8 rounded-[32px] border border-slate-200 bg-white p-6 text-slate-900 shadow-[0_14px_50px_rgba(15,23,42,0.06)] sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-700">
                Launch-ready workflow surface
              </div>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">
                Start with the business, then move straight into the work.
              </h3>
              <div className="mt-3 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  <span>Secure sign-in and business-scoped access</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  <span>Cleaner ledger and issue handling</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  <span>Safer close and export workflows</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  <span>Reports and print surfaces that look professional</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Button className="h-11 rounded-full px-6" onClick={() => router.replace("/create-business")}>
                Create business
              </Button>
              <Button variant="outline" className="h-11 rounded-full px-6" onClick={() => router.replace("/login")}>
                Sign in
              </Button>
            </div>
          </div>
        </section>

        <footer className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-slate-200/80 pt-6 text-xs text-slate-500 sm:flex-row">
          <div>BynkBook • Modern bookkeeping • Reconciliation-first</div>
          <div className="flex items-center gap-4">
            <button type="button" className="hover:text-slate-700" onClick={() => router.replace("/privacy")}>
              Privacy
            </button>
            <button type="button" className="hover:text-slate-700" onClick={() => router.replace("/terms")}>
              Terms
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}