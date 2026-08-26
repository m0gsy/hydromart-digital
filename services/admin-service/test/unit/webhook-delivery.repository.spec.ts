import { WebhookDeliveryPrismaRepository } from '../../src/infrastructure/prisma/webhook-delivery.prisma.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const NOW = new Date('2026-08-04T10:00:00.000Z');

function makeRepo() {
  const webhookDelivery = {
    findMany: jest.fn(),
    createMany: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
  };
  const webhookEndpoint = { findMany: jest.fn() };
  const prisma = { webhookDelivery, webhookEndpoint } as unknown as PrismaService;
  return { repo: new WebhookDeliveryPrismaRepository(prisma), webhookDelivery, webhookEndpoint };
}

describe('WebhookDeliveryPrismaRepository', () => {
  it('finds only active endpoints subscribed to the event', async () => {
    const { repo, webhookEndpoint } = makeRepo();
    webhookEndpoint.findMany.mockResolvedValue([]);
    await repo.subscribersOf('delivery.delivered');
    expect(webhookEndpoint.findMany).toHaveBeenCalledWith({
      where: { active: true, events: { has: 'delivery.delivered' } },
    });
  });

  it('writes nothing, and asks nothing of the database, when there are no subscribers', async () => {
    const { repo, webhookDelivery } = makeRepo();
    await expect(repo.queue([])).resolves.toBe(0);
    expect(webhookDelivery.createMany).not.toHaveBeenCalled();
  });

  it('queues one row per subscriber', async () => {
    const { repo, webhookDelivery } = makeRepo();
    webhookDelivery.createMany.mockResolvedValue({ count: 2 });
    await expect(
      repo.queue([
        { endpointId: 'ep-1', event: 'e', payload: { a: 1 }, occurredAt: NOW },
        { endpointId: 'ep-2', event: 'e', payload: { a: 1 }, occurredAt: NOW },
      ]),
    ).resolves.toBe(2);
  });

  /**
   * The claim is what stops a slow sweep and the next cron tick from both sending the same
   * event: the due predicate lives in the UPDATE's WHERE, and only rows the update actually
   * moved are read back.
   */
  it('claims due rows by moving them out of reach before reading them', async () => {
    const { repo, webhookDelivery } = makeRepo();
    webhookDelivery.findMany
      .mockResolvedValueOnce([{ id: 'd-1' }])
      .mockResolvedValueOnce([
        { id: 'd-1', endpointId: 'ep-1', status: 'PENDING', endpoint: { url: 'u', secret: 's' } },
      ]);
    webhookDelivery.updateMany.mockResolvedValue({ count: 1 });

    const claimed = await repo.claimDue(NOW, 10, 60_000);

    expect(webhookDelivery.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['d-1'] }, status: 'PENDING', nextAttemptAt: { lte: NOW } },
      data: { nextAttemptAt: new Date(NOW.getTime() + 60_000) },
    });
    expect(claimed[0]).toMatchObject({ id: 'd-1', url: 'u', secret: 's' });
  });

  it('claims nothing when another sweep got there first', async () => {
    const { repo, webhookDelivery } = makeRepo();
    webhookDelivery.findMany.mockResolvedValueOnce([{ id: 'd-1' }]);
    webhookDelivery.updateMany.mockResolvedValue({ count: 0 });

    await expect(repo.claimDue(NOW, 10, 60_000)).resolves.toEqual([]);
    expect(webhookDelivery.findMany).toHaveBeenCalledTimes(1); // never read the rows back
  });

  it('claims nothing when nothing is due', async () => {
    const { repo, webhookDelivery } = makeRepo();
    webhookDelivery.findMany.mockResolvedValueOnce([]);
    await expect(repo.claimDue(NOW, 10, 60_000)).resolves.toEqual([]);
    expect(webhookDelivery.updateMany).not.toHaveBeenCalled();
  });

  it('records each outcome', async () => {
    const { repo, webhookDelivery } = makeRepo();
    await repo.markDelivered('d-1', 204, NOW);
    expect(webhookDelivery.update.mock.calls[0][0].data).toMatchObject({
      status: 'DELIVERED',
      responseStatus: 204,
      attempts: { increment: 1 },
    });

    await repo.markRetry('d-1', 2, NOW, 'boom', 500);
    expect(webhookDelivery.update.mock.calls[1][0].data).toMatchObject({
      status: 'PENDING',
      attempts: 2,
      lastError: 'boom',
    });

    await repo.markDead('d-1', 6, 'gone', null);
    expect(webhookDelivery.update.mock.calls[2][0].data).toMatchObject({
      status: 'DEAD',
      attempts: 6,
    });
  });

  it('reports delivered vs attempted and the latest outcome', async () => {
    const { repo, webhookDelivery } = makeRepo();
    webhookDelivery.count.mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    webhookDelivery.findFirst.mockResolvedValue({ status: 'FAILED' });

    await expect(repo.endpointStats('ep-1')).resolves.toEqual({
      delivered: 3,
      attempted: 4,
      lastStatus: 'FAILED',
    });
  });

  it('reports no outcome for an endpoint nothing was ever attempted on', async () => {
    const { repo, webhookDelivery } = makeRepo();
    webhookDelivery.count.mockResolvedValue(0);
    webhookDelivery.findFirst.mockResolvedValue(null);
    await expect(repo.endpointStats('ep-1')).resolves.toMatchObject({ lastStatus: null });
  });

  it('lists newest-first, optionally by event', async () => {
    const { repo, webhookDelivery } = makeRepo();
    webhookDelivery.findMany.mockResolvedValue([]);
    await repo.listForPartner(25, 'delivery.delivered');
    expect(webhookDelivery.findMany).toHaveBeenCalledWith({
      where: { event: 'delivery.delivered' },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
    await repo.listForPartner(25);
    expect(webhookDelivery.findMany.mock.calls[1][0].where).toBeUndefined();
  });

  /*
   * AUTHZ-3. One API key read — and could replay — every other partner's deliveries,
   * payloads included, because nothing in the query mentioned who was asking. An endpoint
   * now records the key it belongs to, and a partner sees exactly its own endpoints'
   * deliveries. An endpoint with no owner belongs to no partner: invisible, not shared.
   */
  it('scopes a partner read to the endpoints its own key owns', async () => {
    const { repo, webhookDelivery } = makeRepo();
    webhookDelivery.findMany.mockResolvedValue([]);
    await repo.listForPartner(25, 'delivery.delivered', 'key-1');
    expect(webhookDelivery.findMany).toHaveBeenCalledWith({
      where: { event: 'delivery.delivered', endpoint: { apiKeyId: 'key-1' } },
      orderBy: { createdAt: 'desc' },
      take: 25,
    });
  });

  it('refuses to replay a delivery that belongs to another key', async () => {
    const { repo, webhookDelivery } = makeRepo();
    webhookDelivery.findFirst.mockResolvedValue(null);
    await expect(repo.replay('d-1', NOW, 'key-1')).resolves.toBeNull();
    expect(webhookDelivery.findFirst).toHaveBeenCalledWith({
      where: { id: 'd-1', endpoint: { apiKeyId: 'key-1' } },
    });
    expect(webhookDelivery.update).not.toHaveBeenCalled();
  });

  it('replays by resetting the attempt count, so a DEAD row gets a real second chance', async () => {
    const { repo, webhookDelivery } = makeRepo();
    webhookDelivery.findUnique.mockResolvedValue({ id: 'd-1' });
    webhookDelivery.update.mockResolvedValue({ id: 'd-1', status: 'PENDING' });

    await repo.replay('d-1', NOW);
    expect(webhookDelivery.update).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: NOW, lastError: null },
    });
  });

  it('returns null for an unknown replay id', async () => {
    const { repo, webhookDelivery } = makeRepo();
    webhookDelivery.findUnique.mockResolvedValue(null);
    await expect(repo.replay('nope', NOW)).resolves.toBeNull();
  });
});
