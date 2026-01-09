const API_SAMPLES: Record<string, number[]> = {};
const UI_SAMPLES: Record<string, number[]> = {};
const COUNTERS: Record<string, number> = {};

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
  console.log(`[perf] ${name} p50=${p50.toFixed(1)}ms p95=${p95.toFixed(1)}ms n=${values.length}`);
}

export const metrics = {
  timeUi(name: string, startMs: number) {
    const ms = performance.now() - startMs;
    pushSample(UI_SAMPLES, name, ms);
    console.log(`[ui] ${name} ${ms.toFixed(1)}ms`);
    logSummary(name, UI_SAMPLES[name]);
  },

  api(name: string, ms: number, status?: number) {
    pushSample(API_SAMPLES, name, ms);
    console.log(`[api] ${name} ${ms.toFixed(1)}ms status=${status ?? "?"}`);
    logSummary(name, API_SAMPLES[name]);
  },

  incCounter(name: string, by = 1) {
    COUNTERS[name] = (COUNTERS[name] ?? 0) + by;
    console.log(`[rq] ${name} count=${COUNTERS[name]}`);
  },

  resetCounters() {
    for (const k of Object.keys(COUNTERS)) COUNTERS[k] = 0;
  },
};
