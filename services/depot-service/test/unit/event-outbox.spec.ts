import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DepotConfigService } from '../../src/config/depot-config.service';
import {
  EventRelayService,
  outboxRetryDelayMs,
} from '../../src/application/services/event-relay.service';
import {
  FRANCHISE_APPLICATION_SUBMITTED,
  franchiseApplicationSubmitted,
  franchiseApplicationSubmittedEventId,
} from '../../src/domain/franchise-application';
import { EventPublisherHttpAdapter } from '../../src/infrastructure/http/event-publisher.http.adapter';
import { EventOutboxPrismaRepository } from '../../src/infrastructure/prisma/event-outbox.prisma.repository';
import { EventOutboxController } from '../../src/modules/event-outbox.controller';

const NOW = new Date('2026-11-22T10:00:00.000Z');
const row = (over = {}) => ({
  id: 'o1',
  event: 'franchise.application_submitted',
  eventId: 'k1',
  payload: { a: 1 },
  occurredAt: NOW,
  status: 'PENDING',
  attempts: 0,
  nextAttemptAt: NOW,
  lastError: null,
  ...over,
});

function makeRepo() {
  const webhookEventOutbox = {
    findMany: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn(),
    deleteMany: jest.fn(),
  };
  return {
    webhookEventOutbox,
    repo: new EventOutboxPrismaRepository({ webhookEventOutbox } as never),
  };
}

describe('EventOutboxPrismaRepository (HD-7)', () => {
  it('findDue asks for PENDING rows whose backoff has elapsed, oldest first', async () => {
    const { repo, webhookEventOutbox } = makeRepo();
    webhookEventOutbox.findMany.mockResolvedValue([row()]);
    await expect(repo.findDue(NOW, 50)).resolves.toMatchObject([
      { id: 'o1', eventId: 'k1', status: 'PENDING', payload: { a: 1 } },
    ]);
    expect(webhookEventOutbox.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDING', nextAttemptAt: { lte: NOW } },
      orderBy: { nextAttemptAt: 'asc' },
      take: 50,
    });
  });

  it('counts the events owed since the cutoff or earlier, by when they were written', async () => {
    const { repo, webhookEventOutbox } = makeRepo();
    (webhookEventOutbox as unknown as { count: jest.Mock }).count = jest.fn().mockResolvedValue(2);
    await expect(repo.countStuck(NOW)).resolves.toBe(2);
    expect((webhookEventOutbox as unknown as { count: jest.Mock }).count).toHaveBeenCalledWith({
      where: { status: 'PENDING', createdAt: { lte: NOW } },
    });
  });

  it('findByEventId reads by the unique key, null when absent', async () => {
    const { repo, webhookEventOutbox } = makeRepo();
    webhookEventOutbox.findUnique.mockResolvedValueOnce(row()).mockResolvedValueOnce(null);
    await expect(repo.findByEventId('k1')).resolves.toMatchObject({ eventId: 'k1' });
    expect(webhookEventOutbox.findUnique).toHaveBeenCalledWith({ where: { eventId: 'k1' } });
    await expect(repo.findByEventId('nope')).resolves.toBeNull();
  });

  it('pruneDone deletes at most `limit` DONE rows older than the cutoff', async () => {
    const { repo, webhookEventOutbox } = makeRepo();
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
    const { repo, webhookEventOutbox } = makeRepo();
    await repo.markDone('o1');
    expect(webhookEventOutbox.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'o1', status: 'PENDING' },
      data: { status: 'DONE', lastError: null },
    });
    await repo.markFailed('o1', 'x'.repeat(600), NOW);
    expect(webhookEventOutbox.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'o1', status: 'PENDING' },
      data: { attempts: { increment: 1 }, lastError: 'x'.repeat(500), nextAttemptAt: NOW },
    });
  });
});

describe('EventOutboxController (HD-7)', () => {
  it('runs the relay sweep', async () => {
    const result = { claimed: 1, delivered: 1, failed: 0, pruned: 0, stuck: 0, ok: true };
    const relay = { processDue: jest.fn().mockResolvedValue(result) } as unknown as EventRelayService;
    await expect(new EventOutboxController(relay).process()).resolves.toBe(result);
  });
});

describe('EventPublisherHttpAdapter (HD-7)', () => {
  const at = new Date('2026-11-22T09:00:00.000Z');
  const config = (over: Record<string, string> = {}) =>
    ({
      adminServiceUrl: 'http://admin:3017',
      internalServiceKey: 'internal-key-01',
      ...over,
    }) as unknown as DepotConfigService;
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 202 } as Response);
  });
  afterEach(() => fetchMock.mockRestore());

  it('POSTs the event, its time and its key to admin-service with the internal key', async () => {
    await new EventPublisherHttpAdapter(config()).publish('franchise.application_submitted', { a: 1 }, at, 'k1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://admin:3017/api/v1/webhooks/events');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'content-type': 'application/json', 'x-internal-key': 'internal-key-01' });
    expect(JSON.parse(init.body)).toEqual({
      event: 'franchise.application_submitted',
      payload: { a: 1 },
      occurredAt: at.toISOString(),
      eventId: 'k1',
    });
    expect(init.signal).toBeDefined();
  });

  // The other half is admin-service's spec, which validates the same example against its DTO.
  it('sends admin-service exactly the internal publish example of the contract', async () => {
    const contract = JSON.parse(
      readFileSync(join(__dirname, '../../../../contracts/ai-v1/events.openapi.json'), 'utf8'),
    );
    const example = contract['x-hydromart-internal-publish-example'].body;
    await new EventPublisherHttpAdapter(config()).publish(
      example.event,
      example.payload,
      new Date(example.occurredAt),
      example.eventId,
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(example);
  });

  it('throws when admin-service refuses it, so the outbox keeps it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 } as Response);
    await expect(
      new EventPublisherHttpAdapter(config()).publish('franchise.application_submitted', {}, at, 'k1'),
    ).rejects.toThrow('admin-service responded 400');
  });

  // Unlike delivery-service: an unconfigured fan-out is an event still owed, not one forgotten.
  it('throws without sending when admin-service is not configured', async () => {
    const blanks: Record<string, string>[] = [{ adminServiceUrl: '' }, { internalServiceKey: '' }];
    for (const over of blanks) {
      await expect(
        new EventPublisherHttpAdapter(config(over)).publish('franchise.application_submitted', {}, at, 'k1'),
      ).rejects.toThrow(/not configured/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('franchise.application_submitted (HD-7)', () => {
  const app = {
    id: '3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807',
    city: 'Bekasi',
    province: 'Jawa Barat',
    submittedAt: NOW,
    // What the row also holds, and the event must never carry.
    applicantName: 'Rudi Hartono',
    applicantPhone: '+6281211112222',
    lat: -6.2,
    lng: 107.0,
    investmentAmount: 150_000_000,
  };

  it('is keyed by the application, and carries no personal data', () => {
    const event = franchiseApplicationSubmitted(app);
    expect(event).toEqual({
      event: FRANCHISE_APPLICATION_SUBMITTED,
      eventId: `franchise.application_submitted:${app.id}`,
      payload: { applicationId: app.id, city: 'Bekasi', province: 'Jawa Barat' },
      occurredAt: NOW,
    });
    expect(franchiseApplicationSubmittedEventId(app.id)).toBe(event.eventId);
    expect(JSON.stringify(event)).not.toMatch(/Rudi|\+62|150000000|-6\.2/);
  });

  /*
   * The AI web codes against contracts/ai-v1/events.openapi.json, in another repository. The
   * payload built here and the schema written there must not drift apart in silence.
   */
  it('matches the contract the AI web codes against', () => {
    const contract = JSON.parse(
      readFileSync(join(__dirname, '../../../../contracts/ai-v1/events.openapi.json'), 'utf8'),
    );
    const envelope = contract.components.schemas.FranchiseApplicationSubmitted;
    const data = contract.components.schemas.FranchiseApplicationSubmittedData;
    const event = franchiseApplicationSubmitted(app);

    expect(Object.keys(contract.webhooks)).toContain(event.event);
    expect(envelope.properties.event.const).toBe(event.event);
    expect(event.eventId).toMatch(new RegExp(envelope.properties.eventId.pattern));
    expect(Object.keys(event.payload).sort()).toEqual([...data.required].sort());
    expect(Object.keys(data.properties).sort()).toEqual([...data.required].sort());
    for (const key of ['city', 'province'] as const) {
      expect(data.properties[key]).toMatchObject({ type: 'string', minLength: 1 });
      // The form counts characters its own way: a receiver must not reject on length.
      expect(data.properties[key].maxLength).toBeUndefined();
    }

    // The signed sample a receiver tests against carries exactly the data depot sends.
    const vector = JSON.parse(contract['x-hydromart-signature-test-vector'].body);
    expect(Object.keys(vector.data).sort()).toEqual(Object.keys(event.payload).sort());
    expect(vector.event).toBe(event.event);
    expect(vector.eventId).toBe(franchiseApplicationSubmittedEventId(vector.data.applicationId));
    // The producer's retry rhythm as a receiver is told it, from the function the relay uses.
    const steps = [1, 2, 3, 4, 5, 6].map((n) => outboxRetryDelayMs(n) / 60_000);
    expect(contract.info.description).toContain(
      `${steps.slice(0, -1).join(', ')} and ${steps.at(-1)} minutes`,
    );
    expect(outboxRetryDelayMs(7)).toBe(3_600_000);
    expect(data.properties.applicationId).toMatchObject({ type: 'string', format: 'uuid' });
  });
});
