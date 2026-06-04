export function extractHttpStatus(e: unknown): number | null {
  const anyE: any = e as any;

  const direct =
    anyE?.status ??
    anyE?.statusCode ??
    anyE?.response?.status ??
    anyE?.cause?.status ??
    anyE?.cause?.statusCode ??
    null;

  const n = Number(direct);
  if (Number.isFinite(n) && n > 0) return n;

  const msg = String(anyE?.message ?? anyE ?? "");
  // apiFetch throws: "API 401: ..."
  const m = msg.match(/\bAPI\s+(\d{3})\b/);
  if (m?.[1]) {
    const code = Number(m[1]);
    if (Number.isFinite(code)) return code;
  }

  // Fallback patterns
  if (/\b401\b/.test(msg)) return 401;
  if (/\b403\b/.test(msg)) return 403;

  return null;
}

function extractApiCode(e: unknown): string | null {
  const anyE: any = e as any;
  return (
    anyE?.code ??
    anyE?.payload?.code ??
    (typeof anyE?.message === "string" && anyE.message.includes("CLOSED_PERIOD") ? "CLOSED_PERIOD" : null) ??
    null
  );
}

function formatMatchedBankTransaction(e: unknown): string {
  const bank = (e as any)?.payload?.bankTransaction;
  if (!bank) return "";

  const parts: string[] = [];
  const date = typeof bank.date === "string" ? bank.date.trim() : "";
  const name = typeof bank.name === "string" ? bank.name.trim() : "";
  if (date) parts.push(date);
  if (name) parts.push(name);

  const rawCents = String(bank.amount_cents ?? "").trim();
  if (/^-?\d+$/.test(rawCents)) {
    const cents = Number(rawCents);
    if (Number.isSafeInteger(cents)) {
      const amount = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(cents / 100);
      parts.push(amount);
    }
  }

  return parts.length ? ` Matched bank transaction: ${parts.join(" · ")}.` : "";
}

/**
 * Always returns a string. Use when the call site needs a definite message
 * (e.g. for a banner / toast). Walks status/message patterns to pick a
 * user-friendly line, falling back to `fallback` if nothing matches.
 *
 * Prefer `appErrorMessageOrNull` for the common "show fallback if null"
 * pattern — this helper exists for call sites that want the full pattern
 * matching against status + raw message text.
 */
export function userFacingErrorMessage(
  error: any,
  fallback = "Something went wrong. Try again."
): string {
  const status = Number(
    error?.status ??
      error?.statusCode ??
      error?.response?.status ??
      error?.payload?.status ??
      extractApiStatusFromMessage(error?.message) ??
      NaN
  );

  const apiMessage = extractApiMessage(error);
  const raw = String(
    error?.message ?? error?.response?.data?.message ?? error?.payload?.message ?? ""
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

  if (
    status === 429 ||
    raw.includes("rate limit") ||
    raw.includes("too many requests") ||
    raw.includes("quota")
  ) {
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

function extractApiStatusFromMessage(message: unknown): number | null {
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

export function appErrorMessageOrNull(e: unknown): string | null {
  if (!e) return null;

  const anyE: any = e as any;
  const status = extractHttpStatus(e);
  const code = extractApiCode(e);

  if (status === 401) return "Session expired. Please sign in again.";
  if (status === 403) return "You don’t have access to this business.";

  // CPA-clean, consistent message everywhere
  if (status === 409 && code === "CLOSED_PERIOD") {
    return "This period is closed. Reopen period to modify.";
  }

  // Debuggable close-through guard
  if (status === 409 && code === "CANNOT_CLOSE_BEYOND_TODAY") {
    const st = anyE?.payload?.server_today ? ` (Server today: ${anyE.payload.server_today})` : "";
    return `Cannot close beyond today.${st}`;
  }

  if (status === 409 && code === "ENTRY_MATCHED_REQUIRES_UNMATCH") {
    return (
      "This entry is matched to a bank transaction. Unmatch or revert the match before deleting it." +
      formatMatchedBankTransaction(e)
    );
  }

  return "Something went wrong. Try again.";
}
