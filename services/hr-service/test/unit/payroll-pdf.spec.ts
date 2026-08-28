import type { SlipData } from '../../src/domain/payroll-pdf';

// Both branches are driven by a plain module mock: a working fake PDFDocument (success path)
// and a throwing factory (the require-failed path).
//
// NOT a virtual mock, and the comment that used to stand here said why one was reached for:
// "pdfkit is an optional runtime dep (not installed in dev/CI)". It is neither — it is a
// declared dependency in services/hr-service/package.json and it installs everywhere.
//
// `virtual: true` is for a module that cannot be resolved. On one that can, the mock is
// registered under the name as written while the require resolves to a real path, and which
// of the two wins depends on what the module registry already holds. That is a coin flip,
// and it landed: `npx jest --maxWorkers=2` on this service — the command CI runs — failed
// these six tests on one run in three, with the real pdfkit rendering a real PDF instead of
// the fake. Measured on main, with no source change of any kind.

const slip: SlipData = {
  employeeName: 'Ani',
  employeeCode: 'EMP-001',
  periodMonth: '2026-07',
  status: 'ACTIVE',
  lines: [
    { label: 'Gaji Pokok', amount: 3_000_000, deduction: false },
    { label: 'Potongan Telat', amount: 10_000, deduction: true },
  ],
  net: 2_990_000,
};

class FakePdfDoc {
  private handlers: Record<string, (c?: Buffer) => void> = {};
  /** Everything text() was asked to render, so the truncation notice can be asserted. */
  written: string[] = [];
  constructor(public opts?: Record<string, unknown>) {}
  fontSize(): this {
    return this;
  }
  text(s: string): this {
    this.written.push(s);
    return this;
  }
  moveDown(): this {
    return this;
  }
  on(event: string, cb: (c?: Buffer) => void): this {
    this.handlers[event] = cb;
    return this;
  }
  end(): void {
    this.handlers['data']?.(Buffer.from('%PDF-fake'));
    this.handlers['data']?.(undefined); // exercises the `c && chunks.push(c)` falsy guard
    this.handlers['end']?.();
  }
}

describe('payrollSlipPdf', () => {
  afterEach(() => jest.resetModules());

  it('renders finished PDF bytes when pdfkit is available', async () => {
    let out: Promise<Buffer> | undefined;
    jest.isolateModules(() => {
      jest.doMock('pdfkit', () => FakePdfDoc);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { payrollSlipPdf } = require('../../src/domain/payroll-pdf');
      out = payrollSlipPdf(slip);
    });
    const buf = await out!;
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString()).toBe('%PDF-fake');
  });

  it('rejects with a clear message when pdfkit is not installed', async () => {
    let out: Promise<Buffer> | undefined;
    jest.isolateModules(() => {
      jest.doMock('pdfkit', () => {
        throw new Error('Cannot find module');
      });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { payrollSlipPdf } = require('../../src/domain/payroll-pdf');
      out = payrollSlipPdf(slip);
    });
    await expect(out!).rejects.toThrow(/pdfkit/);
  });
});

describe('tableReportPdf (C4)', () => {
  afterEach(() => jest.resetModules());

  /** Render through the fake document and hand back every line it was asked to write. */
  function render(report: unknown): { bytes: Promise<Buffer>; lines: () => string[] } {
    const docs: FakePdfDoc[] = [];
    class Capturing extends FakePdfDoc {
      constructor(opts?: Record<string, unknown>) {
        super(opts);
        docs.push(this);
      }
    }
    let bytes: Promise<Buffer> | undefined;
    jest.isolateModules(() => {
      jest.doMock('pdfkit', () => Capturing);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { tableReportPdf } = require('../../src/domain/payroll-pdf');
      bytes = tableReportPdf(report);
    });
    return { bytes: bytes!, lines: () => docs[0]?.written ?? [] };
  }

  it('writes the title, an optional subtitle, the headers and every row', async () => {
    const { bytes, lines } = render({
      title: 'Laporan Cuti',
      subtitle: '2026-07-01 s/d 2026-07-31',
      headers: ['kode', 'nama'],
      rows: [
        ['EMP-001', 'Budi'],
        ['EMP-002', null],
      ],
    });
    await bytes;
    expect(lines()[0]).toBe('Laporan Cuti');
    expect(lines()[1]).toBe('2026-07-01 s/d 2026-07-31');
    expect(lines()).toContain('kode  |  nama');
    expect(lines()).toContain('EMP-001  |  Budi');
    // A null cell renders empty rather than the string "null".
    expect(lines()).toContain('EMP-002  |  ');
  });

  it('omits the subtitle line entirely when there is none', async () => {
    const { bytes, lines } = render({ title: 'Laporan Aset', headers: ['kode'], rows: [] });
    await bytes;
    expect(lines()[1]).toBe('kode');
  });

  it('SAYS SO when it truncates — a short PDF must not read as the whole picture', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PDF_ROW_LIMIT } = require('../../src/domain/payroll-pdf');
    const rows = Array.from({ length: PDF_ROW_LIMIT + 3 }, (_, i) => [`row-${i}`]);
    const { bytes, lines } = render({ title: 'Besar', headers: ['kode'], rows });
    await bytes;
    expect(lines()).toContain(`row-${PDF_ROW_LIMIT - 1}`);
    expect(lines()).not.toContain(`row-${PDF_ROW_LIMIT}`);
    expect(lines().at(-1)).toContain(`${PDF_ROW_LIMIT} dari ${rows.length} baris`);
  });

  it('rejects with the same clear message when pdfkit is not installed', async () => {
    let out: Promise<Buffer> | undefined;
    jest.isolateModules(() => {
      jest.doMock('pdfkit', () => {
        throw new Error('Cannot find module');
      });
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { tableReportPdf } = require('../../src/domain/payroll-pdf');
      out = tableReportPdf({ title: 'x', headers: [], rows: [] });
    });
    await expect(out!).rejects.toThrow(/pdfkit/);
  });
});
