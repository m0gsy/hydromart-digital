import { randomUUID } from 'node:crypto';

import { EventPublisherPort } from '../../src/application/ports/event-publisher.port';
import { EventRelayService } from '../../src/application/services/event-relay.service';
import { emptyChecklist, FranchiseAppStage } from '../../src/domain/franchise-application';
import { EventOutboxPrismaRepository } from '../../src/infrastructure/prisma/event-outbox.prisma.repository';
import { FranchiseApplicationPrismaRepository } from '../../src/infrastructure/prisma/franchise-application.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

/** Every call answers after a short pause, so two senders really overlap. */
function transport(fail = false): EventPublisherPort & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    publish: async (_event, _payload, _at, eventId) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      if (fail) throw new Error('admin-service responded 503');
      sent.push(eventId);
    },
  };
}

describeRace('franchise application events on real Postgres (HD-7)', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let applications: FranchiseApplicationPrismaRepository;
  let outbox: EventOutboxPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    applications = new FranchiseApplicationPrismaRepository(prisma as never);
    outbox = new EventOutboxPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const submit = () =>
    applications.create({
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

  it('twenty applications at once: twenty events, each keyed by its own application', async () => {
    const results = await race(Array.from({ length: 20 }, () => submit));
    const ids = results.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id);
    const rows = await prisma.webhookEventOutbox.findMany({
      where: { eventId: { in: ids.map((id) => `franchise.application_submitted:${id}`) } },
    });
    expect(rows).toHaveLength(20);
    for (const row of rows) {
      const id = row.eventId.split(':')[1];
      expect(row.payload).toEqual({ applicationId: id, city: 'Depok', province: 'Jawa Barat' });
      expect(row.status).toBe('PENDING');
    }
  });

  // The transaction for real: an event that cannot be written takes the application with it.
  it('an application whose event cannot be written is not saved', async () => {
    const before = await prisma.franchiseApplication.count();
    await prisma.$executeRawUnsafe(
      // NOT VALID: only rows written from now on are checked; the earlier tests' rows stay.
      `ALTER TABLE "webhook_event_outbox" ADD CONSTRAINT "race_refuse" CHECK ("event" <> 'franchise.application_submitted') NOT VALID`,
    );
    try {
      await expect(submit()).rejects.toThrow(/race_refuse/);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "webhook_event_outbox" DROP CONSTRAINT "race_refuse"`);
    }
    expect(await prisma.franchiseApplication.count()).toBe(before);
  });

  /*
   * The inline send and a sweep, or two sweeps, can hold the same row at once. A send that
   * failed must not reopen a row another send closed, whichever lands last.
   */
  it('a send that worked is never reported as owed again, whichever write lands last', async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, submit));
    const good = new EventRelayService(outbox, transport());
    const bad = new EventRelayService(outbox, transport(true));
    await race(
      ids.flatMap((app) => {
        const key = `franchise.application_submitted:${app.id}`;
        return [() => good.flush(key), () => bad.flush(key)];
      }),
    );
    const rows = await prisma.webhookEventOutbox.findMany({
      where: { eventId: { in: ids.map((a) => `franchise.application_submitted:${a.id}`) } },
    });
    expect(rows.map((r) => r.status)).toEqual(Array(10).fill('DONE'));
  });

  it('two overlapping sweeps leave every due event DONE, none lost and none counted as failed', async () => {
    await prisma.webhookEventOutbox.updateMany({ data: { status: 'DONE' } });
    const ids = await Promise.all(Array.from({ length: 12 }, submit));
    const sender = transport();
    const relay = new EventRelayService(outbox, sender);
    const now = new Date(Date.now() + 1000);
    await race([() => relay.processDue(now), () => relay.processDue(now)]);

    const keys = ids.map((a) => `franchise.application_submitted:${a.id}`);
    const rows = await prisma.webhookEventOutbox.findMany({ where: { eventId: { in: keys } } });
    expect(rows.every((r) => r.status === 'DONE' && r.attempts === 0)).toBe(true);
    // Each sent at least once; a double send is admin-service's to dedupe (one per eventId).
    expect(new Set(sender.sent)).toEqual(new Set(keys));
  });
});
