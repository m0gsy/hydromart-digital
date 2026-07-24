export type CsvCell = string | number | null | undefined;

/** RFC-4180 field: quote when it holds a comma, quote, CR or LF; double embedded quotes. */
function escapeCell(value: CsvCell): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV document (CRLF line endings) from a header row + data rows. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
}
