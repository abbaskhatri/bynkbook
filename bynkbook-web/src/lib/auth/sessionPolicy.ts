import { signOut } from "aws-amplify/auth";

const SESSION_STARTED_AT_KEY = "bynkbook.auth.sessionStartedAt";
const SESSION_LAST_ACTIVITY_KEY = "bynkbook.auth.lastActivityAt";

const DEFAULT_WEEKLY_IDLE_MINUTES = 7 * 24 * 60;
const DEFAULT_WEEKLY_MAX_HOURS = 7 * 24;

export type SessionExpiryReason = "idle" | "max_age" | "unknown";

function readPositiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const SESSION_IDLE_TIMEOUT_MS =
  readPositiveNumber(process.env.NEXT_PUBLIC_AUTH_IDLE_TIMEOUT_MINUTES, DEFAULT_WEEKLY_IDLE_MINUTES) * 60_000;

export const SESSION_MAX_AGE_MS =
  readPositiveNumber(process.env.NEXT_PUBLIC_AUTH_MAX_SESSION_HOURS, DEFAULT_WEEKLY_MAX_HOURS) * 60 * 60_000;

function readTimestamp(key: string): number | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeTimestamp(key: string, value: number) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(key, String(value));
  } catch {}
}

export function markSessionAuthenticated(now = Date.now()) {
  writeTimestamp(SESSION_STARTED_AT_KEY, now);
  writeTimestamp(SESSION_LAST_ACTIVITY_KEY, now);
}

export function recordSessionActivity(now = Date.now()) {
  if (!readTimestamp(SESSION_STARTED_AT_KEY)) return;
  writeTimestamp(SESSION_LAST_ACTIVITY_KEY, now);
}

export function clearSessionPolicyState() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(SESSION_STARTED_AT_KEY);
    window.localStorage.removeItem(SESSION_LAST_ACTIVITY_KEY);
  } catch {}
}

export function getSessionExpiryReason(now = Date.now()): SessionExpiryReason | null {
  const startedAt = readTimestamp(SESSION_STARTED_AT_KEY);
  const lastActivityAt = readTimestamp(SESSION_LAST_ACTIVITY_KEY);

  if (!startedAt || !lastActivityAt) return "unknown";
  if (now - startedAt > SESSION_MAX_AGE_MS) return "max_age";
  if (now - lastActivityAt > SESSION_IDLE_TIMEOUT_MS) return "idle";

  return null;
}

export async function signOutAndClearSession() {
  const redirectUrl = process.env.NEXT_PUBLIC_COGNITO_REDIRECT_SIGN_OUT;

  clearSessionPolicyState();

  try {
    await signOut({
      global: false,
      ...(redirectUrl ? { oauth: { redirectUrl } } : {}),
    });
  } finally {
    clearSessionPolicyState();
  }
}

export async function expireSessionIfNeeded() {
  const reason = getSessionExpiryReason();
  if (!reason) return null;

  if (reason === "unknown") {
    markSessionAuthenticated();
    return null;
  }

  await signOutAndClearSession().catch(() => {
    clearSessionPolicyState();
  });
  return reason;
}

export function sanitizeAuthNext(value: string | null | undefined, fallback = "/dashboard") {
  if (!value) return fallback;

  try {
    const url = new URL(value, "https://bynkbook.local");
    if (url.origin !== "https://bynkbook.local") return fallback;
    if (!url.pathname.startsWith("/")) return fallback;
    if (url.pathname.startsWith("//")) return fallback;

    return `${url.pathname}${url.search}${url.hash}` || fallback;
  } catch {
    return fallback;
  }
}

export function sessionExpiredLoginUrl(reason: SessionExpiryReason, nextUrl: string) {
  const params = new URLSearchParams({
    reason,
    next: sanitizeAuthNext(nextUrl),
  });
  return `/login?${params.toString()}`;
}
