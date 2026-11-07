export type CsvCell = string | number | null | undefined;

/**
 * RFC-4180 field: quote when it holds a comma, quote, CR or LF; double embedded quotes.
 *
 * HR-22: TEXT that starts with `=`, `+`, `-`, `@`, tab or CR is a formula to Excel and Sheets,
 * and these exports carry names, notes and reasons typed by staff and customers. A leading
 * apostrophe makes the cell show what was typed and evaluate nothing. Numbers are left alone
 * so a negative amount stays a number. Same rule as admin-service/src/domain/report-file.ts.
 */
function escapeCell(value: CsvCell): string {
  if (value == null) return '';
  const s = String(value);
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Build a CSV document (CRLF line endings) from a header row + data rows. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\r\n');
}
