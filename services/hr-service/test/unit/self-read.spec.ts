import { NotFoundException } from '@nestjs/common';
import { AuthenticatedUser } from '@hydromart/platform';

import { Attendance, Employee } from '../../prisma/generated/client';
import { AttendanceService } from '../../src/application/services/attendance.service';
import { PayrollService } from '../../src/application/services/payroll.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { EmployeeRepository } from '../../src/application/ports/employee.repository';
import { AttendanceRepository } from '../../src/application/ports/attendance.repository';
import { PayrollRepository } from '../../src/application/ports/payroll.repository';

const user: AuthenticatedUser = { sub: 'auth-1', role: 'DRIVER' as never, phone: null, depotId: 'd1' };
const employee = { id: 'e1', depotId: 'd1', authSubjectId: 'auth-1', status: 'ACTIVE' } as Employee;

describe('self-scoped reads', () => {
  it('attendance.listSelf resolves the caller and filters by their employee id', async () => {
    let filter: { employeeId?: string } = {};
    const repo = {
      findByEmployeeAndDate: async () => null,
      summary: async () => ({ presentDays: 0, lateDays: 0, leaveDays: 0 }),
      create: async () => ({}) as never,
      patchCheckOut: async () => ({}) as never,
      list: async (f: { employeeId?: string }) => { filter = f; return { rows: [{ id: 'a1' } as Attendance], total: 1 }; },
    } as unknown as AttendanceRepository;
    const employees = { findByAuthSubjectId: async () => employee } as unknown as EmployeeRepository;
    const svc = new AttendanceService(repo, {} as never, {} as never, employees, {} as never);
    const out = await svc.listSelf(user, { page: 1, pageSize: 30 });
    expect(filter.employeeId).toBe('e1');
    expect(out.total).toBe(1);
  });

  it('payroll.listSelf scopes to the caller’s employee id', async () => {
    let filter: { employeeId?: string } = {};
    const repo = { list: async (f: { employeeId?: string }) => { filter = f; return { rows: [], total: 0 }; } } as unknown as PayrollRepository;
    const employees = { getSelf: async () => employee } as unknown as EmployeeService;
    const svc = new PayrollService(repo, {} as never, {} as never, {} as never, employees, {} as never);
    await svc.listSelf(user, { page: 1, pageSize: 30 });
    expect(filter.employeeId).toBe('e1');
  });

  it('getSelf throws 404 when the account is not linked to an employee', async () => {
    const employees = { findByAuthSubjectId: async () => null } as unknown as EmployeeRepository;
    const svc = new EmployeeService(employees);
    await expect(svc.getSelf(user)).rejects.toBeInstanceOf(NotFoundException);
  });
});
