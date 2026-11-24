import { InternalServerErrorException } from '@nestjs/common';

import { belumAda, ditahan, ok } from '../../src/application/ai-read/envelope';
import {
  COMPLEMENT_FLAG,
  SMALL_GROUP_FLAG,
  SMALL_GROUP_MIN,
  PersonalDataError,
  assertNoPersonalData,
  suppressSmallGroups,
} from '../../src/application/ai-read/masking';
import { parsePeriod } from '../../src/application/ai-read/period';

describe('suppressSmallGroups', () => {
  it('returns a group of 1 or 2 as "kurang dari 3" with no number, and shows 0 and 3 as they are', () => {
    const { cells } = suppressSmallGroups([
      { key: 'a', people: 2 },
      { key: 'b', people: 0 },
      { key: 'c', people: 3 },
      { key: 'd', people: 1 },
    ]);
    expect(cells).toEqual([
      { key: 'a', value: null, flag: SMALL_GROUP_FLAG },
      { key: 'b', value: 0 },
      { key: 'c', value: 3 },
      { key: 'd', value: null, flag: SMALL_GROUP_FLAG },
    ]);
  });

  const held = (out: ReturnType<typeof suppressSmallGroups>, people: number[]) =>
    out.cells.reduce((sum, c, i) => sum + (c.value === null ? people[i] : 0), 0);

  it('holds back more cells until the held-back people are at least 6, when a total is published', () => {
    // 1,1,50: two small cells hold 2 people, so the 50 goes with them
    const a = suppressSmallGroups(
      [
        { key: 'a', people: 1 },
        { key: 'b', people: 1 },
        { key: 'c', people: 50 },
      ],
      52,
    );
    expect(a.cells.map((c) => c.value)).toEqual([null, null, null]);
    expect(a.cells[2].flag).toBe(COMPLEMENT_FLAG);
    expect(a.total).toBe(52);
    // 2,2,40: 4 held people is not enough either
    const b = suppressSmallGroups(
      [
        { key: 'a', people: 2 },
        { key: 'b', people: 2 },
        { key: 'c', people: 40 },
      ],
      44,
    );
    expect(b.cells.map((c) => c.value)).toEqual([null, null, null]);
    expect(b.total).toBe(44);
  });

  it('with one small cell, adds the smallest other non-empty cells until 6 people are held', () => {
    const out = suppressSmallGroups(
      [
        { key: 'a', people: 2 },
        { key: 'b', people: 9 },
        { key: 'c', people: 4 },
        { key: 'd', people: 0 },
      ],
      15,
    );
    expect(out.cells).toEqual([
      { key: 'a', value: null, flag: SMALL_GROUP_FLAG },
      { key: 'b', value: 9 },
      { key: 'c', value: null, flag: COMPLEMENT_FLAG },
      { key: 'd', value: 0 },
    ]);
    expect(out.total).toBe(15);
    expect(held(out, [2, 9, 4, 0])).toBeGreaterThanOrEqual(2 * SMALL_GROUP_MIN);
  });

  it('holds back the total when the cells run out before 6 people are held', () => {
    expect(
      suppressSmallGroups(
        [
          { key: 'a', people: 2 },
          { key: 'b', people: 0 },
        ],
        2,
      ),
    ).toEqual({
      cells: [
        { key: 'a', value: null, flag: SMALL_GROUP_FLAG },
        { key: 'b', value: 0 },
      ],
      total: null,
      totalFlag: COMPLEMENT_FLAG,
    });
  });

  it('leaves a total alone when no cell is small, and holds nothing extra when no total is published', () => {
    const big = suppressSmallGroups(
      [
        { key: 'a', people: 5 },
        { key: 'b', people: 4 },
      ],
      9,
    );
    expect(big.total).toBe(9);
    const none = suppressSmallGroups([
      { key: 'a', people: 1 },
      { key: 'b', people: 50 },
    ]);
    expect(none.cells.map((c) => c.value)).toEqual([null, 50]);
    expect(none.total).toBeNull();
  });
});

describe('assertNoPersonalData', () => {
  it('lets counts, opaque ids, dates, depot names and a label through', () => {
    expect(() =>
      assertNoPersonalData({
        customers: 12,
        couriers: [{ id: '6f0c1c8e-5d9b-4a53-9f3f-0a1b2c3d4e5f', deliveries: 4 }],
        depotName: 'Depot Cikini',
        label: 'Depot Cikini',
        from: '2026-11-25T03:00:00.000Z',
        range: '2026-11-01 2026-11-30',
        byDepot: { '88888888-8888-4888-8888-888888888888': 3 },
        omzet: '8500000',
      }),
    ).not.toThrow();
  });

  it('refuses a personal field by its normalised key, however deep', () => {
    for (const key of [
      'phone',
      'Name',
      'full_name',
      'Full-Name',
      'nama',
      'namaLengkap',
      'firstName',
      'last_name',
      'customerName',
      'courierName',
      'address',
      'Alamat',
      'email',
      'noHp',
      'no_hp',
      'hp',
      'telepon',
      'phoneNumber',
      'phone_number',
    ]) {
      expect(() => assertNoPersonalData({ rows: [{ [key]: 'x' }] })).toThrow(PersonalDataError);
    }
  });

  it('refuses a phone number or an email in any string value, alone or inside text', () => {
    for (const text of [
      '08123456789',
      '+628123456789',
      '0812-3456-789',
      '62 812 3456 789',
      '8123456789',
      'a.b@c.id',
      'hubungi 081234567890 segera',
      'kirim ke budi@mail.com ya',
    ]) {
      expect(() => assertNoPersonalData({ note: text })).toThrow(PersonalDataError);
      expect(() => assertNoPersonalData([text])).toThrow(PersonalDataError);
    }
    // a label is still scanned
    expect(() => assertNoPersonalData({ label: '081234567890' })).toThrow(PersonalDataError);
  });

  it('refuses data used as a map key', () => {
    expect(() => assertNoPersonalData({ byCustomer: { '081234567890': 3 } })).toThrow(PersonalDataError);
    expect(() => assertNoPersonalData({ 'a@b.co': 1 })).toThrow(PersonalDataError);
  });

  it('carries the rule, never the offending text', () => {
    const error = (() => {
      try {
        assertNoPersonalData({ note: 'budi@mail.com' });
      } catch (e) {
        return e as PersonalDataError;
      }
      return undefined;
    })();
    expect(error?.rule).toBe('email');
    expect(error?.message).not.toContain('budi');
  });
});

describe('answer envelope', () => {
  const base = {
    metricId: 'x.y',
    period: parsePeriod({ period: 'day', date: '2026-11-25' }, new Date()),
    scope: { depotIds: [], legalEntityIds: [] },
    unit: 'rupiah',
    asOf: new Date('2026-11-25T03:00:00.000Z'),
  };

  it('is ok with a value (0 is a value), belum_ada or ditahan with null and a reason', () => {
    expect(ok(base, 0)).toMatchObject({ status: 'ok', value: 0, asOf: '2026-11-25T03:00:00.000Z', unit: 'rupiah' });
    expect(belumAda(base, 'belum dibangun')).toMatchObject({ status: 'belum_ada', value: null, reason: 'belum dibangun' });
    expect(ditahan(base, SMALL_GROUP_FLAG)).toMatchObject({ status: 'ditahan', value: null });
    expect('reason' in ok(base, 1)).toBe(false);
  });

  it('never calls a missing value ok', () => {
    expect(() => ok(base, null)).toThrow('needs a value');
    expect(() => ok(base, undefined)).toThrow('needs a value');
  });

  it('answers a stable 500 that never echoes what tripped the guard', () => {
    for (const make of [() => ok(base, { name: 'Budi' }), () => belumAda(base, '08123456789')]) {
      const error = (() => {
        try {
          make();
        } catch (e) {
          return e as Error;
        }
        return undefined;
      })();
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect(error?.message).toBe('Jawaban ini tidak bisa dikirim.');
    }
  });

  it('lets an error that is not the guard through untouched', () => {
    const boom = {
      get inner(): never {
        throw new Error('boom');
      },
    };
    expect(() => ok(base, boom)).toThrow('boom');
  });
});
