import { AuthenticatedUser } from '@hydromart/platform';

import { PerformanceReview } from '../../prisma/generated/client';
import { PerformanceService } from '../../src/application/services/performance.service';
import { EmployeeService } from '../../src/application/services/employee.service';
import { PerformanceRepository, PerformanceWrite } from '../../src/application/ports/performance.repository';

const user: AuthenticatedUser = { sub: 'reviewer-1', role: 'HR' as never, phone: null, depotId: null };

function build() {
  let lastWrite: PerformanceWrite | undefined;
  const repo: PerformanceRepository = {
    upsert: async (data) => {
      lastWrite = data;
      return { id: 'r1', ...data } as unknown as PerformanceReview;
    },
    listByEmployee: async () => [{ id: 'r1' } as PerformanceReview],
    findById: async () => null,
  };
  const getById = jest.fn(async () => ({ id: 'e1', depotId: 'd1' }));
  const employees = { getById } as unknown as EmployeeService;
  return { svc: new PerformanceService(repo, employees), getById, write: () => lastWrite };
}

describe('PerformanceService', () => {
  it('upserts with the reviewer stamped and defaults for optional fields', async () => {
    const { svc, getById, write } = build();
    await svc.upsert(user, { employeeId: 'e1', periodMonth: '2026-07', score: 88 });
    expect(getById).toHaveBeenCalledWith(user, 'e1'); // 404 + depot check
    expect(write()).toEqual({
      employeeId: 'e1',
      periodMonth: '2026-07',
      score: 88,
      metrics: {},
      reviewerId: 'reviewer-1',
      note: null,
    });
  });

  it('passes through metrics + note when given', async () => {
    const { svc, write } = build();
    await svc.upsert(user, { employeeId: 'e1', periodMonth: '2026-07', score: 90, metrics: { punctuality: 9 }, note: 'solid' });
    expect(write()?.metrics).toEqual({ punctuality: 9 });
    expect(write()?.note).toBe('solid');
  });

  it('list checks the employee first, then returns reviews', async () => {
    const { svc, getById } = build();
    const rows = await svc.listByEmployee(user, 'e1');
    expect(getById).toHaveBeenCalledWith(user, 'e1');
    expect(rows).toHaveLength(1);
  });
});
