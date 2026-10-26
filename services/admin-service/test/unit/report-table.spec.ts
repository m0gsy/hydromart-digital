import { ExportFormat } from '../../src/domain/export';
import { ReportDataset } from '../../src/domain/report-dataset';
import { renderTable } from '../../src/domain/report-file';
import { ReportTable, comparisonTable, revenueTable } from '../../src/domain/report-table';
import { ReportSourceHttpAdapter } from '../../src/infrastructure/http/report-source.http.adapter';
import { AdminConfigService } from '../../src/config/admin-config.service';

const FROM = new Date('2026-10-25T17:00:00.000Z');
const TO = new Date('2026-10-26T17:00:00.000Z');

describe('revenueTable / comparisonTable', () => {
  it('totals the legacy rows, and has no totals row when there are none', () => {
    expect(revenueTable([]).totals).toBeNull();
    expect(
      revenueTable([
        { label: 'A', orders: 1, revenue: 10 },
        { label: 'B', orders: 2, revenue: 30 },
      ]).totals,
    ).toEqual(['Total', 3, 40]);
  });

  it('pairs rows with the previous period by label and keeps rows that only existed before', () => {
    const t = comparisonTable(
      [
        { label: 'A', orders: 2, revenue: 150 },
        { label: 'New', orders: 1, revenue: 50 },
      ],
      [
        { label: 'A', orders: 1, revenue: 100 },
        { label: 'Gone', orders: 4, revenue: 200 },
      ],
    );
    expect(t.rows).toEqual([
      ['A', 2, 150, 1, 100, 50],
      ['New', 1, 50, 0, 0, null],
      ['Gone', 0, 0, 4, 200, -100],
    ]);
    // 200 now against 300 before.
    expect(t.totals).toEqual(['Total', 3, 200, 5, 300, -33.3]);
  });

  it('has no totals and no delta on an empty comparison', () => {
    expect(comparisonTable([], []).totals).toBeNull();
    expect(comparisonTable([{ label: 'A', orders: 1, revenue: 5 }], []).totals?.[5]).toBeNull();
  });
});

describe('renderTable', () => {
  const table: ReportTable = {
    columns: [
      { key: 'name', label: 'Nama', type: 'text' },
      { key: 'at', label: 'Waktu', type: 'date' },
      { key: 'amount', label: 'Jumlah', type: 'money' },
      { key: 'pct', label: 'Persen', type: 'percent' },
      { key: 'n', label: 'Qty', type: 'int' },
    ],
    rows: [
      ['=cmd', '2026-10-26T00:00:00.000Z', 12000, 12.5, 3],
      ['Budi', 'bukan-tanggal', null, null, null],
    ],
    totals: ['Total', null, 12000, null, 3],
  };

  it('writes the service columns to CSV, dates on the WIB calendar, formulas defused', async () => {
    const text = (await renderTable(table, ExportFormat.CSV, 'x')).toString('utf8');
    expect(text.split('\r\n')[0]).toBe('﻿Nama,Waktu,Jumlah,Persen,Qty');
    expect(text).toContain("'=cmd,2026-10-26 07:00,12000,12.5,3");
    expect(text).toContain('Budi,bukan-tanggal,,,');
  });

  it('writes XLSX and PDF, wide tables on a landscape page', async () => {
    expect((await renderTable(table, ExportFormat.XLSX, 'Lap')).subarray(0, 2).toString()).toBe(
      'PK',
    );
    const wide: ReportTable = {
      columns: Array.from({ length: 8 }, (_, i) => ({
        key: `c${i}`,
        label: `C${i}`,
        type: i % 2 ? 'money' : 'text',
      })) as ReportTable['columns'],
      rows: [Array.from({ length: 8 }, (_, i) => (i % 2 ? 1500 : 'x'))],
    };
    for (const t of [table, wide, { ...table, rows: [] }]) {
      const pdf = await renderTable(t, ExportFormat.PDF, 'Lap', { pdfCompress: false });
      expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    }
  });
});

describe('renderTable edges', () => {
  const t = (n: number): ReportTable => ({
    columns: [
      { key: 'a', label: 'A', type: 'text' },
      { key: 'b', label: 'B', type: 'int' },
    ],
    rows: Array.from({ length: n }, (_, i) => [`r${i}`, i]),
    totals: ['Total', n],
  });

  it('breaks a long table across pages, repeating the header', async () => {
    const pdf = await renderTable(t(120), ExportFormat.PDF, 'Panjang', { pdfCompress: false });
    expect(pdf.toString('latin1').split('/Type /Page').length).toBeGreaterThan(3);
  });

  it('refuses a format it has no renderer for', async () => {
    await expect(renderTable(t(1), 'DOCX' as ExportFormat, 'x')).rejects.toThrow(/belum didukung/);
  });
});

describe('AdminConfigService.peerUrl', () => {
  it('trims and drops trailing slashes, blank when unset', () => {
    const cfg = (v?: string) =>
      new AdminConfigService({ get: (_k: string, d: string) => v ?? d } as never);
    expect(cfg(' http://order:3004// ').peerUrl('ORDER_SERVICE_URL')).toBe('http://order:3004');
    expect(cfg().peerUrl('ORDER_SERVICE_URL')).toBe('');
  });
});

describe('ReportSourceHttpAdapter.tableFor', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  const config = (
    peers: Record<string, string> = { DELIVERY_SERVICE_URL: 'http://delivery:3006' },
  ) =>
    ({
      internalServiceKey: 'k',
      peerUrl: (key: string) => peers[key] ?? '',
    }) as unknown as AdminConfigService;
  const body = (b: unknown) => ({ ok: true, status: 200, json: async () => b });
  const cols = [
    { key: 'a', label: 'A', type: 'text' },
    { key: 'b', label: 'B', type: 'int' },
  ];

  it('passes a service table through, calling the owning service under the internal key', async () => {
    fetchMock.mockResolvedValue(body({ columns: cols, rows: [['x', 1]], truncated: false }));
    const t = await new ReportSourceHttpAdapter(config()).tableFor(
      ReportDataset.COD_UNSETTLED,
      FROM,
      TO,
    );
    expect(t).toEqual({ columns: cols, rows: [['x', 1]] });
    expect(fetchMock.mock.calls[0][0]).toBe(
      `http://delivery:3006/api/v1/settlements/internal/report-table?dataset=COD_UNSETTLED&from=${FROM.toISOString()}&to=${TO.toISOString()}`,
    );
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'x-internal-key': 'k' });
  });

  it('appends a note row when the source cut the table short', async () => {
    fetchMock.mockResolvedValue(body({ columns: cols, rows: [['x', 1]], truncated: true }));
    const t = await new ReportSourceHttpAdapter(config()).tableFor(
      ReportDataset.FAILED_DELIVERIES,
      FROM,
      TO,
    );
    expect(t.rows[1][0]).toMatch(/TERPOTONG: hanya 1 baris/);
    expect(t.rows[1][1]).toBeNull();
  });

  it('throws on an unknown shape, a missing peer URL and a bad status', async () => {
    fetchMock.mockResolvedValue(body({ nope: true }));
    await expect(
      new ReportSourceHttpAdapter(config()).tableFor(ReportDataset.COD_UNSETTLED, FROM, TO),
    ).rejects.toThrow(/unknown shape/);
    await expect(
      new ReportSourceHttpAdapter(config({})).tableFor(ReportDataset.COD_UNSETTLED, FROM, TO),
    ).rejects.toThrow(/URL not configured/);
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(
      new ReportSourceHttpAdapter(config()).tableFor(ReportDataset.COD_UNSETTLED, FROM, TO),
    ).rejects.toThrow(/500/);
  });

  it('adds comparison columns to a revenue dataset when given the previous period', async () => {
    fetchMock
      .mockResolvedValueOnce(body({ rows: [{ label: 'A', orders: 2, revenue: 200 }] }))
      .mockResolvedValueOnce(body({ rows: [{ label: 'A', orders: 1, revenue: 100 }] }));
    const prev = { from: new Date('2026-10-24T17:00:00Z'), to: FROM };
    const t = await new ReportSourceHttpAdapter(
      config({ ORDER_SERVICE_URL: 'http://order:3004' }),
    ).tableFor(ReportDataset.REVENUE_BY_DEPOT, FROM, TO, prev);
    expect(t.columns).toHaveLength(6);
    expect(t.rows[0]).toEqual(['A', 2, 200, 1, 100, 100]);
    expect(fetchMock.mock.calls[1][0]).toContain(`from=${prev.from.toISOString()}`);
  });

  it('keeps three columns for a revenue dataset with no previous period', async () => {
    fetchMock.mockResolvedValue(body({ rows: [{ label: 'A', orders: 2, revenue: 200 }] }));
    const t = await new ReportSourceHttpAdapter(
      config({ ORDER_SERVICE_URL: 'http://order:3004' }),
    ).tableFor(ReportDataset.REVENUE_BY_DEPOT, FROM, TO);
    expect(t.columns).toHaveLength(3);
  });

  describe('names for the ids delivery-service stores', () => {
    const D = '11111111-1111-4111-8111-111111111111';
    const C = '22222222-2222-4222-8222-222222222222';
    const named = [
      { key: 'courier', label: 'Kurir', type: 'text' },
      { key: 'depot', label: 'Depot', type: 'text' },
    ];
    const peers = {
      DELIVERY_SERVICE_URL: 'http://delivery:3006',
      DEPOT_SERVICE_URL: 'http://depot:3007',
      AUTH_SERVICE_URL: 'http://auth:3001',
    };

    it('swaps courier and depot ids for names, and leaves everything else alone', async () => {
      fetchMock
        .mockResolvedValueOnce(
          body({
            columns: named,
            rows: [
              [C, D],
              ['Budi', 'bukan-uuid'],
            ],
          }),
        )
        .mockResolvedValueOnce(body({ depots: [{ id: D, name: 'Depot Cibubur' }] }))
        .mockResolvedValueOnce(body([{ id: C, fullName: 'Andi Kurir' }]));
      const t = await new ReportSourceHttpAdapter(config(peers)).tableFor(
        ReportDataset.FAILED_DELIVERIES,
        FROM,
        TO,
      );
      expect(t.rows).toEqual([
        ['Andi Kurir', 'Depot Cibubur'],
        ['Budi', 'bukan-uuid'],
      ]);
    });

    it('keeps the id when a directory is down, instead of failing the report', async () => {
      fetchMock
        .mockResolvedValueOnce(body({ columns: named, rows: [[C, D]] }))
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
      const t = await new ReportSourceHttpAdapter(config(peers)).tableFor(
        ReportDataset.FAILED_DELIVERIES,
        FROM,
        TO,
      );
      expect(t.rows).toEqual([[C, D]]);
    });

    it('survives a courier lookup that throws or answers without names', async () => {
      fetchMock
        .mockResolvedValueOnce(body({ columns: named, rows: [[C, D]] }))
        .mockResolvedValueOnce(body({ depots: [] }))
        .mockRejectedValueOnce(new Error('boom'));
      expect(
        (
          await new ReportSourceHttpAdapter(config(peers)).tableFor(
            ReportDataset.FAILED_DELIVERIES,
            FROM,
            TO,
          )
        ).rows,
      ).toEqual([[C, D]]);
      fetchMock
        .mockResolvedValueOnce(body({ columns: named, rows: [[C, D]] }))
        .mockResolvedValueOnce(body({}))
        .mockResolvedValueOnce(body([{ id: C, fullName: null }, {}]));
      expect(
        (
          await new ReportSourceHttpAdapter(config(peers)).tableFor(
            ReportDataset.FAILED_DELIVERIES,
            FROM,
            TO,
          )
        ).rows,
      ).toEqual([[C, D]]);
    });

    it('skips the lookups when the directories are not configured', async () => {
      fetchMock.mockResolvedValueOnce(body({ columns: named, rows: [[C, D]] }));
      const t = await new ReportSourceHttpAdapter(
        config({ DELIVERY_SERVICE_URL: 'http://delivery:3006' }),
      ).tableFor(ReportDataset.FAILED_DELIVERIES, FROM, TO);
      expect(t.rows).toEqual([[C, D]]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not look anything up for a table with no such columns', async () => {
      fetchMock.mockResolvedValueOnce(body({ columns: cols, rows: [[D, 1]] }));
      await new ReportSourceHttpAdapter(config(peers)).tableFor(
        ReportDataset.COD_UNSETTLED,
        FROM,
        TO,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('refuses a dataset nobody serves', async () => {
    await expect(
      new ReportSourceHttpAdapter(config()).tableFor('NOPE' as ReportDataset, FROM, TO),
    ).rejects.toThrow(/belum punya sumber/);
  });
});
