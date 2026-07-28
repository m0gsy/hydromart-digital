import { describe, expect, it } from 'vitest';

import {
  enumCell,
  intCell,
  numberCell,
  phoneCell,
  prepareRows,
  type ImportColumn,
} from '@/components/csv-import';

const COLUMNS: ImportColumn[] = [
  { key: 'fullName', required: true, example: 'Budi' },
  { key: 'phone', required: true, example: '081234567890' },
  { key: 'salaryType', required: true, example: 'DAILY', parse: enumCell(['DAILY', 'MONTHLY']) },
  { key: 'dailyRate', example: '150000', parse: intCell },
];

/** prepareRows always returns one entry per record; unwrap it without a non-null assertion. */
function firstRow(records: Parameters<typeof prepareRows>[0], columns: ImportColumn[]) {
  const [row] = prepareRows(records, columns);
  if (!row) throw new Error('prepareRows returned nothing');
  return row;
}

describe('prepareRows', () => {
  it('builds a payload for a complete row', () => {
    const row = firstRow(
      [{ fullName: 'Budi', phone: '0812', salaryType: 'daily', dailyRate: '150000' }],
      COLUMNS,
    );
    expect(row).toEqual({
      row: 1,
      raw: expect.anything(),
      payload: { fullName: 'Budi', phone: '0812', salaryType: 'DAILY', dailyRate: 150000 },
    });
  });

  it('omits empty optional columns instead of sending empty strings', () => {
    const row = firstRow(
      [{ fullName: 'Budi', phone: '0812', salaryType: 'MONTHLY', dailyRate: '' }],
      COLUMNS,
    );
    expect(row.payload).not.toHaveProperty('dailyRate');
  });

  it('rejects a row missing a required column', () => {
    const row = firstRow([{ fullName: '', phone: '0812', salaryType: 'DAILY' }], COLUMNS);
    expect(row.payload).toBeUndefined();
    expect(row.error).toContain('fullName');
  });

  it('rejects a row whose enum cell is out of range', () => {
    const row = firstRow(
      [{ fullName: 'Budi', phone: '0812', salaryType: 'WEEKLY' }],
      COLUMNS,
    );
    expect(row.error).toBe('salaryType: harus salah satu dari DAILY/MONTHLY');
  });

  it('rejects a non-numeric number cell rather than coercing it to 0', () => {
    const row = firstRow(
      [{ fullName: 'Budi', phone: '0812', salaryType: 'DAILY', dailyRate: 'seratus' }],
      COLUMNS,
    );
    expect(row.error).toContain('bukan angka');
  });

  it('rejects a decimal in a whole-number cell instead of truncating it', () => {
    const row = firstRow(
      [{ fullName: 'Budi', phone: '0812', salaryType: 'DAILY', dailyRate: '150.0' }],
      COLUMNS,
    );
    expect(row.error).toContain('bukan angka bulat');
  });

  it('numbers rows from 1 and keeps good rows alongside bad ones', () => {
    const rows = prepareRows(
      [
        { fullName: 'Budi', phone: '0812', salaryType: 'DAILY', dailyRate: '150000' },
        { fullName: '', phone: '0813', salaryType: 'DAILY' },
      ],
      COLUMNS,
    );
    expect(rows.map((r) => r.row)).toEqual([1, 2]);
    expect(rows[0]?.payload).toBeDefined();
    expect(rows[1]?.error).toBeDefined();
  });
});

describe('intCell', () => {
  it('accepts Indonesian thousand separators, dot or comma', () => {
    expect(intCell('150.000')).toBe(150000);
    expect(intCell('1,250,000')).toBe(1250000);
    expect(intCell('20000')).toBe(20000);
  });

  it('rejects a separator that is not a thousand group', () => {
    expect(() => intCell('150.00')).toThrow();
    expect(() => intCell('1.2345')).toThrow();
  });
});

describe('numberCell', () => {
  it('reads a decimal percentage with either separator', () => {
    expect(numberCell('7.5')).toBe(7.5);
    expect(numberCell('7,5')).toBe(7.5);
  });

  it('rejects an empty cell instead of returning 0', () => {
    expect(() => numberCell(' ')).toThrow();
  });
});

describe('phoneCell', () => {
  it('canonicalizes every local form to +628…', () => {
    expect(phoneCell('081234567890')).toBe('+6281234567890');
    expect(phoneCell('6281234567890')).toBe('+6281234567890');
    expect(phoneCell('+6281234567890')).toBe('+6281234567890');
    expect(phoneCell('0812-3456-7890')).toBe('+6281234567890');
  });

  it('accepts a number Excel stripped the leading zero from', () => {
    // Harmless: the canonical form drops the 0 anyway, so 81… means the same number.
    expect(phoneCell('81234567890')).toBe('+6281234567890');
  });

  it('rejects scientific notation instead of guessing the lost digits', () => {
    expect(() => phoneCell('8.12E+10')).toThrow(/notasi ilmiah/);
    expect(() => phoneCell('8,1235E+11')).toThrow(/notasi ilmiah/);
  });

  it('rejects a landline or a number that is too short', () => {
    expect(() => phoneCell('02112345678')).toThrow(/bukan nomor HP/);
    expect(() => phoneCell('0812345')).toThrow(/bukan nomor HP/);
  });
});

describe('column options and field alias', () => {
  const columns: ImportColumn[] = [
    {
      key: 'depotCode',
      field: 'depotId',
      required: true,
      example: 'JKT-01',
      parse: (raw) => (raw === 'JKT-01' ? 'depot-uuid-1' : (() => { throw new Error('tidak dikenal'); })()),
    },
    { key: 'itemType', required: true, example: 'GALON', options: ['GALON', 'TUTUP'] },
  ];

  it('posts the resolved value under the field name, not the header name', () => {
    const row = firstRow([{ depotCode: 'JKT-01', itemType: 'GALON' }], columns);
    expect(row.payload).toEqual({ depotId: 'depot-uuid-1', itemType: 'GALON' });
    expect(row.payload).not.toHaveProperty('depotCode');
  });

  it('uses options as the parser when no explicit one is given', () => {
    expect(firstRow([{ depotCode: 'JKT-01', itemType: 'galon' }], columns).payload).toMatchObject({
      itemType: 'GALON',
    });
    expect(firstRow([{ depotCode: 'JKT-01', itemType: 'AIR' }], columns).error).toContain(
      'GALON/TUTUP',
    );
  });

  it('reports the header name in the error, not the field name', () => {
    expect(firstRow([{ depotCode: 'SBY-99', itemType: 'GALON' }], columns).error).toBe(
      'depotCode: tidak dikenal',
    );
  });
});
