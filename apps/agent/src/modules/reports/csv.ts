/**
 * Serialización CSV (US-109) — RFC 4180: campos con comas, comillas o saltos de
 * línea se entrecomillan y las comillas internas se duplican; líneas con CRLF.
 * Puro y testeable.
 */

export type CsvValue = string | number | boolean | null | undefined;

/**
 * Neutraliza la **inyección de fórmulas** (CSV/Formula Injection): Excel y
 * LibreOffice evalúan como fórmula cualquier celda que empiece por `= + - @` (o
 * TAB/CR). Campos como el `hostname`/`label` de un dispositivo los controla un
 * tercero que conecte hardware hostil a la red (los anuncia por DHCP/mDNS), así
 * que un `=HYPERLINK(...)`/`=cmd|...` acabaría ejecutándose al abrir el export.
 * Se antepone un apóstrofo, que fuerza a la hoja de cálculo a tratar la celda como
 * texto literal (y luego se aplica el entrecomillado RFC 4180 normal).
 */
function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const s = neutralizeFormula(String(value));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeField).join(',')).join('\r\n') + '\r\n';
}
