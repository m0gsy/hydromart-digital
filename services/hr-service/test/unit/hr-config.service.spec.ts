import { ConfigService } from '@nestjs/config';
import { SettingsCache, SettingRow } from '@hydromart/platform';

import { HrConfigService } from '../../src/config/hr-config.service';

class FakeSource {
  constructor(private readonly rows: SettingRow[]) {}
  async loadAll(): Promise<SettingRow[]> {
    return this.rows;
  }
}

const ENV: Record<string, string> = {
  HR_SERVICE_PORT: '3018',
  RATE_LIMIT_TTL_SECONDS: '60',
  RATE_LIMIT_MAX: '100',
  HR_WORK_START_TIME: '08:00',
  HR_LATE_TOLERANCE_MINUTES: '15',
  HR_LATE_DEDUCTION_IDR: '10000',
  HR_DAILY_RATE_TRAINING_IDR: '30000',
  HR_ABSENCE_DEDUCTION_IDR: '0',
  HR_STANDARD_WORKING_MINUTES: '480',
  HR_FACE_MATCH_THRESHOLD: '0.62',
  HR_FACE_DUPLICATE_THRESHOLD: '0.75',
};

function config(overrides: Record<string, string> = {}): ConfigService {
  const env = { ...ENV, ...overrides };
  return {
    get: <T>(k: string, d?: T) => (env[k] ?? d) as T,
    getOrThrow: (k: string) => {
      if (env[k] == null) throw new Error(`missing ${k}`);
      return env[k];
    },
  } as unknown as ConfigService;
}

async function cacheWith(rows: SettingRow[]): Promise<SettingsCache> {
  const c = new SettingsCache(new FakeSource(rows));
  await c.refresh();
  return c;
}

const depotId = '11111111-1111-1111-1111-111111111111';

describe('HrConfigService', () => {
  it('reads scalar config from ENV', () => {
    const svc = new HrConfigService(config(), new SettingsCache(new FakeSource([])));
    expect(svc.port).toBe(3018);
    expect(svc.faceMatchThreshold).toBeCloseTo(0.62);
    expect(svc.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
  });

  it('falls through to ENV defaults with no overrides', async () => {
    const svc = new HrConfigService(config(), await cacheWith([]));
    expect(svc.lateDeductionAmount()).toBe(10000);
    expect(svc.workStartTime()).toBe('08:00');
    expect(svc.standardWorkingMinutes()).toBe(480);
  });

  it('honors a per-depot override', async () => {
    const cache = await cacheWith([
      { scope: 'DEPOT', depotId, key: 'lateDeductionAmount', value: '20000' },
      { scope: 'GLOBAL', depotId: null, key: 'workStartTime', value: '07:30' },
    ]);
    const svc = new HrConfigService(config(), cache);
    expect(svc.lateDeductionAmount(depotId)).toBe(20000);
    expect(svc.lateDeductionAmount()).toBe(10000); // no depot → global absent → env
    expect(svc.workStartTime()).toBe('07:30'); // global override applies network-wide
  });

  // The network-wide (no depot) read of every tunable the payroll and performance engines
  // ask for, plus the outbound service targets.
  it('serves every remaining tunable from its ENV default when no depot is given', async () => {
    const svc = new HrConfigService(
      config({
        HR_OVERTIME_MULTIPLIER_PCT: '150',
        HR_OVERTIME_OFF_DAY_MULTIPLIER_PCT: '200',
        HR_ANNUAL_LEAVE_QUOTA_DAYS: '12',
        HR_WEEKLY_OFF_DAYS: '0,6',
      }),
      await cacheWith([]),
    );
    expect(svc.overtimeMultiplierPct()).toBe(150);
    expect(svc.overtimeOffDayMultiplierPct()).toBe(200);
    expect(svc.annualLeaveQuotaDays()).toBe(12);
    expect(svc.weeklyOffDays()).toBe('0,6');
    expect(svc.performanceWeights()).toEqual({ attendance: 40, discipline: 30, sales: 30 });
    expect(svc.performanceSalesTarget()).toBe(0);
  });

  // Depot SOP. Every one of these ships EMPTY/0, which is what keeps an unconfigured depot
  // on the old payroll — so the default read is the behaviour worth pinning.
  it('serves the depot SOP tunables as off by default, and honours a per-depot override', async () => {
    const off = new HrConfigService(config(), await cacheWith([]));
    expect(off.dailySalesBonusTiers()).toBe('');
    expect(off.lateFineCsv(false)).toBe('');
    expect(off.lateFineCsv(true)).toBe('');
    expect(off.lateTier2AfterMinutes()).toBe(0);
    expect(off.absentAfterMinutes()).toBe(0);

    const svc = new HrConfigService(
      config(),
      await cacheWith([
        { scope: 'DEPOT', depotId, key: 'dailySalesBonusTiers', value: '120:15000' },
        { scope: 'DEPOT', depotId, key: 'lateFineStaff', value: '10000,15000,20000' },
        { scope: 'DEPOT', depotId, key: 'lateFineManager', value: '15000,20000,25000' },
        { scope: 'DEPOT', depotId, key: 'lateTier2AfterMinutes', value: '70' },
        { scope: 'DEPOT', depotId, key: 'absentAfterMinutes', value: '130' },
      ]),
    );
    expect(svc.dailySalesBonusTiers(depotId)).toBe('120:15000');
    expect(svc.lateFineCsv(false, depotId)).toBe('10000,15000,20000');
    expect(svc.lateFineCsv(true, depotId)).toBe('15000,20000,25000');
    expect(svc.lateTier2AfterMinutes(depotId)).toBe(70);
    expect(svc.absentAfterMinutes(depotId)).toBe(130);
  });

  // Q-13. The store keeps percentages ×100 because it is integer-only, so the thing that
  // matters here is that they come back as real percentages and the rupiah ceilings do not.
  it('divides the stored ×100 percentages back, and leaves the rupiah ceilings alone', async () => {
    const svc = new HrConfigService(config(), await cacheWith([]));

    expect(svc.statutoryRates()).toEqual({
      healthEmployeePct: 1,
      healthCeilingIdr: 12_000_000,
      jhtEmployeePct: 2,
      jpEmployeePct: 1,
      jpCeilingIdr: 10_547_400,
      occupationalCostPct: 5,
      occupationalCostCapIdr: 500_000,
      noNpwpSurchargePct: 20,
    });
  });

  it('takes a per-depot statutory override', async () => {
    const cache = await cacheWith([
      { scope: 'DEPOT', depotId, key: 'bpjsJhtEmployeePctX100', value: '300' },
      { scope: 'DEPOT', depotId, key: 'bpjsJpCeilingIdr', value: '11000000' },
    ]);
    const svc = new HrConfigService(config(), cache);

    expect(svc.statutoryRates(depotId).jhtEmployeePct).toBe(3);
    expect(svc.statutoryRates(depotId).jpCeilingIdr).toBe(11_000_000);
    expect(svc.statutoryRates().jhtEmployeePct).toBe(2);
  });

  // B-19. The dev fallback is what keeps CI and a local box running on throwaway data;
  // production is held to a real key by env validation, not by this getter.
  it('reads the face encryption key, falling back for dev', () => {
    const cache = new SettingsCache(new FakeSource([]));
    expect(new HrConfigService(config(), cache).faceEncryptionKey).toBe('hydromart-dev-face-key');
    expect(
      new HrConfigService(config({ HR_FACE_ENCRYPTION_KEY: 'real-key' }), cache).faceEncryptionKey,
    ).toBe('real-key');
  });

  it('reads the crm notification target from ENV', () => {
    const svc = new HrConfigService(
      config({ CRM_SERVICE_URL: 'http://crm:3012', INTERNAL_SERVICE_KEY: 'k' }),
      new SettingsCache(new FakeSource([])),
    );
    expect(svc.crmService).toEqual({ url: 'http://crm:3012', internalKey: 'k' });
  });

  it('parses corsOrigins into a trimmed list', () => {
    const svc = new HrConfigService(
      config({ CORS_ALLOWED_ORIGINS: 'http://a.com, http://b.com ' }),
      new SettingsCache(new FakeSource([])),
    );
    expect(svc.corsOrigins).toEqual(['http://a.com', 'http://b.com']);
  });
});

/**
 * The TER table is typed into a settings screen, so it is parsed and validated on every
 * read rather than trusted. A refused table behaves as no table at all — which keeps the
 * annualised method running — and says why in the log, because silently withholding by a
 * different method is how a payslip goes wrong for a year.
 */
describe('PPh 21 TER table', () => {
  const table = JSON.stringify({
    A: [{ upToIdr: 6_000_000, rate: 0 }, { upToIdr: null, rate: 0.02 }],
    B: [{ upToIdr: 7_000_000, rate: 0 }, { upToIdr: null, rate: 0.01 }],
    C: [{ upToIdr: null, rate: 0.005 }],
  });

  it('is empty when nothing is configured, which is the shipped state', async () => {
    const svc = new HrConfigService(config(), await cacheWith([]));
    expect(svc.pph21TerTable()).toEqual({});
  });

  it('parses a complete table and turns the open-ended top band into Infinity', async () => {
    const svc = new HrConfigService(config({ HR_PPH21_TER_TABLE_JSON: table }), await cacheWith([]));
    const parsed = svc.pph21TerTable();
    expect(parsed.A?.[1]).toEqual({ upToIdr: Number.POSITIVE_INFINITY, rate: 0.02 });
    expect(parsed.C).toHaveLength(1);
  });

  it('ignores a table that is not valid JSON', async () => {
    const svc = new HrConfigService(config({ HR_PPH21_TER_TABLE_JSON: '{oops' }), await cacheWith([]));
    expect(svc.pph21TerTable()).toEqual({});
  });

  // Half a table is the dangerous case: it would change method for some employees only.
  it('ignores a table that fails validation', async () => {
    const partial = JSON.stringify({ A: [{ upToIdr: null, rate: 0.02 }] });
    const svc = new HrConfigService(
      config({ HR_PPH21_TER_TABLE_JSON: partial }),
      await cacheWith([]),
    );
    expect(svc.pph21TerTable()).toEqual({});
  });

  it('takes a per-depot table, like every other statutory number', async () => {
    const svc = new HrConfigService(
      config(),
      await cacheWith([{ scope: 'DEPOT', depotId, key: 'pph21TerTableJson', value: table }]),
    );
    expect(svc.pph21TerTable(depotId).A).toHaveLength(2);
    expect(svc.pph21TerTable()).toEqual({});
  });
});
