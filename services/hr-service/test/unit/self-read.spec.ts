import { NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Attendance, Employee } from '../../prisma/generated/client';
import { AttendanceService } from '../../src/application/services/attendance.service';
import { PayrollService } from '../../src/application/services/payroll.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';
import { AttendanceRepository } from '../../src/application/ports/attendance.repository';
import { PayrollRepository } from '../../src/application/ports/payroll.repository';
import { fakeIdentity } from './support/identity';

const user: AuthenticatedUser = {
  sub: 'auth-1',
  role: 'STAFF_DEPOT' as never,
  phone: null,
  depotId: 'd1',
};
const employee = { id: 'e1', depotId: 'd1', authSubjectId: 'auth-1', status: 'ACTIVE' } as Employee;

describe('self-scoped reads', () => {
  it('attendance.listSelf resolves the caller and filters by their employee id', async () => {
    let filter: { employeeId?: string } = {};
    const repo = {
      findByEmployeeAndDate: async () => null,
      summary: async () => ({ presentDays: 0, lateDays: 0, leaveDays: 0 }),
      create: async () => ({}) as never,
      patchCheckOut: async () => ({}) as never,
      list: async (f: { employeeId?: string }) => {
        filter = f;
        return { rows: [{ id: 'a1' } as Attendance], total: 1 };
      },
    } as unknown as AttendanceRepository;
    const employees = {
      findByAuthSubjectId: async () => employee,
    } as unknown as EmployeeRepository;
    const svc = new AttendanceService(repo, {} as never, {} as never, employees, {} as never);
    const out = await svc.listSelf(user, { page: 1, pageSize: 30 });
    expect(filter.employeeId).toBe('e1');
    expect(out.total).toBe(1);
  });

  it('payroll.listSelf scopes to the caller’s employee id', async () => {
    let filter: { employeeId?: string } = {};
    const repo = {
      list: async (f: { employeeId?: string }) => {
        filter = f;
        return { rows: [], total: 0 };
      },
    } as unknown as PayrollRepository;
    const employees = { getSelf: async () => employee } as unknown as EmployeeService;
    const svc = new PayrollService(
      repo,
      {} as never,
      {} as never,
      {} as never,
      employees,
      {} as never,
    );
    await svc.listSelf(user, { page: 1, pageSize: 30 });
    expect(filter.employeeId).toBe('e1');
  });

  // The authorisation boundary behind "Slip Gaji Saya". `getById` next to it is hrView-gated
  // and an ordinary employee has no such capability, so these two are the only way they can
  // open their own payslip — and they must not open anybody else's.
  describe('payroll self detail', () => {
    const payroll = { id: 'p1', employeeId: 'e1', periodMonth: '2026-07', items: [] };
    const build = (found: unknown) => {
      const repo = { findById: async () => found } as unknown as PayrollRepository;
      const employees = { getSelf: async () => employee } as unknown as EmployeeService;
      return new PayrollService(
        repo,
        {} as never,
        {} as never,
        {} as never,
        employees,
        {} as never,
      );
    };

    it('returns the caller’s own payroll', async () => {
      await expect(build(payroll).getSelfById(user, 'p1')).resolves.toMatchObject({ id: 'p1' });
    });

    // 404, not 403: a colleague's payroll id is not something an employee should be able
    // to confirm the existence of by the shape of the error.
    it('404s on another employee’s payroll, indistinguishably from a missing one', async () => {
      const other = { ...payroll, id: 'p2', employeeId: 'e2' };
      await expect(build(other).getSelfById(user, 'p2')).rejects.toBeInstanceOf(NotFoundException);
      await expect(build(null).getSelfById(user, 'p9')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('applies the same ownership rule to the slip PDF', async () => {
      const other = { ...payroll, id: 'p2', employeeId: 'e2' };
      await expect(build(other).selfSlip(user, 'p2')).rejects.toBeInstanceOf(NotFoundException);
      // The happy path renders a real PDF through the shared layout.
      const pdf = await build({ ...payroll, status: 'PAID', net: 1_000_000 }).selfSlip(user, 'p1');
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    });
  });

  it('getSelf throws 404 when the account is not linked to an employee', async () => {
    const employees = { findByAuthSubjectId: async () => null } as unknown as EmployeeRepository;
    const svc = new EmployeeService(employees, fakeIdentity());
    await expect(svc.getSelf(user)).rejects.toBeInstanceOf(NotFoundException);
  });
});
