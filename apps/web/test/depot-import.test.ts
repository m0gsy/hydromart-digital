import { describe, expect, it } from 'vitest';

import { prepareRows } from '@/components/csv-import';
import { areaCell, hhmmCell, holidaysCell, plainDigitsCell } from '@/lib/depot-import-cells';
import { DEPOT_IMPORT_COLUMNS } from '@/lib/depot-import-columns';

const fails = (fn: () => unknown, text: string) => expect(fn).toThrow(text);

describe('hhmmCell', () => {
  it.each([
    ['08:00', '08:00'],
    ['8:00', '08:00'],
    ['8.30', '08:30'],
    [' 23:59 ', '23:59'],
    ['00:00', '00:00'],
  ])('reads %s as %s', (raw, out) => expect(hhmmCell(raw)).toBe(out));

  it.each(['24:00', '08:60', '8', '0800', '08:00:00', '1899-12-30', '8am', ''])(
    'refuses "%s"',
    (raw) => fails(() => hhmmCell(raw), 'notATime'),
  );
});

describe('holidaysCell', () => {
  it('reads dates with and without a label, and keeps a colon inside the label', () => {
    expect(
      holidaysCell('2026-08-17:Hari Kemerdekaan|2026-12-25| 2026-01-01 : Tahun Baru: 2026 '),
    ).toEqual([
      { date: '2026-08-17', label: 'Hari Kemerdekaan' },
      { date: '2026-12-25' },
      { date: '2026-01-01', label: 'Tahun Baru: 2026' },
    ]);
  });

  it('ignores empty items from a trailing separator', () => {
    expect(holidaysCell('2026-08-17||')).toEqual([{ date: '2026-08-17' }]);
  });

  it.each(['17/08/2026', '2026-02-30', '2026-13-01', '46251', 'x:label'])('refuses "%s"', (raw) =>
    fails(() => holidaysCell(raw), 'notADate'),
  );
});

describe('areaCell', () => {
  it('reads one ring and several rings', () => {
    expect(areaCell('-6.2,106.8|-6.2,107|-6,107')).toEqual([
      [
        { lat: -6.2, lng: 106.8 },
        { lat: -6.2, lng: 107 },
        { lat: -6, lng: 107 },
      ],
    ]);
    expect(areaCell('1,1|1,2|2,2#3,3|3,4|4,4')).toHaveLength(2);
  });

  it('refuses a decimal comma, which would shift every number after it', () => {
    fails(() => areaCell('-6,2,106,8|1,1|2,2'), 'badPair');
  });

  it.each(['-6.2', '-6.2,', ',106.8', 'a,b', '95,106', '-6.2,181', '1..2,3'])(
    'refuses the pair "%s"',
    (pair) => expect(() => areaCell(`${pair}|1,1|2,2`)).toThrow(),
  );

  it('returns no rings for blank separators only', () => {
    expect(areaCell('#')).toEqual([]);
  });
});

describe('plainDigitsCell', () => {
  it('keeps digits and refuses scientific notation', () => {
    expect(plainDigitsCell(' 1234567890 ')).toBe('1234567890');
    fails(() => plainDigitsCell('1.23457E+14'), 'scientific');
  });
});

describe('the depot import sheet', () => {
  const full = {
    code: 'JKT-01',
    name: 'Depot Cikini',
    ownershipType: 'waralaba',
    ownerId: '11111111-1111-4111-8111-111111111111',
    address: 'Jl. Cikini Raya No. 1',
    city: 'Jakarta Pusat',
    province: 'DKI Jakarta',
    lat: '-6,1944',
    lng: '106.8412',
    serviceRadiusKm: '7.5',
    deliveryFee: '5.000',
    minOrderAmount: '20000',
    contactPhone: '0812-3456-7890',
    paymentBankAccountNumber: '1234567890',
    senBuka: '08:00',
    senTutup: '20:00',
    senIstirahatMulai: '12:00',
    senIstirahatSelesai: '13:00',
    minBuka: '9.00',
    minTutup: '17:00',
    hariLibur: '2026-08-17:Kemerdekaan',
    gallonDepositIdr: '25.000',
    gallonMaxHoldDays: '10',
    areaLayanan: '-6.2,106.8|-6.2,107.0|-6.0,107.0#-5.9,106.0|-5.9,106.1|-5.8,106.1',
  };

  it('shapes one flat row into the nested payload the API takes', () => {
    const [row] = prepareRows([full], DEPOT_IMPORT_COLUMNS);
    expect(row?.error).toBeUndefined();
    expect(row?.payload).toEqual({
      code: 'JKT-01',
      name: 'Depot Cikini',
      ownershipType: 'WARALABA',
      ownerId: '11111111-1111-4111-8111-111111111111',
      address: 'Jl. Cikini Raya No. 1',
      city: 'Jakarta Pusat',
      province: 'DKI Jakarta',
      lat: -6.1944,
      lng: 106.8412,
      serviceRadiusKm: 7.5,
      deliveryFee: 5000,
      minOrderAmount: 20000,
      contactPhone: '+6281234567890',
      paymentBankAccountNumber: '1234567890',
      operatingHours: {
        mon: { open: '08:00', close: '20:00', breakStart: '12:00', breakEnd: '13:00' },
        sun: { open: '09:00', close: '17:00' },
      },
      holidays: [{ date: '2026-08-17', label: 'Kemerdekaan' }],
      settings: { gallonDepositIdr: 25000, gallonMaxHoldDays: 10 },
      serviceArea: [
        [
          { lat: -6.2, lng: 106.8 },
          { lat: -6.2, lng: 107 },
          { lat: -6, lng: 107 },
        ],
        [
          { lat: -5.9, lng: 106 },
          { lat: -5.9, lng: 106.1 },
          { lat: -5.8, lng: 106.1 },
        ],
      ],
    });
  });

  it('sends only the code for an otherwise blank row, so an update changes nothing else', () => {
    const [row] = prepareRows(
      [{ code: 'JKT-01', name: '', senBuka: '', gallonDepositIdr: '' }],
      DEPOT_IMPORT_COLUMNS,
    );
    expect(row?.payload).toEqual({ code: 'JKT-01' });
  });

  it('leaves a weekday out entirely when none of its cells is filled', () => {
    const [row] = prepareRows(
      [{ code: 'A', rabBuka: '08:00', rabTutup: '17:00' }],
      DEPOT_IMPORT_COLUMNS,
    );
    expect(row?.payload).toEqual({
      code: 'A',
      operatingHours: { wed: { open: '08:00', close: '17:00' } },
    });
  });

  it('names the column of the first bad cell', () => {
    const [row] = prepareRows([{ code: 'A', senBuka: '9am' }], DEPOT_IMPORT_COLUMNS);
    expect(row?.error).toContain('senBuka');
    expect(row?.payload).toBeUndefined();
  });

  it('requires the code', () => {
    const [row] = prepareRows([{ code: '' }], DEPOT_IMPORT_COLUMNS);
    expect(row?.error).toContain('columnRequired');
    expect(row?.payload).toBeUndefined();
  });

  it('has one column per weekday cell and per setting, with unique headers', () => {
    const keys = DEPOT_IMPORT_COLUMNS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        'senBuka',
        'minIstirahatSelesai',
        'hariLibur',
        'areaLayanan',
        'approvalAutoPassIdr',
      ]),
    );
  });
});
