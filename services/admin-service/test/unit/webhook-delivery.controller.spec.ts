import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import {
  PartnerDeliveryController,
  WebhookDeliveryController,
  WebhookInternalController,
} from '../../src/modules/webhook-delivery.controller';
import {
  ListDeliveriesDto,
  PublishEventDto,
  WebhookDeliveryDto,
} from '../../src/modules/dto/webhook-delivery.dto';
import { WebhookDeliveryRecord } from '../../src/application/ports/webhook.repository';
import { WebhookDispatchService } from '../../src/application/services/webhook-dispatch.service';

const NOW = new Date('2026-08-04T10:00:00.000Z');

const record = (over: Partial<WebhookDeliveryRecord> = {}): WebhookDeliveryRecord => ({
  id: 'd-1',
  endpointId: 'ep-1',
  event: 'delivery.delivered',
  payload: { a: 1 },
  status: 'DELIVERED',
  attempts: 1,
  nextAttemptAt: NOW,
  responseStatus: 200,
  lastError: null,
  occurredAt: NOW,
  deliveredAt: NOW,
  createdAt: NOW,
  ...over,
});

function makeService() {
  return {
    publish: jest.fn().mockResolvedValue({ queued: 2 }),
    process: jest.fn().mockResolvedValue({ sent: 1, failed: 0, dead: 0 }),
    list: jest.fn().mockResolvedValue([record()]),
    replay: jest.fn().mockResolvedValue(record({ status: 'PENDING' })),
  } as unknown as jest.Mocked<WebhookDispatchService>;
}

describe('WebhookInternalController', () => {
  it('publishes an event, passing the reported time through', async () => {
    const service = makeService();
    const controller = new WebhookInternalController(service);

    await expect(
      controller.publish({
        event: 'delivery.delivered',
        payload: { a: 1 },
        occurredAt: NOW.toISOString(),
      }),
    ).resolves.toEqual({ queued: 2 });
    expect(service.publish).toHaveBeenCalledWith({
      event: 'delivery.delivered',
      payload: { a: 1 },
      occurredAt: NOW,
    });
  });

  it('leaves occurredAt to the service when the reporter omitted it', async () => {
    const service = makeService();
    await new WebhookInternalController(service).publish({
      event: 'delivery.delivered',
      payload: {},
    });
    expect(service.publish).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: undefined }),
    );
  });

  it('runs the sweep', async () => {
    const service = makeService();
    await expect(new WebhookInternalController(service).process()).resolves.toEqual({
      sent: 1,
      failed: 0,
      dead: 0,
    });
  });
});

describe('WebhookDeliveryController (HQ)', () => {
  it('lists and replays', async () => {
    const service = makeService();
    const controller = new WebhookDeliveryController(service);

    await expect(controller.list({ limit: 10, event: 'delivery.delivered' })).resolves.toEqual([
      WebhookDeliveryDto.from(record()),
    ]);
    expect(service.list).toHaveBeenCalledWith(10, 'delivery.delivered');

    await expect(controller.replay('d-1')).resolves.toMatchObject({ status: 'PENDING' });
  });
});

describe('PartnerDeliveryController (API key)', () => {
  // AUTHZ-3: the partner routes answered "deliveries sent to you" with every partner's
  // deliveries — payload included — and replayed any of them. The key that authenticated
  // the request is the only thing that says whose data it is, so it goes to the service.
  const req = (id = 'key-1') => ({ apiKey: { id } }) as never;

  it('scopes the list and the replay to the calling key', async () => {
    const service = makeService();
    const controller = new PartnerDeliveryController(service);

    await expect(controller.list({ limit: 50 }, req())).resolves.toHaveLength(1);
    expect(service.list).toHaveBeenCalledWith(50, undefined, 'key-1');
    await expect(controller.replay('d-1', req())).resolves.toMatchObject({ id: 'd-1' });
    expect(service.replay).toHaveBeenCalledWith('d-1', 'key-1');
  });
});

describe('WebhookDeliveryController (HQ) still sees every partner', () => {
  it('passes no key, so nothing is scoped away from the platform owner', async () => {
    const service = makeService();
    const controller = new WebhookDeliveryController(service);

    await controller.list({ limit: 50 });
    expect(service.list).toHaveBeenCalledWith(50, undefined);
    await controller.replay('d-1');
    expect(service.replay).toHaveBeenCalledWith('d-1');
  });
});

describe('webhook delivery DTOs', () => {
  it('serialises a delivery, including one never delivered', () => {
    expect(WebhookDeliveryDto.from(record())).toMatchObject({
      id: 'd-1',
      status: 'DELIVERED',
      deliveredAt: NOW.toISOString(),
    });
    expect(WebhookDeliveryDto.from(record({ deliveredAt: null })).deliveredAt).toBeNull();
  });

  // An event name is what an endpoint subscribes to, so a typo'd or free-form name is a
  // subscription that silently never matches.
  it('requires an event name shaped like domain.thing_happened', () => {
    const bad = ['delivery delivered', 'Delivery.Delivered', 'delivered', ''];
    for (const event of bad) {
      const dto = plainToInstance(PublishEventDto, { event, payload: {} });
      expect(validateSync(dto).map((e) => e.property)).toContain('event');
    }
    const ok = plainToInstance(PublishEventDto, { event: 'delivery.delivered', payload: {} });
    expect(validateSync(ok)).toHaveLength(0);
  });

  it('requires a payload, even an empty one, rather than silently sending nothing', () => {
    const dto = plainToInstance(PublishEventDto, { event: 'delivery.delivered' });
    expect(validateSync(dto).map((e) => e.property)).toContain('payload');
  });

  it('bounds the list size and defaults it', () => {
    expect(plainToInstance(ListDeliveriesDto, {}).limit).toBe(50);
    const tooMany = plainToInstance(ListDeliveriesDto, { limit: 1000 });
    expect(validateSync(tooMany).map((e) => e.property)).toContain('limit');
  });
});
