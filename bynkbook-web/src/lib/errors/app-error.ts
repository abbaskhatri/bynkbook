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

export function appErrorMessageOrNull(e: unknown): string | null {
  if (!e) return null;

  const status = extractHttpStatus(e);

  if (status === 401) return "Session expired. Please sign in again.";
  if (status === 403) return "You don’t have access to this business.";

  return "Something went wrong. Try again.";
}
