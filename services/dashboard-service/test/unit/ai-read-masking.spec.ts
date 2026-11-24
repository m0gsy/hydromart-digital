import { belumAda, ditahan, ok } from '../../src/application/ai-read/envelope';
import {
  COMPLEMENT_FLAG,
  SMALL_GROUP_FLAG,
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

  it('holds back the next smallest cell too when a total is published beside one small cell', () => {
    const out = suppressSmallGroups(
      [
        { key: 'a', people: 2 },
        { key: 'b', people: 9 },
        { key: 'c', people: 4 },
        { key: 'd', people: 0 },
      ],
      15,
    );
    expect(out.total).toBe(15);
    expect(out.cells).toEqual([
      { key: 'a', value: null, flag: SMALL_GROUP_FLAG },
      { key: 'b', value: 9 },
      { key: 'c', value: null, flag: COMPLEMENT_FLAG },
      { key: 'd', value: 0 },
    ]);
    // 15 minus what is shown is 6 = a + c: two unknowns, so 'a' cannot be computed back
    const shown = out.cells.reduce((sum, c) => sum + (c.value ?? 0), 0);
    expect((out.total as number) - shown).toBe(6);
  });

  it('holds back the total when there is no other cell to hold back with the small one', () => {
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

  it('leaves a total alone when no cell is small, and when several are (their sum stays ambiguous)', () => {
    expect(
      suppressSmallGroups(
        [
          { key: 'a', people: 5 },
          { key: 'b', people: 4 },
        ],
        9,
      ).total,
    ).toBe(9);
    const two = suppressSmallGroups(
      [
        { key: 'a', people: 1 },
        { key: 'b', people: 2 },
        { key: 'c', people: 8 },
      ],
      11,
    );
    expect(two.total).toBe(11);
    expect(two.cells.map((c) => c.value)).toEqual([null, null, 8]);
  });
});

describe('assertNoPersonalData', () => {
  it('lets counts, opaque ids and depot names through', () => {
    expect(() =>
      assertNoPersonalData({
        customers: 12,
        couriers: [{ id: '6f0c1c8e-5d9b-4a53-9f3f-0a1b2c3d4e5f', deliveries: 4 }],
        depotName: 'Depot Cikini',
      }),
    ).not.toThrow();
  });

  it('refuses a personal field by its key, however deep', () => {
    for (const key of ['phone', 'Name', 'fullName', 'nama', 'customerName', 'courierName', 'address', 'alamat', 'email', 'noHp']) {
      expect(() => assertNoPersonalData({ rows: [{ [key]: 'x' }] })).toThrow(/personal field at \$\.rows\[0\]/);
    }
  });

  it('refuses text that is a phone number or an email under any key', () => {
    for (const text of ['08123456789', '+628123456789', '0812-3456-789', '62 812 3456 789', 'a.b@c.id']) {
      expect(() => assertNoPersonalData({ note: text })).toThrow(/phone number or email/);
    }
    expect(() =>
      assertNoPersonalData({ note: '2026-11-25T03:00:00.000Z', id: '6f0c1c8e-5d9b-4a53-9f3f-0a1b2c3d4e5f' }),
    ).not.toThrow();
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

  it('refuses to send a personal field out', () => {
    expect(() => ok(base, { name: 'Budi' })).toThrow('personal field');
    expect(() => belumAda(base, '08123456789')).toThrow('phone number');
  });
});
