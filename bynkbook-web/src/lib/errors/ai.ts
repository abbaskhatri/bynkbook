// Canonical AI-error → user-message helper.
//
// Previously this same logic was duplicated 3 times across:
//   - lib/reconcile/helpers.ts   (aiUiMessage)
//   - app/(app)/dashboard/...    (dashboardAiMessage)
//   - app/(app)/ledger/...        (aiFriendlyMessage)
//
// Each implementation did roughly the same thing — detect 429 / quota /
// rate-limit signals in the error and substitute a friendly message —
// but with slightly different wording. They now all delegate here.

export type AiUserMessageOptions = {
  /** Returned when the error doesn't look like a quota/rate-limit issue. */
  fallback?: string;
  /** Returned when the error DOES look like a quota/rate-limit issue. */
  quotaMessage?: string;
};

/**
 * Map any thrown error from an AI call to a user-facing string.
 *
 * Detects 429 in HTTP status or these keywords in the error message:
 *   "quota", "rate limit", "too many requests"
 *
 * Returns `quotaMessage` (defaults to "AI quota reached. Try again later.")
 * when those signals are present; otherwise returns `fallback` (defaults to
 * "AI is unavailable right now.").
 */
export function aiUserMessage(err: unknown, opts?: AiUserMessageOptions): string {
  const e = err as any;
  const status = Number(
    e?.status ?? e?.statusCode ?? e?.response?.status ?? NaN
  );
  const raw = String(
    e?.message ??
    e?.payload?.message ??
    e?.response?.data?.message ??
    ""
  ).toLowerCase();

  const isQuota =
    status === 429 ||
    raw.includes("429") ||
    raw.includes("quota") ||
    raw.includes("rate limit") ||
    raw.includes("too many requests");

  if (isQuota) {
    return opts?.quotaMessage ?? "AI quota reached. Try again later.";
  }
  return opts?.fallback ?? "AI is unavailable right now.";
}
