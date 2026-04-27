export function normalizeDateOnly(input: unknown): string | null {
  if (input === undefined || input === null) return null;

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return input.toISOString().slice(0, 10);
  }

  const s = String(input).trim();
  if (!s) return null;

  const prefix = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (prefix) return `${prefix[1]}-${prefix[2]}-${prefix[3]}`;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function parseDateOnlyToUtcDate(input: unknown): Date | null {
  const ymd = normalizeDateOnly(input);
  if (!ymd) return null;

  const d = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function serializeDateOnly(input: unknown): string | null {
  return normalizeDateOnly(input);
}
