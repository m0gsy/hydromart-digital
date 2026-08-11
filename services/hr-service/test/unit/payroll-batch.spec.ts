import { AuthenticatedUser } from '@hydromart/platform';

import { Employee } from '../../prisma/generated/client';
import { EmployeeService } from '../../src/application/services/employee.service';
import { PayrollService } from '../../src/application/services/payroll.service';

/**
 * D10 — generating a depot's payroll one employee at a time.
 *
 * `POST /payroll/generate` takes a single `employeeId` and the web page is one click per
 * person, so a depot of thirty is thirty clicks with no way to tell who was missed. The
 * batch endpoint reuses `generate` per employee rather than reimplementing it, so every
 * D2/D4/D5/D7 fix applies unchanged — and so the next one does too.
 *
 * These tests are about the ORCHESTRATION, which is the only new behaviour: who is
 * included, what happens when one person fails, and whether running it twice is safe.
 * `generate` itself has 600 lines of its own tests.
 */

const user: AuthenticatedUser = { sub: 'hr', role: 'HR' as never, phone: null, depotId: null };

function employee(id: string, status: Employee['status'] = 'ACTIVE'): Employee {
  return { id, status, depotId: 'dep_1', fullName: `E ${id}` } as unknown as Employee;
}

function makeService(rows: Employee[]): {
  service: PayrollService;
  generate: jest.Mock;
  listArgs: unknown[];
} {
  const listArgs: unknown[] = [];
  const employees = {
    list: jest.fn(async (_u: AuthenticatedUser, q: unknown) => {
      listArgs.push(q);
      return { rows, total: rows.length, page: 1, pageSize: 500 };
    }),
  } as unknown as EmployeeService;

  const service = new PayrollService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    employees,
    {} as never,
  );
  const generate = jest.fn(async (_u, id: string) => ({ id: `pay_${id}` }) as never);
  (service as unknown as { generate: unknown }).generate = generate;
  return { service, generate, listArgs };
}

describe('generateBatch', () => {
  it('rejects a period that is not YYYY-MM before touching anything', async () => {
    const { service, generate } = makeService([employee('e1')]);
    await expect(service.generateBatch(user, 'dep_1', '2026-8')).rejects.toThrow(/YYYY-MM/);
    expect(generate).not.toHaveBeenCalled();
  });

  it('generates for every active employee of the depot', async () => {
    const { service, generate, listArgs } = makeService([employee('e1'), employee('e2')]);
    const result = await service.generateBatch(user, 'dep_1', '2026-08');

    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.generated).toBe(2);
    expect(result.failed).toHaveLength(0);
    // Only ACTIVE, and only this depot — asked of the employee service, which is what
    // applies the caller's own depot scope (a manager cannot batch another depot).
    expect(listArgs[0]).toMatchObject({ depotId: 'dep_1', status: 'ACTIVE' });
  });

  it('does not stop at the first failure, and names who failed', async () => {
    const { service, generate } = makeService([employee('e1'), employee('e2'), employee('e3')]);
    generate.mockImplementation(async (_u: unknown, id: string) => {
      if (id === 'e2') throw new Error('Payroll 2026-08 sudah APPROVED, tidak bisa dibuat ulang');
      return { id: `pay_${id}` } as never;
    });

    const result = await service.generateBatch(user, 'dep_1', '2026-08');

    expect(generate).toHaveBeenCalledTimes(3);
    // The other two must still be generated: one refusal cannot decide 29 people's payday.
    expect(result.generated).toBe(2);
    expect(result.failed).toEqual([
      {
        employeeId: 'e2',
        name: 'E e2',
        reason: 'Payroll 2026-08 sudah APPROVED, tidak bisa dibuat ulang',
      },
    ]);
  });

  it('is safe to run twice — the second run is the same work, not double work', async () => {
    const { service, generate } = makeService([employee('e1'), employee('e2')]);
    const first = await service.generateBatch(user, 'dep_1', '2026-08');
    const second = await service.generateBatch(user, 'dep_1', '2026-08');
    expect(second).toEqual(first);
    // `generate` is idempotent per (employee, period) via the unique index and rewrites the
    // DRAFT in place, so re-running is a rewrite rather than a duplicate.
    expect(generate).toHaveBeenCalledTimes(4);
  });

  it('reports an empty depot as zero rather than as success with nothing done', async () => {
    const { service } = makeService([]);
    const result = await service.generateBatch(user, 'dep_1', '2026-08');
    expect(result).toEqual({ generated: 0, failed: [] });
  });
});
