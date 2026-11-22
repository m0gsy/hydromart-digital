import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_ATTEMPTS,
  WEBHOOK_EVENTS,
  nextAttemptDelayMs,
  signPayload,
  successRatePct,
  verifySignature,
} from '../../src/domain/webhook-delivery';
import { WebhookDispatchService } from '../../src/application/services/webhook-dispatch.service';
import {
  DueDelivery,
  UpdateWebhookData,
  WebhookDeliveryRecord,
  WebhookDeliveryRepository,
  WebhookDeliveryStatus,
  WebhookRecord,
  WebhookRepository,
} from '../../src/application/ports/webhook.repository';

const NOW = new Date('2026-08-04T10:00:00.000Z');

function endpoint(over: Partial<WebhookRecord> = {}): WebhookRecord {
  return {
    id: 'ep-1',
    url: 'https://partner.example.com/hooks',
    apiKeyId: null,
    events: ['delivery.delivered'],
    active: true,
    secret: 'partner-secret',
    lastDeliveryStatus: null,
    deliveryRatePct: null,
    createdAt: NOW,
    ...over,
  };
}

function due(over: Partial<DueDelivery> = {}): DueDelivery {
  return {
    id: 'd-1',
    endpointId: 'ep-1',
    event: 'delivery.delivered',
    payload: { deliveryId: 'x' },
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: NOW,
    responseStatus: null,
    lastError: null,
    occurredAt: NOW,
    deliveredAt: null,
    createdAt: NOW,
    url: 'https://partner.example.com/hooks',
    secret: 'partner-secret',
    leaseUntil: new Date(NOW.getTime() + 300_000),
    ...over,
  };
}

/** Records what the dispatcher wrote, so each outcome can be asserted on. */
function makeRepos(dueRows: DueDelivery[], subscribers: WebhookRecord[] = [endpoint()]) {
  const calls = {
    queued: [] as { endpointId: string; event: string; eventId?: string | null }[],
    delivered: [] as { id: string; status: number }[],
    retried: [] as { id: string; attempts: number; nextAttemptAt: Date; error: string }[],
    dead: [] as { id: string; attempts: number; error: string }[],
    updated: [] as { id: string; data: UpdateWebhookData }[],
  };
  const stats = { delivered: 1, attempted: 2, lastStatus: 'DELIVERED' as WebhookDeliveryStatus };
  const deliveries: WebhookDeliveryRepository = {
    subscribersOf: async () => subscribers,
    queue: async (rows) => {
      calls.queued.push(
        ...rows.map((r) => ({ endpointId: r.endpointId, event: r.event, eventId: r.eventId })),
      );
      return rows.length;
    },
    claimDue: async () => dueRows,
    markDelivered: async (id, status) => {
      calls.delivered.push({ id, status });
    },
    markRetry: async (id, attempts, nextAttemptAt, error) => {
      calls.retried.push({ id, attempts, nextAttemptAt, error });
    },
    markDead: async (id, attempts, error) => {
      calls.dead.push({ id, attempts, error });
    },
    endpointStats: async () => stats,
    listForPartner: async () => [] as WebhookDeliveryRecord[],
    replay: async (id) => (id === 'd-1' ? ({ id } as WebhookDeliveryRecord) : null),
  };
  const endpoints = {
    list: async () => subscribers,
    create: async () => subscribers[0],
    update: async (id: string, data: UpdateWebhookData) => {
      calls.updated.push({ id, data });
      return subscribers[0];
    },
    remove: async () => true,
  } as unknown as WebhookRepository;
  return { deliveries, endpoints, calls, stats };
}

/**
 * ADM-1: the dispatcher resolves the destination before every send, so a test has to say
 * what a hostname resolves to. Public address = a partner's real endpoint.
 */
const publicLookup = async () => [{ address: '203.0.113.10' }];

describe('webhook signing (H-30)', () => {
  it('signs the timestamp with the body, so a captured request cannot be replayed forever', () => {
    const sig = signPayload('s3cret', '1785790000', '{"a":1}');
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature('s3cret', '1785790000', '{"a":1}', sig)).toBe(true);
    // Same body, different minute → a different signature.
    expect(verifySignature('s3cret', '1785790060', '{"a":1}', sig)).toBe(false);
    expect(verifySignature('other', '1785790000', '{"a":1}', sig)).toBe(false);
    expect(verifySignature('s3cret', '1785790000', '{"a":2}', sig)).toBe(false);
  });

  it('backs off geometrically and reports a rate only once something was attempted', () => {
    expect(nextAttemptDelayMs(1)).toBe(60_000);
    expect(nextAttemptDelayMs(2)).toBe(300_000);
    expect(nextAttemptDelayMs(3)).toBeGreaterThan(nextAttemptDelayMs(2));
    expect(successRatePct(0, 0)).toBeNull();
    expect(successRatePct(3, 4)).toBe(75);
  });
});

describe('WebhookDispatchService', () => {
  const fetchMock = jest.fn();
  // AAS-15: the send is injected; the spec observes it exactly as it observed `fetch` (same url, same init).
  const send = (url: string, init: unknown, pin: unknown) => fetchMock(url, init, pin);

  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('queues one delivery per subscribed endpoint', async () => {
    const { deliveries, endpoints, calls } = makeRepos([], [endpoint(), endpoint({ id: 'ep-2' })]);
    const service = new WebhookDispatchService(deliveries, endpoints, publicLookup, send);

    await expect(
      service.publish({ event: 'delivery.delivered', payload: { a: 1 }, eventId: 'delivery.delivered:d1' }, NOW),
    ).resolves.toEqual({ queued: 2 });
    expect(calls.queued.map((q) => q.endpointId)).toEqual(['ep-1', 'ep-2']);
  });

  // AAS-11: the producer's key travels with every row, so a retried publish is one event.
  it('queues the producer eventId on every row', async () => {
    const { deliveries, endpoints, calls } = makeRepos([], [endpoint(), endpoint({ id: 'ep-2' })]);
    const service = new WebhookDispatchService(deliveries, endpoints, publicLookup, send);
    await service.publish({ event: 'delivery.delivered', payload: {}, eventId: 'delivery.delivered:d9' }, NOW);
    expect(calls.queued.map((q) => q.eventId)).toEqual(['delivery.delivered:d9', 'delivery.delivered:d9']);
  });

  it('puts eventId in the partner body only when there is one', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const withId = makeRepos([due({ eventId: 'delivery.delivered:d9' })]);
    await new WebhookDispatchService(withId.deliveries, withId.endpoints, publicLookup, send).process(NOW);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).eventId).toBe('delivery.delivered:d9');

    fetchMock.mockClear();
    const without = makeRepos([due()]);
    await new WebhookDispatchService(without.deliveries, without.endpoints, publicLookup, send).process(NOW);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('eventId');
  });

  // AAS-15: the send is handed the address the destination check just validated.
  it('pins the send to the validated address of the hostname', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { deliveries, endpoints } = makeRepos([due()]);
    await new WebhookDispatchService(deliveries, endpoints, publicLookup, send).process(NOW);
    expect(fetchMock.mock.calls[0][2]).toEqual({ address: '203.0.113.10', family: 4 });
  });

  // The rebinding case itself: validation saw a public address, so the send must not be able to land
  // elsewhere. The pin is what the sender connects to, whatever DNS would say next.
  it('hands the sender the first validated address even if the name would now resolve elsewhere', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const answers = [[{ address: '203.0.113.10' }], [{ address: '10.0.0.5' }]];
    const flipping = async () => answers.shift() ?? [{ address: '10.0.0.5' }];
    const { deliveries, endpoints } = makeRepos([due()]);
    await new WebhookDispatchService(deliveries, endpoints, flipping, send).process(NOW);
    expect(fetchMock.mock.calls[0][2]).toEqual({ address: '203.0.113.10', family: 4 });
    expect(answers).toHaveLength(1); // the name was resolved once, not twice
  });

  it('sends a signed POST and records the endpoint outcome', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { deliveries, endpoints, calls } = makeRepos([due()]);
    const service = new WebhookDispatchService(deliveries, endpoints, publicLookup, send);

    await expect(service.process(NOW)).resolves.toEqual({ sent: 1, failed: 0, dead: 0, ok: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://partner.example.com/hooks');
    const timestamp = init.headers['X-Hydromart-Timestamp'];
    expect(init.headers['X-Hydromart-Event']).toBe('delivery.delivered');
    expect(
      verifySignature(
        'partner-secret',
        timestamp,
        init.body,
        init.headers['X-Hydromart-Signature'],
      ),
    ).toBe(true);
    expect(JSON.parse(init.body)).toMatchObject({
      event: 'delivery.delivered',
      data: { deliveryId: 'x' },
    });
    expect(calls.delivered).toEqual([{ id: 'd-1', status: 200 }]);
    // The two columns that were permanently null before this existed.
    expect(calls.updated[0]!.data).toEqual({
      lastDeliveryStatus: 'DELIVERED',
      deliveryRatePct: 50,
    });
  });

  it('stops starting new sends once the lease is nearly spent, leaving the rest to lapse', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { deliveries, endpoints, calls } = makeRepos([due({ id: 'd-1' }), due({ id: 'd-2' })]);
    const real = Date.now();
    // The first send "takes" almost the whole lease; the second must not start.
    const clock = jest.spyOn(Date, 'now');
    clock.mockReturnValueOnce(real).mockReturnValueOnce(real).mockReturnValue(real + 290_000);

    const out = await new WebhookDispatchService(deliveries, endpoints, publicLookup, send).process(NOW);
    clock.mockRestore();

    expect(out.sent).toBe(1);
    expect(calls.delivered.map((d) => d.id)).toEqual(['d-1']);
  });

  /*
   * HD-7: the timestamp is when THIS send starts. Stamped with the sweep's start instead, the
   * last of twenty slow sends went out up to 270 s old, near the 300 s a receiver allows.
   */
  it('stamps each send with the moment it starts, not the moment the sweep began', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { deliveries, endpoints, calls } = makeRepos([due({ id: 'd-1' }), due({ id: 'd-2' })]);
    const real = Date.now();
    const clock = jest.spyOn(Date, 'now');
    // sweep start, first send at +0, second send at +120 s
    clock.mockReturnValueOnce(real).mockReturnValueOnce(real).mockReturnValue(real + 120_000);

    await new WebhookDispatchService(deliveries, endpoints, publicLookup, send).process(NOW);
    clock.mockRestore();

    const stamps = fetchMock.mock.calls.map(([, init]) => Number(init.headers['X-Hydromart-Timestamp']));
    expect(stamps).toEqual([NOW.getTime() / 1000, NOW.getTime() / 1000 + 120]);
    // Signed with the stamp it carries, so a receiver checking the window accepts it.
    const [, second] = fetchMock.mock.calls[1];
    expect(
      verifySignature('partner-secret', second.headers['X-Hydromart-Timestamp'], second.body, second.headers['X-Hydromart-Signature']),
    ).toBe(true);
    expect(calls.delivered.map((d) => d.id)).toEqual(['d-1', 'd-2']);
  });

  it('schedules a retry from the moment the failed send started', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200 }).mockResolvedValue({ ok: false, status: 503 });
    const { deliveries, endpoints, calls } = makeRepos([due({ id: 'd-1' }), due({ id: 'd-2' })]);
    const real = Date.now();
    const clock = jest.spyOn(Date, 'now');
    clock.mockReturnValueOnce(real).mockReturnValueOnce(real).mockReturnValue(real + 60_000);

    await new WebhookDispatchService(deliveries, endpoints, publicLookup, send).process(NOW);
    clock.mockRestore();

    expect(calls.retried[0]!.nextAttemptAt.getTime()).toBe(NOW.getTime() + 60_000 + nextAttemptDelayMs(1));
  });

  it('schedules a retry with backoff when the endpoint rejects it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { deliveries, endpoints, calls } = makeRepos([due({ attempts: 1 })]);

    await expect(new WebhookDispatchService(deliveries, endpoints, publicLookup, send).process(NOW)).resolves.toEqual({
      sent: 0,
      failed: 1,
      dead: 0,
      // J7: due deliveries, none sent — the scheduler must not call this round healthy.
      ok: false,
    });
    expect(calls.retried[0]).toMatchObject({ attempts: 2, error: 'endpoint responded 500' });
    expect(calls.retried[0]!.nextAttemptAt.getTime()).toBe(NOW.getTime() + nextAttemptDelayMs(2));
    expect(calls.dead).toHaveLength(0);
  });

  it('retries a transport failure too, not just an HTTP error', async () => {
    fetchMock.mockRejectedValue(new Error('ETIMEDOUT'));
    const { deliveries, endpoints, calls } = makeRepos([due()]);

    await new WebhookDispatchService(deliveries, endpoints, publicLookup, send).process(NOW);
    expect(calls.retried[0]).toMatchObject({ attempts: 1, error: 'ETIMEDOUT' });
  });

  it('gives up on an endpoint that never answers, instead of retrying forever', async () => {
    fetchMock.mockRejectedValue(new Error('ENOTFOUND'));
    const { deliveries, endpoints, calls } = makeRepos([due({ attempts: MAX_ATTEMPTS - 1 })]);

    await expect(new WebhookDispatchService(deliveries, endpoints, publicLookup, send).process(NOW)).resolves.toEqual({
      sent: 0,
      failed: 0,
      dead: 1,
      ok: false,
    });
    expect(calls.dead[0]).toMatchObject({ attempts: MAX_ATTEMPTS });
    expect(calls.retried).toHaveLength(0);
  });

  it('keeps the reported event time rather than the moment it was queued', async () => {
    const { deliveries, endpoints } = makeRepos([]);
    const queued: unknown[] = [];
    deliveries.queue = async (rows) => {
      queued.push(...rows);
      return rows.length;
    };
    const earlier = new Date('2026-08-04T09:00:00.000Z');
    await new WebhookDispatchService(deliveries, endpoints, publicLookup, send).publish(
      { event: 'delivery.delivered', payload: {}, occurredAt: earlier, eventId: 'delivery.delivered:d3' },
      NOW,
    );
    expect(queued[0]).toMatchObject({ occurredAt: earlier });
  });

  it('queues nothing when no endpoint subscribed to the event', async () => {
    const { deliveries, endpoints, calls } = makeRepos([], []);
    await expect(
      new WebhookDispatchService(deliveries, endpoints, publicLookup, send).publish(
        { event: 'nobody.cares', payload: {}, eventId: 'nobody.cares:1' },
        NOW,
      ),
    ).resolves.toEqual({ queued: 0 });
    expect(calls.queued).toHaveLength(0);
  });

  it('does nothing, and touches no endpoint, when nothing is due', async () => {
    const { deliveries, endpoints, calls } = makeRepos([]);
    await expect(new WebhookDispatchService(deliveries, endpoints, publicLookup, send).process(NOW)).resolves.toEqual({
      sent: 0,
      failed: 0,
      dead: 0,
      // Nothing due is not a failure — this is the idle body a healthy tick answers with.
      ok: true,
    });
    expect(calls.updated).toHaveLength(0);
  });

  it('refreshes each touched endpoint once, however many of its deliveries were sent', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202 });
    const { deliveries, endpoints, calls } = makeRepos([due(), due({ id: 'd-2' })]);

    await new WebhookDispatchService(deliveries, endpoints, publicLookup, send).process(NOW);
    expect(calls.delivered).toHaveLength(2);
    expect(calls.updated).toHaveLength(1);
  });

  it('passes the event filter through to the list', async () => {
    const { deliveries, endpoints } = makeRepos([]);
    const seen: unknown[] = [];
    deliveries.listForPartner = async (limit, event) => {
      seen.push({ limit, event });
      return [];
    };
    await new WebhookDispatchService(deliveries, endpoints, publicLookup, send).list(10, 'delivery.delivered');
    expect(seen[0]).toEqual({ limit: 10, event: 'delivery.delivered' });
  });

  // The sweep and the ingest run off the wall clock in production; the tests pin it
  // everywhere else, which would leave that default unexercised.
  it('uses the wall clock when no time is supplied', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { deliveries, endpoints, calls } = makeRepos([due()]);
    const service = new WebhookDispatchService(deliveries, endpoints, publicLookup, send);

    await service.publish({ event: 'delivery.delivered', payload: {}, eventId: 'delivery.delivered:d4' });
    await service.process();
    await service.replay('d-1');
    expect(calls.queued).toHaveLength(1);
    expect(calls.delivered).toHaveLength(1);
  });

  it('records a thrown non-Error as its string form rather than "[object Object]"', async () => {
    fetchMock.mockRejectedValue('socket hang up');
    const { deliveries, endpoints, calls } = makeRepos([due()]);

    await new WebhookDispatchService(deliveries, endpoints, publicLookup, send).process(NOW);
    expect(calls.retried[0]!.error).toBe('socket hang up');
  });

  it('records a 200 when the response carries no status at all', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const { deliveries, endpoints, calls } = makeRepos([due()]);

    await new WebhookDispatchService(deliveries, endpoints, publicLookup, send).process(NOW);
    expect(calls.delivered[0]).toEqual({ id: 'd-1', status: 200 });
  });

  it('replays a known delivery and 404s an unknown one', async () => {
    const { deliveries, endpoints } = makeRepos([]);
    const service = new WebhookDispatchService(deliveries, endpoints, publicLookup, send);

    await expect(service.replay('d-1', undefined, NOW)).resolves.toMatchObject({ id: 'd-1' });
    await expect(service.replay('nope', undefined, NOW)).rejects.toThrow('Delivery not found');
  });
});

/*
 * HD-7: the AI web, in another repository, codes against contracts/ai-v1/events.openapi.json.
 * These hold the dispatcher to it, so the two cannot drift apart in silence.
 */
describe('the AI-web event contract (HD-7)', () => {
  const contract = JSON.parse(
    readFileSync(join(__dirname, '../../../../contracts/ai-v1/events.openapi.json'), 'utf8'),
  );

  it('signs the contract test vector exactly as a receiver will check it', () => {
    const v = contract['x-hydromart-signature-test-vector'];
    expect(signPayload(v.secret, v.timestamp, v.body)).toBe(v.signature);
    expect(verifySignature(v.secret, v.timestamp, v.body, v.signature)).toBe(true);
  });

  it('describes only events a service may publish', () => {
    for (const name of Object.keys(contract.webhooks)) expect(WEBHOOK_EVENTS).toContain(name);
  });

  it('sends the envelope and the headers the contract describes', async () => {
    const sent: { url: string; init: { headers: Record<string, string>; body: string } }[] = [];
    const send = async (url: string, init: unknown) => {
      sent.push({ url, init: init as (typeof sent)[number]['init'] });
      return { ok: true, status: 200 } as Response;
    };
    const applicationId = '3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807';
    const { deliveries, endpoints } = makeRepos([
      due({
        id: '7d0c8a52-5f5e-4c51-9a4e-2b9e0f6f3a11',
        event: 'franchise.application_submitted',
        eventId: `franchise.application_submitted:${applicationId}`,
        payload: { city: 'Bekasi', province: 'Jawa Barat', applicationId },
      }),
    ]);
    await new WebhookDispatchService(deliveries, endpoints, publicLookup, send).process(NOW);

    const op = contract.webhooks['franchise.application_submitted'].post;
    const { headers, body } = sent[0].init;
    for (const param of op.parameters) {
      expect(headers[param.name]).toMatch(new RegExp(param.schema.pattern ?? '.'));
    }
    expect(headers['X-Hydromart-Event']).toBe('franchise.application_submitted');
    const envelope = contract.components.schemas.FranchiseApplicationSubmitted;
    const parsed = JSON.parse(body);
    expect(Object.keys(parsed).sort()).toEqual([...envelope.required].sort());
    expect(parsed.eventId).toMatch(new RegExp(envelope.properties.eventId.pattern));
    expect(parsed.id).toBe(headers['X-Hydromart-Delivery']);
    expect(verifySignature('partner-secret', headers['X-Hydromart-Timestamp'], body, headers['X-Hydromart-Signature'])).toBe(true);
  });
});
