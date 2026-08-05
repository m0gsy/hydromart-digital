import { AuthenticatedUser } from '@hydromart/platform';
import type { Response } from 'express';

// Mock the xlsx + pdf helpers so the format branches don't need the exceljs/pdfkit runtime.
jest.mock('../../src/domain/xlsx', () => ({
  toXlsx: jest.fn(async () => Buffer.from('xlsx-bytes')),
}));
jest.mock('../../src/domain/payroll-pdf', () => ({
  tableReportPdf: jest.fn(async () => Buffer.from('pdf-bytes')),
}));

import { Prisma } from '../../prisma/generated/client';
import {
  AnalyticsRepository,
  AnnouncementWithStats,
  AssetWithHolder,
  AttendanceWithEmployee,
  LeaveWithEmployee,
  ReviewWithEmployee,
} from '../../src/application/ports/analytics.repository';
import { AnalyticsService } from '../../src/application/services/analytics.service';
import { HrConfigService } from '../../src/config/hr-config.service';
import { ReportsController } from '../../src/modules/reports.controller';
import { tableReportPdf } from '../../src/domain/payroll-pdf';

const hq: AuthenticatedUser = { sub: 'hr', role: 'HR' as never, phone: null, depotId: null };
const manager: AuthenticatedUser = {
  sub: 'mgr',
  role: 'MANAGER' as never,
  phone: null,
  depotId: 'd-locked',
};

const employee = { employeeCode: 'EMP-001', fullName: 'Budi' };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function build(over: Partial<AnalyticsRepository> = {}) {
  const seen: Record<string, unknown[]> = {};
  const track =
    <T>(name: string, value: T) =>
    async (...args: unknown[]) => {
      seen[name] = args;
      return value;
    };
  const repo: AnalyticsRepository = {
    depotSummaryFacts: async () => new Map(),
    headcountByStatus: async () => [],
    headcountByEmploymentStatus: async () => [],
    attendanceByStatus: async () => [],
    payrollTotals: async () => ({ gross: 0, totalBonus: 0, totalDeduction: 0, net: 0, count: 0 }),
    payrollByStatus: async () => [],
    employeesForReport: async () => [],
    attendanceForReport: async () => [],
    payrollForReport: async () => [],
    lateForReport: track('late', [
      {
        workDate: day('2026-07-03'),
        checkInAt: new Date('2026-07-03T02:35:00.000Z'),
        lateMinutes: 35,
        employee,
      },
    ] as unknown as AttendanceWithEmployee[]),
    leaveForReport: track('leave', [
      {
        type: 'ANNUAL',
        startDate: day('2026-07-10'),
        endDate: day('2026-07-12'),
        workingDays: 3,
        status: 'APPROVED',
        reason: 'acara keluarga',
        decisionNote: null,
        employee,
      },
    ] as unknown as LeaveWithEmployee[]),
    performanceForReport: track('performance', [
      {
        periodMonth: '2026-07',
        score: new Prisma.Decimal(82.5),
        attendanceScore: new Prisma.Decimal(90),
        disciplineScore: null,
        salesScore: null,
        managerNote: 'stabil',
        employee,
      },
    ] as unknown as ReviewWithEmployee[]),
    assetsForReport: track('assets', [
      {
        code: 'MTR-0001',
        type: 'MOTORCYCLE',
        name: 'Honda Beat',
        brand: null,
        serialNo: null,
        value: new Prisma.Decimal(15_000_000),
        status: 'ASSIGNED',
        holder: employee,
      },
      {
        code: 'MTR-0002',
        type: 'MOTORCYCLE',
        name: 'Vario',
        brand: 'Honda',
        serialNo: 'SN-2',
        value: null,
        status: 'AVAILABLE',
        holder: null,
      },
    ] as unknown as AssetWithHolder[]),
    announcementsForReport: track('announcements', [
      {
        publishedAt: new Date('2026-07-01T03:00:00.000Z'),
        title: 'Libur',
        level: 'INFO',
        audienceSize: 40,
        targets: [
          { dimension: 'DEPOT', value: 'd1' },
          { dimension: 'COMPANY', value: null },
        ],
        _count: { reads: 12 },
      },
      {
        publishedAt: new Date('2026-07-02T03:00:00.000Z'),
        title: 'Nihil',
        level: 'INFO',
        audienceSize: 0,
        targets: [],
        _count: { reads: 0 },
      },
    ] as unknown as AnnouncementWithStats[]),
    ...over,
  };
  const config = { timeZone: 'Asia/Jakarta' } as HrConfigService;
  return { svc: new AnalyticsService(repo, config), seen };
}

describe('C4 report builders', () => {
  const range = { from: '2026-07-01', to: '2026-07-31' };

  it('late lists only the late days, with the minutes', async () => {
    const { svc } = build();
    const out = await svc.lateReport(hq, range);
    expect(out.headers).toEqual([
      'workDate',
      'employeeCode',
      'fullName',
      'checkInAt',
      'lateMinutes',
    ]);
    expect(out.rows[0]).toEqual(['2026-07-03', 'EMP-001', 'Budi', '2026-07-03T02:35:00.000Z', 35]);
  });

  it('leave carries the frozen working-day count and the decision note', async () => {
    const { svc } = build();
    const out = await svc.leaveReport(hq, range);
    expect(out.rows[0]).toEqual([
      'EMP-001',
      'Budi',
      'ANNUAL',
      '2026-07-10',
      '2026-07-12',
      3,
      'APPROVED',
      'acara keluarga',
      '',
    ]);
  });

  it('performance leaves an unmeasured component BLANK, never 0', async () => {
    const { svc } = build();
    const out = await svc.performanceReport(hq, { periodMonth: '2026-07' });
    // 90 was measured; discipline and sales were not, and a 0 there would read as a failure.
    expect(out.rows[0]).toEqual(['2026-07', 'EMP-001', 'Budi', 82.5, 90, '', '', 'stabil']);
  });

  // The mirror image of the row above: the components that WERE measured are the ones that
  // may be missing, and a review with no manager note prints an empty cell.
  it('performance prints the measured components and blanks a missing note', async () => {
    const { svc } = build({
      performanceForReport: async () =>
        [
          {
            periodMonth: '2026-07',
            score: null,
            attendanceScore: null,
            disciplineScore: new Prisma.Decimal(70),
            salesScore: new Prisma.Decimal(60),
            managerNote: null,
            employee: { employeeCode: 'EMP-002', fullName: 'Sari' },
          },
        ] as unknown as ReviewWithEmployee[],
    });
    const out = await svc.performanceReport(hq, { periodMonth: '2026-07' });
    expect(out.rows[0]).toEqual(['2026-07', 'EMP-002', 'Sari', 0, '', 70, 60, '']);
  });

  it('assets name the holder, or leave it blank when nobody holds it', async () => {
    const { svc } = build();
    const out = await svc.assetReport(hq);
    expect(out.rows[0]).toEqual([
      'MTR-0001',
      'MOTORCYCLE',
      'Honda Beat',
      '',
      '',
      15_000_000,
      'ASSIGNED',
      'EMP-001',
      'Budi',
    ]);
    expect(out.rows[1].slice(5)).toEqual([0, 'AVAILABLE', '', '']);
  });

  it('announcements state the read rate, and blank it rather than dividing by zero', async () => {
    const { svc } = build();
    const out = await svc.announcementReport(range);
    expect(out.rows[0]).toEqual([
      '2026-07-01T03:00:00.000Z',
      'Libur',
      'INFO',
      'DEPOT:d1 | COMPANY',
      40,
      12,
      '30%',
    ]);
    expect(out.rows[1][6]).toBe('');
  });

  it('locks a depot manager to their own depot on every C4 report', async () => {
    const { svc, seen } = build();
    await svc.lateReport(manager, { ...range, depotId: 'someone-else' }).catch(() => undefined);
    await svc.leaveReport(manager, range);
    expect(seen.leave[2]).toEqual(['d-locked']);
    await svc.performanceReport(manager, { periodMonth: '2026-07' });
    expect(seen.performance[1]).toEqual(['d-locked']);
    await svc.assetReport(manager);
    expect(seen.assets[0]).toEqual(['d-locked']);
  });

  it('passes the whole window to the announcement fetcher — it has no depot scope', async () => {
    const { svc, seen } = build();
    await svc.announcementReport(range);
    expect(seen.announcements).toEqual([new Date('2026-07-01'), new Date('2026-07-31')]);
  });
});

function fakeRes(): Response & { headers: Record<string, string>; body: unknown } {
  const res = {
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader: jest.fn((k: string, v: string) => {
      res.headers[k] = v;
    }),
    send: jest.fn((b: unknown) => {
      res.body = b;
    }),
  };
  return res as unknown as Response & { headers: Record<string, string>; body: unknown };
}

describe('ReportsController C4 delivery', () => {
  const range = { from: '2026-07-01', to: '2026-07-31' };
  const analytics = {
    lateReport: jest.fn(async () => ({ headers: ['a'], rows: [[1]] })),
    leaveReport: jest.fn(async () => ({ headers: ['a'], rows: [[1]] })),
    performanceReport: jest.fn(async () => ({ headers: ['a'], rows: [[1]] })),
    assetReport: jest.fn(async () => ({ headers: ['a'], rows: [[1]] })),
    announcementReport: jest.fn(async () => ({ headers: ['a'], rows: [[1]] })),
    csv: jest.fn(() => 'a\r\n1'),
  } as unknown as AnalyticsService;

  beforeEach(() => jest.clearAllMocks());

  it('defaults to CSV with a BOM and a named file', async () => {
    const c = new ReportsController(analytics);
    const res = fakeRes();
    await c.late({ ...range } as never, hq, res);
    expect(res.headers['Content-Disposition']).toContain('late-2026-07-01_2026-07-31.csv');
    expect(res.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(String(res.body).startsWith('﻿')).toBe(true);
  });

  it('renders a PDF with a title and the period as its subtitle', async () => {
    const c = new ReportsController(analytics);
    const res = fakeRes();
    await c.leave({ ...range, format: 'pdf' } as never, hq, res);
    expect(res.headers['Content-Type']).toBe('application/pdf');
    expect(res.headers['Content-Disposition']).toContain('.pdf');
    expect(tableReportPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Laporan Cuti',
        subtitle: '2026-07-01 s/d 2026-07-31',
        headers: ['a'],
      }),
    );
  });

  it('still serves xlsx, and every C4 route reaches its builder', async () => {
    const c = new ReportsController(analytics);
    const xlsxRes = fakeRes();
    await c.performance({ periodMonth: '2026-07', format: 'xlsx' } as never, hq, xlsxRes);
    expect(xlsxRes.headers['Content-Type']).toContain('spreadsheetml');

    await c.assets({ format: 'pdf' } as never, hq, fakeRes());
    // No period to state, so the asset register carries a title and no subtitle.
    expect(tableReportPdf).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Laporan Aset', subtitle: undefined }),
    );

    const annRes = fakeRes();
    await c.announcements({ ...range } as never, annRes);
    expect(analytics.announcementReport).toHaveBeenCalled();
    expect(annRes.headers['Content-Disposition']).toContain('announcements-');
  });
});
