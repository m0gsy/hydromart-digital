// exceljs is an optional runtime dep (not installed in dev/CI). Virtual mock drives the
// success path (both writeBuffer return shapes) and the require-failure path.

const HEADERS = ['Nama', 'Gaji'];
const ROWS = [
  ['Ani', 3_000_000],
  ['Budi', 2_500_000],
];

function fakeExcel(bufferShape: 'buffer' | 'arraybuffer') {
  const added: unknown[][] = [];
  const row1 = { font: { bold: false } };
  const ws = {
    addRow: (v: unknown[]) => added.push(v),
    getRow: (_n: number) => row1,
  };
  let sheetName = '';
  const wb = {
    addWorksheet: (name: string) => {
      sheetName = name;
      return ws;
    },
    xlsx: {
      writeBuffer: async () =>
        bufferShape === 'buffer' ? Buffer.from('xlsx-bytes') : new Uint8Array([1, 2, 3]).buffer,
    },
  };
  return {
    Module: { Workbook: function Workbook() { return wb; } },
    inspect: () => ({ added, sheetName, row1 }),
  };
}

describe('toXlsx', () => {
  afterEach(() => jest.resetModules());

  it('builds a workbook (bold header) and returns a Buffer directly', async () => {
    const fake = fakeExcel('buffer');
    let out: Promise<Buffer> | undefined;
    jest.isolateModules(() => {
      jest.doMock('exceljs', () => fake.Module, { virtual: true });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { toXlsx } = require('../../src/domain/xlsx');
      out = toXlsx(HEADERS, ROWS, 'Payroll');
    });
    const buf = await out!;
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe('xlsx-bytes');
    const state = fake.inspect();
    expect(state.added[0]).toEqual(HEADERS);
    expect(state.added).toHaveLength(3); // header + 2 rows
    expect(state.row1.font.bold).toBe(true);
    expect(state.sheetName).toBe('Payroll');
  });

  it('wraps an ArrayBuffer result in a Buffer', async () => {
    let out: Promise<Buffer> | undefined;
    jest.isolateModules(() => {
      jest.doMock('exceljs', () => fakeExcel('arraybuffer').Module, { virtual: true });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { toXlsx } = require('../../src/domain/xlsx');
      out = toXlsx(HEADERS, ROWS, 'Payroll');
    });
    const buf = await out!;
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(Array.from(buf)).toEqual([1, 2, 3]);
  });

  it('truncates a sheet name to Excel 31-char limit', async () => {
    const fake = fakeExcel('buffer');
    let out: Promise<Buffer> | undefined;
    jest.isolateModules(() => {
      jest.doMock('exceljs', () => fake.Module, { virtual: true });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { toXlsx } = require('../../src/domain/xlsx');
      out = toXlsx(HEADERS, ROWS, 'a'.repeat(40));
    });
    await out!;
    expect(fake.inspect().sheetName).toHaveLength(31);
  });

  it('throws a clear error when exceljs is not installed', async () => {
    let out: Promise<Buffer> | undefined;
    jest.isolateModules(() => {
      jest.doMock(
        'exceljs',
        () => {
          throw new Error('Cannot find module');
        },
        { virtual: true },
      );
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { toXlsx } = require('../../src/domain/xlsx');
      out = toXlsx(HEADERS, ROWS, 'Payroll');
    });
    await expect(out!).rejects.toThrow(/exceljs/);
  });
});
