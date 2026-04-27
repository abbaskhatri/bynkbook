export function normalizeDateOnly(input: unknown): string {
  if (input === undefined || input === null) return "";

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return "";
    return input.toISOString().slice(0, 10);
  }

  const s = String(input).trim();
  if (!s) return "";

  const prefix = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (prefix) return `${prefix[1]}-${prefix[2]}-${prefix[3]}`;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function formatDateOnlyShort(input: unknown): string {
  const ymd = normalizeDateOnly(input);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";

  return `${m[2]}/${m[3]}/${m[1].slice(-2)}`;
}
