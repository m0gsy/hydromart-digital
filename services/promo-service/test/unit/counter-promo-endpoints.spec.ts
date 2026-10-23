import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser, Role } from '@hydromart/platform';

import { PromoConfigService } from '../../src/config/promo-config.service';
import { PromoRuleCandidate, ruleIsLive } from '../../src/domain/promo-rule';
import { DiscountType } from '../../src/domain/voucher';
import { CreateVoucherData } from '../../src/application/ports/voucher.repository';
import { PromoRuleRepository } from '../../src/application/ports/promo-rule.repository';
import { PromoRuleService } from '../../src/application/services/promo-rule.service';
import { VoucherService } from '../../src/application/services/voucher.service';
import { PromoRuleController } from '../../src/modules/promo-rule.controller';
import { VoucherController } from '../../src/modules/voucher.controller';
import { FakeCustomerLookup, FakeNotification, InMemoryVoucherRepository } from '../support/fakes';

/*
 * The cashier's two lists (promo aktif, voucher pembeli) and the names the till prints next to
 * a discount. All three read the engine that already prices the basket, so what they say can
 * never drift from what the sale charges.
 */

// 2026-10-23 is a Friday; 03:00Z is 10:00 in Jakarta.
const FRIDAY_10AM = new Date('2026-10-23T03:00:00Z');
const MONDAY_10AM = new Date('2026-10-26T03:00:00Z');

const rule = (o: Partial<PromoRuleCandidate> = {}): PromoRuleCandidate => ({
  id: 'r-1',
  name: 'Jumat Berkah',
  kind: 'SPECIAL_PRICE',
  depotId: null,
  productId: null,
  categoryId: null,
  specialPrice: 6000,
  buyQty: null,
  getQty: null,
  shippingFeeOverride: null,
  percentOff: null,
  minSubtotal: null,
  discountAmount: null,
  giftProductId: null,
  firstOrderOnly: false,
  validFrom: null,
  validUntil: null,
  daysOfWeek: [],
  startTime: null,
  endTime: null,
  minQty: 1,
  maxQty: null,
  channels: [],
  ...o,
});

const config = { businessTimeZone: 'Asia/Jakarta' } as unknown as PromoConfigService;

const serviceWith = (rows: PromoRuleCandidate[]) => {
  const repo = { findActiveCandidates: jest.fn().mockResolvedValue(rows) };
  return { repo, service: new PromoRuleService(repo as unknown as PromoRuleRepository, config) };
};

describe('ruleIsLive', () => {
  const ctx = { channel: 'COUNTER' as const, occurredAt: FRIDAY_10AM, timeZone: 'Asia/Jakarta', depotId: 'depot-a' };

  it('is open for a rule with no restrictions', () => {
    expect(ruleIsLive(rule(), ctx)).toBe(true);
  });

  it.each([
    ['another depot', rule({ depotId: 'depot-b' })],
    ['a window that has not started', rule({ validFrom: new Date('2026-11-01T00:00:00Z') })],
    ['a window that has ended', rule({ validUntil: new Date('2026-10-01T00:00:00Z') })],
    ['a different weekday', rule({ daysOfWeek: [1] })],
    ['hours that start later', rule({ startTime: '11:00' })],
    ['hours that ended earlier', rule({ endTime: '09:30' })],
    ['the app channel only', rule({ channels: ['APP'] })],
  ])('is closed for %s', (_label, r) => {
    expect(ruleIsLive(r, ctx)).toBe(false);
  });

  it('is open on its own weekday, inside its hours, on the counter', () => {
    expect(
      ruleIsLive(
        rule({ depotId: 'depot-a', daysOfWeek: [5], startTime: '09:00', endTime: '12:00', channels: ['COUNTER'] }),
        ctx,
      ),
    ).toBe(true);
  });
});

describe('PromoRuleService.quote · ruleNames', () => {
  const line = (productId: string) => ({ productId, categoryId: null, quantity: 3, unitPrice: 8000 });
  const input = (lines = [line('p-1')]) => ({
    depotId: 'depot-a',
    channel: 'COUNTER' as const,
    occurredAt: FRIDAY_10AM,
    lines,
  });

  it('names the rule that won a line and leaves out the one that lost', async () => {
    const { service } = serviceWith([
      rule({ id: 'cheap', name: 'Harga Hemat', specialPrice: 5000 }),
      rule({ id: 'dear', name: 'Harga Biasa', specialPrice: 7000 }),
    ]);
    const out = await service.quote(input());
    expect(out.lines[0].appliedRuleIds).toEqual(['cheap']);
    expect(out.ruleNames).toEqual({ cheap: 'Harga Hemat' });
  });

  it('names the shipping, order-discount and gift winners too', async () => {
    const { service } = serviceWith([
      rule({ id: 'ship', name: 'Ongkir Murah', kind: 'SHIPPING_DISCOUNT', specialPrice: null, shippingFeeOverride: 1000 }),
      rule({
        id: 'ord',
        name: 'Belanja Hemat',
        kind: 'ORDER_DISCOUNT',
        specialPrice: null,
        minSubtotal: 10000,
        discountAmount: 2000,
      }),
      rule({
        id: 'gift',
        name: 'Bonus Tutup',
        kind: 'BUNDLE_GIFT',
        specialPrice: null,
        giftProductId: 'p-cap',
        buyQty: 1,
        getQty: 1,
      }),
    ]);
    const out = await service.quote(input());
    expect(out.ruleNames).toEqual({ ship: 'Ongkir Murah', ord: 'Belanja Hemat', gift: 'Bonus Tutup' });
  });

  it('is an empty map when nothing matched', async () => {
    const { service } = serviceWith([rule({ daysOfWeek: [1] })]);
    expect((await service.quote(input())).ruleNames).toEqual({});
  });
});

describe('PromoRuleService.activeNow', () => {
  it('asks the repository for this depot only, then keeps what is live right now', async () => {
    const { service, repo } = serviceWith([
      rule({ id: 'fri', daysOfWeek: [5] }),
      rule({ id: 'mon', daysOfWeek: [1] }),
      rule({ id: 'app', channels: ['APP'] }),
      rule({ id: 'late', startTime: '13:00' }),
      rule({ id: 'other', depotId: 'depot-b' }),
      rule({ id: 'all' }),
    ]);
    const live = await service.activeNow('depot-a', 'COUNTER', FRIDAY_10AM);
    expect(live.map((r) => r.id)).toEqual(['fri', 'all']);
    expect(repo.findActiveCandidates).toHaveBeenCalledWith(['depot-a'], FRIDAY_10AM);
  });

  it('follows the clock: the Friday rule is gone on Monday', async () => {
    const { service } = serviceWith([rule({ id: 'fri', daysOfWeek: [5] })]);
    expect(await service.activeNow('depot-a', 'COUNTER', MONDAY_10AM)).toEqual([]);
  });

  it('defaults to the current time', async () => {
    const { service, repo } = serviceWith([]);
    await service.activeNow('depot-a', 'COUNTER');
    expect((repo.findActiveCandidates.mock.calls[0][1] as Date).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('lists a first-order-only rule (the strip says who it is for)', async () => {
    const { service } = serviceWith([rule({ id: 'new', firstOrderOnly: true })]);
    expect((await service.activeNow('depot-a', 'COUNTER', FRIDAY_10AM)).map((r) => r.id)).toEqual(['new']);
  });
});

const voucherData = (o: Partial<CreateVoucherData> = {}): CreateVoucherData => ({
  code: 'MAAF10',
  description: null,
  discountType: DiscountType.PERCENTAGE,
  value: 10,
  minSpend: 0,
  maxDiscount: null,
  validFrom: null,
  validUntil: null,
  usageLimit: null,
  perCustomerLimit: 1,
  audience: 'GRANTED',
  ...o,
});

describe('VoucherService.grantedForCounter', () => {
  let service: VoucherService;
  const grantTo = async (customerId: string, o: Partial<CreateVoucherData> = {}) => {
    const v = await service.create(voucherData(o));
    await service.grant(v.id, customerId);
    return v;
  };

  beforeEach(() => {
    service = new VoucherService(new InMemoryVoucherRepository(), new FakeCustomerLookup(), new FakeNotification());
  });

  it("lists the buyer's granted code", async () => {
    await grantTo('cust-1');
    const out = await service.grantedForCounter('cust-1', 'depot-a');
    expect(out.map((w) => [w.voucher.code, w.status])).toEqual([['MAAF10', 'AVAILABLE']]);
  });

  it('never lists a PUBLIC campaign code, which is typed rather than offered', async () => {
    await service.create(voucherData({ code: 'HEMAT10', audience: 'PUBLIC' }));
    expect(await service.grantedForCounter('cust-1', 'depot-a')).toEqual([]);
  });

  it("never lists somebody else's granted code", async () => {
    await grantTo('cust-2');
    expect(await service.grantedForCounter('cust-1', 'depot-a')).toEqual([]);
  });

  it('keeps a network-wide code and this depot code, and drops another depot code', async () => {
    await grantTo('cust-1', { code: 'NET', depotId: null });
    await grantTo('cust-1', { code: 'HERE', depotId: 'depot-a' });
    await grantTo('cust-1', { code: 'ELSEWHERE', depotId: 'depot-b' });
    const out = await service.grantedForCounter('cust-1', 'depot-a');
    expect(out.map((w) => w.voucher.code).sort()).toEqual(['HERE', 'NET']);
  });

  it('drops a code that is expired, not started, or already used up by this buyer', async () => {
    await grantTo('cust-1', { code: 'OLD', validUntil: new Date('2020-01-01T00:00:00Z') });
    await grantTo('cust-1', { code: 'SOON', validFrom: new Date('2999-01-01T00:00:00Z') });
    const spent = await grantTo('cust-1', { code: 'SPENT' });
    await service.redeem(spent.code, 'cust-1', '11111111-1111-4111-8111-111111111111', 60000);
    expect(await service.grantedForCounter('cust-1', 'depot-a')).toEqual([]);
  });
});

describe('cashier endpoints · depot scope', () => {
  const ownDepot = { sub: 'u-1', role: Role.MANAGER, phone: null, depotId: 'depot-a', depotIds: ['depot-a'] } as AuthenticatedUser;
  const hq = { sub: 'hq', role: Role.SUPER_ADMIN, phone: null } as AuthenticatedUser;

  describe('PromoRuleController.active', () => {
    const make = () => {
      const service = { activeNow: jest.fn().mockResolvedValue([{ id: 'r-1' }]) };
      return { service, controller: new PromoRuleController(service as unknown as PromoRuleService) };
    };

    it("answers for the caller's own depot, on the counter channel", async () => {
      const { service, controller } = make();
      await expect(controller.active({ depotId: 'depot-a' }, ownDepot)).resolves.toEqual([{ id: 'r-1' }]);
      expect(service.activeNow).toHaveBeenCalledWith('depot-a', 'COUNTER');
    });

    it('lets an unscoped HQ user name any depot', async () => {
      const { controller } = make();
      await expect(controller.active({ depotId: 'depot-z' }, hq)).resolves.toHaveLength(1);
    });

    it("refuses another depot's counter", () => {
      const { service, controller } = make();
      expect(() => controller.active({ depotId: 'depot-b' }, ownDepot)).toThrow(ForbiddenException);
      expect(service.activeNow).not.toHaveBeenCalled();
    });
  });

  describe('VoucherController.counterWallet', () => {
    const wallet = [
      {
        status: 'AVAILABLE' as const,
        voucher: {
          code: 'MAAF10',
          description: null,
          discountType: DiscountType.PERCENTAGE,
          value: 10,
          minSpend: 0,
          maxDiscount: null,
          validUntil: null,
          productId: null,
          categoryId: null,
        },
      },
    ];
    const make = () => {
      const service = { grantedForCounter: jest.fn().mockResolvedValue(wallet) };
      return { service, controller: new VoucherController(service as unknown as VoucherService) };
    };

    it('maps the wallet through MyVoucherDto', async () => {
      const { service, controller } = make();
      const out = await controller.counterWallet({ customerId: 'c-1', depotId: 'depot-a' }, ownDepot);
      expect(service.grantedForCounter).toHaveBeenCalledWith('c-1', 'depot-a');
      expect(out).toEqual([expect.objectContaining({ code: 'MAAF10', status: 'AVAILABLE', value: 10 })]);
    });

    it("refuses another depot's counter before reading any wallet", async () => {
      const { service, controller } = make();
      await expect(
        controller.counterWallet({ customerId: 'c-1', depotId: 'depot-b' }, ownDepot),
      ).rejects.toThrow(ForbiddenException);
      expect(service.grantedForCounter).not.toHaveBeenCalled();
    });
  });
});
