import { beforeAll, describe, expect, it } from 'vitest';

import { buildTemplateXlsx, classifyImportFile, parseXlsxRecords, toXlsxBlob } from '@/lib/xlsx';

// exceljs is a big lazy chunk. Warm it once here instead of making whichever test
// runs first absorb the load time and flake on the default 5s timeout.
beforeAll(async () => {
  await import('exceljs');
}, 30_000);

/** Wrap a Blob as the File the wizard receives from the picker. */
async function asFile(blob: Blob, name: string): Promise<File> {
  return new File([await blob.arrayBuffer()], name);
}

const COLUMNS = [
  { key: 'fullName', example: 'Budi Santoso' },
  { key: 'phone', example: '081234567890', text: true },
  { key: 'role', example: 'STAFF_DEPOT', options: ['STAFF_DEPOT', 'KEPALA_DEPOT'] },
  { key: 'dailyRate', example: '150000' },
];

describe('classifyImportFile', () => {
  it('routes the modern Excel formats to the spreadsheet parser', () => {
    expect(classifyImportFile('karyawan.xlsx')).toBe('spreadsheet');
    expect(classifyImportFile('KARYAWAN.XLSM')).toBe('spreadsheet');
  });

  it('routes text formats to the delimited parser', () => {
    expect(classifyImportFile('karyawan.csv')).toBe('delimited');
    expect(classifyImportFile('karyawan.TSV')).toBe('delimited');
  });

  // These used to fall through to the CSV parser, which chewed on binary and blamed
  // the columns. They get their own "save it as .xlsx" message instead.
  it('names the legacy formats exceljs cannot read', () => {
    expect(classifyImportFile('karyawan.xls')).toBe('legacy');
    expect(classifyImportFile('karyawan.ods')).toBe('legacy');
    expect(classifyImportFile('karyawan.numbers')).toBe('legacy');
  });

  it('rejects anything else outright', () => {
    expect(classifyImportFile('karyawan.pdf')).toBe('unsupported');
    expect(classifyImportFile('karyawan')).toBe('unsupported');
    // A name that merely mentions xlsx is not an xlsx.
    expect(classifyImportFile('xlsx-panduan.docx')).toBe('unsupported');
  });
});

describe('template round-trip', () => {
  it('writes a header + example row the parser reads straight back', async () => {
    const file = await asFile(await buildTemplateXlsx(COLUMNS, 'karyawan'), 'karyawan.xlsx');

    await expect(parseXlsxRecords(file)).resolves.toEqual([
      {
        fullName: 'Budi Santoso',
        phone: '081234567890',
        role: 'STAFF_DEPOT',
        dailyRate: '150000',
      },
    ]);
  });

  it('keeps the phone column as Text so Excel cannot renumber it', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await buildTemplateXlsx(COLUMNS, 'karyawan')).arrayBuffer());

    // '@' is Excel's Text format; applied to the column, it holds for rows typed later.
    expect(workbook.worksheets[0]?.getColumn(2).numFmt).toBe('@');
    expect(workbook.worksheets[0]?.getColumn(1).numFmt).toBeUndefined();
  });

  it('puts a dropdown on the enum column', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await (await buildTemplateXlsx(COLUMNS, 'karyawan')).arrayBuffer());

    const validation = workbook.worksheets[0]?.getCell(2, 3).dataValidation;
    expect(validation).toMatchObject({ type: 'list', formulae: ['"STAFF_DEPOT,KEPALA_DEPOT"'] });
    expect(workbook.worksheets[0]?.getCell(2, 1).dataValidation).toBeUndefined();
  });
});

describe('toXlsxBlob', () => {
  async function load(blob: Blob) {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await blob.arrayBuffer());
    return workbook.worksheets[0]!;
  }

  it('round-trips a header + rows through the reader the importer uses', async () => {
    const blob = await toXlsxBlob(
      ['Staf', 'Sen', 'Sel'],
      [
        ['Budi Santoso', 'Pagi', 'Libur'],
        ['Siti Aminah', 'Sore', 'Pagi'],
      ],
      'Jadwal shift',
    );
    await expect(parseXlsxRecords(await asFile(blob, 'jadwal.xlsx'))).resolves.toEqual([
      { Staf: 'Budi Santoso', Sen: 'Pagi', Sel: 'Libur' },
      { Staf: 'Siti Aminah', Sen: 'Sore', Sel: 'Pagi' },
    ]);
  });

  // The whole point of offering .xlsx next to CSV: money arrives as a number Excel can
  // sum, not as text a locale has to guess at.
  it('keeps numbers numeric and strings textual', async () => {
    const sheet = await load(
      await toXlsxBlob(['No. pesanan', 'Total'], [['ORD-001', 150000]], 'Laporan'),
    );
    expect(sheet.getCell(2, 1).value).toBe('ORD-001');
    expect(sheet.getCell(2, 2).value).toBe(150000);
  });

  it('writes null and undefined cells as blanks rather than the words', async () => {
    const sheet = await load(await toXlsxBlob(['a', 'b'], [[null, undefined]], 'Kosong'));
    expect(sheet.getCell(2, 1).value).toBe('');
    expect(sheet.getCell(2, 2).value).toBe('');
  });

  it('truncates a sheet name Excel would reject', async () => {
    const sheet = await load(await toXlsxBlob(['a'], [['1']], 'x'.repeat(40)));
    expect(sheet.name).toBe('x'.repeat(31));
  });

  it('bolds the header row', async () => {
    const sheet = await load(await toXlsxBlob(['a'], [['1']], 'Data'));
    expect(sheet.getRow(1).font?.bold).toBe(true);
  });
});

describe('parseXlsxRecords', () => {
  async function sheetFile(rows: unknown[][]): Promise<File> {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('data');
    rows.forEach((row) => sheet.addRow(row));
    return asFile(new Blob([await workbook.xlsx.writeBuffer()]), 'data.xlsx');
  }

  it('reads numbers as plain digits, with no thousand-separator ambiguity', async () => {
    const file = await sheetFile([
      ['label', 'quantity'],
      ['Galon 19L', 150000],
    ]);
    await expect(parseXlsxRecords(file)).resolves.toEqual([
      { label: 'Galon 19L', quantity: '150000' },
    ]);
  });

  it('reads a real date cell as an ISO date, not a locale-ordered string', async () => {
    const file = await sheetFile([
      ['joinDate'],
      [new Date(Date.UTC(2026, 0, 2))],
    ]);
    await expect(parseXlsxRecords(file)).resolves.toEqual([{ joinDate: '2026-01-02' }]);
  });

  it('skips fully blank rows left behind in the sheet', async () => {
    const file = await sheetFile([['a'], ['1'], [null], ['2']]);
    await expect(parseXlsxRecords(file)).resolves.toEqual([{ a: '1' }, { a: '2' }]);
  });

  it('fills short rows with empty strings', async () => {
    const file = await sheetFile([
      ['a', 'b', 'c'],
      ['1'],
    ]);
    await expect(parseXlsxRecords(file)).resolves.toEqual([{ a: '1', b: '', c: '' }]);
  });

  it('returns nothing for a workbook with no rows', async () => {
    const file = await sheetFile([]);
    await expect(parseXlsxRecords(file)).resolves.toEqual([]);
  });
});
