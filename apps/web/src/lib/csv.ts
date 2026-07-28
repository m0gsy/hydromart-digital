// Client-side CSV for the bulk-import wizard: the browser parses the file and
// posts typed JSON, so no service needs a CSV parser or a multipart route.
// Mirrors services/hr-service/src/domain/csv.ts on the write side (that one is
// server-only — different package, nothing to import).

export type CsvCell = string | number | null | undefined;
export type CsvRecord = Record<string, string>;

/**
 * RFC-4180 parse. Handles quoted cells containing commas, CRLF/LF newlines and
 * escaped `""` quotes; strips a leading UTF-8 BOM (Excel writes one).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');

  const endCell = () => {
    row.push(cell);
    cell = '';
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        // A doubled quote is a literal quote; a lone one closes the cell.
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      endCell();
    } else if (ch === '\r') {
      // swallow — the \n that follows ends the row (a lone \r ends it too)
      if (src[i + 1] !== '\n') endRow();
    } else if (ch === '\n') {
      endRow();
    } else {
      cell += ch;
    }
  }
  // Trailing newline leaves nothing pending; anything else is a final row.
  if (cell !== '' || row.length > 0) endRow();

  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * Parse into header-keyed records. Header cells are trimmed and used verbatim;
 * values are trimmed. Rows shorter than the header get empty strings.
 */
export function parseCsvRecords(text: string): CsvRecord[] {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((cells) =>
    Object.fromEntries(keys.map((key, i) => [key, (cells[i] ?? '').trim()])),
  );
}

/** RFC-4180 field: quote when it holds a comma, quote, CR or LF; double embedded quotes. */
function escapeCell(value: CsvCell): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV document (CRLF line endings) from a header row + data rows. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((r) => r.map(escapeCell).join(',')).join('\r\n');
}

/** Trigger a browser download of `csv` as `filename`. BOM so Excel reads UTF-8. */
export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
