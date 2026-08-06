import { HrConfigService } from '../../src/config/hr-config.service';
import { AnalyticsService } from '../../src/application/services/analytics.service';
import { AnalyticsRepository } from '../../src/application/ports/analytics.repository';

function build(over: Partial<AnalyticsRepository> = {}) {
  const repo: AnalyticsRepository = {
    depotSummaryFacts: async () => new Map(),
    headcountByStatus: async () => [{ key: 'ACTIVE', count: 7 }],
    headcountByEmploymentStatus: async () => [],
    attendanceByStatus: async () => [
      { key: 'LATE', count: 2 },
      { key: 'ABSENT', count: 1 },
      { key: 'PRESENT', count: 4 },
    ],
    payrollTotals: async () => ({
      gross: 0,
      totalBonus: 0,
      totalDeduction: 0,
      net: 9_000_000,
      count: 3,
    }),
    payrollByStatus: async () => [],
    employeesForReport: async () => [],
    attendanceForReport: async () => [],
    payrollForReport: async () => [],
    lateForReport: async () => [],
    leaveForReport: async () => [],
    performanceForReport: async () => [],
    assetsForReport: async () => [],
    announcementsForReport: async () => [],
    ...over,
  };
  const config = { timeZone: 'Asia/Jakarta' } as HrConfigService;
  return new AnalyticsService(repo, config);
}

describe('AnalyticsService.depotSummary', () => {
  it('rolls up late/absent/present, MTD net, and active headcount for a depot', async () => {
    const svc = build();
    const s = await svc.depotSummary('d-1');
    expect(s).toMatchObject({
      depotId: 'd-1',
      lateToday: 2,
      absentToday: 1,
      presentToday: 4,
      payrollMtdNet: 9_000_000,
      activeHeadcount: 7,
    });
    expect(s.workDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.periodMonth).toBe(s.workDate.slice(0, 7));
  });

  it('defaults missing status groups to zero', async () => {
    const svc = build({
      attendanceByStatus: async () => [],
      headcountByStatus: async () => [],
    });
    const s = await svc.depotSummary('d-2');
    expect(s).toMatchObject({ lateToday: 0, absentToday: 0, presentToday: 0, activeHeadcount: 0 });
  });
});

describe('AnalyticsService.depotSummaryMany', () => {
  it('answers every requested depot from ONE facts read (audit S-1)', async () => {
    const depotSummaryFacts = jest.fn(async () =>
      new Map([
        [
          'd-1',
          {
            lateToday: 2,
            absentToday: 1,
            presentToday: 4,
            payrollMtdNet: 9_000_000,
            activeHeadcount: 7,
          },
        ],
      ]),
    );
    const svc = build({ depotSummaryFacts });

    const rows = await svc.depotSummaryMany(['d-1', 'd-2']);

    expect(depotSummaryFacts).toHaveBeenCalledTimes(1);
    expect(rows[0]).toMatchObject({ depotId: 'd-1', lateToday: 2, payrollMtdNet: 9_000_000 });
    // A depot with no rows still gets a card, all zeroes — a missing card reads as broken.
    expect(rows[1]).toMatchObject({
      depotId: 'd-2',
      lateToday: 0,
      absentToday: 0,
      presentToday: 0,
      payrollMtdNet: 0,
      activeHeadcount: 0,
    });
  });

  it('asks nothing for an empty depot list', async () => {
    const depotSummaryFacts = jest.fn(async () => new Map());
    const svc = build({ depotSummaryFacts });
    expect(await svc.depotSummaryMany([])).toEqual([]);
    expect(depotSummaryFacts).not.toHaveBeenCalled();
  });
});
