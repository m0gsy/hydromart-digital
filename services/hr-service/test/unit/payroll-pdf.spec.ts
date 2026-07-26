import type { SlipData } from '../../src/domain/payroll-pdf';

// pdfkit is an optional runtime dep (not installed in dev/CI). We drive both branches with a
// virtual mock: a working fake PDFDocument (success path) and a throwing factory (require fail).

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
  constructor(public opts?: Record<string, unknown>) {}
  fontSize(): this {
    return this;
  }
  text(): this {
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
      jest.doMock('pdfkit', () => FakePdfDoc, { virtual: true });
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
      jest.doMock(
        'pdfkit',
        () => {
          throw new Error('Cannot find module');
        },
        { virtual: true },
      );
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { payrollSlipPdf } = require('../../src/domain/payroll-pdf');
      out = payrollSlipPdf(slip);
    });
    await expect(out!).rejects.toThrow(/pdfkit/);
  });
});
