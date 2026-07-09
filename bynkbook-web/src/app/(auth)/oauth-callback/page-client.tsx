"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";
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

async function waitForOAuthSession(onRetrying: () => void, timeoutMs = 30000) {
  const startedAt = Date.now();
  let attempts = 0;
  let lastError: unknown = null;

  while (Date.now() - startedAt < timeoutMs) {
    attempts += 1;

    try {
      await withTimeout(fetchAuthSession(), 6000);
      await withTimeout(getCurrentUser(), 6000);
      return;
    } catch (error) {
      lastError = error;
      if (attempts === 2) onRetrying();
      await sleep(600);
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

  useEffect(() => {
    (async () => {
      try {
        await sleep(150);
        await waitForOAuthSession(() => setMsg("Finishing sign-in… (retrying)"));
        markSessionAuthenticated();

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
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-sm text-slate-600">{msg}</div>
    </div>
  );
}
