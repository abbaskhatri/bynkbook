export function safeCsvCell(value: any) {
  const raw = value === null || value === undefined ? "" : String(value);
  const safe = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function safeCsvRow(values: any[]) {
  return values.map(safeCsvCell).join(",");
}
