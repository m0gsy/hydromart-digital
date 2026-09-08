import { AuthenticatedUser } from '@hydromart/platform';

import { AuditService } from '../../src/application/services/audit.service';
import { LeaveService } from '../../src/application/services/leave.service';
import { PayrollService } from '../../src/application/services/payroll.service';
import { EmployeeService } from '../../src/application/services/employee.service';

/**
 * CA-1-26 — five HR list endpoints answered two fields of the four their screens read.
 *
 * `HrPage<T>` (apps/web/src/lib/hr.ts:46) is `{ rows, total, page, pageSize }`, and every
 * console screen asserts it with a CAST — `api.get<HrPage<LeaveRequest>>(...)`. A cast is a
 * claim, not a check, so five endpoints could hand back `{ rows, total }` for as long as
 * nothing happened to read the missing two. The attendance and employee lists on the same
 * screens do return all four; these five were the drift.
 *
 * The triage called leave "the odd one out". It was not — a sweep found five: leave twice,
 * audit, and payroll twice. Fixing the two the row happened to name would have left three
 * endpoints lying behind the same client type, which is why this test walks all five.
 *
 * The pair matters because `page`/`pageSize` are the only two facts in the response that
 * the REPOSITORY cannot know: they are what the caller asked for, and a repository is handed
 * `skip`/`take`. So the assertion is not decoration — a paginator that ever reads
 * `data.page` would read `undefined` and silently render page NaN of N.
 */

const user: AuthenticatedUser = {
  sub: 'auth-1',
  role: 'HR' as never,
  phone: null,
  depotId: 'd1',
};

const employee = { id: 'e1', depotId: 'd1', authSubjectId: 'auth-1', status: 'ACTIVE' };
const employees = {
  getSelf: async () => employee,
} as unknown as EmployeeService;

// Every repository under test answers the two fields it legitimately owns, and no more.
const twoFieldRepo = { list: async () => ({ rows: [], total: 7 }) };

const isPage = (out: unknown, page: number, pageSize: number): void => {
  expect(out).toEqual({ rows: [], total: 7, page, pageSize });
};

describe('CA-1-26 every HR list endpoint answers the shape its screen reads', () => {
  it('leave.listSelf carries the page it was asked for', async () => {
    const svc = new LeaveService(twoFieldRepo as never, {} as never, employees, {} as never);
    isPage(await svc.listSelf(user, 3, 25), 3, 25);
  });

  it('leave.listSelf carries its own defaults when the caller names none', async () => {
    // The defaults live in the signature, so they are a fact only the service holds.
    const svc = new LeaveService(twoFieldRepo as never, {} as never, employees, {} as never);
    isPage(await svc.listSelf(user), 1, 20);
  });

  it('leave.listForApproval carries the page it resolved', async () => {
    const svc = new LeaveService(twoFieldRepo as never, {} as never, employees, {} as never);
    isPage(await svc.listForApproval(user, { page: 2, pageSize: 50 }), 2, 50);
    isPage(await svc.listForApproval(user), 1, 20);
  });

  it('audit.list carries the page it was asked for', async () => {
    const svc = new AuditService(twoFieldRepo as never);
    isPage(await svc.list({ page: 4, pageSize: 10 }), 4, 10);
  });

  it('payroll.list carries the page it was asked for', async () => {
    const svc = new PayrollService(
      twoFieldRepo as never,
      {} as never,
      {} as never,
      {} as never,
      employees,
      {} as never,
    );
    isPage(await svc.list(user, { page: 5, pageSize: 15 }), 5, 15);
  });

  it('payroll.listSelf carries the page it was asked for', async () => {
    const svc = new PayrollService(
      twoFieldRepo as never,
      {} as never,
      {} as never,
      {} as never,
      employees,
      {} as never,
    );
    isPage(await svc.listSelf(user, { page: 6, pageSize: 12 }), 6, 12);
  });
});
