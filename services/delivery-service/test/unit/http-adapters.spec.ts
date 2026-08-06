import { DeliveryConfigService } from '../../src/config/delivery-config.service';
import { OrderCoordinationHttpAdapter } from '../../src/infrastructure/http/order-coordination.http.adapter';
import { DepotLocationHttpAdapter } from '../../src/infrastructure/http/depot-location.http.adapter';
import { OpsNotifierHttpAdapter } from '../../src/infrastructure/http/ops-notifier.http.adapter';
import { EventPublisherHttpAdapter } from '../../src/infrastructure/http/event-publisher.http.adapter';
import { CashCollectionHttpAdapter } from '../../src/infrastructure/http/cash-collection.http.adapter';
import { CourierPayoutHttpAdapter } from '../../src/infrastructure/http/courier-payout.http.adapter';
import { RatingHttpAdapter } from '../../src/infrastructure/http/rating.http.adapter';
import type { OpsIncidentAlert } from '../../src/application/ports/ops-notifier.port';
import type {
  CashVarianceChargedEvent,
  DeliveryCompletedEvent,
} from '../../src/application/ports/courier-payout.port';

// These specs exercise the REAL delivery HTTP adapter code (URL building, headers,
// res.ok branches, fail-open vs fail-closed, response parsing) against a mocked
// global.fetch — the units the e2e's Fake* stand-ins never run. No network, no DB.

const KEY = 'internal-key-01';

function makeConfig(over: Partial<Record<string, unknown>> = {}): DeliveryConfigService {
  return {
    orderServiceUrl: 'http://order:3005',
    depotServiceUrl: 'http://depot:3007',
    paymentServiceUrl: 'http://payment:3004',
    crmServiceUrl: 'http://crm:3012',
    payoutServiceUrl: 'http://payout:3015',
    adminServiceUrl: 'http://admin:3017',
    internalServiceKey: KEY,
    opsAlertPhone: '628123',
    ...over,
  } as unknown as DeliveryConfigService;
}

function res(init: { ok?: boolean; status?: number; body?: unknown }): Response {
  const status = init.status ?? (init.ok === false ? 500 : 200);
  return {
    ok: init.ok ?? status < 400,
    status,
    json: async () => init.body ?? {},
  } as unknown as Response;
}

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('OrderCoordinationHttpAdapter', () => {
  it('throws without authorization (before any fetch)', async () => {
    const a = new OrderCoordinationHttpAdapter(makeConfig());
    await expect(a.advanceStatus('o1', 'PICKED_UP', '')).rejects.toThrow(/authorization/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PATCHes order status on happy path, forwarding driver name + phone when given', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new OrderCoordinationHttpAdapter(makeConfig()).advanceStatus('o1', 'DELIVERED', 'Bearer x', {
      driverName: 'Budi',
      driverPhone: '081298765432',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://order:3005/api/v1/orders/o1/status',
      expect.objectContaining({ method: 'PATCH' }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ status: 'DELIVERED', driverName: 'Budi', driverPhone: '081298765432' });
  });

  it('serialises the ETA as an ISO string when given', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    const eta = new Date('2026-07-20T10:30:00.000Z');
    await new OrderCoordinationHttpAdapter(makeConfig()).advanceStatus('o1', 'ON_DELIVERY', 'Bearer x', {
      estimatedArrivalAt: eta,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      status: 'ON_DELIVERY',
      estimatedArrivalAt: eta.toISOString(),
    });
  });

  it('omits meta fields when not provided', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new OrderCoordinationHttpAdapter(makeConfig()).advanceStatus('o1', 'PICKED_UP', 'Bearer x');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: 'PICKED_UP' });
  });

  it('fails closed (throws) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 403 }));
    await expect(
      new OrderCoordinationHttpAdapter(makeConfig()).advanceStatus('o1', 'PICKED_UP', 'Bearer x'),
    ).rejects.toThrow(/403/);
  });

  it('fails closed (throws) when the order-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new OrderCoordinationHttpAdapter(makeConfig()).advanceStatus('o1', 'PICKED_UP', 'Bearer x'),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe('DepotLocationHttpAdapter', () => {
  it('returns the depot location on happy path', async () => {
    fetchMock.mockResolvedValue(res({ body: { name: 'Depot A', lat: -6.2, lng: 106.8 } }));
    const out = await new DepotLocationHttpAdapter(makeConfig()).find('d1');
    expect(out).toEqual({ id: 'd1', name: 'Depot A', lat: -6.2, lng: 106.8 });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://depot:3007/api/v1/depots/d1',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('returns null when coordinates are missing', async () => {
    fetchMock.mockResolvedValue(res({ body: { name: 'Depot A' } }));
    expect(await new DepotLocationHttpAdapter(makeConfig()).find('d1')).toBeNull();
  });

  it('throws (fail closed) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(new DepotLocationHttpAdapter(makeConfig()).find('d1')).rejects.toThrow(/500/);
  });

  it('throws (fail closed) when depot-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    await expect(new DepotLocationHttpAdapter(makeConfig()).find('d1')).rejects.toThrow(/timeout/);
  });
});

describe('OpsNotifierHttpAdapter', () => {
  const alert: OpsIncidentAlert = {
    category: 'ACCIDENT' as never,
    severity: 'HIGH' as never,
    description: 'truck stuck',
  };

  it('skips without ops phone', async () => {
    await new OpsNotifierHttpAdapter(makeConfig({ opsAlertPhone: '' })).incidentReported(alert);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips without crm URL', async () => {
    await new OpsNotifierHttpAdapter(makeConfig({ crmServiceUrl: '' })).incidentReported(alert);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips without internal key', async () => {
    await new OpsNotifierHttpAdapter(makeConfig({ internalServiceKey: '' })).incidentReported(alert);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs a COURIER_INCIDENT on happy path', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new OpsNotifierHttpAdapter(makeConfig()).incidentReported(alert);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://crm:3012/api/v1/notifications/internal',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).event).toBe('COURIER_INCIDENT');
  });

  it('fails open (no throw) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(
      new OpsNotifierHttpAdapter(makeConfig()).incidentReported(alert),
    ).resolves.toBeUndefined();
  });

  it('fails open (no throw) when crm-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new OpsNotifierHttpAdapter(makeConfig()).incidentReported(alert),
    ).resolves.toBeUndefined();
  });
});

describe('CashCollectionHttpAdapter', () => {
  it('throws without authorization', async () => {
    await expect(
      new CashCollectionHttpAdapter(makeConfig()).sumCollected(['o1'], ''),
    ).rejects.toThrow(/authorization/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns zero for no order ids (without calling fetch)', async () => {
    const out = await new CashCollectionHttpAdapter(makeConfig()).sumCollected([], 'Bearer x');
    expect(out).toEqual({ total: 0, count: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sums PAID cash on happy path', async () => {
    fetchMock.mockResolvedValue(res({ body: { total: 150000, count: 3 } }));
    const out = await new CashCollectionHttpAdapter(makeConfig()).sumCollected(
      ['o1', 'o2', 'o3'],
      'Bearer x',
    );
    expect(out).toEqual({ total: 150000, count: 3 });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://payment:3004/api/v1/payments/cash-collected?orderIds=o1%2Co2%2Co3',
    );
  });

  it('fails closed (throws) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(
      new CashCollectionHttpAdapter(makeConfig()).sumCollected(['o1'], 'Bearer x'),
    ).rejects.toThrow(/500/);
  });
});

describe('CourierPayoutHttpAdapter', () => {
  const completed: DeliveryCompletedEvent = {
    courierId: 'c1',
    depotId: 'd1',
    deliveryId: 'del1',
    deliveredAt: new Date().toISOString(),
    onTime: true,
  };
  const variance: CashVarianceChargedEvent = {
    courierId: 'c1',
    depotId: 'd1',
    settlementId: 's1',
    amount: 5000,
  };

  it('deliveryCompleted: skips without payout URL', async () => {
    await new CourierPayoutHttpAdapter(makeConfig({ payoutServiceUrl: '' })).deliveryCompleted(
      completed,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deliveryCompleted: skips without internal key', async () => {
    await new CourierPayoutHttpAdapter(makeConfig({ internalServiceKey: '' })).deliveryCompleted(
      completed,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('deliveryCompleted: POSTs to the earning endpoint on happy path', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new CourierPayoutHttpAdapter(makeConfig()).deliveryCompleted(completed);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://payout:3015/api/v1/courier/ledger/internal',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('cashVarianceCharged: POSTs to the variance endpoint on happy path', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new CourierPayoutHttpAdapter(makeConfig()).cashVarianceCharged(variance);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://payout:3015/api/v1/courier/ledger/variance/internal',
    );
  });

  it('fails open (no throw) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    await expect(
      new CourierPayoutHttpAdapter(makeConfig()).deliveryCompleted(completed),
    ).resolves.toBeUndefined();
  });

  it('fails open (no throw) when payout-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new CourierPayoutHttpAdapter(makeConfig()).cashVarianceCharged(variance),
    ).resolves.toBeUndefined();
  });
});

describe('RatingHttpAdapter', () => {
  it('returns empty for no order ids (without fetch)', async () => {
    const out = await new RatingHttpAdapter(makeConfig()).avgRating([]);
    expect(out).toEqual({ average: null, count: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns empty (skips) without internal key', async () => {
    const out = await new RatingHttpAdapter(makeConfig({ internalServiceKey: '' })).avgRating(['o1']);
    expect(out).toEqual({ average: null, count: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the mean rating on happy path', async () => {
    fetchMock.mockResolvedValue(res({ body: { average: 4.5, count: 8 } }));
    const out = await new RatingHttpAdapter(makeConfig()).avgRating(['o1', 'o2']);
    expect(out).toEqual({ average: 4.5, count: 8 });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://order:3005/api/v1/orders/reviews/ratings/internal',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('preserves a null average from the service', async () => {
    fetchMock.mockResolvedValue(res({ body: { average: null, count: 0 } }));
    expect(await new RatingHttpAdapter(makeConfig()).avgRating(['o1'])).toEqual({
      average: null,
      count: 0,
    });
  });

  it('fails open (empty) on non-2xx', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 500 }));
    expect(await new RatingHttpAdapter(makeConfig()).avgRating(['o1'])).toEqual({
      average: null,
      count: 0,
    });
  });

  it('fails open (empty) when order-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    expect(await new RatingHttpAdapter(makeConfig()).avgRating(['o1'])).toEqual({
      average: null,
      count: 0,
    });
  });
});

// Every adapter arms an AbortController so a hung owner cannot pin a courier's screen open.
// The abort callback itself only runs when the timer fires, which no other spec waits for —
// leaving the one line that enforces the timeout unexecuted.
describe('the 5s timeout actually aborts', () => {
  const hang = () =>
    jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
        }),
    );

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** Attach the assertion BEFORE the timer fires, or the rejection lands unhandled. */
  async function settleAfterTimeout<T>(assertion: Promise<T>): Promise<T> {
    await jest.advanceTimersByTimeAsync(5000);
    return assertion;
  }

  it('cash collection gives up and rethrows', async () => {
    global.fetch = hang() as never;
    await settleAfterTimeout(
      expect(
        new CashCollectionHttpAdapter(makeConfig()).sumCollected(['o1'], 'Bearer t'),
      ).rejects.toThrow(/aborted/),
    );
  });

  it('depot lookup gives up and rethrows', async () => {
    global.fetch = hang() as never;
    await settleAfterTimeout(
      expect(new DepotLocationHttpAdapter(makeConfig()).find('dep-1')).rejects.toThrow(/aborted/),
    );
  });

  it('order coordination gives up and rethrows', async () => {
    global.fetch = hang() as never;
    await settleAfterTimeout(
      expect(
        new OrderCoordinationHttpAdapter(makeConfig()).advanceStatus(
          'o1',
          'ON_DELIVERY' as never,
          'Bearer t',
        ),
      ).rejects.toThrow(/aborted/),
    );
  });

  it('payout push fails OPEN on the same timeout', async () => {
    global.fetch = hang() as never;
    await settleAfterTimeout(
      expect(
        new CourierPayoutHttpAdapter(makeConfig()).deliveryCompleted({
          deliveryId: 'd1',
        } as DeliveryCompletedEvent),
      ).resolves.toBeUndefined(),
    );
  });

  it('ops alert fails OPEN on the same timeout', async () => {
    global.fetch = hang() as never;
    await settleAfterTimeout(
      expect(
        new OpsNotifierHttpAdapter(makeConfig()).incidentReported({
          severity: 'HIGH',
          category: 'ACCIDENT',
          description: 'ban pecah',
        } as OpsIncidentAlert),
      ).resolves.toBeUndefined(),
    );
  });

  it('rating read fails OPEN on the same timeout', async () => {
    global.fetch = hang() as never;
    await settleAfterTimeout(
      expect(new RatingHttpAdapter(makeConfig()).avgRating(['o1'])).resolves.toEqual({
        average: null,
        count: 0,
      }),
    );
  });
});

// A body that arrives without the fields we read is not an error — it is 0 / '' / null, never
// NaN or "undefined" rendered into a courier's screen.
describe('missing fields in an owner response', () => {
  it('cash collection reads absent totals as zero', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }) as never;
    expect(await new CashCollectionHttpAdapter(makeConfig()).sumCollected(['o1'], 'Bearer t')).toEqual({
      total: 0,
      count: 0,
    });
  });

  it('a depot with coordinates but no name still anchors the radius check', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ lat: -6.2, lng: 106.8 }) }) as never;
    expect(await new DepotLocationHttpAdapter(makeConfig()).find('dep-1')).toEqual({
      id: 'dep-1',
      name: '',
      lat: -6.2,
      lng: 106.8,
    });
  });

  it('a rating body with no count reports zero ratings', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ average: 4.5 }) }) as never;
    expect(await new RatingHttpAdapter(makeConfig()).avgRating(['o1'])).toEqual({
      average: 4.5,
      count: 0,
    });
  });
});

// H-30: the producer half of the partner webhook fan-out. Fail-open by contract — see
// EventPublisherPort: a partner integration must not cost a courier their handover.
describe('EventPublisherHttpAdapter', () => {
  const at = new Date('2026-08-04T09:00:00.000Z');

  it('POSTs the event to admin-service with the internal key', async () => {
    fetchMock.mockResolvedValue(res({ ok: true }));
    await new EventPublisherHttpAdapter(makeConfig()).publish('delivery.delivered', { a: 1 }, at);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://admin:3017/api/v1/webhooks/events');
    expect(init.headers['x-internal-key']).toBe(KEY);
    expect(JSON.parse(init.body)).toEqual({
      event: 'delivery.delivered',
      payload: { a: 1 },
      occurredAt: at.toISOString(),
    });
  });

  it('publishes nothing when the fan-out is not configured', async () => {
    await new EventPublisherHttpAdapter(makeConfig({ adminServiceUrl: '' })).publish('e', {}, at);
    await new EventPublisherHttpAdapter(makeConfig({ internalServiceKey: '' })).publish('e', {}, at);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails open on a non-2xx and on an unreachable admin-service', async () => {
    fetchMock.mockResolvedValue(res({ ok: false, status: 503 }));
    await expect(
      new EventPublisherHttpAdapter(makeConfig()).publish('e', {}, at),
    ).resolves.toBeUndefined();

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      new EventPublisherHttpAdapter(makeConfig()).publish('e', {}, at),
    ).resolves.toBeUndefined();
  });
});
