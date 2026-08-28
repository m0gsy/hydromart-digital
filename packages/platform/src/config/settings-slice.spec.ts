import { SettingsCache, SettingRow } from './settings';
import { SettingDef, SettingsSliceRepository, SettingsSliceService } from './settings-slice';

const DEFS: SettingDef[] = [
  { key: 'radiusKm', label: 'Radius', type: 'number', envDefault: 5, min: 1, max: 50 },
  { key: 'fee', label: 'Ongkir', type: 'money', envDefault: 5000 },
  { key: 'label', label: 'Label', type: 'string', envDefault: 'depot' },
  { key: 'netWide', label: 'Global only', type: 'int', envDefault: 1, global: true },
  // The exact shape the live money bug is in: an int carrying a PERCENTAGE, min 0.
  {
    key: 'goldDiscountPct',
    label: 'GOLD — diskon',
    type: 'int',
    unit: '%',
    envDefault: 5,
    min: 0,
    max: 50,
  },
  {
    key: 'slots',
    label: 'Slot',
    type: 'string',
    envDefault: '09.00-11.00',
    pattern: '^\\d{2}\\.\\d{2}-\\d{2}\\.\\d{2}$',
  },
];
const BY_KEY: Record<string, SettingDef> = Object.assign(
  Object.create(null),
  Object.fromEntries(DEFS.map((d) => [d.key, d])),
);

class FakeRepo implements SettingsSliceRepository {
  rows: SettingRow[] = [];
  loads = 0;
  upserts: (SettingRow & { updatedBy: string })[] = [];
  removes: [string, string | null, string][] = [];

  async loadAll(): Promise<SettingRow[]> {
    this.loads += 1;
    return this.rows;
  }
  async upsert(row: SettingRow & { updatedBy: string }): Promise<void> {
    this.upserts.push(row);
  }
  async remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    this.removes.push([scope, depotId, key]);
  }
}

class TestSettings extends SettingsSliceService {
  constructor(repo: SettingsSliceRepository, cache: SettingsCache) {
    super(repo, cache, DEFS, BY_KEY);
  }
}

function build(ttlMs = 30_000) {
  const repo = new FakeRepo();
  const service = new TestSettings(repo, new SettingsCache(repo, ttlMs));
  return { repo, service };
}

const put = (over: Partial<Parameters<TestSettings['put']>[0]> = {}) => ({
  scope: 'GLOBAL' as const,
  depotId: null,
  key: 'radiusKm',
  value: '7',
  updatedBy: 'u1',
  ...over,
});

describe('SettingsSliceService', () => {
  it('returns the defs with the effective values, falling back to the env default', async () => {
    const { service } = build();
    const out = await service.schema(null);
    expect(out.defs).toBe(DEFS);
    expect(out.effective).toEqual({
      radiusKm: 5,
      fee: 5000,
      label: 'depot',
      netWide: 1,
      goldDiscountPct: 5,
      slots: '09.00-11.00',
    });
  });

  it('prefers a depot override over the global row', async () => {
    const { repo, service } = build();
    repo.rows = [
      { scope: 'GLOBAL', depotId: null, key: 'radiusKm', value: '9' },
      { scope: 'DEPOT', depotId: 'd1', key: 'radiusKm', value: '12' },
    ];
    expect((await service.schema('d1')).effective.radiusKm).toBe(12);
    expect((await service.schema(null)).effective.radiusKm).toBe(9);
  });

  // Q-7: the read path used to force a full table read per request, in seven services.
  it('serves repeat reads from the cache until the TTL expires', async () => {
    const { repo, service } = build();
    await service.schema(null);
    await service.schema(null);
    await service.schema(null);
    expect(repo.loads).toBe(1);
  });

  it('re-reads once the TTL has passed', async () => {
    const { repo, service } = build(0);
    await service.schema(null);
    await service.schema(null);
    expect(repo.loads).toBe(2);
  });

  // A write must be visible to the response that made it, TTL or no TTL.
  it('refreshes immediately after a write, and after a reset', async () => {
    const { repo, service } = build();
    await service.schema(null);
    await service.put(put());
    expect(repo.loads).toBe(2);
    await service.reset('GLOBAL', null, 'radiusKm');
    expect(repo.loads).toBe(3);
  });

  /*
   * This used to assert that 7500.9 is STORED as 7500 — the silent truncation, written down
   * as though it were a requirement. It is the trap, not a requirement: there is no such
   * amount as 7500,9 rupiah, so a fraction here is a typing mistake and the store now says
   * so instead of quietly keeping a different number than the one that was typed.
   */
  it('refuses a fractional rupiah rather than quietly storing a different amount', async () => {
    const { repo, service } = build();
    await expect(service.put(put({ key: 'fee', value: '7500.9' }))).rejects.toThrow(/7500/);
    expect(repo.upserts).toEqual([]);
  });

  it('stores a whole value of the def type', async () => {
    const { repo, service } = build();
    await service.put(put({ key: 'fee', value: '7500' }));
    expect(repo.upserts[0]!.value).toBe('7500');
  });

  /*
   * The write that produced a live money bug.
   *
   * `coerce('0.05', 'int')` is `Math.trunc(0.05)` — a silent 0 — and `min: 0` waves it
   * through. Production is serving goldDiscountPct = 0 against a coded default of 5, so every
   * customer the app calls GOLD has been paying full price. The field's unit is `%` and it
   * wants `5`; somebody typed the rate and was told nothing.
   */
  it('refuses a fraction in a whole-number field instead of truncating it to zero', async () => {
    const { repo, service } = build();
    await expect(service.put(put({ key: 'goldDiscountPct', value: '0.05' }))).rejects.toThrow(
      /whole number in %/,
    );
    expect(repo.upserts).toEqual([]);
  });

  // The message has to name the unit and the value to type, because that is the whole fix.
  it('says what to type instead', async () => {
    const { service } = build();
    await expect(service.put(put({ key: 'goldDiscountPct', value: '0.05' }))).rejects.toThrow(
      /5, not 0/,
    );
  });

  // The same silent zero by the other door: `coerce` returns 0 for anything unparseable.
  it('refuses a value that is not a number at all', async () => {
    const { repo, service } = build();
    await expect(
      service.put(put({ key: 'goldDiscountPct', value: 'lima persen' })),
    ).rejects.toThrow(/must be a number in %/);
    expect(repo.upserts).toEqual([]);
  });

  it('refuses an empty value rather than storing zero', async () => {
    const { repo, service } = build();
    await expect(service.put(put({ key: 'fee', value: '   ' }))).rejects.toThrow(
      /must be a number/,
    );
    expect(repo.upserts).toEqual([]);
  });

  // A whole number written with a decimal point loses nothing, so it is not a mistake.
  it('accepts a whole number written as 5.0', async () => {
    const { repo, service } = build();
    await service.put(put({ key: 'goldDiscountPct', value: '5.0' }));
    expect(repo.upserts[0]!.value).toBe('5');
  });

  // `number` fields exist to carry fractions; nothing changes for them.
  it('still accepts a fraction where the type allows one', async () => {
    const { repo, service } = build();
    await service.put(put({ key: 'radiusKm', value: '7.5' }));
    expect(repo.upserts[0]!.value).toBe('7.5');
  });

  it('writes a DEPOT override against its depot', async () => {
    const { repo, service } = build();
    await service.put(put({ scope: 'DEPOT', depotId: 'd1', value: '8' }));
    expect(repo.upserts[0]).toMatchObject({ scope: 'DEPOT', depotId: 'd1', value: '8' });
  });

  it.each([
    ['an unknown key', put({ key: 'nope' }), 'Unknown setting'],
    ['a DEPOT scope with no depot', put({ scope: 'DEPOT', depotId: null }), 'depotId required'],
    [
      'a per-depot override of a global-only key',
      put({ scope: 'DEPOT', depotId: 'd1', key: 'netWide' }),
      'global-only',
    ],
    ['a value below min', put({ value: '0' }), 'below min'],
    ['a value above max', put({ value: '99' }), 'above max'],
    // A string tunable something downstream parses must fail at the person typing it,
    // not three screens later at the reader.
    [
      'a string that does not match its pattern',
      put({ key: 'slots', value: '9-11' }),
      'must match',
    ],
  ])('refuses %s', async (_case, input, message) => {
    const { repo, service } = build();
    await expect(service.put(input)).rejects.toThrow(message);
    expect(repo.upserts).toHaveLength(0);
  });

  it('does not range-check a string setting', async () => {
    const { repo, service } = build();
    await service.put(put({ key: 'label', value: 'kantor' }));
    expect(repo.upserts[0].value).toBe('kantor');
  });

  it('accepts a string that matches its pattern', async () => {
    const { repo, service } = build();
    await service.put(put({ key: 'slots', value: '13.00-15.00' }));
    expect(repo.upserts[0].value).toBe('13.00-15.00');
  });

  it('refuses a DEPOT reset with no depot, and passes GLOBAL through as null', async () => {
    const { repo, service } = build();
    await expect(service.reset('DEPOT', null, 'radiusKm')).rejects.toThrow('depotId required');
    await service.reset('DEPOT', 'd1', 'radiusKm');
    await service.reset('GLOBAL', 'd1', 'radiusKm');
    expect(repo.removes).toEqual([
      ['DEPOT', 'd1', 'radiusKm'],
      ['GLOBAL', null, 'radiusKm'],
    ]);
  });
});
