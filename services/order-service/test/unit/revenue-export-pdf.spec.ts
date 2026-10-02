import { revenueExportPdf, type RevenueExportRow } from '../../src/application/services/revenue-export-pdf';

/**
 * Same extraction trick as depot-daily-pdf.spec.ts: pdfkit writes each text call as one
 * `[<hex> kern <hex> …] TJ` operator, so reading those back in draw order is enough to
 * assert what is on the sheet without a PDF parser.
 */
function cellsOf(pdf: Buffer): string[] {
  const out: string[] = [];
  for (const m of pdf.toString('latin1').matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    const chunks = [...m[1].matchAll(/<([0-9a-f]*)>/g)].map((h) =>
      Buffer.from(h[1], 'hex').toString('latin1'),
    );
    out.push(chunks.join(''));
  }
  return out;
}

const pages = (pdf: Buffer): number =>
  (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

const row = (over: Partial<RevenueExportRow> = {}): RevenueExportRow => ({
  label: 'Depot Tirta Jaya',
  orders: 10,
  revenue: 400000,
  ...over,
});

describe('revenueExportPdf', () => {
  it('is a real PDF', async () => {
    const pdf = await revenueExportPdf({
      group: 'depot',
      from: '2026-09-01',
      to: '2026-09-30',
      rows: [row()],
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });

  it('prints the group title, the date range, and every row', async () => {
    const cells = cellsOf(
      await revenueExportPdf(
        {
          group: 'product',
          from: '2026-09-01',
          to: '2026-09-30',
          rows: [row({ label: 'Galon 19L', orders: 50, revenue: 2000000 })],
        },
        { compress: false },
      ),
    );
    expect(cells).toContain('Pendapatan per produk');
    expect(cells).toEqual(expect.arrayContaining(['Galon 19L', '50', 'Rp2.000.000']));
  });

  it('sums a total row rather than leaving the reader to add it up', async () => {
    const cells = cellsOf(
      await revenueExportPdf(
        {
          group: 'method',
          from: '2026-09-01',
          to: '2026-09-30',
          rows: [
            row({ label: 'QRIS', orders: 10, revenue: 400000 }),
            row({ label: 'Tunai', orders: 5, revenue: 100000 }),
          ],
        },
        { compress: false },
      ),
    );
    expect(cells).toEqual(expect.arrayContaining(['Total', '15', 'Rp500.000']));
  });

  it('says so when there are no rows, rather than printing an empty table', async () => {
    const cells = cellsOf(
      await revenueExportPdf(
        { group: 'depot', from: '2026-09-01', to: '2026-09-30', rows: [] },
        { compress: false },
      ),
    );
    expect(cells).toContain('Tidak ada data pada periode ini.');
    expect(cells).not.toContain('Total');
  });

  it('breaks onto more pages, repeating the header, instead of running off the sheet', async () => {
    const pdf = await revenueExportPdf(
      {
        group: 'depot',
        from: '2026-09-01',
        to: '2026-09-30',
        rows: Array.from({ length: 80 }, (_, i) => row({ label: `Depot ${i}` })),
      },
      { compress: false },
    );
    const headers = cellsOf(pdf).filter((c) => c === 'Label').length;
    expect(pages(pdf)).toBeGreaterThan(1);
    expect(headers).toBeGreaterThan(1);
  });
});
