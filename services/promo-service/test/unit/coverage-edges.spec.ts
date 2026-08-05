import { DiscountType } from '../../src/domain/voucher';
import { CreateVoucherData } from '../../src/application/ports/voucher.repository';
import { VoucherService } from '../../src/application/services/voucher.service';
import { PromotionService } from '../../src/application/services/promotion.service';
import { OrderValueHttpAdapter } from '../../src/infrastructure/http/order-value.http.adapter';
import { FakeCustomerLookup, FakeNotification, InMemoryVoucherRepository } from '../support/fakes';

const baseVoucher = (overrides: Partial<CreateVoucherData> = {}): CreateVoucherData => ({
  code: 'HEMAT10',
  description: null,
  discountType: DiscountType.PERCENTAGE,
  value: 10,
  minSpend: 0,
  maxDiscount: null,
  validFrom: null,
  validUntil: null,
  usageLimit: null,
  perCustomerLimit: 1,
  ...overrides,
});

describe('VoucherService.browse defaults', () => {
  const svc = () =>
    new VoucherService(new InMemoryVoucherRepository(), new FakeCustomerLookup(), new FakeNotification());

  it('pages from 1 with a limit of 20 when called bare', async () => {
    expect(await svc().browse()).toMatchObject({ page: 1, limit: 20 });
  });

  // Clamping rather than rejecting: a bad page is nearly always a stale bookmark.
  it.each([
    ['a page below 1', 0, 20, 1, 20],
    ['a limit below 1', 1, 0, 1, 1],
    ['a limit over the cap', 1, 9999, 1, 100],
  ])('clamps %s', async (_case, page, limit, p, l) => {
    expect(await svc().browse(page, limit)).toMatchObject({ page: p, limit: l });
  });

  it('filters to active only when asked', async () => {
    expect(await svc().browse(1, 20, true)).toMatchObject({ items: [] });
  });
});

/**
 * `budgetCap !== null ? sum : 0` guards a whole extra query. Skipping it for the
 * common uncapped voucher is the point — but the capped path is the one that stops
 * a promo from overspending, so both need to be real.
 */
describe('VoucherService budget cap short-circuit', () => {
  let repo: InMemoryVoucherRepository;
  let service: VoucherService;

  beforeEach(() => {
    repo = new InMemoryVoucherRepository();
    service = new VoucherService(repo, new FakeCustomerLookup(), new FakeNotification());
  });

  it('does not sum redemptions for an uncapped voucher', async () => {
    await service.create(baseVoucher({ code: 'NOCAP' }));
    const spy = jest.spyOn(repo, 'sumRedemptionsFor');
    await service.quote('NOCAP', 'cust-1', 100_000, 5_000);
    expect(spy).not.toHaveBeenCalled();
  });

  it('counts the burned budget when quoting a capped voucher', async () => {
    await service.create(baseVoucher({ code: 'CAPPED', budgetCap: 1_000_000 } as never));
    const spy = jest.spyOn(repo, 'sumRedemptionsFor');
    await service.quote('CAPPED', 'cust-1', 100_000, 5_000);
    expect(spy).toHaveBeenCalled();
  });

  // H-1: redeem no longer calls sumRedemptionsFor on its own connection — the burned
  // total is read inside the locked transaction, because reading it outside was exactly
  // what let concurrent redemptions blow past the cap. So assert the CAP, not the call:
  // this is the behaviour that has to hold, and it survives the next refactor.
  it('enforces the budget cap on redeem', async () => {
    await service.create(baseVoucher({ code: 'CAPPED', budgetCap: 15_000 } as never));

    const first = await service.redeem('CAPPED', 'cust-1', 'order-1', 100_000, 5_000);
    expect(first.discountApplied).toBeGreaterThan(0);

    // The next redemption would push the total past the cap, so it must be refused
    // outright rather than recorded and reconciled later.
    await expect(service.redeem('CAPPED', 'cust-2', 'order-2', 100_000, 5_000)).rejects.toThrow();
    expect(await repo.findRedemptionByOrder('order-2')).toBeNull();
  });
});

describe('PromotionService.listActive', () => {
  // The default `new Date()` is what the customer Home page actually calls — every
  // test so far passed an explicit clock, so the production path was never taken.
  it('defaults the clock to now', async () => {
    const findActive = jest.fn().mockResolvedValue([]);
    const before = Date.now();
    await new PromotionService({ findActive } as never, {} as never, {} as never).listActive();
    const passed = findActive.mock.calls[0][0] as Date;
    expect(passed.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('passes an explicit clock straight through', async () => {
    const findActive = jest.fn().mockResolvedValue([]);
    const at = new Date('2026-03-01T00:00:00.000Z');
    await new PromotionService({ findActive } as never, {} as never, {} as never).listActive(at);
    expect(findActive).toHaveBeenCalledWith(at);
  });
});

/**
 * A cross-service read that decides money. Every uncertain answer has to be `null`
 * ("unknown"), never a partial list — a caller that treats a short list as complete
 * would under-count someone's spend.
 */
describe('OrderValueHttpAdapter', () => {
  const config = { internalServiceKey: 'k', orderServiceUrl: 'http://order:3003' };
  const adapter = (cfg: Record<string, string> = config) => new OrderValueHttpAdapter(cfg as never);
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as { fetch: unknown }).fetch = fetchMock;
  });

  it('short-circuits an empty request without a round trip', async () => {
    expect(await adapter().findOrderValues([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['no key', { orderServiceUrl: 'http://order:3003' }],
    ['no url', { internalServiceKey: 'k' }],
  ])('returns unknown when configured with %s', async (_c, cfg) => {
    expect(await adapter(cfg).findOrderValues(['o1'])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the values when every requested order came back', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ orderId: 'o1', totalIdr: 50_000 }],
    });
    expect(await adapter().findOrderValues(['o1'])).toEqual([{ orderId: 'o1', totalIdr: 50_000 }]);
  });

  it.each([
    ['a non-object entry', [null]],
    ['a primitive entry', ['o1']],
    ['an entry missing totalIdr', [{ orderId: 'o1' }]],
  ])('returns unknown for %s', async (_case, body) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => body });
    expect(await adapter().findOrderValues(['o1'])).toBeNull();
  });

  // The important one: a SHORT answer is not a valid answer.
  it('returns unknown when the response omits one of the requested orders', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ orderId: 'o1', totalIdr: 50_000 }],
    });
    expect(await adapter().findOrderValues(['o1', 'o2'])).toBeNull();
  });

  it('returns unknown on a non-2xx and on a dead connection', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    expect(await adapter().findOrderValues(['o1'])).toBeNull();
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await adapter().findOrderValues(['o1'])).toBeNull();
  });
});
