export function safeCsvCell(v: any) {
  const raw = String(v ?? "");
  const s = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function downloadCsv(filename: string, headers: string[], rows: any[][]) {
  const lines = [
    headers.map(safeCsvCell).join(","),
    ...rows.map((r) => r.map(safeCsvCell).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

export function slugifyFilenamePart(value: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "ledger";
}
