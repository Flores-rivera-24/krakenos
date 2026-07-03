/**
 * Serialización CSV (US-109) — RFC 4180: campos con comas, comillas o saltos de
 * línea se entrecomillan y las comillas internas se duplican; líneas con CRLF.
 * Puro y testeable.
 */

export type CsvValue = string | number | boolean | null | undefined;

function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeField).join(',')).join('\r\n') + '\r\n';
}
