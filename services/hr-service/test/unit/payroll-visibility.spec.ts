/**
 * Owner decision 2026-11-19: pay figures go to the roles holding `payrollRead` and to no one else.
 *
 * Those roles are HR, FINANCE, SUPER_ADMIN, HEAD_OFFICE, DIREKTUR, MANAGER and FRANCHISE_OWNER.
 * SUPERVISOR, ASSISTANT_SUPERVISOR and KEPALA_DEPOT open HR (`hrView`) for attendance, leave
 * and the roster. In a depot of three or four people a payroll total IS each person's pay, so
 * the payroll runs, the slips, the payroll export, the allowance lines and an employee's own rate
 * are not theirs to read.
 */
import { ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import { AuthenticatedUser } from '@hydromart/platform';

import { AllowanceController } from '../../src/modules/allowance.controller';
import { EmployeesController } from '../../src/modules/employees.controller';
import { PayrollController } from '../../src/modules/payroll.controller';
import { ReportsController } from '../../src/modules/reports.controller';
import { mayReadPay } from '../../src/domain/pay-visibility';

const as = (role: string): AuthenticatedUser =>
  ({ sub: 'u1', role, phone: null, depotId: 'd1' }) as never;
const EMPLOYEE = { id: 'e1', fullName: 'Ani', depotId: 'd1', dailyRate: 120_000, monthlyRate: null, salaryType: 'DAILY' };

describe('pay figures by role', () => {
  const payroll = { list: jest.fn().mockResolvedValue({ rows: [] }), getById: jest.fn().mockResolvedValue({}), slip: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
  const pc = new PayrollController(payroll as never);
  const allowances = { list: jest.fn().mockResolvedValue([]) };
  const ac = new AllowanceController(allowances as never);
  const analytics = { payrollReport: jest.fn().mockResolvedValue({ columns: [], rows: [] }) };
  const rc = new ReportsController(analytics as never);
  const res = { setHeader: jest.fn(), send: jest.fn() } as unknown as Response;
  beforeEach(() => jest.clearAllMocks());

  it.each(['SUPERVISOR', 'ASSISTANT_SUPERVISOR', 'KEPALA_DEPOT'])(
    '%s reads no payroll run, slip, export or allowance',
    async (role) => {
      const u = as(role);
      expect(() => pc.list({} as never, u)).toThrow(ForbiddenException);
      await expect(pc.getById('00000000-0000-4000-8000-000000000001', u)).rejects.toThrow(ForbiddenException);
      await expect(pc.slip('00000000-0000-4000-8000-000000000001', u, res)).rejects.toThrow(ForbiddenException);
      await expect(rc.payroll({ periodMonth: '2026-11' } as never, u, res)).rejects.toThrow(ForbiddenException);
      await expect(ac.list({ employeeId: 'e1' } as never, u)).rejects.toThrow(ForbiddenException);
      expect(payroll.list).not.toHaveBeenCalled();
      expect(payroll.getById).not.toHaveBeenCalled();
      expect(payroll.slip).not.toHaveBeenCalled();
      expect(analytics.payrollReport).not.toHaveBeenCalled();
      expect(allowances.list).not.toHaveBeenCalled();
    },
  );

  it.each(['HR', 'FINANCE', 'HEAD_OFFICE', 'DIREKTUR', 'MANAGER'])('%s still reads them', async (role) => {
    const u = as(role);
    await pc.list({} as never, u);
    await pc.getById('00000000-0000-4000-8000-000000000001', u);
    await ac.list({ employeeId: 'e1' } as never, u);
    expect(payroll.list).toHaveBeenCalled();
    expect(payroll.getById).toHaveBeenCalled();
    expect(allowances.list).toHaveBeenCalled();
  });
});

describe("an employee's rate", () => {
  const emp = {
    list: jest.fn().mockResolvedValue({ rows: [EMPLOYEE], total: 1, page: 1, pageSize: 20 }),
    getById: jest.fn().mockResolvedValue(EMPLOYEE),
  };
  const c = new EmployeesController(emp as never);

  it('is blank for a role without payrollRead, on the list and the record', async () => {
    const u = as('SUPERVISOR');
    const page = await c.list({} as never, u);
    expect(page.rows[0]).toMatchObject({ fullName: 'Ani', dailyRate: null, monthlyRate: null });
    expect(await c.getById('e1', u)).toMatchObject({ fullName: 'Ani', dailyRate: null, monthlyRate: null });
  });

  it('is there for one with it', async () => {
    const u = as('MANAGER');
    expect((await c.list({} as never, u)).rows[0]).toMatchObject({ dailyRate: 120_000 });
    expect(await c.getById('e1', u)).toMatchObject({ dailyRate: 120_000 });
  });
});

describe('who reads pay', () => {
  it('is payrollRead: head office, direksi and managers too; supervisors and depot heads not', () => {
    for (const role of ['HR', 'FINANCE', 'SUPER_ADMIN', 'HEAD_OFFICE', 'DIREKTUR', 'MANAGER', 'FRANCHISE_OWNER']) {
      expect({ role, may: mayReadPay(as(role)) }).toEqual({ role, may: true });
    }
    for (const role of ['SUPERVISOR', 'ASSISTANT_SUPERVISOR', 'KEPALA_DEPOT', 'STAFF_DEPOT']) {
      expect({ role, may: mayReadPay(as(role)) }).toEqual({ role, may: false });
    }
  });
});
