import { randomUUID } from 'node:crypto';

import { emptyChecklist, FranchiseAppStage } from '../../src/domain/franchise-application';
import { FranchiseApplicationPrismaRepository } from '../../src/infrastructure/prisma/franchise-application.prisma.repository';
import { describeRace, freshPrisma } from './db';

/*
 * HD-6 H5, on a real Postgres: the stage history is written with the application and each stage
 * change; the summary counts a purged rejection from the history (and counts it once); and the purge
 * cuts the history's link to the application it belonged to.
 */
describeRace('franchise application stage history on real Postgres (HD-6 H5)', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: FranchiseApplicationPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new FranchiseApplicationPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const submit = () =>
    repo.create({
      applicantName: 'Rudi Hartono',
      applicantPhone: '+6281211112222',
      proposedCode: `DPK-${randomUUID().slice(0, 6)}`,
      proposedName: 'Depot Sumber Jernih',
      city: 'Depok',
      province: 'Jawa Barat',
      lat: -6.4,
      lng: 106.8,
      investmentAmount: 120_000_000,
      projectedMonthlyRevenue: 18_000_000,
      checklist: emptyChecklist(),
      stage: FranchiseAppStage.PENDING,
    });
  const window = () => [new Date(Date.now() - 3_600_000), new Date(Date.now() + 3_600_000)] as const;

  it('records the stage history, counts by current stage, and still counts a rejection after its purge, once', async () => {
    const a = await submit();
    const b = await submit();
    const c = await submit();
    await repo.updateIfOpen(a.id, { stage: FranchiseAppStage.SURVEY });
    await repo.updateIfOpen(b.id, { stage: FranchiseAppStage.REJECTED, decisionReason: 'x' });
    const events = await prisma.franchiseApplicationStageEvent.findMany({ where: { applicationId: b.id } });
    expect(events.map((e) => e.stage).sort()).toEqual(['PENDING', 'REJECTED']);

    const [from, to] = window();
    expect(await repo.summary(from, to)).toEqual({
      total: 3,
      byStage: { PENDING: 1, DOC_VERIFICATION: 0, SURVEY: 1, APPROVED: 0, REJECTED: 1 },
    });

    // its "application submitted" event is not delivered yet: inside the grace period the application stays
    const later = new Date(Date.now() + 60_000);
    expect(await repo.purgeRejectedBefore(later)).toBe(0);
    expect(await prisma.franchiseApplication.count({ where: { id: b.id } })).toBe(1);
    // delivered: now it goes, and its outbox row (application id, city) goes with it
    await prisma.webhookEventOutbox.updateMany({ data: { status: 'DONE' } });
    const key = `franchise.application_submitted:${b.id}`;
    expect(await prisma.webhookEventOutbox.count({ where: { eventId: key } })).toBe(1);
    expect(await repo.purgeRejectedBefore(later)).toBe(1);
    expect(await prisma.webhookEventOutbox.count({ where: { eventId: key } })).toBe(0);
    // past the ceiling an undelivered event no longer holds an application back: both go, the event is never sent
    const d = await submit();
    await repo.updateIfOpen(d.id, { stage: FranchiseAppStage.REJECTED, decisionReason: 'x' });
    const dKey = `franchise.application_submitted:${d.id}`;
    expect(await prisma.webhookEventOutbox.count({ where: { eventId: dKey, status: 'PENDING' } })).toBe(1);
    expect(await repo.purgeRejectedBefore(later)).toBe(0); // rejected just now: still in its grace period
    const farFuture = new Date(Date.now() + 40 * 86_400_000); // cutoff + 30 days is behind the rejection
    expect(await repo.purgeRejectedBefore(farFuture)).toBe(1);
    expect(await prisma.franchiseApplication.count({ where: { id: d.id } })).toBe(0);
    expect(await prisma.webhookEventOutbox.count({ where: { eventId: dKey } })).toBe(0);
    // the other applications' rows are untouched
    expect(await prisma.webhookEventOutbox.count()).toBe(2);
    expect(await prisma.franchiseApplication.count({ where: { id: b.id } })).toBe(0);
    // its history no longer points at it, nor at anything else: the link is gone, the counts stay
    expect(await prisma.franchiseApplicationStageEvent.count({ where: { applicationId: b.id } })).toBe(0);
    expect(await repo.summary(from, to)).toEqual({
      // b and d were both purged: each still counts once, as a rejection
      total: 4,
      byStage: { PENDING: 1, DOC_VERIFICATION: 0, SURVEY: 1, APPROVED: 0, REJECTED: 2 },
    });
    expect(c.id).toBeTruthy();
  });
});
