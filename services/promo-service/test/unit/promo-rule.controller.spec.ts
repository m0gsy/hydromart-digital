import { AuthenticatedUser, Role } from '@hydromart/platform';

import { PromoRuleController } from '../../src/modules/promo-rule.controller';
import { PromoRuleService } from '../../src/application/services/promo-rule.service';

const managerOwnDepot = {
  sub: 'u-1',
  role: Role.MANAGER,
  phone: null,
  depotId: 'depot-a',
  depotIds: ['depot-a'],
} as AuthenticatedUser;

const managerOtherDepot = {
  sub: 'u-2',
  role: Role.MANAGER,
  phone: null,
  depotId: 'depot-b',
  depotIds: ['depot-b'],
} as AuthenticatedUser;

const hqUser = { sub: 'hq-1', role: Role.SUPER_ADMIN, phone: null } as AuthenticatedUser;

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
      usage: jest.fn().mockResolvedValue([]),
    }) as unknown as PromoRuleService;

  const rule = (overrides: Partial<{ id: string; depotId: string | null }> = {}) => ({
    id: 'rule-1',
    name: 'Jumat Berkah',
    depotId: 'depot-a',
    ...overrides,
  });

  it('list() returns whatever the service returns', async () => {
    const service = makeService();
    const controller = new PromoRuleController(service);
    const result = await controller.list();
    expect(result).toEqual([]);
    expect(service.findAll).toHaveBeenCalled();
  });

  describe('get()', () => {
    it('returns the rule when the caller is unscoped (HQ)', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule());
      const controller = new PromoRuleController(service);
      const result = await controller.get('rule-1', hqUser);
      expect(result).toEqual(rule());
    });

    it('returns the rule when the depot-scoped caller owns its depot', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-a' }));
      const controller = new PromoRuleController(service);
      const result = await controller.get('rule-1', managerOwnDepot);
      expect(result).toEqual(rule({ depotId: 'depot-a' }));
    });

    it('rejects a depot-scoped caller reading another depot\'s rule', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-a' }));
      const controller = new PromoRuleController(service);
      await expect(controller.get('rule-1', managerOtherDepot)).rejects.toThrow();
    });

    // Fix 3: list() already shows a depot-scoped reader every network-wide (depotId null)
    // rule alongside their own depot's — get() used to gate on it too, which let list()
    // promise a rule the detail page then refused to open. Only a depot-OWNED rule still
    // needs the depot-access check.
    it('allows a depot-scoped caller to read a network-wide rule', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule({ depotId: null }));
      const controller = new PromoRuleController(service);
      const result = await controller.get('rule-1', managerOwnDepot);
      expect(result).toEqual(rule({ depotId: null }));
    });
  });

  describe('create()', () => {
    it('allows an unscoped (HQ) caller to create a network-wide rule', async () => {
      const service = makeService();
      (service.create as jest.Mock).mockResolvedValue(rule({ depotId: null }));
      const controller = new PromoRuleController(service);
      await controller.create({ name: 'x', kind: 'SPECIAL_PRICE', depotId: undefined } as never, hqUser);
      expect(service.create).toHaveBeenCalled();
    });

    it('allows a depot-scoped caller to create a rule scoped to their own depot', async () => {
      const service = makeService();
      (service.create as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-a' }));
      const controller = new PromoRuleController(service);
      await controller.create(
        { name: 'x', kind: 'SPECIAL_PRICE', depotId: 'depot-a' } as never,
        managerOwnDepot,
      );
      expect(service.create).toHaveBeenCalled();
    });

    it('rejects a depot-scoped caller creating a rule for another depot', () => {
      const service = makeService();
      const controller = new PromoRuleController(service);
      // create() is synchronous up to the assertDepotAccess call, so the guard throws
      // before a Promise is even returned — not a rejection to await.
      expect(() =>
        controller.create(
          { name: 'x', kind: 'SPECIAL_PRICE', depotId: 'depot-b' } as never,
          managerOwnDepot,
        ),
      ).toThrow();
      expect(service.create).not.toHaveBeenCalled();
    });

    it('rejects a depot-scoped caller omitting depotId (would become network-wide)', () => {
      const service = makeService();
      const controller = new PromoRuleController(service);
      expect(() =>
        controller.create({ name: 'x', kind: 'SPECIAL_PRICE', depotId: undefined } as never, managerOwnDepot),
      ).toThrow();
      expect(service.create).not.toHaveBeenCalled();
    });

    it('maps every optional field through when fully populated', async () => {
      const service = makeService();
      (service.create as jest.Mock).mockResolvedValue(rule());
      const controller = new PromoRuleController(service);
      await controller.create(
        {
          name: 'Jumat Berkah',
          kind: 'BUY_X_GET_Y',
          depotId: 'depot-a',
          productId: 'prod-1',
          categoryId: 'cat-1',
          specialPrice: 6000,
          buyQty: 2,
          getQty: 1,
          shippingFeeOverride: 1000,
          validFrom: '2026-01-01T00:00:00.000Z',
          validUntil: '2026-12-31T00:00:00.000Z',
          daysOfWeek: [5],
          startTime: '09:00',
          endTime: '18:00',
          minQty: 2,
          maxQty: 10,
          channels: ['APP'],
        } as never,
        managerOwnDepot,
      );
      expect(service.create).toHaveBeenCalledWith({
        name: 'Jumat Berkah',
        kind: 'BUY_X_GET_Y',
        depotId: 'depot-a',
        productId: 'prod-1',
        categoryId: 'cat-1',
        specialPrice: 6000,
        buyQty: 2,
        getQty: 1,
        shippingFeeOverride: 1000,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2026-12-31T00:00:00.000Z'),
        daysOfWeek: [5],
        startTime: '09:00',
        endTime: '18:00',
        minQty: 2,
        maxQty: 10,
        channels: ['APP'],
      });
    });
  });

  describe('update()', () => {
    it('allows an unscoped (HQ) caller to move a rule to any depot', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-a' }));
      (service.update as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-b' }));
      const controller = new PromoRuleController(service);
      await controller.update('rule-1', { depotId: 'depot-b' } as never, hqUser);
      expect(service.update).toHaveBeenCalled();
    });

    it('allows a depot-scoped caller to patch their own depot\'s rule without changing depotId', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-a' }));
      (service.update as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-a' }));
      const controller = new PromoRuleController(service);
      await controller.update('rule-1', { name: 'Baru', depotId: undefined } as never, managerOwnDepot);
      expect(service.update).toHaveBeenCalled();
    });

    it('rejects a depot-scoped caller patching another depot\'s existing rule', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-b' }));
      const controller = new PromoRuleController(service);
      await expect(
        controller.update('rule-1', { name: 'Baru', depotId: undefined } as never, managerOwnDepot),
      ).rejects.toThrow();
      expect(service.update).not.toHaveBeenCalled();
    });

    it('rejects a depot-scoped caller moving their own rule to another depot', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-a' }));
      const controller = new PromoRuleController(service);
      await expect(
        controller.update('rule-1', { depotId: 'depot-b' } as never, managerOwnDepot),
      ).rejects.toThrow();
      expect(service.update).not.toHaveBeenCalled();
    });

    it('rejects a depot-scoped caller moving their own rule to network-wide', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-a' }));
      const controller = new PromoRuleController(service);
      await expect(
        controller.update('rule-1', { depotId: null } as never, managerOwnDepot),
      ).rejects.toThrow();
      expect(service.update).not.toHaveBeenCalled();
    });

    it('maps every optional field through when fully populated', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-a' }));
      (service.update as jest.Mock).mockResolvedValue(rule());
      const controller = new PromoRuleController(service);
      await controller.update(
        'rule-1',
        {
          name: 'Baru',
          kind: 'SHIPPING_DISCOUNT',
          depotId: 'depot-a',
          productId: 'prod-1',
          categoryId: 'cat-1',
          specialPrice: 6000,
          buyQty: 2,
          getQty: 1,
          shippingFeeOverride: 1000,
          validFrom: '2026-01-01T00:00:00.000Z',
          validUntil: '2026-12-31T00:00:00.000Z',
          daysOfWeek: [5],
          startTime: '09:00',
          endTime: '18:00',
          minQty: 2,
          maxQty: 10,
          channels: ['APP'],
          active: false,
          seenUpdatedAt: '2026-09-01T00:00:00.000Z',
        } as never,
        managerOwnDepot,
      );
      expect(service.update).toHaveBeenCalledWith(
        'rule-1',
        {
          name: 'Baru',
          kind: 'SHIPPING_DISCOUNT',
          depotId: 'depot-a',
          productId: 'prod-1',
          categoryId: 'cat-1',
          specialPrice: 6000,
          buyQty: 2,
          getQty: 1,
          shippingFeeOverride: 1000,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2026-12-31T00:00:00.000Z'),
          daysOfWeek: [5],
          startTime: '09:00',
          endTime: '18:00',
          minQty: 2,
          maxQty: 10,
          channels: ['APP'],
          active: false,
        },
        '2026-09-01T00:00:00.000Z',
      );
    });
  });

  describe('remove()', () => {
    it('allows an unscoped (HQ) caller to delete any rule', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-a' }));
      const controller = new PromoRuleController(service);
      await controller.remove('rule-1', hqUser);
      expect(service.remove).toHaveBeenCalledWith('rule-1');
    });

    it('allows a depot-scoped caller to delete their own depot\'s rule', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-a' }));
      const controller = new PromoRuleController(service);
      await controller.remove('rule-1', managerOwnDepot);
      expect(service.remove).toHaveBeenCalledWith('rule-1');
    });

    it('rejects a depot-scoped caller deleting another depot\'s rule', async () => {
      const service = makeService();
      (service.findById as jest.Mock).mockResolvedValue(rule({ depotId: 'depot-b' }));
      const controller = new PromoRuleController(service);
      await expect(controller.remove('rule-1', managerOwnDepot)).rejects.toThrow();
      expect(service.remove).not.toHaveBeenCalled();
    });
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
      lines: [
        {
          productId: 'p1',
          unitPrice: 8000,
          quantity: 2,
          appliedRuleIds: ['rule-special'],
          unitPriceAfter: 6000,
          freeQty: 0,
        },
      ],
      shippingAppliedRuleId: 'rule-ship',
      shippingFeeOverride: 1000,
      originalShippingFee: 2000,
      shippingUnits: 2,
    } as never);
    expect(service.apply).toHaveBeenCalledWith({
      orderId: 'order-1',
      originalLines: [{ productId: 'p1', unitPrice: 8000, quantity: 2 }],
      quotedLines: [
        {
          productId: 'p1',
          appliedRuleIds: ['rule-special'],
          unitPriceAfter: 6000,
          freeQty: 0,
          lineTotal: 12000,
        },
      ],
      quotedShipping: { appliedRuleId: 'rule-ship', shippingFeeOverride: 1000 },
      originalShippingFee: 2000,
      shippingUnits: 2,
    });
  });

  // D-1: no safe default for shippingUnits any more — the controller now passes it through
  // exactly as the (DTO-validated) caller sent it, undefined when there is no shipping data
  // at all. The service's own D-1 guard is what turns a missing shippingUnits alongside a
  // present originalShippingFee into "skip the row", not a controller-level fallback.
  it('apply() defaults omitted shipping fields to null, leaves shippingUnits undefined', async () => {
    const service = makeService();
    const controller = new PromoRuleController(service);
    await controller.apply({
      orderId: 'order-2',
      lines: [
        {
          productId: 'p1',
          unitPrice: 8000,
          quantity: 1,
          appliedRuleIds: [],
          unitPriceAfter: 8000,
          freeQty: 0,
        },
      ],
    } as never);
    expect(service.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        quotedShipping: { appliedRuleId: null, shippingFeeOverride: null },
        originalShippingFee: null,
        shippingUnits: undefined,
      }),
    );
  });

  it('apply() carries shippingUnits through when the caller supplies one > 1', async () => {
    const service = makeService();
    const controller = new PromoRuleController(service);
    await controller.apply({
      orderId: 'order-3',
      lines: [],
      shippingAppliedRuleId: 'rule-ship',
      shippingFeeOverride: 1000,
      originalShippingFee: 2000,
      shippingUnits: 5,
    } as never);
    expect(service.apply).toHaveBeenCalledWith(
      expect.objectContaining({ shippingUnits: 5 }),
    );
  });

  describe('usage', () => {
    it('is scoped to the caller and serialises the date', async () => {
      const service = makeService();
      (service.usage as jest.Mock).mockResolvedValue([
        { promoRuleId: 'r1', orders: 2, totalDiscount: 5000, lastAppliedAt: new Date('2026-10-08T01:00:00Z') },
        { promoRuleId: 'r2', orders: 0, totalDiscount: 0, lastAppliedAt: null },
      ]);
      const result = await new PromoRuleController(service).usage(managerOwnDepot);
      expect(service.usage).toHaveBeenCalledWith(['depot-a']);
      expect(result).toEqual([
        { promoRuleId: 'r1', orders: 2, totalDiscount: 5000, lastAppliedAt: '2026-10-08T01:00:00.000Z' },
        { promoRuleId: 'r2', orders: 0, totalDiscount: 0, lastAppliedAt: null },
      ]);
    });
  });

  describe('simulate', () => {
    const body = {
      depotId: 'depot-a',
      channel: 'APP' as const,
      lines: [{ productId: 'p1', quantity: 2, unitPrice: 8000 }],
    };

    it('quotes at the requested moment and returns the quote shape', async () => {
      const service = makeService();
      (service.quote as jest.Mock).mockResolvedValue({
        lines: [{ productId: 'p1', appliedRuleIds: ['r1'], unitPriceAfter: 6000, freeQty: 0, lineTotal: 12000 }],
        shipping: { appliedRuleId: 'r2', shippingFeeOverride: 1000 },
      });
      const result = await new PromoRuleController(service).simulate(
        { ...body, occurredAt: '2026-10-09T02:30:00.000Z' } as never,
        managerOwnDepot,
      );
      expect(service.quote).toHaveBeenCalledWith({
        depotId: 'depot-a',
        channel: 'APP',
        occurredAt: new Date('2026-10-09T02:30:00.000Z'),
        lines: [{ productId: 'p1', categoryId: null, quantity: 2, unitPrice: 8000 }],
      });
      expect(result).toMatchObject({ shippingAppliedRuleId: 'r2', shippingFeeOverride: 1000 });
    });

    it('defaults the moment to now and lets an unscoped caller try the network-wide rules', async () => {
      const service = makeService();
      const before = Date.now();
      await new PromoRuleController(service).simulate({ ...body, depotId: undefined } as never, hqUser);
      const call = (service.quote as jest.Mock).mock.calls[0][0];
      expect(call.depotId).toBeNull();
      expect(call.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    });

    it('refuses a depot-scoped caller trying another depot, or naming none', async () => {
      const service = makeService();
      const controller = new PromoRuleController(service);
      await expect(controller.simulate(body as never, managerOtherDepot)).rejects.toThrow();
      await expect(controller.simulate({ ...body, depotId: undefined } as never, managerOwnDepot)).rejects.toThrow();
      expect(service.quote).not.toHaveBeenCalled();
    });
  });
});
