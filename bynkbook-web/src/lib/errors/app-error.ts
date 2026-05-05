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
