import { randomUUID } from 'node:crypto';

import { WebhookDeliveryPrismaRepository } from '../../src/infrastructure/prisma/webhook-delivery.prisma.repository';
import { describeRace, freshPrisma, race } from './db';

describeRace('webhook deliveries on real Postgres', () => {
  let drop: () => Promise<void>;
  let prisma: Awaited<ReturnType<typeof freshPrisma>>['prisma'];
  let repo: WebhookDeliveryPrismaRepository;

  beforeAll(async () => {
    const db = await freshPrisma();
    drop = db.drop;
    prisma = db.prisma;
    repo = new WebhookDeliveryPrismaRepository(prisma as never);
  });
  afterAll(async () => drop?.());

  const endpoint = () =>
    prisma.webhookEndpoint.create({
      data: { url: `https://partner.example.com/${randomUUID()}`, events: ['x'], active: true },
    });
  const delivery = (endpointId: string) =>
    prisma.webhookDelivery.create({
      data: { endpointId, event: 'x', payload: {}, nextAttemptAt: new Date(Date.now() - 1000) },
    });

  it('two overlapping sweeps never claim the same delivery', async () => {
    const ep = await endpoint();
    const ids = new Set<string>();
    for (let i = 0; i < 12; i++) ids.add((await delivery(ep.id)).id);
    const now = new Date();
    const [a, b] = await race([
      () => repo.claimDue(now, 12, 300_000),
      () => repo.claimDue(new Date(now.getTime() + 1), 12, 300_000),
    ]);
    const claimedA = (a as PromiseFulfilledResult<{ id: string }[]>).value.map((d) => d.id);
    const claimedB = (b as PromiseFulfilledResult<{ id: string }[]>).value.map((d) => d.id);
    expect(claimedA.filter((id) => claimedB.includes(id))).toEqual([]);
  });

  it('a sweep whose lease lapsed cannot overwrite the sweep that re-claimed the delivery', async () => {
    const ep = await endpoint();
    const d = await delivery(ep.id);
    const t0 = new Date();
    const [first] = await repo.claimDue(t0, 5, 1_000);
    // The lease runs out and a second sweep takes the row.
    const [second] = await repo.claimDue(new Date(t0.getTime() + 2_000), 5, 300_000);
    expect(first.id).toBe(d.id);
    expect(second.id).toBe(d.id);

    await repo.markDelivered(d.id, 200, new Date(), second.leaseUntil);
    // The first sweep finishes late, with the lease it no longer holds.
    await repo.markRetry(d.id, 1, new Date(), 'late timeout', 504, first.leaseUntil);

    const row = (await prisma.webhookDelivery.findUnique({ where: { id: d.id } }))!;
    expect(row.status).toBe('DELIVERED');
    expect(row.lastError).toBeNull();
  });
});
