export function userFacingErrorMessage(error: any, fallback = "Something went wrong. Try again.") {
  const status = Number(
    error?.status ??
    error?.statusCode ??
    error?.response?.status ??
    error?.payload?.status ??
    extractApiStatus(error?.message) ??
    NaN
  );

  const apiMessage = extractApiMessage(error);
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
    if (apiMessage) return apiMessage;
    return "You don’t have access to do that.";
  }

  if (status === 404 || raw.includes("not found")) {
    if (apiMessage) return apiMessage;
    return "That item could not be found.";
  }

  if (raw.includes("closed_period")) {
    return "This item is in a closed period and can’t be changed.";
  }

  if (status === 400 || status === 409) {
    if (apiMessage) return apiMessage;
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

function extractApiStatus(message: unknown): number | null {
  const raw = String(message ?? "");
  const match = raw.match(/\bAPI\s+(\d{3})\b/);
  if (!match?.[1]) return null;
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

function extractApiMessage(error: any): string | null {
  if (String(error?.payload?.code ?? error?.response?.data?.code ?? "") === "POLICY_DENIED") {
    return "Role policy does not allow this action.";
  }

  const direct =
    error?.response?.data?.message ??
    error?.response?.data?.error ??
    error?.payload?.message ??
    error?.payload?.error ??
    error?.message;

  const directMessage = readableMessage(direct);
  if (directMessage && !directMessage.startsWith("API ")) return directMessage;

  const raw = String(error?.message ?? "");
  const match = raw.match(/\bAPI\s+\d{3}:\s*(.+)$/s);
  if (!match?.[1]) return null;

  const body = match[1].trim();
  try {
    const parsed = JSON.parse(body);
    if (String(parsed?.code ?? "") === "POLICY_DENIED") {
      return "Role policy does not allow this action.";
    }
    return readableMessage(parsed?.message ?? parsed?.error);
  } catch {
    return readableMessage(body);
  }
}

function readableMessage(value: unknown): string | null {
  const message = String(value ?? "").trim();
  if (!message) return null;
  if (message.startsWith("{") || message.startsWith("[")) return null;
  return message;
}
