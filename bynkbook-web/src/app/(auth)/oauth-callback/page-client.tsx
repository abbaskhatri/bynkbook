"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchAuthSession, getCurrentUser } from "aws-amplify/auth";

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

export default function OAuthCallbackClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const nextFromQuery = useMemo(() => sp.get("next"), [sp]);
  const [msg, setMsg] = useState("Finishing sign-in…");

  useEffect(() => {
    (async () => {
      try {
        await sleep(150);
        await withTimeout(fetchAuthSession(), 8000);
        await withTimeout(getCurrentUser(), 8000);

        const stored = typeof window !== "undefined" ? window.sessionStorage.getItem(NEXT_KEY) : null;
        if (typeof window !== "undefined") window.sessionStorage.removeItem(NEXT_KEY);

        const next = nextFromQuery ?? stored ?? "/dashboard";
        router.replace(next);
      } catch (e: any) {
        try {
          setMsg("Finishing sign-in… (retrying)");
          await sleep(600);
          await withTimeout(fetchAuthSession(), 8000);
          await withTimeout(getCurrentUser(), 8000);

          const stored = typeof window !== "undefined" ? window.sessionStorage.getItem(NEXT_KEY) : null;
          if (typeof window !== "undefined") window.sessionStorage.removeItem(NEXT_KEY);

          const next = nextFromQuery ?? stored ?? "/dashboard";
          router.replace(next);
          return;
        } catch {
          const message = e?.message ?? "Sign-in failed. Please try again.";
          setMsg(message);
          setTimeout(() => router.replace("/login"), 900);
        }
      }
    })();
  }, [router, nextFromQuery]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="text-sm text-slate-600">{msg}</div>
    </div>
  );
}
