// AREA-2b: the five-sheet prospect workbook. Pure builders plus the workbook writer, read back with exceljs.
import { beforeAll, describe, expect, it } from 'vitest';

import { opsFix } from '@/lib/dictionaries/id/opsFix';
import { buildExportSheets, exportFileName, type ExportResponse, type ExportRowDto } from '@/lib/prospect-export';
import { toWorkbookBlob } from '@/lib/xlsx';

beforeAll(async () => {
  await import('exceljs');
}, 30_000);

/** The real Indonesian copy, so sheet names are what a person sees (and the 31-character cut is honest). */
function t(key: string, vars: Record<string, string | number> = {}): string {
  let v: unknown = { opsFix };
  for (const part of key.split('.')) v = (v as Record<string, unknown>)?.[part];
  return typeof v === 'string' ? v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : key;
}

const row = (over: Partial<ExportRowDto> = {}): ExportRowDto => ({
  id: 'p-1',
  name: 'Kos Mawar',
  category: 'KOS',
  phone: '+6281200000001',
  address: 'Jl. Mawar',
  latitude: -6.2,
  longitude: 106.9,
  kecamatanCode: '3275010',
  kecamatan: 'Bekasi Barat',
  kelurahanCode: '3275010001',
  kelurahan: 'Kranji',
  status: 'NEW',
  ownerDepotId: 'dep-a',
  assignedToId: 'staff-aaaa1234',
  source: 'OSM',
  licence: 'ODbL-1.0',
  sourceId: 'node/1',
  sourceDate: '2026-10-01T00:00:00.000Z',
  ...over,
});

const depots = [
  { id: 'dep-a', code: 'BKS', name: 'Bekasi', serviceRadiusKm: 3 },
  { id: 'dep-b', code: 'DPK', name: 'Depok', serviceRadiusKm: 2, serviceArea: [[{ lat: 1, lng: 1 }]] },
];

function build(rows: ExportRowDto[], extra: Partial<ExportResponse> = {}, names = new Map<string, string>()) {
  const response: ExportResponse = { rows, truncated: false, rowCount: rows.length, visits: [], ...extra };
  return buildExportSheets({
    response,
    depots,
    names,
    dnc: [
      { depotId: 'dep-a', count: 4 },
      { depotId: 'dep-b', count: 0 },
    ],
    t,
  });
}

async function readBack(sheets: ReturnType<typeof build>) {
  const ExcelJS = (await import('exceljs')).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await (await toWorkbookBlob(sheets)).arrayBuffer());
  return workbook;
}

describe('prospect workbook', () => {
  it('has the five sheets in the agreed order with the exact tab names', async () => {
    const wb = await readBack(build([row()]));
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Ringkasan depot', 'Prospek', 'Kunjungan', 'Tahap per PIC', 'Jangan hubungi']);
  });

  it('summarises per depot: counts per category and stage, % with phone, radius or drawn area', () => {
    const sheets = build([
      row(),
      row({ id: 'p-2', category: 'SEKOLAH', phone: null, status: 'CONTACTED' }),
      row({ id: 'p-3', ownerDepotId: 'dep-b' }),
      row({ id: 'p-4', ownerDepotId: null }),
    ]);
    const s = sheets[0]!;
    const [bks, dpk, map] = s.rows;
    expect(s.headers.slice(0, 4)).toEqual(['Kode depot', 'Depot', 'Area', 'Total prospek']);
    expect(bks!.slice(0, 4)).toEqual(['BKS', 'Bekasi', 'radius 3 km', 2]);
    expect(dpk!.slice(0, 4)).toEqual(['DPK', 'Depok', 'gambar', 1]);
    expect(map!.slice(0, 4)).toEqual(['-', 'Di luar area depot', '', 1]);
    expect(bks![s.headers.indexOf('% ber-telepon')]).toBe(50);
    expect(bks![s.headers.indexOf(t('opsFix.prospects.category.KOS'))]).toBe(1);
    expect(bks![s.headers.indexOf(t('opsFix.prospects.status.NEW'))]).toBe(1);
  });

  it('writes the prospect sheet with depot code, tahap, PIC and a footer that names the sources', () => {
    const s = build([row(), row({ id: 'p-2', source: 'OVERTURE', assignedToId: null })], {}, new Map([['staff-aaaa1234', 'Sari']]))[1]!;
    expect(s.rows[0]).toEqual([
      'Kos Mawar',
      t('opsFix.prospects.category.KOS'),
      'Jl. Mawar',
      '+6281200000001',
      -6.2,
      106.9,
      '3275010',
      'Bekasi Barat',
      '3275010001',
      'Kranji',
      'BKS',
      'OSM',
      'ODbL-1.0',
      'node/1',
      '2026-10-01',
      t('opsFix.prospects.status.NEW'),
      'Sari',
    ]);
    expect(s.rows[1]![16]).toBe('');
    expect(s.footer).toEqual([
      'Kolom teknis AREA-T tidak ikut.',
      '© OpenStreetMap contributors (ODbL)',
      'Overture Maps Foundation (CDLA-Permissive-2.0)',
    ]);
    expect(s.text).toEqual(expect.arrayContaining(['Telepon', 'Kode kecamatan', 'Kode kelurahan', 'ID sumber']));
  });

  it('joins visits by row index, in WIB, and a PIC the caller cannot see is "Staf" + the last 4 of the id', () => {
    const sheets = build([row(), row({ id: 'p-2', name: 'SD Harapan' })], {
      visits: [{ rowIndex: 1, visitorId: 'staff-zzzz9999', visitedAt: '2026-11-26T18:30:00.000Z', outcome: 'NOT_THERE', distanceM: 42 }],
    });
    // 18:30 UTC is 01:30 on the 27th in WIB.
    expect(sheets[2]!.rows).toEqual([['SD Harapan', 'Staf 9999', '2026-11-27', 'ya', t('opsFix.prospects.outcome.NOT_THERE'), 42]]);
  });

  it('groups prospects per PIC and stage; unassigned is its own PIC', () => {
    const sheets = build(
      [row(), row({ id: 'p-2' }), row({ id: 'p-3', assignedToId: null }), row({ id: 'p-4', status: 'VISITED' })],
      {},
      new Map([['staff-aaaa1234', 'Sari']]),
    );
    expect(sheets[3]!.rows).toEqual([
      ['(belum ditugaskan)', t('opsFix.prospects.status.NEW'), 1],
      ['Sari', t('opsFix.prospects.status.NEW'), 2],
      ['Sari', t('opsFix.prospects.status.VISITED'), 1],
    ]);
  });

  it('holds counts only on the do-not-contact sheet: no prospect name or phone anywhere in it', async () => {
    const wb = await readBack(build([row({ name: 'Kos Rahasia', phone: '+6281299999999' })]));
    const dnc = wb.worksheets[4]!;
    const cells: string[] = [];
    dnc.eachRow((r) => r.eachCell((c) => cells.push(String(c.value))));
    expect(cells.join('|')).not.toMatch(/Rahasia|\+62812/);
    expect(dnc.getRow(2).values).toEqual([undefined, 'BKS', 'Bekasi', 4]);
    expect(cells.join('|')).toMatch(/daftar tidak bisa dibaca kembali/);
  });

  it('neutralises every formula lead in names, addresses, PICs and depot names; phone stays raw; no formula cells', async () => {
    const leads = ['=', '+', '-', '@', '\t', '\r'];
    const rows = leads.map((l, i) => row({ id: `p-${i}`, name: `${l}cmd`, address: `${l}addr`, kecamatan: `${l}kec`, assignedToId: `s-${i}` }));
    rows.push(row({ id: 'p-x', name: "'=already" })); // the server's own prefix
    const names = new Map(leads.map((l, i) => [`s-${i}`, `${l}pic`]));
    const sheets = buildExportSheets({
      response: {
        rows,
        truncated: false,
        rowCount: rows.length,
        visits: [{ rowIndex: 0, visitorId: 's-0', visitedAt: '2026-11-20T03:00:00.000Z', outcome: 'REFUSED', distanceM: 5 }],
      },
      depots: [{ id: 'dep-a', code: 'BKS', name: '=Bekasi' }],
      names,
      dnc: [{ depotId: 'dep-a', count: 1 }],
      t,
    });
    const wb = await readBack(sheets);
    for (const sheet of wb.worksheets) {
      sheet.eachRow((r, n) =>
        r.eachCell((c, col) => {
          expect(typeof c.value === 'object' && c.value !== null && 'formula' in c.value).toBe(false);
          if (typeof c.value !== 'string') return;
          const header = String(sheet.getRow(1).getCell(col).value);
          if (n === 1 || ['Telepon', 'lat', 'lng'].includes(header)) return;
          expect(c.value, `${sheet.name}!${c.address}`).not.toMatch(/^[=+\-@\t\r]/);
        }),
      );
    }
    const prospects = wb.worksheets[1]!;
    expect(prospects.getCell('A2').value).toBe("'=cmd");
    expect(prospects.getCell('A8').value).toBe("'=already"); // not double-prefixed
    expect(prospects.getCell('D2').value).toBe('+6281200000001'); // phone untouched
    expect(wb.worksheets[0]!.getCell('B2').value).toBe("'=Bekasi");
  });

  it('names the file after the depot (or the network) and the WIB day, and marks a cut file', () => {
    const at = new Date('2026-11-26T18:00:00.000Z'); // 01:00 on the 27th in WIB
    expect(exportFileName('BKS', false, t, at)).toBe('prospek-BKS-2026-11-27.xlsx');
    expect(exportFileName(null, true, t, at)).toBe('prospek-jaringan-sebagian-2026-11-27.xlsx');
  });
});
