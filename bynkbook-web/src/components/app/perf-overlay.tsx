"use client";

// Dev-only performance overlay. Stripped from production bundles via the
// process.env.NODE_ENV check below — the entire component returns null
// in production so React never mounts it and tree-shaking can drop it.

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { metrics, type PerfSnapshot } from "@/lib/perf/metrics";

const STORAGE_KEY = "bynkbook.debug.perfOverlay";

function readEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeEnabled(v: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
  } catch {}
}

export function PerfOverlay() {
  // Hard-strip from production. The bundler can DCE this whole component.
  if (process.env.NODE_ENV === "production") return null;

  return <PerfOverlayInner />;
}

function PerfOverlayInner() {
  const pathname = usePathname();
  const qc = useQueryClient();

  const [enabled, setEnabled] = useState(false);
  const [snap, setSnap] = useState<PerfSnapshot>({ api: [], ui: [], counters: {} });
  const [navMs, setNavMs] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const prevPathRef = useRef<string>(pathname);
  const navStartRef = useRef<number | null>(null);

  useEffect(() => {
    setEnabled(readEnabled());
  }, []);

  // Alt+P to toggle (does not conflict with browser shortcuts).
  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.altKey && !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && ev.key.toLowerCase() === "p") {
        ev.preventDefault();
        setEnabled((v) => {
          const next = !v;
          writeEnabled(next);
          return next;
        });
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Time route changes: from pathname-change start until next animation frame.
  useEffect(() => {
    if (pathname !== prevPathRef.current) {
      navStartRef.current = performance.now();
      prevPathRef.current = pathname;
      const raf = requestAnimationFrame(() => {
        if (navStartRef.current != null) {
          setNavMs(performance.now() - navStartRef.current);
          navStartRef.current = null;
        }
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [pathname]);

  // Poll the snapshot at a low rate so the overlay doesn't itself become slow.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setSnap(metrics.getSnapshot()), 1000);
    return () => clearInterval(id);
  }, [enabled]);

  if (!enabled) return null;

  const cacheEntries = qc.getQueryCache().getAll().length;
  const fetchingCount = qc.isFetching();
  const mutatingCount = qc.isMutating();

  const topApi = snap.api.slice(0, 6);
  const topUi = snap.ui.slice(0, 4);

  return (
    <div
      className="fixed bottom-3 right-3 z-[9999] font-mono text-[11px] leading-tight pointer-events-auto"
      style={{ width: collapsed ? 140 : 360 }}
    >
      <div className="rounded-md border border-bb-border bg-bb-surface-elevated shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-2 py-1 border-b border-bb-border bg-bb-surface-soft">
          <div className="font-semibold text-foreground/90">perf · {pathname}</div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="px-1.5 py-0.5 text-foreground/70 hover:text-foreground border border-bb-border rounded"
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? "+" : "−"}
            </button>
            <button
              type="button"
              className="px-1.5 py-0.5 text-foreground/70 hover:text-foreground border border-bb-border rounded"
              onClick={() => metrics.reset()}
              title="Reset samples"
            >
              ↻
            </button>
            <button
              type="button"
              className="px-1.5 py-0.5 text-foreground/70 hover:text-foreground border border-bb-border rounded"
              onClick={() => {
                writeEnabled(false);
                setEnabled(false);
              }}
              title="Hide (Alt+P)"
            >
              ×
            </button>
          </div>
        </div>

        {!collapsed ? (
          <div className="p-2 space-y-2 max-h-[60vh] overflow-auto">
            <div className="grid grid-cols-3 gap-1">
              <Stat label="route" value={navMs != null ? `${navMs.toFixed(0)}ms` : "—"} />
              <Stat label="cache" value={String(cacheEntries)} />
              <Stat label="fetching" value={`${fetchingCount}/${mutatingCount}m`} />
            </div>

            <section>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">slowest API (p95)</div>
              {topApi.length === 0 ? (
                <div className="text-muted-foreground">no samples yet</div>
              ) : (
                <ul className="space-y-0.5">
                  {topApi.map((s) => (
                    <li key={s.name} className="flex items-center justify-between gap-2">
                      <span className="truncate text-foreground/80" title={s.name}>{s.name}</span>
                      <span className={s.p95 > 800 ? "text-bb-amount-negative tabular-nums" : "tabular-nums text-foreground/80"}>
                        {s.p95.toFixed(0)}ms · n{s.n}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {topUi.length > 0 ? (
              <section>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">UI work (p95)</div>
                <ul className="space-y-0.5">
                  {topUi.map((s) => (
                    <li key={s.name} className="flex items-center justify-between gap-2">
                      <span className="truncate text-foreground/80" title={s.name}>{s.name}</span>
                      <span className="tabular-nums text-foreground/80">{s.p95.toFixed(0)}ms · n{s.n}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="text-[10px] text-muted-foreground border-t border-bb-border-muted pt-1">
              Alt+P toggles. Resets per page reload.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-bb-border bg-bb-surface-card px-1.5 py-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-[11px] tabular-nums text-foreground">{value}</div>
    </div>
  );
}
