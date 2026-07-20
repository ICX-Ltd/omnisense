// Small client-side CSV export — no backend, no dependency. Turns an array of
// plain objects into a CSV string and triggers a browser download.

export function toCsv(rows: Array<Record<string, any>>, columns?: string[]): string {
  if (!rows.length) return "";
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: any) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    // Quote if it contains a comma, quote or newline; double up embedded quotes.
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = cols.join(",");
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\r\n");
  return head + "\r\n" + body;
}

export function downloadCsv(
  filename: string,
  rows: Array<Record<string, any>>,
  columns?: string[],
) {
  const csv = toCsv(rows, columns);
  // Prepend a BOM so Excel opens UTF-8 correctly (£ signs, accented names).
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
