import { randomUUID } from 'node:crypto';

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

  it('twenty people dating one employee on one day: no error, one row, one of their entities', async () => {
    const emp = await prisma.employee.create({
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
    const entities = [randomUUID(), randomUUID(), randomUUID()];
    const day = parseCalendarDay('2026-12-01')!;
    const results = await race(
      Array.from({ length: 20 }, (_, i) => () =>
        repo.assign({ employeeIds: [emp.id], legalEntityId: entities[i % 3], effectiveFrom: day, recordedBy: null }),
      ),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    const rows = await prisma.employeeLegalEntity.findMany({ where: { employeeId: emp.id } });
    expect(rows).toHaveLength(1);
    expect(entities).toContain(rows[0].legalEntityId);
    const [history] = (await repo.histories()).filter((h) => h.employeeId === emp.id);
    expect(history.points[0].effectiveFrom).toBe('2026-12-01');
  });
});
