export function userFacingErrorMessage(error: any, fallback = "Something went wrong. Try again.") {
  const status = Number(
    error?.status ??
    error?.statusCode ??
    error?.response?.status ??
    error?.payload?.status ??
    NaN
  );

  const raw = String(
    error?.message ??
    error?.response?.data?.message ??
    error?.payload?.message ??
    ""
  ).toLowerCase();

  if (status === 401 || raw.includes("unauthorized") || raw.includes("session expired")) {
    return "Your session expired. Please sign in again.";
  }

  if (status === 403 || raw.includes("forbidden")) {
    return "You don’t have access to do that.";
  }

  if (status === 404 || raw.includes("not found")) {
    return "That item could not be found.";
  }

  if (status === 409 || raw.includes("closed_period")) {
    return "This item is in a closed period and can’t be changed.";
  }

  if (status === 429 || raw.includes("rate limit") || raw.includes("too many requests") || raw.includes("quota")) {
    return "AI is busy right now. Try again shortly.";
  }

  if (
    status >= 500 ||
    raw.includes("internal server error") ||
    raw.includes("failed to fetch") ||
    raw.includes("cors") ||
    raw.includes("networkerror")
  ) {
    return fallback;
  }

  return fallback;
}