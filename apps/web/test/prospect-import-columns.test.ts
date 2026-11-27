import { IMPORT_COLUMNS } from '@hydromart/access';
import { describe, expect, it } from 'vitest';

import { prospectsIo as en } from '@/lib/dictionaries/en/prospectsIo';
import { prospectsIo as id } from '@/lib/dictionaries/id/prospectsIo';
import { missingColumns, REQUIRED_COLUMNS, rowsHash, templateColumns, toImportRows } from '@/lib/prospect-import';
import { buildTemplateXlsx } from '@/lib/xlsx';

const keys = (o: unknown, prefix = ''): string[] =>
  Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );

describe('prospect import file', () => {
  it('the template header is exactly the shared 19-column list', async () => {
    expect(templateColumns.map((c) => c.key)).toEqual([...IMPORT_COLUMNS]);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await (await buildTemplateXlsx(templateColumns, 'prospek')).arrayBuffer());
    const header = (wb.worksheets[0]!.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([...IMPORT_COLUMNS]);
  }, 30_000);

  it('keeps codes and phones as Text and offers the 13 categories and 4 sources as dropdowns', () => {
    const text = templateColumns.filter((c) => c.text).map((c) => c.key);
    expect(text).toEqual(['phone', 'kecamatanCode', 'kelurahanCode', 'gridCell', 'ownerDepotCode', 'sourceId']);
    expect(templateColumns.find((c) => c.key === 'category')!.options).toHaveLength(13);
    expect(templateColumns.find((c) => c.key === 'category')!.options).toContain('tempat_ibadah');
    expect(templateColumns.find((c) => c.key === 'source')!.options).toEqual(['overture', 'osm', 'foursquare_os', 'internal']);
  });

  it('names the required columns the header lacks; extras and optional ones are fine', () => {
    expect(missingColumns({ name: 'x', category: 'x', lat: '1', lng: '1', source: 'osm', license: 'ODbL-1.0', extra: 'y' })).toEqual([]);
    expect(missingColumns({ name: 'x', lat: '1' })).toEqual(['category', 'lng', 'source', 'license']);
    expect([...REQUIRED_COLUMNS]).toEqual(['name', 'category', 'lat', 'lng', 'source', 'license']);
  });

  it('shapes a record into the 19 string columns and ignores extras', () => {
    const [r] = toImportRows([{ name: 'Kos', lat: '-6.2', zzz: 'ignored' }]);
    expect(Object.keys(r!)).toEqual([...IMPORT_COLUMNS]);
    expect(r).toMatchObject({ name: 'Kos', lat: '-6.2', phone: '' });
  });

  it('hashes the parsed rows: same rows same hash, any change a different one', () => {
    const a = toImportRows([{ name: 'A' }]);
    expect(rowsHash(a)).toBe(rowsHash(toImportRows([{ name: 'A' }])));
    expect(rowsHash(a)).not.toBe(rowsHash(toImportRows([{ name: 'B' }])));
    expect(rowsHash(a)).not.toBe(rowsHash([...a, ...a]));
  });

  it('has the same dictionary keys in id and en', () => {
    expect(keys(en).sort()).toEqual(keys(id).sort());
  });
});
