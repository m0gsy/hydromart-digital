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
const manager: AuthenticatedUser = {
  sub: 'mgr',
  role: 'MANAGER' as never,
  phone: null,
  depotId: 'd-locked',
};

function build(over: Partial<AnalyticsRepository> = {}) {
  const calls: { depotId?: string }[] = [];
  const repo: AnalyticsRepository = {
    depotSummaryFacts: async () => new Map(),
    headcountByStatus: async (depotId) => {
      calls.push({ depotId: depotId?.[0] });
      return [
        { key: 'ACTIVE', count: 3 },
        { key: 'RESIGNED', count: 1 },
      ];
    },
    headcountByEmploymentStatus: async () => [{ key: 'PERMANENT', count: 2 }],
    attendanceByStatus: async () => [
      { key: 'PRESENT', count: 2 },
      { key: 'LATE', count: 1 },
    ],
    payrollTotals: async () => ({
      gross: 1000,
      totalBonus: 100,
      totalDeduction: 50,
      net: 1050,
      count: 2,
    }),
    payrollByStatus: async () => [{ key: 'DRAFT', count: 2 }],
    expiringDocuments: async () => [],
    endingEmployments: async () => [],
    employeesForReport: async () => [],
    departmentCodesByIds: async () => new Map<string, string>(),
    shiftNamesByIds: async () => new Map<string, string>(),
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
  return { svc: new AnalyticsService(repo, config), calls };
}

describe('AnalyticsService.dashboard', () => {
  it('aggregates headcount, attendance, and payroll; totals headcount from status groups', async () => {
    const { svc } = build();
    const d = await svc.dashboard(hq, { periodMonth: '2026-07' });
    /*
     * CA-1-61 — three, not four. The fixture holds one RESIGNED row on purpose: the total
     * summed EVERY status group, so "Total Karyawan" grew each time somebody quit, and the
     * headcount a manager plans against sat above an attendance figure counted only over
     * people who still work here.
     */
    expect(d.headcount.total).toBe(3);
    // The breakdown still carries the leaver — the total is what was wrong, not the list.
    expect(d.headcount.byStatus).toEqual(
      expect.arrayContaining([{ key: 'RESIGNED', count: 1 }]),
    );
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

  /*
   * CA-1-47 — the expiry date nobody read. It rides on the dashboard payload rather than a
   * route of its own: the screen HR opens every morning is the only place a lapsed licence
   * gets seen, and a card there costs no new way for the page to fail.
   */
  it('asks for documents expiring within thirty days of today, and passes the depot scope', async () => {
    let asked: { cutoff?: Date; depotIds?: readonly string[] } = {};
    const row = {
      employeeId: 'e-1',
      employeeCode: 'HR-0001',
      fullName: 'Budi',
      type: 'SIM',
      expiresAt: '2026-07-02',
    };
    const { svc } = build({
      expiringDocuments: async (cutoff, depotIds) => {
        asked = { cutoff, depotIds };
        return [row];
      },
    });
    const d = await svc.dashboard(manager, {});

    expect(d.documentsExpiring).toEqual([row]);
    expect(asked.depotIds).toEqual(['d-locked']);
    const days = Math.round(
      (asked.cutoff!.getTime() - Date.parse(`${d.workDate}T00:00:00.000Z`)) / 86_400_000,
    );
    expect(days).toBe(30);
  });

  /*
   * CA-1-43 — `contractEndDate` was written on every fixed-term hire and read by nothing.
   * Deliberately not a status (nobody is expired automatically), which left the date with
   * no reader at all: a contract that ran out last month looks exactly like one with two
   * years left, on every screen there is.
   */
  it('asks for the employments ending in the same window as the documents', async () => {
    let asked: Date | undefined;
    const row = {
      employeeId: 'e-1',
      employeeCode: 'HR-0001',
      fullName: 'Budi',
      employmentStatus: 'PROBATION',
      contractEndDate: '2026-07-02',
    };
    let docCutoff: Date | undefined;
    const { svc } = build({
      expiringDocuments: async (cutoff) => {
        docCutoff = cutoff;
        return [];
      },
      endingEmployments: async (cutoff, depotIds) => {
        asked = cutoff;
        expect(depotIds).toEqual(['d-locked']);
        return [row];
      },
    });
    const d = await svc.dashboard(manager, {});

    expect(d.employmentsEnding).toEqual([row]);
    // One window, not two: HR plans a renewal and a document reissue in the same sitting.
    expect(asked?.getTime()).toBe(docCutoff?.getTime());
  });

  it('rejects a depot-locked role requesting another depot', async () => {
    const { svc } = build();
    await expect(svc.dashboard(manager, { depotId: 'someone-else' })).rejects.toThrow(
      /tanggung jawabnya/,
    );
  });
});

describe('AnalyticsService CSV exports', () => {
  it('emits an employee CSV with a header + one row per employee', async () => {
    const rows = [
      {
        id: 'e-1',
        employeeCode: 'HR-0001',
        fullName: 'A',
        phone: '08',
        email: null,
        position: 'Kasir',
        departmentId: 'dep-1',
        role: 'STAFF_DEPOT',
        employmentStatus: 'PERMANENT',
        salaryType: 'DAILY',
        dailyRate: { toNumber: () => 50000 },
        monthlyRate: null,
        status: 'ACTIVE',
        joinDate: new Date('2026-01-15T00:00:00Z'),
      },
    ] as unknown as Employee[];
    const { svc } = build({
      employeesForReport: async () => rows,
      departmentCodesByIds: async () => new Map([['dep-1', 'OPS']]),
    });
    const csv = await svc.csv(await svc.employeeReport(hq));
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('employeeCode');
    // CA-1-62: every column the row does not carry still holds its place, so the file an HR
    // officer edits keeps the shape the importer reads back.
    expect(lines[1]).toBe(
      'HR-0001,A,08,,Kasir,OPS,STAFF_DEPOT,PERMANENT,DAILY,50000,0,ACTIVE,2026-01-15' +
        ','.repeat(16),
    );
  });

  it('emits an attendance CSV joining the employee code + name', async () => {
    const rows = [
      {
        workDate: new Date('2026-07-01T00:00:00Z'),
        status: 'LATE',
        checkInAt: null,
        checkOutAt: null,
        lateMinutes: 12,
        workingMinutes: null,
        employee: { employeeCode: 'HR-0001', fullName: 'A' },
      },
    ] as unknown as AttendanceWithEmployee[];
    const { svc } = build({ attendanceForReport: async () => rows });
    const csv = await svc.csv(
      await svc.attendanceReport(hq, { from: '2026-07-01', to: '2026-07-31' }),
    );
    expect(csv.split('\r\n')[1]).toBe('2026-07-01,HR-0001,A,LATE,,,12,');
  });

  it('emits a payroll CSV with money as plain numbers', async () => {
    const dec = (n: number) => ({ toNumber: () => n });
    const rows = [
      {
        periodMonth: '2026-07',
        status: 'APPROVED',
        gross: dec(1000),
        totalBonus: dec(100),
        totalDeduction: dec(50),
        net: dec(1050),
        presentDays: 20,
        employee: { employeeCode: 'HR-0001', fullName: 'A' },
      },
    ] as unknown as PayrollWithEmployee[];
    const { svc } = build({ payrollForReport: async () => rows });
    const csv = await svc.csv(await svc.payrollReport(hq, { periodMonth: '2026-07' }));
    expect(csv.split('\r\n')[1]).toBe('2026-07,HR-0001,A,APPROVED,1000,100,50,1050,20');
  });
});
