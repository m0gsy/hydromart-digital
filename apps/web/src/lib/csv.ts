import { saveFile } from './platform';

// Client-side CSV for the bulk-import wizard: the browser parses the file and
// posts typed JSON, so no service needs a CSV parser or a multipart route.
// Mirrors services/hr-service/src/domain/csv.ts on the write side (that one is
// server-only — different package, nothing to import).

export type CsvCell = string | number | null | undefined;
export type CsvRecord = Record<string, string>;

/**
 * Pick the separator from the header line. Excel on an Indonesian (or most European)
 * locale saves CSV with ';' — assuming ',' turns the whole file into one column.
 * Counts only separators OUTSIDE quotes so a quoted header can't skew the vote.
 */
export function detectDelimiter(text: string): string {
  const header = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? '';
  const counts = new Map<string, number>([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ]);
  let quoted = false;
  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && counts.has(ch)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best = ',';
  for (const [candidate, count] of counts) {
    if (count > (counts.get(best) ?? 0)) best = candidate;
  }
  return best;
}

/**
 * RFC-4180 parse. Handles quoted cells containing the separator, CRLF/LF newlines and
 * escaped `""` quotes; strips a leading UTF-8 BOM (Excel writes one). The separator is
 * auto-detected unless given.
 */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
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
    } else if (ch === delimiter) {
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

/**
 * Trigger a download of `blob` as `filename`. The single download path in the app —
 * four screens used to hand-roll their own object URL and so were invisible to any
 * change made here, including the native one below.
 */
/**
 * Extensions for the types this app actually hands back, so a saved file opens.
 *
 * A name with no suffix is a file Windows and Android will not open: the attendance photo
 * saved as `absensi-2026-08-18-in` and an employee document as `KTP-v1`, both real JPEGs
 * and PDFs that looked like nothing at all. Every other caller already spells its own
 * extension; these two could not, because the type is only known once the bytes arrive.
 */
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/pdf': '.pdf',
  'text/csv': '.csv',
  'application/json': '.json',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

/**
 * `filename`, plus the extension its bytes say they need — and nothing when it already has
 * one, or when the type is not one we can name. Guessing an extension is worse than leaving
 * it off: a `.jpg` that is really a PDF opens to an error instead of to nothing.
 */
function withExtension(filename: string, blob: Blob): string {
  if (/\.[a-z0-9]{2,5}$/i.test(filename)) return filename;
  // `image/jpeg; charset=…` is a legal content type; the parameters are not part of it.
  const ext = EXT_BY_TYPE[blob.type.split(';')[0]!.trim().toLowerCase()];
  return ext ? `${filename}${ext}` : filename;
}

export function downloadBlob(rawName: string, blob: Blob): void {
  const filename = withExtension(rawName, blob);
  // An Android WebView has no download manager listening for the synthetic click, so
  // the user would get no file and no error. F3 writes it out instead.
  if (saveFile(filename, blob)) return;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Download `csv` as `filename`. BOM so Excel reads it as UTF-8. */
export function downloadCsv(filename: string, csv: string): void {
  downloadBlob(filename, new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
}
