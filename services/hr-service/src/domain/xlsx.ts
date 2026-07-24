import { CsvCell } from './csv';

// exceljs is a runtime dependency loaded lazily so typecheck/dev don't require it installed;
// `npm ci` provides it in CI/prod. Missing → a clear error rather than a fake file.
interface ExcelWorksheet {
  addRow(values: CsvCell[]): void;
  getRow(n: number): { font: { bold: boolean } };
}
interface ExcelWorkbook {
  addWorksheet(name: string): ExcelWorksheet;
  xlsx: { writeBuffer(): Promise<ArrayBuffer | Buffer> };
}
interface ExcelModule {
  Workbook: new () => ExcelWorkbook;
}

/** Build a single-sheet .xlsx workbook from a header row + data rows. */
export async function toXlsx(headers: string[], rows: CsvCell[][], sheetName: string): Promise<Buffer> {
  let ExcelJS: ExcelModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ExcelJS = require('exceljs') as ExcelModule;
  } catch {
    throw new Error('Ekspor Excel butuh paket "exceljs" (jalankan npm ci di server).');
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31)); // Excel sheet-name limit
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  for (const row of rows) ws.addRow(row);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
}
