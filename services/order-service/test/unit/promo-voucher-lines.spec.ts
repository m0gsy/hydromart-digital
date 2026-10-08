import { PromoHttpAdapter } from '../../src/infrastructure/http/promo.http.adapter';
import { OrderConfigService } from '../../src/config/order-config.service';
import { voucherLinesFor } from '../../src/domain/promo-adjustment';

const config = {
  promoServiceUrl: 'http://promo-service',
  internalServiceKey: 'test-internal-key',
} as OrderConfigService;

const LINES = [
  { productId: 'p1', categoryId: 'c1', lineTotal: 40000 },
  { productId: 'p1', categoryId: 'c1', lineTotal: 0 },
];

describe('voucher lines (item 5 B)', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ discount: 1 }) });
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const sent = () => JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);

  it('quote puts the lines ON THE WIRE (an optional parameter nothing would notice dropped)', async () => {
    await new PromoHttpAdapter(config).quote('X', 'c', 1, 0, 'Bearer t', 'd1', LINES);
    expect(sent()).toMatchObject({ code: 'X', depotId: 'd1', lines: LINES });
  });

  it('quoteFor puts the lines on the wire', async () => {
    await new PromoHttpAdapter(config).quoteFor('X', 'c', 1, 0, 'd1', LINES);
    expect(sent()).toMatchObject({ customerId: 'c', depotId: 'd1', lines: LINES });
  });

  it('redeem puts the same lines on the wire', async () => {
    await new PromoHttpAdapter(config).redeem('X', 'c', 'o', 1, 0, '', 'd1', LINES);
    expect(sent()).toMatchObject({ orderId: 'o', depotId: 'd1', lines: LINES });
  });

  it('voucherLinesFor builds one line per FINAL item, free rows at 0, uncategorised as null', () => {
    const lines = voucherLinesFor(
      [
        { productId: 'p1', lineTotal: 40000 },
        { productId: 'p1', lineTotal: 0 },
        { productId: 'p2', lineTotal: 5000 },
      ],
      new Map([['p1', 'c1']]),
    );
    expect(lines).toEqual([
      { productId: 'p1', categoryId: 'c1', lineTotal: 40000 },
      { productId: 'p1', categoryId: 'c1', lineTotal: 0 },
      { productId: 'p2', categoryId: null, lineTotal: 5000 },
    ]);
  });
});
