import { PricingAdjustType } from '../../src/domain/pricing-rule';
import { PricingService, CreateRuleInput } from '../../src/application/services/pricing.service';
import { PricingRuleNotFoundError, InvalidPricingWindowError, DepotNotFoundError } from '../../src/domain/errors';
import { FakePricingRuleRepository } from '../support/fakes';

// Minimal inventory + depot repo fakes sufficient for pricing (findPrices / findById).
class InvStub {
  prices = new Map<string, number>(); // productId -> sellPrice
  async findPrices(_depotId: string, productIds: string[]) {
    return productIds
      .filter((id) => this.prices.has(id))
      .map((id) => ({ productId: id, sellPrice: this.prices.get(id)! }));
  }
}
class DepotStub {
  exists = true;
  async findById() {
    return this.exists ? ({ id: 'd1', name: 'Depot' } as never) : null;
  }
}

function make() {
  const rules = new FakePricingRuleRepository();
  const inv = new InvStub();
  const depots = new DepotStub();
  const config = { pricingTimeZone: 'Asia/Jakarta' } as never;
  const service = new PricingService(rules as never, inv as never, depots as never, config);
  return { service, rules, inv, depots };
}

const baseInput: CreateRuleInput = {
  productId: null,
  adjustType: PricingAdjustType.PERCENT,
  value: -10,
  daysOfWeek: [],
  startMinute: null,
  endMinute: null,
  validFrom: null,
  validUntil: null,
  priority: 0,
  active: true,
};

describe('PricingService CRUD', () => {
  it('rejects create for an unknown depot', async () => {
    const { service, depots } = make();
    depots.exists = false;
    await expect(service.create('d1', baseInput)).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('rejects an inverted time window', async () => {
    const { service } = make();
    await expect(
      service.create('d1', { ...baseInput, startMinute: 600, endMinute: 300 }),
    ).rejects.toBeInstanceOf(InvalidPricingWindowError);
  });

  it('rejects an inverted date range', async () => {
    const { service } = make();
    await expect(
      service.create('d1', {
        ...baseInput,
        validFrom: new Date('2026-07-10T00:00:00Z'),
        validUntil: new Date('2026-07-01T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(InvalidPricingWindowError);
  });

  it('creates, lists, updates, and removes a rule', async () => {
    const { service } = make();
    const created = await service.create('d1', baseInput);
    expect(await service.list('d1')).toHaveLength(1);
    const updated = await service.update(created.id, { value: -20 });
    expect(updated.value).toBe(-20);
    await service.remove(created.id);
    expect(await service.list('d1')).toHaveLength(0);
  });

  it('throws when updating a missing rule', async () => {
    const { service } = make();
    await expect(service.update('nope', { value: 1 })).rejects.toBeInstanceOf(PricingRuleNotFoundError);
  });
});

describe('PricingService.resolvePrices', () => {
  const at = new Date('2026-07-11T05:00:00Z'); // Sat 12:00 WIB

  it('merges sellPrice override and the winning rule per product', async () => {
    const { service, rules, inv } = make();
    inv.prices.set('p1', 15000);
    await service.create('d1', { ...baseInput, productId: 'p1', adjustType: PricingAdjustType.PERCENT, value: -10 });
    await service.create('d1', { ...baseInput, productId: null, adjustType: PricingAdjustType.FIXED, value: -500 });

    const out = await service.resolvePrices('d1', ['p1', 'p2'], at);
    const p1 = out.find((r) => r.productId === 'p1')!;
    expect(p1.sellPrice).toBe(15000);
    expect(p1.adjustType).toBe(PricingAdjustType.PERCENT); // product-specific beats depot-wide
    expect(p1.value).toBe(-10);

    const p2 = out.find((r) => r.productId === 'p2')!;
    expect(p2.sellPrice).toBeUndefined(); // no override
    expect(p2.adjustType).toBe(PricingAdjustType.FIXED); // depot-wide applies
    expect(p2.value).toBe(-500);
    void rules;
  });

  it('omits a product with neither an override nor a rule', async () => {
    const { service } = make();
    const out = await service.resolvePrices('d1', ['p9'], at);
    expect(out).toHaveLength(0);
  });
});
