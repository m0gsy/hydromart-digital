import { PromoRuleController } from '../../src/modules/promo-rule.controller';
import { PromoRuleService } from '../../src/application/services/promo-rule.service';

describe('PromoRuleController', () => {
  const makeService = () =>
    ({
      findAll: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      quote: jest.fn().mockResolvedValue({
        lines: [],
        shipping: { appliedRuleId: null, shippingFeeOverride: null },
      }),
      apply: jest.fn().mockResolvedValue(undefined),
    }) as unknown as PromoRuleService;

  it('list() returns whatever the service returns', async () => {
    const service = makeService();
    const controller = new PromoRuleController(service);
    const result = await controller.list();
    expect(result).toEqual([]);
    expect(service.findAll).toHaveBeenCalled();
  });

  it('quote() maps the DTO into the service call and flattens the shipping result', async () => {
    const service = makeService();
    const controller = new PromoRuleController(service);
    const result = await controller.quote({
      depotId: undefined,
      channel: 'APP',
      lines: [{ productId: 'p1', categoryId: undefined, quantity: 1, unitPrice: 8000 }],
    });
    expect(service.quote).toHaveBeenCalledWith(
      expect.objectContaining({ depotId: null, channel: 'APP' }),
    );
    expect(result).toEqual({
      lines: [],
      shippingAppliedRuleId: null,
      shippingFeeOverride: null,
    });
  });

  it('apply() maps the DTO into the service call and returns nothing', async () => {
    const service = makeService();
    const controller = new PromoRuleController(service);
    await controller.apply({
      orderId: 'order-1',
      depotId: undefined,
      channel: 'COUNTER',
      lines: [],
    });
    expect(service.apply).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', depotId: null, channel: 'COUNTER' }),
    );
  });
});
