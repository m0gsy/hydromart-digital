import { randomUUID } from 'node:crypto';

import { DuplicateDataSubjectRequestError } from '../../src/domain/errors/auth.errors';
import { DataSubjectRequestPrismaRepository } from '../../src/infrastructure/prisma/repositories/data-subject-request.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('data-subject requests on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: DataSubjectRequestPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new DataSubjectRequestPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const customer = () =>
    prisma.customer.create({ data: { phone: `+62${Math.floor(Math.random() * 1e10)}` } });

  it('the migration installed the one-open-request index on a clean table', async () => {
    const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
      "SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'data_subject_requests_one_open'",
    );
    expect(rows[0].n).toBe(1);
  });

  it('six taps on "delete my data": one request is queued, the rest are told one is open', async () => {
    for (let i = 0; i < 5; i++) {
      const c = await customer();
      const res = await race(
        Array.from({ length: 6 }, () => () =>
          repo.create({ customerId: c.id, type: 'DELETE', reason: null }),
        ),
      );
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of res.filter((x) => x.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateDataSubjectRequestError);
      }
    }
  });

  it('a different type, or a decided request, does not block a new one', async () => {
    const c = await customer();
    const del = await repo.create({ customerId: c.id, type: 'DELETE', reason: null });
    await expect(repo.create({ customerId: c.id, type: 'EXPORT', reason: null })).resolves.toBeDefined();
    await repo.decide({ id: del.id, status: 'REJECTED', processedBy: randomUUID(), reason: 'no' });
    await expect(repo.create({ customerId: c.id, type: 'DELETE', reason: null })).resolves.toBeDefined();
  });

  it('two approvers: exactly one claims the request, and a rejection loses to a claim', async () => {
    for (let i = 0; i < 10; i++) {
      const c = await customer();
      const r = await repo.create({ customerId: c.id, type: 'DELETE', reason: null });
      const now = new Date();
      const claims = await race([
        () => repo.claim(r.id, randomUUID(), now, 600_000),
        () => repo.claim(r.id, randomUUID(), now, 600_000),
      ]);
      expect(claims.map((x) => (x as PromiseFulfilledResult<boolean>).value).filter(Boolean)).toHaveLength(1);
      await expect(
        repo.decide({ id: r.id, status: 'REJECTED', processedBy: randomUUID(), reason: 'x' }),
      ).rejects.toBeDefined();
    }
  });

  it('a stale claim can be taken over; a fresh one cannot', async () => {
    const c = await customer();
    const r = await repo.create({ customerId: c.id, type: 'DELETE', reason: null });
    const t0 = new Date('2026-10-30T10:00:00Z');
    expect(await repo.claim(r.id, randomUUID(), t0, 600_000)).toBe(true);
    expect(await repo.claim(r.id, randomUUID(), new Date(t0.getTime() + 60_000), 600_000)).toBe(false);
    expect(await repo.claim(r.id, randomUUID(), new Date(t0.getTime() + 11 * 60_000), 600_000)).toBe(true);
  });
});
