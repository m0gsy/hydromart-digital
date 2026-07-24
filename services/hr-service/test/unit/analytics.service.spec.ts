import { AuthenticatedUser } from '@hydromart/platform';

import { HrConfigService } from '../../src/config/hr-config.service';
import { AnalyticsService } from '../../src/application/services/analytics.service';
import {
  AnalyticsRepository,
  AttendanceWithEmployee,
  PayrollWithEmployee,
} from '../../src/application/ports/analytics.repository';
import { Employee } from '../../prisma/generated/client';

const hq: AuthenticatedUser = { sub: 'hr', role: 'HR' as never, phone: null, depotId: null };
const manager: AuthenticatedUser = { sub: 'mgr', role: 'DEPOT_MANAGER' as never, phone: null, depotId: 'd-locked' };

function build(over: Partial<AnalyticsRepository> = {}) {
  const calls: { depotId?: string }[] = [];
  const repo: AnalyticsRepository = {
    headcountByStatus: async (depotId) => {
      calls.push({ depotId });
      return [{ key: 'ACTIVE', count: 3 }, { key: 'RESIGNED', count: 1 }];
    },
    headcountByEmploymentStatus: async () => [{ key: 'PERMANENT', count: 2 }],
    attendanceByStatus: async () => [{ key: 'PRESENT', count: 2 }, { key: 'LATE', count: 1 }],
    payrollTotals: async () => ({ gross: 1000, totalBonus: 100, totalDeduction: 50, net: 1050, count: 2 }),
    payrollByStatus: async () => [{ key: 'DRAFT', count: 2 }],
    employeesForReport: async () => [],
    attendanceForReport: async () => [],
    payrollForReport: async () => [],
    ...over,
  };
  const config = { timeZone: 'Asia/Jakarta' } as HrConfigService;
  return { svc: new AnalyticsService(repo, config), calls };
}

describe('AnalyticsService.dashboard', () => {
  it('aggregates headcount, attendance, and payroll; totals headcount from status groups', async () => {
    const { svc } = build();
    const d = await svc.dashboard(hq, { periodMonth: '2026-07' });
    expect(d.headcount.total).toBe(4); // 3 ACTIVE + 1 RESIGNED
    expect(d.headcount.byEmploymentStatus).toEqual([{ key: 'PERMANENT', count: 2 }]);
    expect(d.attendanceToday).toHaveLength(2);
    expect(d.payroll.totals.net).toBe(1050);
    expect(d.periodMonth).toBe('2026-07');
    expect(d.workDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('defaults periodMonth to the current month when omitted', async () => {
    const { svc } = build();
    const d = await svc.dashboard(hq, {});
    expect(d.periodMonth).toBe(d.workDate.slice(0, 7));
  });

  it('scopes a depot-locked role to its own depot', async () => {
    const { svc, calls } = build();
    const d = await svc.dashboard(manager, {});
    expect(d.depotId).toBe('d-locked');
    expect(calls[0].depotId).toBe('d-locked');
  });

  it('rejects a depot-locked role requesting another depot', async () => {
    const { svc } = build();
    await expect(svc.dashboard(manager, { depotId: 'someone-else' })).rejects.toThrow(/depotnya sendiri/);
  });
});

describe('AnalyticsService CSV exports', () => {
  it('emits an employee CSV with a header + one row per employee', async () => {
    const rows = [
      { employeeCode: 'HR-0001', fullName: 'A', phone: '08', email: null, position: 'Kasir',
        employmentStatus: 'PERMANENT', salaryType: 'DAILY', dailyRate: { toNumber: () => 50000 },
        monthlyRate: null, status: 'ACTIVE', joinDate: new Date('2026-01-15T00:00:00Z') },
    ] as unknown as Employee[];
    const { svc } = build({ employeesForReport: async () => rows });
    const csv = await svc.employeesCsv(hq);
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('employeeCode');
    expect(lines[1]).toBe('HR-0001,A,08,,Kasir,PERMANENT,DAILY,50000,0,ACTIVE,2026-01-15');
  });

  it('emits an attendance CSV joining the employee code + name', async () => {
    const rows = [
      { workDate: new Date('2026-07-01T00:00:00Z'), status: 'LATE', checkInAt: null, checkOutAt: null,
        lateMinutes: 12, workingMinutes: null, employee: { employeeCode: 'HR-0001', fullName: 'A' } },
    ] as unknown as AttendanceWithEmployee[];
    const { svc } = build({ attendanceForReport: async () => rows });
    const csv = await svc.attendanceCsv(hq, { from: '2026-07-01', to: '2026-07-31' });
    expect(csv.split('\r\n')[1]).toBe('2026-07-01,HR-0001,A,LATE,,,12,');
  });

  it('emits a payroll CSV with money as plain numbers', async () => {
    const dec = (n: number) => ({ toNumber: () => n });
    const rows = [
      { periodMonth: '2026-07', status: 'APPROVED', gross: dec(1000), totalBonus: dec(100),
        totalDeduction: dec(50), net: dec(1050), presentDays: 20, employee: { employeeCode: 'HR-0001', fullName: 'A' } },
    ] as unknown as PayrollWithEmployee[];
    const { svc } = build({ payrollForReport: async () => rows });
    const csv = await svc.payrollCsv(hq, { periodMonth: '2026-07' });
    expect(csv.split('\r\n')[1]).toBe('2026-07,HR-0001,A,APPROVED,1000,100,50,1050,20');
  });
});
