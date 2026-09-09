import { AuthenticatedUser } from '@hydromart/platform';

import { HrConfigService } from '../../src/config/hr-config.service';
import { AnalyticsService } from '../../src/application/services/analytics.service';
import { AnalyticsRepository } from '../../src/application/ports/analytics.repository';
import { Employee } from '../../prisma/generated/client';

/**
 * CA-1-62 — the directory export could not be imported back.
 *
 * `/hr/employees` offers "Ekspor" next to "Impor", and the import template declares 29
 * columns. The export answered 11 of them. An HR officer who exported the directory, fixed
 * a typo in Excel and imported the file back silently emptied NIK, NPWP, both BPJS numbers,
 * the bank account, PTKP class, birth date, gender, address, both contract dates and the
 * emergency contact off every row it touched — an employee's whole payroll and tax
 * identity, gone because a screen offered a round trip it could not complete.
 *
 * `depotCode` is the one template column still absent, deliberately: depot codes live in
 * depot-service and an export must not gain a new way to fail. The export is depot-scoped,
 * so its value is constant and known to whoever ran it.
 */

const hq: AuthenticatedUser = { sub: 'hr', role: 'HR' as never, phone: null, depotId: null };

/*
 * The import page's column list (apps/web/src/app/hr/employees/import/page.tsx), minus
 * depotCode. Copied rather than imported: this service must not depend on the web app.
 */
const IMPORT_COLUMNS = [
  'employeeCode',
  'fullName',
  'phone',
  'position',
  'departmentCode',
  'role',
  'employmentStatus',
  'joinDate',
  'contractEndDate',
  'exitDate',
  'salaryType',
  'dailyRate',
  'monthlyRate',
  'supervisorCode',
  'shiftName',
  'email',
  'nik',
  'birthDate',
  'gender',
  'address',
  'ptkpStatus',
  'npwp',
  'bpjsKes',
  'bpjsTk',
  'bankName',
  'bankAccount',
  'emergencyName',
  'emergencyPhone',
];

const BOSS = {
  id: 'e-boss',
  employeeCode: 'HR-0001',
  fullName: 'Sri Lestari',
  phone: '081100000001',
  email: null,
  position: 'Kepala Depot',
  departmentId: null,
  role: 'DEPOT_HEAD',
  employmentStatus: 'PERMANENT',
  salaryType: 'MONTHLY',
  dailyRate: null,
  monthlyRate: { toNumber: () => 7_500_000 },
  status: 'ACTIVE',
  joinDate: new Date('2024-02-01T00:00:00Z'),
  contractEndDate: null,
  exitDate: null,
  supervisorId: null,
  shiftId: null,
  nik: null,
  birthDate: null,
  gender: null,
  address: null,
  ptkpStatus: null,
  npwp: null,
  bpjsKes: null,
  bpjsTk: null,
  bankName: null,
  bankAccount: null,
  emergencyName: null,
  emergencyPhone: null,
};

const STAFF = {
  ...BOSS,
  id: 'e-2',
  employeeCode: 'HR-0002',
  fullName: 'Budi Santoso',
  phone: '081234567890',
  email: 'budi@example.com',
  position: 'Kurir',
  departmentId: 'dep-1',
  role: 'STAFF_DEPOT',
  employmentStatus: 'PROBATION',
  salaryType: 'DAILY',
  dailyRate: { toNumber: () => 150_000 },
  monthlyRate: null,
  joinDate: new Date('2026-01-15T00:00:00Z'),
  contractEndDate: new Date('2027-01-14T00:00:00Z'),
  exitDate: new Date('2026-08-31T00:00:00Z'),
  supervisorId: 'e-boss',
  shiftId: 'sh-1',
  nik: '3201234567890123',
  birthDate: new Date('1998-03-09T00:00:00Z'),
  gender: 'MALE',
  address: 'Jl. Melati No. 4, Bogor',
  ptkpStatus: 'K1',
  npwp: '09.254.294.3-407.000',
  bpjsKes: '0001234567890',
  bpjsTk: '99001234567',
  bankName: 'BCA',
  bankAccount: '1234567890',
  emergencyName: 'Ani Santoso',
  emergencyPhone: '081298765432',
};

function build(rows: unknown[]) {
  const repo = {
    employeesForReport: async () => rows as Employee[],
    departmentCodesByIds: async (ids: readonly string[]) =>
      new Map(ids.includes('dep-1') ? [['dep-1', 'OPS']] : []),
    shiftNamesByIds: async (ids: readonly string[]) =>
      new Map(ids.includes('sh-1') ? [['sh-1', 'Pagi']] : []),
  } as unknown as AnalyticsRepository;
  const config = { timeZone: 'Asia/Jakarta' } as HrConfigService;
  return new AnalyticsService(repo, config);
}

describe('CA-1-62 the employee export can be imported back', () => {
  it('answers every column the import template declares', async () => {
    const report = await build([STAFF, BOSS]).employeeReport(hq);
    const missing = IMPORT_COLUMNS.filter((c) => !report.headers.includes(c));
    expect(missing).toEqual([]);
  });

  it('carries the payroll and tax identity a re-import would otherwise erase', async () => {
    const svc = build([STAFF, BOSS]);
    const report = await svc.employeeReport(hq);
    const cell = (name: string) => report.rows[0][report.headers.indexOf(name)];

    expect(cell('nik')).toBe('3201234567890123');
    expect(cell('npwp')).toBe('09.254.294.3-407.000');
    expect(cell('bpjsKes')).toBe('0001234567890');
    expect(cell('bpjsTk')).toBe('99001234567');
    expect(cell('bankName')).toBe('BCA');
    expect(cell('bankAccount')).toBe('1234567890');
    expect(cell('ptkpStatus')).toBe('K1');
    expect(cell('birthDate')).toBe('1998-03-09');
    expect(cell('gender')).toBe('MALE');
    expect(cell('address')).toBe('Jl. Melati No. 4, Bogor');
    expect(cell('emergencyName')).toBe('Ani Santoso');
    expect(cell('emergencyPhone')).toBe('081298765432');
    expect(cell('contractEndDate')).toBe('2027-01-14');
    expect(cell('exitDate')).toBe('2026-08-31');
    expect(cell('email')).toBe('budi@example.com');
    expect(cell('role')).toBe('STAFF_DEPOT');

    // And it reaches the file, not only the report object.
    const csv = svc.csv(report);
    expect(csv).toContain('3201234567890123');
    expect(csv).toContain('Jl. Melati No. 4, Bogor');
  });

  it('writes the codes a human types, not the uuids the database stores', async () => {
    const report = await build([STAFF, BOSS]).employeeReport(hq);
    const cell = (name: string) => report.rows[0][report.headers.indexOf(name)];

    expect(cell('departmentCode')).toBe('OPS');
    expect(cell('shiftName')).toBe('Pagi');
    // The supervisor is another row in this same result set — no second query for it.
    expect(cell('supervisorCode')).toBe('HR-0001');
    expect(JSON.stringify(report.rows)).not.toContain('dep-1');
    expect(JSON.stringify(report.rows)).not.toContain('e-boss');
  });

  it('leaves the label blank when a lookup has nothing to say', async () => {
    const report = await build([BOSS]).employeeReport(hq);
    const cell = (name: string) => report.rows[0][report.headers.indexOf(name)];

    expect(cell('departmentCode')).toBe('');
    expect(cell('shiftName')).toBe('');
    expect(cell('supervisorCode')).toBe('');
    expect(cell('exitDate')).toBe('');
  });
});
