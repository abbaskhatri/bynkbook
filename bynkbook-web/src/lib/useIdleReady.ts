"use client";

import { useEffect, useState } from "react";

export function useIdleReady(enabled: boolean, timeoutMs = 1200) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;

    const markReady = () => {
      if (!cancelled) setReady(true);
    };

    const w = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof w.requestIdleCallback === "function") {
      idleId = w.requestIdleCallback(markReady, { timeout: timeoutMs });
    } else {
      timeoutId = setTimeout(markReady, Math.min(timeoutMs, 800));
    }

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (idleId !== null && typeof w.cancelIdleCallback === "function") {
        w.cancelIdleCallback(idleId);
      }
    };
  }, [enabled, timeoutMs]);

  return enabled && ready;
}
