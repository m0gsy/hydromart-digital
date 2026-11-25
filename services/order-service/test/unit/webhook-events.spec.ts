import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { EventRelayService } from '../../src/application/services/event-relay.service';
import { EventPublisherHttpAdapter } from '../../src/infrastructure/http/event-publisher.http.adapter';
import { EventOutboxPrismaRepository } from '../../src/infrastructure/prisma/event-outbox.prisma.repository';
import {
  newTransitionId,
  orderCreatedEvent,
  orderStatusChangedEvent,
} from '../../src/domain/webhook-events';
import { OrderConfigService } from '../../src/config/order-config.service';

jest.mock('@hydromart/platform', () => ({
  ...jest.requireActual('@hydromart/platform'),
  alertServerError: jest.fn(),
}));

const NOW = new Date('2026-11-25T03:00:00.000Z');
const ORDER = {
  id: '00000000-0000-4000-8000-000000000002',
  depotId: '00000000-0000-4000-8000-000000000003',
  isWalkIn: false,
};
const contract = JSON.parse(
  readFileSync(join(__dirname, '../../../../contracts/ai-v1/events.openapi.json'), 'utf8'),
);

describe('order webhook events (HD-17B)', () => {
  it('order.created is keyed by the order and carries ids, depot, channel and status only', () => {
    const e = orderCreatedEvent({ ...ORDER, isWalkIn: true }, 'COMPLETED', NOW);
    expect(e.eventId).toBe(`order.created:${ORDER.id}`);
    expect(e.payload).toEqual({
      orderId: ORDER.id,
      depotId: ORDER.depotId,
      channel: 'WALK_IN',
      status: 'COMPLETED',
      occurredAt: NOW.toISOString(),
    });
    expect(orderCreatedEvent(ORDER, 'CREATED', NOW).payload.channel).toBe('ONLINE');
  });

  it('order.status_changed is unique per transition, so a revisited status is a new event', () => {
    const a = orderStatusChangedEvent(ORDER, 'CREATED', 'CONFIRMED', newTransitionId(), NOW);
    const b = orderStatusChangedEvent(ORDER, 'CREATED', 'CONFIRMED', newTransitionId(), NOW);
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.payload).toMatchObject({ from: 'CREATED', to: 'CONFIRMED', status: 'CONFIRMED' });
  });

  it('matches the contract the AI web codes against', () => {
    const schemas = contract.components.schemas;
    const created = orderCreatedEvent(ORDER, 'CREATED', NOW);
    const changed = orderStatusChangedEvent(ORDER, 'CREATED', 'CONFIRMED', newTransitionId(), NOW);
    for (const [name, dataName, e] of [
      ['OrderCreated', 'OrderCreatedData', created],
      ['OrderStatusChanged', 'OrderStatusChangedData', changed],
    ] as const) {
      expect(schemas[name].properties.event.const).toBe(e.event);
      expect(e.eventId).toMatch(new RegExp(schemas[name].properties.eventId.pattern));
      expect(Object.keys(e.payload).sort()).toEqual([...schemas[dataName].required].sort());
      expect(Object.keys(schemas[dataName].properties).sort()).toEqual(
        [...schemas[dataName].required].sort(),
      );
      expect(Object.keys(contract.webhooks)).toContain(e.event);
    }
  });

  it('every new contract example is an instance of its own schema (keys and eventId)', () => {
    const schemas = contract.components.schemas;
    for (const [event, name, dataName] of [
      ['order.created', 'OrderCreated', 'OrderCreatedData'],
      ['order.status_changed', 'OrderStatusChanged', 'OrderStatusChangedData'],
      ['stock.low', 'StockLow', 'StockLowData'],
    ]) {
      const ex = contract.webhooks[event].post.requestBody.content['application/json'].example;
      expect(ex.eventId).toMatch(new RegExp(schemas[name].properties.eventId.pattern));
      expect(Object.keys(ex.data).sort()).toEqual([...schemas[dataName].required].sort());
    }
  });
});

describe('EventOutboxPrismaRepository (HD-17B)', () => {
  const row = (over = {}) => ({
    id: 'o1',
    event: 'order.created',
    eventId: 'k1',
    payload: { a: 1 },
    occurredAt: NOW,
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: NOW,
    lastError: null,
    ...over,
  });
  const model = {
    findMany: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  };
  const repo = new EventOutboxPrismaRepository({ webhookEventOutbox: model } as never);

  it('reads due rows oldest first, by key, and counts the stuck ones', async () => {
    model.findMany.mockResolvedValue([row()]);
    await expect(repo.findDue(NOW, 200)).resolves.toMatchObject([{ id: 'o1', status: 'PENDING' }]);
    expect(model.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', nextAttemptAt: { lte: NOW } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 200,
    });
    model.findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
    await expect(repo.findByEventId('k1')).resolves.toMatchObject({ eventId: 'k1' });
    await expect(repo.findByEventId('x')).resolves.toBeNull();
    model.count.mockResolvedValue(2);
    await expect(repo.countStuck(NOW)).resolves.toBe(2);
  });

  it('closes and fails only a PENDING row, and prunes only DONE rows', async () => {
    await repo.markDone('o1');
    expect(model.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'o1', status: 'PENDING' },
      data: { status: 'DONE', lastError: null },
    });
    await repo.markFailed('o1', 'x'.repeat(600), NOW);
    expect(model.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'o1', status: 'PENDING' },
      data: { attempts: { increment: 1 }, lastError: 'x'.repeat(500), nextAttemptAt: NOW },
    });
    model.findMany.mockResolvedValue([{ id: 'a' }]);
    model.deleteMany.mockResolvedValue({ count: 1 });
    await expect(repo.pruneDone(NOW, 500)).resolves.toBe(1);
    model.findMany.mockResolvedValue([]);
    await expect(repo.pruneDone(NOW, 500)).resolves.toBe(0);
  });
});

describe('EventPublisherHttpAdapter (HD-17B)', () => {
  const config = (over: Record<string, string> = {}) =>
    ({
      adminServiceUrl: 'http://admin:3017',
      internalServiceKey: 'internal-key-01',
      ...over,
    }) as unknown as OrderConfigService;
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 202 } as Response);
  });
  afterEach(() => fetchMock.mockRestore());

  it('POSTs the event to admin-service with the internal key', async () => {
    await new EventPublisherHttpAdapter(config()).publish('order.created', { a: 1 }, NOW, 'k1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://admin:3017/api/v1/webhooks/events');
    expect(init.headers).toEqual({
      'content-type': 'application/json',
      'x-internal-key': 'internal-key-01',
    });
    expect(JSON.parse(init.body)).toEqual({
      event: 'order.created',
      payload: { a: 1 },
      occurredAt: NOW.toISOString(),
      eventId: 'k1',
    });
  });

  it('throws when refused or not configured, so the outbox keeps the event', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 } as Response);
    await expect(new EventPublisherHttpAdapter(config()).publish('e', {}, NOW, 'k')).rejects.toThrow(
      'admin-service responded 400',
    );
    for (const over of [{ adminServiceUrl: "" }, { internalServiceKey: "" }] as Record<string, string>[]) {
      await expect(
        new EventPublisherHttpAdapter(config(over)).publish('e', {}, NOW, 'k'),
      ).rejects.toThrow(/not configured/);
    }
  });
});

describe('EventRelayService (HD-17B)', () => {
  const mk = (n: number, over = {}) =>
    Array.from({ length: n }, (_, i) => ({
      id: `o${i}`,
      event: 'order.status_changed',
      eventId: `k${i}`,
      payload: {},
      occurredAt: NOW,
      status: 'PENDING' as const,
      attempts: 0,
      nextAttemptAt: NOW,
      lastError: null,
      ...over,
    }));
  function make(rows: ReturnType<typeof mk>, publish: jest.Mock) {
    const outbox = {
      findDue: jest.fn().mockResolvedValue(rows),
      markDone: jest.fn(),
      markFailed: jest.fn(),
      countStuck: jest.fn().mockResolvedValue(0),
      pruneDone: jest.fn().mockResolvedValue(0),
      findByEventId: jest.fn(),
    };
    return { outbox, svc: new EventRelayService(outbox as never, { publish }) };
  }

  it('sends what is due and closes it', async () => {
    const { outbox, svc } = make(mk(3), jest.fn().mockResolvedValue(undefined));
    await expect(svc.processDue(NOW)).resolves.toMatchObject({
      claimed: 3,
      delivered: 3,
      failed: 0,
      ok: true,
    });
    expect(outbox.markDone).toHaveBeenCalledTimes(3);
  });

  it('stops after three failures in a row, so an outage costs 3 timeouts, not 200', async () => {
    const publish = jest.fn().mockRejectedValue(new Error('admin-service responded 503'));
    const { outbox, svc } = make(mk(10), publish);
    const res = await svc.processDue(NOW);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(res).toMatchObject({ claimed: 10, delivered: 0, failed: 3, ok: false });
    expect(outbox.markFailed).toHaveBeenCalledTimes(3);
  });

  it('a delivery resets the streak; a non-Error rejection is recorded', async () => {
    const publish = jest
      .fn()
      .mockRejectedValueOnce('boom')
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'));
    const { outbox, svc } = make(mk(5, { attempts: 5 }), publish);
    const res = await svc.processDue(NOW);
    expect(publish).toHaveBeenCalledTimes(5);
    expect(res).toMatchObject({ delivered: 1, failed: 4, ok: true });
    expect(outbox.markFailed.mock.calls[0][1]).toBe('boom');
  });

  it('a failing prune never fails the sweep, and the clock defaults to now', async () => {
    const { outbox, svc } = make([], jest.fn());
    outbox.pruneDone.mockRejectedValueOnce(new Error('lock')).mockRejectedValueOnce('x');
    await expect(svc.processDue()).resolves.toMatchObject({ pruned: 0, ok: true });
    await expect(svc.processDue(NOW)).resolves.toMatchObject({ pruned: 0, ok: true });
  });
});
