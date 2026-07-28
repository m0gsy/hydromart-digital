// .xlsx side of the bulk-import wizard. exceljs is loaded lazily (dynamic import)
// so only the import pages pay for it — every other route stays untouched.
//
// Why xlsx at all when CSV already works: a spreadsheet carries cell TYPES and cell
// FORMATS. Types kill the "is 150.000 a hundred-fifty-thousand or 150.0?" guesswork
// CSV forces, and formats let the template we hand out pre-mark the phone column as
// Text — which is what stops Excel turning a long number into 8.12E+10 and losing
// digits for real.

import type { CsvRecord } from './csv';

export interface TemplateColumn {
  key: string;
  example: string;
  /** Enum values — become a dropdown in the template so typos never reach us. */
  options?: readonly string[];
  /** Format this column as Text so Excel keeps it verbatim (phone numbers, codes). */
  text?: boolean;
}

/** Rows the wizard can validate; row 1 is the header. Blank rows are dropped. */
const TEMPLATE_VALIDATION_ROWS = 500;

async function excel() {
  return (await import('exceljs')).default;
}

/** A cell can be text, a number, a date, rich text, a hyperlink or a formula result. */
function cellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const obj = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join('');
    if (obj.text != null) return cellText(obj.text);
    if (obj.result != null) return cellText(obj.result);
    return '';
  }
  return String(value).trim();
}

/** Read the first worksheet into the same header-keyed records the CSV path produces. */
export async function parseXlsxRecords(file: File): Promise<CsvRecord[]> {
  const ExcelJS = await excel();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  // exceljs row.values is 1-indexed with a hole at [0].
  const header = (sheet.getRow(1).values as unknown[]).slice(1).map(cellText);
  if (header.length === 0) return [];

  const records: CsvRecord[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = (row.values as unknown[]).slice(1);
    const record = Object.fromEntries(header.map((key, i) => [key, cellText(cells[i])]));
    if (Object.values(record).some((v) => v !== '')) records.push(record);
  });
  return records;
}

/** Build the downloadable template: header + one example row, formats and dropdowns applied. */
export async function buildTemplateXlsx(
  columns: readonly TemplateColumn[],
  sheetName: string,
): Promise<Blob> {
  const ExcelJS = await excel();
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  sheet.addRow(columns.map((c) => c.key));
  sheet.getRow(1).font = { bold: true };
  sheet.addRow(columns.map((c) => c.example));

  columns.forEach((column, index) => {
    const col = sheet.getColumn(index + 1);
    col.width = Math.max(12, column.key.length + 4);
    // '@' = Excel's Text format. Applied BEFORE the user types, which is the only
    // moment that matters: Excel mangles the value on entry, not on save.
    if (column.text) col.numFmt = '@';

    if (column.options && column.options.length > 0) {
      const list = `"${column.options.join(',')}"`;
      for (let rowNumber = 2; rowNumber <= TEMPLATE_VALIDATION_ROWS + 1; rowNumber++) {
        sheet.getCell(rowNumber, index + 1).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [list],
        };
      }
    }
  });

  return new Blob([await workbook.xlsx.writeBuffer()], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export type ImportFileKind = 'spreadsheet' | 'delimited' | 'legacy' | 'unsupported';

/**
 * What the wizard should do with a picked file.
 *
 * `legacy` is the one worth its own case: .xls (Excel 2003) and .ods are still common
 * in offices and exceljs reads neither. Without this they fell through to the CSV
 * parser, which chewed on binary and reported "kolom wajib hilang" — an error about
 * the wrong thing entirely.
 */
export function classifyImportFile(fileName: string): ImportFileKind {
  if (/\.(xlsx|xlsm)$/i.test(fileName)) return 'spreadsheet';
  if (/\.(csv|tsv|txt)$/i.test(fileName)) return 'delimited';
  if (/\.(xls|xlsb|ods|numbers)$/i.test(fileName)) return 'legacy';
  return 'unsupported';
}
