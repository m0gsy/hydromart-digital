import { DisputeRefundHttpAdapter } from '../../src/infrastructure/http/dispute-refund.http.adapter';
import { DepotConfigService } from '../../src/config/depot-config.service';
import { DisputeRefundUnavailableError } from '../../src/domain/errors';

/**
 * CA-2-39: three hops, because a dispute records a human order NUMBER and a refund needs a
 * payment. Every test here is about failing CLOSED — a dispute marked "refunded" against an
 * order nobody could find is the exact state the row is about.
 */
describe('DisputeRefundHttpAdapter (CA-2-39)', () => {
  const config = (over: Partial<DepotConfigService> = {}) =>
    ({
      orderServiceUrl: 'http://order:3004',
      paymentServiceUrl: 'http://payment:3005',
      ...over,
    }) as DepotConfigService;

  const json = (body: unknown, ok = true, status = 200) =>
    ({ ok, status, json: async () => body }) as never;

  afterEach(() => jest.restoreAllMocks());

  const wire = (
    orders: unknown,
    payments: unknown,
    refund: { ok: boolean; status?: number; body?: unknown } = { ok: true },
  ) => {
    const calls: { url: string; method: string; auth: string; body?: string }[] = [];
    global.fetch = jest.fn(async (url: string, init: never) => {
      const i = (init ?? {}) as { method?: string; headers: Record<string, string>; body?: string };
      calls.push({
        url: String(url),
        method: i.method ?? 'GET',
        auth: i.headers.authorization,
        body: i.body,
      });
      if (String(url).includes('/orders/manage')) return json(orders);
      if (String(url).includes('/for-order/')) return json(payments);
      return json(refund.body ?? {}, refund.ok, refund.status ?? 200);
    }) as never;
    return calls;
  };

  it('walks order number → order → payment → refund, carrying the caller token', async () => {
    const calls = wire(
      { items: [{ id: 'o-1', orderNumber: 'HM-260902-001' }] },
      { items: [{ id: 'p-1', status: 'PAID' }] },
    );

    await new DisputeRefundHttpAdapter(config()).request(
      'HM-260902-001',
      'galon bocor',
      'Bearer manager-token',
    );

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET http://order:3004/api/v1/orders/manage?orderNumber=HM-260902-001&limit=10',
      'GET http://payment:3005/api/v1/payments/for-order/o-1',
      'POST http://payment:3005/api/v1/payments/p-1/refund',
    ]);
    // The manager's own bearer the whole way: `Can('refundIssue')` applies to them, and the
    // refund is attributed to them rather than to a service key.
    expect(calls.every((c) => c.auth === 'Bearer manager-token')).toBe(true);
    expect(JSON.parse(calls[2]!.body!)).toEqual({ reason: 'galon bocor' });
  });

  /*
   * `orderNumber` is a SUBSTRING search on that endpoint (audit F-12), so a typed reference
   * can match several orders. Refunding the first of them would be picking one at random
   * with somebody's money.
   */
  it('refuses when the order number matches none, or more than one', async () => {
    wire({ items: [] }, { items: [] });
    await expect(
      new DisputeRefundHttpAdapter(config()).request('HM-1', 'x', 'Bearer t'),
    ).rejects.toBeInstanceOf(DisputeRefundUnavailableError);

    wire(
      {
        items: [
          { id: 'a', orderNumber: 'HM-1' },
          { id: 'b', orderNumber: 'HM-1' },
        ],
      },
      { items: [] },
    );
    await expect(
      new DisputeRefundHttpAdapter(config()).request('HM-1', 'x', 'Bearer t'),
    ).rejects.toThrow(/cocok dengan 2/);
  });

  it('ignores a substring match that is not the order asked for', async () => {
    wire({ items: [{ id: 'o-9', orderNumber: 'HM-260902-0011' }] }, { items: [] });

    await expect(
      new DisputeRefundHttpAdapter(config()).request('HM-260902-001', 'x', 'Bearer t'),
    ).rejects.toThrow(/tidak ditemukan/);
  });

  it('refuses an order with no settled payment', async () => {
    wire(
      { items: [{ id: 'o-1', orderNumber: 'HM-1' }] },
      { items: [{ id: 'p-1', status: 'PENDING' }] },
    );

    await expect(
      new DisputeRefundHttpAdapter(config()).request('HM-1', 'x', 'Bearer t'),
    ).rejects.toThrow(/belum ada pembayaran yang lunas/);
  });

  /* The other service's own message is more use to an operator than a status code. */
  it("passes payment-service's refusal through in its own words", async () => {
    wire(
      { items: [{ id: 'o-1', orderNumber: 'HM-1' }] },
      { items: [{ id: 'p-1', status: 'PAID' }] },
      { ok: false, status: 422, body: { message: 'Pembayaran ini sudah direfund.' } },
    );

    await expect(
      new DisputeRefundHttpAdapter(config()).request('HM-1', 'x', 'Bearer t'),
    ).rejects.toThrow(/sudah direfund/);
  });

  it.each([
    ['no order URL', { orderServiceUrl: '' }, 'Bearer t'],
    ['no payment URL', { paymentServiceUrl: '' }, 'Bearer t'],
    ['no caller token', {}, ''],
  ])('refuses with %s rather than issuing as somebody else', async (_l, over, auth) => {
    global.fetch = jest.fn() as never;

    await expect(
      new DisputeRefundHttpAdapter(config(over as never)).request('HM-1', 'x', auth),
    ).rejects.toBeInstanceOf(DisputeRefundUnavailableError);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  /*
   * The two reads can fail too, and each keeps its own words. "Order service is down" and
   * "this payment was already refunded" are different problems, and an operator can act on
   * the difference — flattening both to "gagal" would waste that.
   */
  it('reports a failed order read, and a failed payment read, in their own words', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ message: 'order-service sedang tidak tersedia' }),
    })) as never;
    await expect(
      new DisputeRefundHttpAdapter(config()).request('HM-1', 'x', 'Bearer t'),
    ).rejects.toThrow(/order-service sedang tidak tersedia/);

    let hop = 0;
    global.fetch = jest.fn(async () => {
      hop += 1;
      if (hop === 1) return json({ items: [{ id: 'o-1', orderNumber: 'HM-1' }] });
      return { ok: false, status: 500, json: async () => ({}) } as never;
    }) as never;
    await expect(
      new DisputeRefundHttpAdapter(config()).request('HM-1', 'x', 'Bearer t'),
    ).rejects.toThrow(/pembayaran tidak terbaca \(500\)/);
  });

  /* A gateway that answers HTML on an error has no `message` to pass through. */
  it('falls back to the status when the refusal is not JSON', async () => {
    let hop = 0;
    global.fetch = jest.fn(async () => {
      hop += 1;
      if (hop === 1) return json({ items: [{ id: 'o-1', orderNumber: 'HM-1' }] });
      if (hop === 2) return json({ items: [{ id: 'p-1', status: 'PAID' }] });
      return {
        ok: false,
        status: 502,
        json: async () => {
          throw new Error('not json');
        },
      } as never;
    }) as never;

    await expect(
      new DisputeRefundHttpAdapter(config()).request('HM-1', 'x', 'Bearer t'),
    ).rejects.toThrow(/refund ditolak \(502\)/);
  });
  /*
   * A body with no `items` at all — an empty 200 from a service that changed shape. Reading
   * it as "no orders" is right; reading it as a crash would turn a recoverable refusal into
   * a 500 the operator cannot act on.
   */
  it('treats a body with no items as nothing found, at either hop', async () => {
    global.fetch = jest.fn(async () => json({})) as never;
    await expect(
      new DisputeRefundHttpAdapter(config()).request('HM-1', 'x', 'Bearer t'),
    ).rejects.toThrow(/tidak ditemukan/);

    let hop = 0;
    global.fetch = jest.fn(async () => {
      hop += 1;
      return hop === 1 ? json({ items: [{ id: 'o-1', orderNumber: 'HM-1' }] }) : json({});
    }) as never;
    await expect(
      new DisputeRefundHttpAdapter(config()).request('HM-1', 'x', 'Bearer t'),
    ).rejects.toThrow(/belum ada pembayaran yang lunas/);
  });
});
