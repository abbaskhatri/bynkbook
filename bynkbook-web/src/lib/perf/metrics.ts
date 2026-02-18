const API_SAMPLES: Record<string, number[]> = {};
const UI_SAMPLES: Record<string, number[]> = {};
const COUNTERS: Record<string, number> = {};

// Debug toggle (default OFF)
// Enable via: localStorage.setItem("bynkbook.debug.perf","1") + refresh
// or: window.__BYNK_DEBUG__ = { perf: true } + refresh
function debugPerfOn(): boolean {
  try {
    const w: any = typeof window !== "undefined" ? (window as any) : null;
    if (w?.__BYNK_DEBUG__?.perf) return true;
    return localStorage.getItem("bynkbook.debug.perf") === "1";
  } catch {
    return false;
  }
}

function dlog(...args: any[]) {
  if (!debugPerfOn()) return;
  if (process.env.NODE_ENV === "production") return;
  // eslint-disable-next-line no-console
  console.log(...args);
}

function pushSample(store: Record<string, number[]>, name: string, ms: number) {
  const arr = (store[name] ??= []);
  arr.push(ms);
  if (arr.length > 200) arr.splice(0, arr.length - 200);
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

function logSummary(name: string, values: number[]) {
  const p50 = percentile(values, 50);
  const p95 = percentile(values, 95);
  if (p50 == null || p95 == null) return;
  dlog(`[perf] ${name} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms n=${values.length}`);
}

export const metrics = {
  timeUi(name: string, startMs: number) {
    const ms = performance.now() - startMs;
    pushSample(UI_SAMPLES, name, ms);
    dlog(`[ui] ${name} ${ms.toFixed(1)}ms`);
    logSummary(name, UI_SAMPLES[name]);
  },

  api(name: string, ms: number, status?: number) {
    pushSample(API_SAMPLES, name, ms);
    dlog(`[api] ${name} ${ms.toFixed(1)}ms status=${status ?? "?"}`);
    logSummary(name, API_SAMPLES[name]);
  },

  incCounter(name: string, by = 1) {
    COUNTERS[name] = (COUNTERS[name] ?? 0) + by;
    dlog(`[rq] ${name} count=${COUNTERS[name]}`);
  },

  resetCounters() {
    for (const k of Object.keys(COUNTERS)) COUNTERS[k] = 0;
  },
};
