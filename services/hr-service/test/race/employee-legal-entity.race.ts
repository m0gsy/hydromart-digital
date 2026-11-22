import { randomUUID } from 'node:crypto';

import { StaleWriteError } from '@hydromart/platform';

import { parseCalendarDay } from '../../src/domain/legal-entity';
import { EmployeeLegalEntityPrismaRepository } from '../../src/infrastructure/prisma/employee-legal-entity.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('employee legal entities on real Postgres (HD-5)', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: EmployeeLegalEntityPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new EmployeeLegalEntityPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  it('twenty screens dating two employees on one day, in both orders: one lands, nineteen 409, no deadlock', async () => {
    const person = () => prisma.employee.create({
      data: {
        employeeCode: `E-${randomUUID().slice(0, 8)}`,
        fullName: 'Budi',
        phone: '0811',
        position: 'Kasir',
        employmentStatus: 'PERMANENT',
        joinDate: new Date('2026-01-01'),
        salaryType: 'MONTHLY',
        monthlyRate: 5_000_000,
      },
    });
    const emp = await person();
    const other = await person();
    const entities = [randomUUID(), randomUUID(), randomUUID()];
    const day = parseCalendarDay('2026-12-01')!;
    const results = await race(
      Array.from({ length: 20 }, (_, i) => () =>
        repo.assign({
          employeeIds: i % 2 ? [emp.id, other.id] : [other.id, emp.id],
          legalEntityId: entities[i % 3],
          effectiveFrom: day,
          recordedBy: null,
          seen: new Map(),
        }),
      ),
    );
    // Exactly one wrote; the rest asked for what it wrote (a no-op) or are told the day changed.
    const kept = results.filter((r): r is PromiseFulfilledResult<unknown[]> => r.status === 'fulfilled');
    expect(kept.filter((r) => r.value.length > 0)).toHaveLength(1);
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(refused.every((r) => r.reason instanceof StaleWriteError)).toBe(true);
    expect(refused.length).toBeGreaterThan(0);
    const rows = await prisma.employeeLegalEntity.findMany({ where: { employeeId: { in: [emp.id, other.id] } } });
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.legalEntityId)).size).toBe(1);
    expect(entities).toContain(rows[0].legalEntityId);
    const [history] = (await repo.histories()).filter((h) => h.employeeId === emp.id);
    expect(history.points[0].effectiveFrom).toBe('2026-12-01');
  });
});
