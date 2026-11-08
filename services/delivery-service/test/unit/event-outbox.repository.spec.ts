import { EventOutboxController } from '../../src/modules/event-outbox.controller';
import { EventRelayService } from '../../src/application/services/event-relay.service';
import { EventOutboxPrismaRepository } from '../../src/infrastructure/prisma/event-outbox.prisma.repository';

const NOW = new Date('2026-11-08T10:00:00.000Z');
const row = (over = {}) => ({
  id: 'o1',
  event: 'delivery.delivered',
  eventId: 'k1',
  payload: { a: 1 },
  occurredAt: NOW,
  status: 'PENDING',
  attempts: 0,
  nextAttemptAt: NOW,
  lastError: null,
  ...over,
});

function make() {
  const webhookEventOutbox = {
    create: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
  };
  return { webhookEventOutbox, repo: new EventOutboxPrismaRepository({ webhookEventOutbox } as never) };
}

describe('EventOutboxPrismaRepository (AAS-11)', () => {
  it('enqueue answers the new row', async () => {
    const { repo, webhookEventOutbox } = make();
    webhookEventOutbox.create.mockResolvedValue(row());
    await expect(
      repo.enqueue({ event: 'delivery.delivered', eventId: 'k1', payload: { a: 1 }, occurredAt: NOW }),
    ).resolves.toMatchObject({ id: 'o1', eventId: 'k1', status: 'PENDING' });
  });

  it('enqueue answers null when the key is already recorded (P2002), rethrows anything else', async () => {
    const { repo, webhookEventOutbox } = make();
    const input = { event: 'e.x', eventId: 'k1', payload: {}, occurredAt: NOW };
    webhookEventOutbox.create.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    await expect(repo.enqueue(input)).resolves.toBeNull();
    webhookEventOutbox.create.mockRejectedValueOnce(new Error('db down'));
    await expect(repo.enqueue(input)).rejects.toThrow('db down');
  });

  it('findDue asks for PENDING rows whose backoff has elapsed, oldest first', async () => {
    const { repo, webhookEventOutbox } = make();
    webhookEventOutbox.findMany.mockResolvedValue([row()]);
    await expect(repo.findDue(NOW, 50)).resolves.toHaveLength(1);
    expect(webhookEventOutbox.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', nextAttemptAt: { lte: NOW } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50,
    });
  });

  it('findByEventId reads by the unique key, null when absent', async () => {
    const { repo, webhookEventOutbox } = make();
    webhookEventOutbox.findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
    await expect(repo.findByEventId('k1')).resolves.toMatchObject({ eventId: 'k1' });
    expect(webhookEventOutbox.findUnique).toHaveBeenCalledWith({ where: { eventId: 'k1' } });
    await expect(repo.findByEventId('nope')).resolves.toBeNull();
  });

  // Bounded: one sweep never issues an unbounded DELETE against a table written on every handover.
  it('pruneDone deletes at most `limit` DONE rows older than the cutoff', async () => {
    const { repo, webhookEventOutbox } = make();
    webhookEventOutbox.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    webhookEventOutbox.deleteMany.mockResolvedValue({ count: 2 });
    await expect(repo.pruneDone(NOW, 500)).resolves.toBe(2);
    expect(webhookEventOutbox.findMany).toHaveBeenCalledWith({
      where: { status: 'DONE', updatedAt: { lt: NOW } },
      select: { id: true },
      take: 500,
    });
    expect(webhookEventOutbox.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] }, status: 'DONE' },
    });
    webhookEventOutbox.findMany.mockResolvedValue([]);
    await expect(repo.pruneDone(NOW, 500)).resolves.toBe(0);
  });

  it('closes and fails only a row that is still PENDING', async () => {
    const { repo, webhookEventOutbox } = make();
    await repo.markDone('o1');
    expect(webhookEventOutbox.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'o1', status: 'PENDING' },
      data: { status: 'DONE', lastError: null },
    });
    await repo.markFailed('o1', 'x'.repeat(600), NOW);
    expect(webhookEventOutbox.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'o1', status: 'PENDING' },
      data: { status: 'PENDING', attempts: { increment: 1 }, lastError: 'x'.repeat(500), nextAttemptAt: NOW },
    });
    await repo.markFailed('o1', 'gone', null);
    expect(webhookEventOutbox.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'o1', status: 'PENDING' },
      data: { status: 'DEAD', attempts: { increment: 1 }, lastError: 'gone' },
    });
  });
});

describe('EventOutboxController (AAS-11)', () => {
  it('runs the relay sweep', async () => {
    const result = { claimed: 1, delivered: 1, failed: 0, dead: 0, ok: true };
    const relay = { processDue: jest.fn().mockResolvedValue(result) } as unknown as EventRelayService;
    await expect(new EventOutboxController(relay).process()).resolves.toBe(result);
  });
});
