"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
import { CheckCircle2, ShieldCheck } from "lucide-react";

import BrandLogo from "@/components/app/BrandLogo";
import { markSessionAuthenticated, sanitizeAuthNext } from "@/lib/auth/sessionPolicy";

const NEXT_KEY = "bb_auth_next";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return (await Promise.race([
    p,
    (async () => {
      await sleep(ms);
      throw new Error("Timed out finishing sign-in. Please try again.");
    })(),
  ])) as T;
}

async function waitForOAuthUser(onRetrying: () => void, timeoutMs = 10000) {
  const startedAt = Date.now();
  let attempts = 0;
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1;

    try {
      await withTimeout(getCurrentUser(), 2500);
      return;
    } catch (error) {
      lastError = error;
      if (attempts === 4) onRetrying();
      await sleep(attempts < 5 ? 150 : 500);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out finishing sign-in. Please try again.");
}

export default function OAuthCallbackClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const nextFromQuery = useMemo(() => sanitizeAuthNext(sp.get("next"), ""), [sp]);
  const [msg, setMsg] = useState("Finishing sign-in…");
  const isRetrying = msg.includes("retrying");
  const isError = !msg.startsWith("Finishing sign-in");

  const title = isError
    ? "Sign-in needs another try"
    : isRetrying
      ? "Still securing your workspace"
      : "Opening your BynkBook workspace";
  const body = isError
    ? msg
    : isRetrying
      ? "Google is verified. We are giving Cognito one more moment to finish the handoff."
      : "Google is verified. We are getting your books ready.";

  useEffect(() => {
    (async () => {
      try {
        await waitForOAuthUser(() => setMsg("Finishing sign-in… (retrying)"));
        markSessionAuthenticated();
        void fetchAuthSession().catch(() => {});

        const stored = typeof window !== "undefined" ? window.sessionStorage.getItem(NEXT_KEY) : null;
        if (typeof window !== "undefined") window.sessionStorage.removeItem(NEXT_KEY);

        const next = sanitizeAuthNext(nextFromQuery || stored, "/dashboard");
        router.replace(next);
      } catch (e: any) {
        const message = e?.message ?? "Sign-in failed. Please try again.";
        setMsg(message);
        setTimeout(() => router.replace("/login"), 1400);
      }
    })();
  }, [router, nextFromQuery]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07111f] px-4 py-8 text-white sm:px-6">
      <div className="absolute inset-0 opacity-[0.14] [background-image:linear-gradient(rgba(255,255,255,.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.16)_1px,transparent_1px)] [background-size:48px_48px]" />

      <section className="relative z-10 flex w-full max-w-xl flex-col items-center gap-6 text-center">
        <BrandLogo size="md" tone="light" priority className="sm:hidden" />
        <BrandLogo size="lg" tone="light" priority className="hidden sm:inline-flex" />

        <div className="w-full rounded-[28px] border border-white/12 bg-[#111d2e]/95 px-6 py-7 shadow-[0_28px_80px_rgba(0,0,0,0.34)] backdrop-blur sm:px-9 sm:py-9">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 text-xs font-semibold tracking-wide text-emerald-100">
            <span className="h-2 w-2 rounded-full bg-emerald-300" />
            Google sign-in secured
          </div>

          <div className="mx-auto mt-7 flex h-20 w-20 items-center justify-center rounded-full border border-emerald-300/25 bg-emerald-300/10 shadow-[0_0_34px_rgba(52,211,153,0.22)] sm:h-24 sm:w-24">
            {isError ? (
              <ShieldCheck className="h-8 w-8 text-amber-200" />
            ) : (
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-emerald-300/30">
                <div className="absolute inset-0 rounded-full border-2 border-emerald-300/20 border-t-emerald-300 motion-safe:animate-spin" />
                <CheckCircle2 className="h-6 w-6 text-emerald-200" />
              </div>
            )}
          </div>

          <h1 className="mt-7 text-2xl font-semibold leading-tight tracking-tight text-white sm:text-3xl">
            {title}
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm leading-7 text-slate-300 sm:text-base">
            {body}
          </p>

          <div className="mx-auto mt-7 max-w-md">
            <div className="h-2 overflow-hidden rounded-full border border-white/10 bg-[#0b1626]">
              <div
                className={[
                  "h-full rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(52,211,153,0.42)] transition-all duration-500",
                  isError ? "w-full bg-amber-300" : isRetrying ? "w-4/5 motion-safe:animate-pulse" : "w-3/5 motion-safe:animate-pulse",
                ].join(" ")}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px] font-medium text-slate-400 sm:text-xs">
              <span className="text-emerald-100">Google verified</span>
              <span>{isError ? "Returning to sign in" : "Opening workspace"}</span>
            </div>
          </div>
        </div>

        <p className="max-w-md text-xs font-medium leading-6 text-slate-500 sm:text-sm">
          Protected by AWS Cognito and BynkBook session controls.
        </p>
      </section>
    </main>
  );
}
