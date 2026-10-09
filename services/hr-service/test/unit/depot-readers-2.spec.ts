import { AuthenticatedUser } from '@hydromart/platform';

import { Employee } from '../../prisma/generated/client';
import { AnnouncementService } from '../../src/application/services/announcement.service';
import { PerformanceService } from '../../src/application/services/performance.service';

const HOME = '11111111-1111-1111-1111-111111111111';
const AWAY = '22222222-2222-2222-2222-222222222222';
const hr: AuthenticatedUser = { sub: 'hr', role: 'HR' as never, phone: null, depotId: null };

const lent = {
  id: 'e1',
  employeeCode: 'EMP-1',
  fullName: 'Budi',
  position: 'Kurir',
  departmentId: null,
  depotId: AWAY,
  homeDepotId: HOME,
} as unknown as Employee;

describe('performance follows the home depot while lent', () => {
  it('asks calendar, sales, weekly-off, target and weights of the home depot', async () => {
    const holidays = { listDates: jest.fn(async (_d: string | null) => [] as string[]) };
    const sales = {
      depotSales: jest.fn(async (_d: string) => 100),
      depotDailyGallons: jest.fn(async () => null),
    };
    const seen: Record<string, string | null> = {};
    const config = {
      weeklyOffDays: (d: string | null) => ((seen.off = d), ''),
      performanceSalesTarget: (d: string | null) => ((seen.target = d), 100),
      performanceWeights: (d: string | null) => ((seen.weights = d), { attendance: 40, discipline: 30, sales: 30 }),
    };
    const svc = new PerformanceService(
      {} as never,
      { getById: async () => lent } as never,
      { summary: async () => ({ presentDays: 20, lateDays: 0, leaveDays: 0, pendingDays: 0 }) } as never,
      {} as never,
      config as never,
      holidays as never,
      sales as never,
    );
    await svc.score(hr, 'e1', '2026-07');
    expect(holidays.listDates.mock.calls[0][0]).toBe(HOME);
    expect(sales.depotSales.mock.calls[0][0]).toBe(HOME);
    expect(seen).toEqual({ off: HOME, target: HOME, weights: HOME });
  });
});

describe('the announcement feed asks for the home depot too', () => {
  it('passes homeDepotId to the feed query', async () => {
    const listFeedFor = jest.fn(async () => []);
    const svc = new AnnouncementService(
      { listFeedFor } as never,
      {} as never,
      { getSelf: async () => lent } as never,
    );
    await svc.listForSelf({ sub: 'a', role: 'STAFF_DEPOT' as never, phone: null, depotId: AWAY });
    expect((listFeedFor.mock.calls as unknown[][])[0][0]).toMatchObject({ depotId: AWAY, homeDepotId: HOME });
  });
});
