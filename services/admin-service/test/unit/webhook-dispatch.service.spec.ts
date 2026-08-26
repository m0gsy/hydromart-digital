import {
  MAX_ATTEMPTS,
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
    ...over,
  };
}

/** Records what the dispatcher wrote, so each outcome can be asserted on. */
function makeRepos(dueRows: DueDelivery[], subscribers: WebhookRecord[] = [endpoint()]) {
  const calls = {
    queued: [] as { endpointId: string; event: string }[],
    delivered: [] as { id: string; status: number }[],
    retried: [] as { id: string; attempts: number; nextAttemptAt: Date; error: string }[],
    dead: [] as { id: string; attempts: number; error: string }[],
    updated: [] as { id: string; data: UpdateWebhookData }[],
  };
  const stats = { delivered: 1, attempted: 2, lastStatus: 'DELIVERED' as WebhookDeliveryStatus };
  const deliveries: WebhookDeliveryRepository = {
    subscribersOf: async () => subscribers,
    queue: async (rows) => {
      calls.queued.push(...rows.map((r) => ({ endpointId: r.endpointId, event: r.event })));
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
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('queues one delivery per subscribed endpoint', async () => {
    const { deliveries, endpoints, calls } = makeRepos([], [endpoint(), endpoint({ id: 'ep-2' })]);
    const service = new WebhookDispatchService(deliveries, endpoints);

    await expect(
      service.publish({ event: 'delivery.delivered', payload: { a: 1 } }, NOW),
    ).resolves.toEqual({ queued: 2 });
    expect(calls.queued.map((q) => q.endpointId)).toEqual(['ep-1', 'ep-2']);
  });

  it('sends a signed POST and records the endpoint outcome', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { deliveries, endpoints, calls } = makeRepos([due()]);
    const service = new WebhookDispatchService(deliveries, endpoints);

    await expect(service.process(NOW)).resolves.toEqual({ sent: 1, failed: 0, dead: 0, ok: true });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://partner.example.com/hooks');
    const timestamp = init.headers['X-Hydromart-Timestamp'];
    expect(init.headers['X-Hydromart-Event']).toBe('delivery.delivered');
    expect(
      verifySignature('partner-secret', timestamp, init.body, init.headers['X-Hydromart-Signature']),
    ).toBe(true);
    expect(JSON.parse(init.body)).toMatchObject({ event: 'delivery.delivered', data: { deliveryId: 'x' } });
    expect(calls.delivered).toEqual([{ id: 'd-1', status: 200 }]);
    // The two columns that were permanently null before this existed.
    expect(calls.updated[0]!.data).toEqual({ lastDeliveryStatus: 'DELIVERED', deliveryRatePct: 50 });
  });

  it('sends unsigned rather than signing with a placeholder when no secret is set', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { deliveries, endpoints } = makeRepos([due({ secret: null })]);
    await new WebhookDispatchService(deliveries, endpoints).process(NOW);

    expect(fetchMock.mock.calls[0][1].headers['X-Hydromart-Signature']).toBeUndefined();
  });

  it('schedules a retry with backoff when the endpoint rejects it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { deliveries, endpoints, calls } = makeRepos([due({ attempts: 1 })]);

    await expect(new WebhookDispatchService(deliveries, endpoints).process(NOW)).resolves.toEqual({
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

    await new WebhookDispatchService(deliveries, endpoints).process(NOW);
    expect(calls.retried[0]).toMatchObject({ attempts: 1, error: 'ETIMEDOUT' });
  });

  it('gives up on an endpoint that never answers, instead of retrying forever', async () => {
    fetchMock.mockRejectedValue(new Error('ENOTFOUND'));
    const { deliveries, endpoints, calls } = makeRepos([due({ attempts: MAX_ATTEMPTS - 1 })]);

    await expect(new WebhookDispatchService(deliveries, endpoints).process(NOW)).resolves.toEqual({
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
    await new WebhookDispatchService(deliveries, endpoints).publish(
      { event: 'delivery.delivered', payload: {}, occurredAt: earlier },
      NOW,
    );
    expect(queued[0]).toMatchObject({ occurredAt: earlier });
  });

  it('queues nothing when no endpoint subscribed to the event', async () => {
    const { deliveries, endpoints, calls } = makeRepos([], []);
    await expect(
      new WebhookDispatchService(deliveries, endpoints).publish(
        { event: 'nobody.cares', payload: {} },
        NOW,
      ),
    ).resolves.toEqual({ queued: 0 });
    expect(calls.queued).toHaveLength(0);
  });

  it('does nothing, and touches no endpoint, when nothing is due', async () => {
    const { deliveries, endpoints, calls } = makeRepos([]);
    await expect(new WebhookDispatchService(deliveries, endpoints).process(NOW)).resolves.toEqual({
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

    await new WebhookDispatchService(deliveries, endpoints).process(NOW);
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
    await new WebhookDispatchService(deliveries, endpoints).list(10, 'delivery.delivered');
    expect(seen[0]).toEqual({ limit: 10, event: 'delivery.delivered' });
  });

  // The sweep and the ingest run off the wall clock in production; the tests pin it
  // everywhere else, which would leave that default unexercised.
  it('uses the wall clock when no time is supplied', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { deliveries, endpoints, calls } = makeRepos([due()]);
    const service = new WebhookDispatchService(deliveries, endpoints);

    await service.publish({ event: 'delivery.delivered', payload: {} });
    await service.process();
    await service.replay('d-1');
    expect(calls.queued).toHaveLength(1);
    expect(calls.delivered).toHaveLength(1);
  });

  it('records a thrown non-Error as its string form rather than "[object Object]"', async () => {
    fetchMock.mockRejectedValue('socket hang up');
    const { deliveries, endpoints, calls } = makeRepos([due()]);

    await new WebhookDispatchService(deliveries, endpoints).process(NOW);
    expect(calls.retried[0]!.error).toBe('socket hang up');
  });

  it('records a 200 when the response carries no status at all', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const { deliveries, endpoints, calls } = makeRepos([due()]);

    await new WebhookDispatchService(deliveries, endpoints).process(NOW);
    expect(calls.delivered[0]).toEqual({ id: 'd-1', status: 200 });
  });

  it('replays a known delivery and 404s an unknown one', async () => {
    const { deliveries, endpoints } = makeRepos([]);
    const service = new WebhookDispatchService(deliveries, endpoints);

    await expect(service.replay('d-1', undefined, NOW)).resolves.toMatchObject({ id: 'd-1' });
    await expect(service.replay('nope', undefined, NOW)).rejects.toThrow('Delivery not found');
  });
});
