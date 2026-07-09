"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getCurrentUser } from "aws-amplify/auth";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  CalendarCheck2,
  CheckCircle2,
  ClipboardCheck,
  GitMerge,
  ShieldCheck,
  Users,
} from "lucide-react";

import BrandLogo from "@/components/app/BrandLogo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { expireSessionIfNeeded } from "@/lib/auth/sessionPolicy";

const heroMetrics = [
  { label: "Matched", value: "56", tone: "success" },
  { label: "Open issues", value: "0", tone: "neutral" },
  { label: "Uncategorized", value: "0", tone: "neutral" },
] as const;

const ledgerRows = [
  {
    title: "Bank deposit matched to invoice",
    meta: "Matched automatically",
    amount: "$4,820",
    tone: "positive",
  },
  {
    title: "Contractor bill ready for review",
    meta: "Needs category",
    amount: "-$1,240",
    tone: "warning",
  },
  {
    title: "Month close preview generated",
    meta: "No open issues",
    amount: "$0",
    tone: "positive",
  },
] as const;

const outcomes = [
  {
    icon: GitMerge,
    title: "Reconcile with confidence",
    body: "Expected entries, bank transactions, generated matches, and manual reviews stay visibly accountable.",
  },
  {
    icon: CalendarCheck2,
    title: "Close with guardrails",
    body: "Closed periods block unsafe edits while owner and admin workflows stay simple enough to run every month.",
  },
  {
    icon: Activity,
    title: "See work as it happens",
    body: "Activity, vendors, payables, and reports tell a clear operational story without digging through spreadsheets.",
  },
] as const;

const workflowSteps = [
  "Import or sync activity",
  "Match and resolve issues",
  "Close periods safely",
  "Report with confidence",
] as const;

const trustItems = [
  "Business-scoped access",
  "Session timeout controls",
  "Audit-friendly activity",
  "Owner/admin guardrails",
] as const;

export default function Home() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        await getCurrentUser();
        const expired = await expireSessionIfNeeded();
        if (expired) return;
        router.replace("/dashboard");
      } catch {
        // not signed in
      } finally {
        setChecking(false);
      }
    })();
  }, [router]);

  return (
    <main className="min-h-screen overflow-hidden bg-[#f6faf8] text-slate-950">
      <section className="relative min-h-[92svh] overflow-hidden bg-[#07111f] text-white">
        <div className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(255,255,255,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.16)_1px,transparent_1px)] [background-size:48px_48px]" />
        <div className="absolute inset-y-0 right-0 hidden w-[58%] min-w-[680px] lg:block">
          <ProductScene />
        </div>

        <div className="relative z-10 mx-auto flex min-h-[92svh] w-full max-w-7xl flex-col px-4 pb-10 pt-5 sm:px-6 lg:px-8">
          <header className="flex items-center justify-between gap-4 rounded-full border border-white/12 bg-white/7 px-4 py-3 backdrop-blur-xl">
            <BrandLogo size="md" tone="light" priority />
            <nav className="hidden items-center gap-6 text-sm font-medium text-slate-300 md:flex">
              <a href="#product" className="hover:text-white">Product</a>
              <a href="#security" className="hover:text-white">Security</a>
              <a href="#workflow" className="hover:text-white">Workflow</a>
            </nav>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                className="rounded-full px-4 text-slate-200 hover:bg-white/10 hover:text-white"
                onClick={() => router.replace("/login")}
              >
                Sign in
              </Button>
              <Button className="hidden rounded-full px-4 sm:inline-flex" onClick={() => router.replace("/create-business")}>
                Create business
              </Button>
            </div>
          </header>

          <div className="flex flex-1 items-center py-12 lg:py-16">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-100">
                <span className="h-2 w-2 rounded-full bg-emerald-300" />
                Launch-ready bookkeeping controls
              </div>

              <h1 className="mt-6 max-w-2xl text-5xl font-semibold leading-[0.98] text-white sm:text-6xl lg:text-7xl">
                BynkBook
              </h1>
              <p className="mt-5 max-w-2xl text-2xl font-semibold leading-tight text-emerald-100 sm:text-3xl">
                Close cleaner books without slowing your team down.
              </p>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                Reconciliation, period close, vendor payables, reports, and audit visibility in one calm workspace built for serious operators.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                {checking ? (
                  <>
                    <Skeleton className="h-12 w-full rounded-full bg-white/12 sm:w-52" />
                    <Skeleton className="h-12 w-full rounded-full bg-white/12 sm:w-40" />
                  </>
                ) : (
                  <>
                    <Button className="h-12 rounded-full px-6 text-base" onClick={() => router.replace("/create-business")}>
                      Start secure workspace
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      className="h-12 rounded-full border-white/15 bg-white/7 px-6 text-base text-white hover:bg-white/12"
                      onClick={() => router.replace("/login")}
                    >
                      Sign in
                    </Button>
                  </>
                )}
              </div>

              <div className="mt-10 grid max-w-xl gap-3 sm:grid-cols-3">
                <HeroStat label="Reconcile focus" value="3x" note="fewer clicks" />
                <HeroStat label="Session control" value="12h" note="max age" />
                <HeroStat label="Audit trail" value="100%" note="scoped activity" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="product" className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div>
            <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-700">
              Why customers trust it
            </div>
            <h2 className="mt-5 max-w-xl text-3xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-4xl">
              Designed around the moments where bookkeeping usually gets messy.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-8 text-slate-600">
              BynkBook makes the state of the books visible: what matched, what needs attention, what is locked, and what is ready to report.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {outcomes.map(({ icon: Icon, title, body }) => (
              <article key={title} className="rounded-lg border border-slate-200 bg-slate-50/80 p-5">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-semibold text-slate-950">{title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="bg-emerald-50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold tracking-wide text-emerald-700">
                <ClipboardCheck className="h-3.5 w-3.5" />
                Operational flow
              </div>
              <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-4xl">
                From bank activity to close-ready books.
              </h2>
              <p className="mt-4 text-base leading-8 text-slate-700">
                Every step is built to reduce uncertainty, keep context visible, and make the next action obvious.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {workflowSteps.map((step, index) => (
                <article key={step} className="rounded-lg border border-emerald-200 bg-white p-5">
                  <div className="text-sm font-semibold text-emerald-700">{String(index + 1).padStart(2, "0")}</div>
                  <h3 className="mt-3 text-lg font-semibold text-slate-950">{step}</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    Clear next actions keep the team moving without guessing what is safe.
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="security" className="bg-[#07111f] px-4 py-16 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/7 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              Security and control
            </div>
            <h2 className="mt-5 max-w-2xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
              A financial workspace should feel locked in from the first click.
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-slate-300">
              BynkBook pairs business-scoped access with session controls, owner/admin boundaries, and audit-friendly workflows.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {trustItems.map((item) => (
              <div key={item} className="flex items-center gap-3 rounded-lg border border-white/12 bg-white/7 px-4 py-4">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />
                <span className="text-sm font-medium text-slate-100">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-8 rounded-lg border border-slate-200 bg-slate-50 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold tracking-wide text-emerald-700">
              Ready for real books
            </div>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
              Make the first impression match the product.
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-8 text-slate-600">
              Customers should immediately understand that BynkBook is secure, operational, and built for month-end work.
            </p>
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

        <footer className="mx-auto mt-10 flex max-w-7xl flex-col items-center justify-between gap-4 border-t border-slate-200/80 pt-6 text-xs text-slate-500 sm:flex-row">
          <div>BynkBook • Cleaner books • Safer close</div>
          <div className="flex items-center gap-4">
            <button type="button" className="hover:text-slate-700" onClick={() => router.replace("/privacy")}>
              Privacy
            </button>
            <button type="button" className="hover:text-slate-700" onClick={() => router.replace("/terms")}>
              Terms
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}

function ProductScene() {
  return (
    <div className="absolute inset-0 flex items-center justify-end pr-8">
      <div className="w-[720px] rounded-lg border border-white/12 bg-slate-50 p-5 text-slate-950 shadow-[0_28px_90px_rgba(0,0,0,0.42)]">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <div className="text-sm font-semibold">Reconciliation cockpit</div>
            <div className="mt-1 text-xs text-slate-500">Flo Vapor and More Dallas • May 2026</div>
          </div>
          <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            Clean month
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {heroMetrics.map((metric) => (
            <div
              key={metric.label}
              className={
                metric.tone === "success"
                  ? "rounded-md border border-emerald-200 bg-emerald-50 p-4"
                  : "rounded-md border border-slate-200 bg-white p-4"
              }
            >
              <div className="text-xs text-slate-500">{metric.label}</div>
              <div className={metric.tone === "success" ? "mt-1 text-3xl font-semibold text-emerald-700" : "mt-1 text-3xl font-semibold text-slate-950"}>
                {metric.value}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          {ledgerRows.map((row) => (
            <div key={row.title} className="flex items-center justify-between gap-4 rounded-md border border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-950">{row.title}</div>
                <div className="mt-1 text-xs text-slate-500">{row.meta}</div>
              </div>
              <div
                className={
                  row.tone === "positive"
                    ? "shrink-0 text-sm font-semibold tabular-nums text-emerald-700"
                    : "shrink-0 text-sm font-semibold tabular-nums text-amber-700"
                }
              >
                {row.amount}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <PreviewChip icon={<BarChart3 className="h-4 w-4" />} label="Reports ready" />
          <PreviewChip icon={<Users className="h-4 w-4" />} label="Vendor context" />
          <PreviewChip icon={<BadgeCheck className="h-4 w-4" />} label="Audit visible" />
        </div>
      </div>
    </div>
  );
}

function HeroStat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-white/12 bg-white/7 p-4 backdrop-blur">
      <div className="text-3xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-sm font-semibold text-emerald-100">{label}</div>
      <div className="mt-1 text-xs text-slate-400">{note}</div>
    </div>
  );
}

function PreviewChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
      <span className="text-emerald-700">{icon}</span>
      {label}
    </div>
  );
}
