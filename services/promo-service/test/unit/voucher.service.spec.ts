import { randomUUID } from 'node:crypto';

import {
  DuplicateVoucherCodeError,
  InvalidVoucherValueError,
  MinSpendNotMetError,
  VoucherCustomerLimitReachedError,
  VoucherExpiredError,
} from '../../src/domain/errors';
import { DiscountType } from '../../src/domain/voucher';
import { CreateVoucherData } from '../../src/application/ports/voucher.repository';
import { VoucherService } from '../../src/application/services/voucher.service';
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

/*
 * PRM-4. A voucher "granted" to one customer was spendable by every customer who learned the
 * code — a birthday voucher, a complaint apology, a reactivation offer — and every wallet
 * listed every active code, including the ones meant for somebody else.
 */
describe('VoucherService · audience (PRM-4)', () => {
  let repo: InMemoryVoucherRepository;
  let service: VoucherService;

  beforeEach(() => {
    repo = new InMemoryVoucherRepository();
    service = new VoucherService(repo, new FakeCustomerLookup(), new FakeNotification());
  });

  it('refuses a GRANTED voucher to a customer who was not given it', async () => {
    const v = await service.create(baseVoucher({ code: 'MAAFYA', audience: 'GRANTED' }));
    await service.grant(v.id, 'cust-1');

    await expect(service.quote('MAAFYA', 'cust-2', 60000)).rejects.toThrow(/khusus untuk/);
    await expect(
      service.redeem('MAAFYA', 'cust-2', randomUUID(), 60000),
    ).rejects.toThrow(/khusus untuk/);
  });

  it('lets the customer it was given to spend it', async () => {
    const v = await service.create(baseVoucher({ code: 'MAAFYA', audience: 'GRANTED' }));
    await service.grant(v.id, 'cust-1');
    await expect(service.quote('MAAFYA', 'cust-1', 60000)).resolves.toMatchObject({ valid: true });
  });

  it('leaves a PUBLIC campaign code spendable by anybody', async () => {
    await service.create(baseVoucher({ code: 'HEMAT10' }));
    await expect(service.quote('HEMAT10', 'anybody', 60000)).resolves.toMatchObject({
      valid: true,
    });
  });

  it('shows a GRANTED voucher only in its grantee’s wallet', async () => {
    const mine = await service.create(baseVoucher({ code: 'MAAFYA', audience: 'GRANTED' }));
    await service.create(baseVoucher({ code: 'HEMAT10' }));
    await service.grant(mine.id, 'cust-1');

    expect((await service.myVouchers('cust-1')).map((w) => w.voucher.code).sort()).toEqual([
      'HEMAT10',
      'MAAFYA',
    ]);
    expect((await service.myVouchers('cust-2')).map((w) => w.voucher.code)).toEqual(['HEMAT10']);
  });
});

/*
 * PRM-6. The PATCH door ran none of create's money rules and dropped `budgetCap` on the
 * floor: a voucher created at a legal 20% could be edited to 500% afterwards, and an editor
 * lowering a campaign's budget saw the form accept a number that never moved.
 */
describe('VoucherService.update · money invariants (PRM-6)', () => {
  let service: VoucherService;
  let repo: InMemoryVoucherRepository;

  beforeEach(() => {
    repo = new InMemoryVoucherRepository();
    service = new VoucherService(repo, new FakeCustomerLookup(), new FakeNotification());
  });

  it('refuses a percentage edited past 100%', async () => {
    const v = await service.create(baseVoucher({ value: 20 }));
    await expect(
      service.update(v.id, { value: 500 }, v.updatedAt.toISOString()),
    ).rejects.toBeInstanceOf(InvalidVoucherValueError);
  });

  it('refuses a zero or negative value on a discount that needs one', async () => {
    const v = await service.create(baseVoucher({ discountType: DiscountType.FIXED, value: 5000 }));
    await expect(
      service.update(v.id, { value: 0 }, v.updatedAt.toISOString()),
    ).rejects.toBeInstanceOf(InvalidVoucherValueError);
  });

  it('judges a value-only patch against the type the voucher already has', async () => {
    const v = await service.create(baseVoucher({ discountType: DiscountType.FIXED, value: 5000 }));
    // 500 is nonsense as a percentage and ordinary as rupiah off.
    await expect(
      service.update(v.id, { value: 500 }, v.updatedAt.toISOString()),
    ).resolves.toMatchObject({ value: 500 });
  });

  it('carries the budget cap through the patch', async () => {
    const v = await service.create(baseVoucher({ budgetCap: 5_000_000 }));
    await expect(
      service.update(v.id, { budgetCap: 1_000_000 }, v.updatedAt.toISOString()),
    ).resolves.toMatchObject({ budgetCap: 1_000_000 });
  });
});

/*
 * PRM-7. The public preview answered with the whole row to anybody who guessed a code: a
 * draft campaign not yet launched, a deactivated one, its budget cap and its usage counters.
 */
describe('VoucherService.previewByCode (PRM-7)', () => {
  let service: VoucherService;

  beforeEach(() => {
    service = new VoucherService(
      new InMemoryVoucherRepository(),
      new FakeCustomerLookup(),
      new FakeNotification(),
    );
  });

  it('returns only what a customer needs to decide', async () => {
    await service.create(baseVoucher({ budgetCap: 5_000_000 }));
    const preview = await service.previewByCode('hemat10');
    expect(preview).toEqual({
      code: 'HEMAT10',
      description: null,
      discountType: DiscountType.PERCENTAGE,
      value: 10,
      minSpend: 0,
      maxDiscount: null,
      validUntil: null,
    });
    expect(preview).not.toHaveProperty('budgetCap');
    expect(preview).not.toHaveProperty('usedCount');
  });

  it.each([
    ['a draft', { active: false }],
    ['one that has not started', { validFrom: new Date(Date.now() + 86_400_000) }],
    ['an expired one', { validUntil: new Date(Date.now() - 86_400_000) }],
    ['one addressed to named customers', { audience: 'GRANTED' as const }],
  ])('answers %s exactly like a code that does not exist', async (_label, over) => {
    await service.create(baseVoucher(over));
    await expect(service.previewByCode('HEMAT10')).rejects.toThrow(/not found|tidak/i);
  });

  it('answers an unknown code the same way', async () => {
    await expect(service.previewByCode('NOSUCH')).rejects.toThrow(/not found|tidak/i);
  });
});

describe('VoucherService', () => {
  let repo: InMemoryVoucherRepository;
  let customers: FakeCustomerLookup;
  let notifications: FakeNotification;
  let service: VoucherService;

  beforeEach(() => {
    repo = new InMemoryVoucherRepository();
    customers = new FakeCustomerLookup();
    notifications = new FakeNotification();
    service = new VoucherService(repo, customers, notifications);
  });

  it('grants a voucher once and fires VOUCHER_GRANTED; a repeat grant is a silent no-op', async () => {
    const v = await service.create(baseVoucher({ code: 'GRATISKIRIM' }));

    const first = await service.grant(v.id, 'cust-1');
    expect(first.granted).toBe(true);
    expect(notifications.calls).toHaveLength(1);
    expect(notifications.calls[0]).toMatchObject({
      event: 'VOUCHER_GRANTED',
      phone: '+6281234567890',
      customerId: 'cust-1',
    });
    expect(notifications.calls[0].vars).toMatchObject({ code: 'GRATISKIRIM', name: 'Budi' });

    const second = await service.grant(v.id, 'cust-1');
    expect(second.granted).toBe(false);
    expect(notifications.calls).toHaveLength(1); // not re-sent
  });

  it('stores the code uppercased and rejects a duplicate code', async () => {
    const created = await service.create(baseVoucher({ code: 'hemat10' }));
    expect(created.code).toBe('HEMAT10');
    await expect(service.create(baseVoucher({ code: 'HEMAT10' }))).rejects.toBeInstanceOf(
      DuplicateVoucherCodeError,
    );
  });

  it('quotes the discount for a valid voucher without side effects', async () => {
    await service.create(baseVoucher({ value: 10 }));
    const quote = await service.quote('hemat10', randomUUID(), 60000);
    expect(quote).toMatchObject({ code: 'HEMAT10', discount: 6000, valid: true });
    expect(repo.redemptions).toHaveLength(0);
    expect((await service.getByCode('HEMAT10')).usedCount).toBe(0);
  });

  it('rejects a quote below the minimum spend', async () => {
    await service.create(baseVoucher({ minSpend: 100000 }));
    await expect(service.quote('HEMAT10', randomUUID(), 60000)).rejects.toBeInstanceOf(
      MinSpendNotMetError,
    );
  });

  it('rejects a quote for an expired voucher', async () => {
    await service.create(baseVoucher({ validUntil: new Date('2000-01-01T00:00:00.000Z') }));
    await expect(service.quote('HEMAT10', randomUUID(), 60000)).rejects.toBeInstanceOf(
      VoucherExpiredError,
    );
  });

  it('is idempotent per orderId and increments usedCount only once', async () => {
    await service.create(baseVoucher({ discountType: DiscountType.FIXED, value: 5000 }));
    const orderId = randomUUID();
    const customerId = randomUUID();

    const first = await service.redeem('HEMAT10', customerId, orderId, 60000);
    const second = await service.redeem('HEMAT10', customerId, orderId, 60000);

    expect(first).toEqual({ orderId, discountApplied: 5000 });
    expect(second).toEqual(first);
    expect(repo.redemptions).toHaveLength(1);
    expect((await service.getByCode('HEMAT10')).usedCount).toBe(1);
  });

  /**
   * C4 · a voided sale gives the voucher back.
   *
   * There was no reversal method on the repository OR the service, so a void returned the
   * goods and the money while the redemption stayed burned — a single-use voucher spent on
   * a sale that never happened, and a per-customer limit consumed by an order that does not
   * exist.
   */
  describe('C4 · release', () => {
    const redeemedOrder = async (over = {}) => {
      await service.create(baseVoucher({ discountType: DiscountType.FIXED, value: 5000, ...over }));
      const orderId = randomUUID();
      const customerId = randomUUID();
      await service.redeem('HEMAT10', customerId, orderId, 60000);
      return { orderId, customerId };
    };

    it('returns the use to the voucher, not just the row', async () => {
      const { orderId } = await redeemedOrder();
      expect((await service.getByCode('HEMAT10')).usedCount).toBe(1);

      const out = await service.release(orderId);

      expect(out).toEqual({ released: true, discountReturned: 5000 });
      // PRM-8: the row STAYS, stamped. Deleting it threw away the only evidence that a
      // discount was burned and then returned, which is what a burn report reconciles against.
      expect(repo.redemptions).toHaveLength(1);
      expect(repo.redemptions[0].releasedAt).toBeInstanceOf(Date);
      expect((await service.getByCode('HEMAT10')).usedCount).toBe(0);
    });

    it('gives the customer their per-customer allowance back', async () => {
      const { orderId, customerId } = await redeemedOrder({ perCustomerLimit: 1 });
      await service.release(orderId);

      // Would have thrown VoucherCustomerLimitReachedError before the release.
      await expect(
        service.redeem('HEMAT10', customerId, randomUUID(), 60000),
      ).resolves.toBeDefined();
    });

    /**
     * IDEMPOTENT, and this is the one that matters: a void retried after a timeout must not
     * decrement twice and hand out a use nobody took.
     */
    it('is a no-op the second time', async () => {
      const { orderId } = await redeemedOrder();
      await service.release(orderId);

      const second = await service.release(orderId);

      expect(second).toEqual({ released: false, discountReturned: 0 });
      expect((await service.getByCode('HEMAT10')).usedCount).toBe(0);
    });

    it('reports nothing released for an order that used no voucher — the common case', async () => {
      await expect(service.release(randomUUID())).resolves.toEqual({
        released: false,
        discountReturned: 0,
      });
    });
  });

  it('enforces the per-customer limit on redeem', async () => {
    await service.create(
      baseVoucher({ discountType: DiscountType.FIXED, value: 5000, perCustomerLimit: 1 }),
    );
    const customerId = randomUUID();

    await service.redeem('HEMAT10', customerId, randomUUID(), 60000);
    await expect(service.redeem('HEMAT10', customerId, randomUUID(), 60000)).rejects.toBeInstanceOf(
      VoucherCustomerLimitReachedError,
    );
  });

  describe('myVouchers (wallet)', () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const past = new Date('2000-01-01T00:00:00.000Z');
    const cust = randomUUID();

    const statusOf = async (code: string): Promise<string> => {
      const wallet = await service.myVouchers(cust);
      return wallet.find((w) => w.voucher.code === code)!.status;
    };

    it('marks a fresh, in-window voucher AVAILABLE', async () => {
      await service.create(baseVoucher({ code: 'AVAIL', validUntil: future }));
      expect(await statusOf('AVAIL')).toBe('AVAILABLE');
    });

    it('marks an expired voucher EXPIRED', async () => {
      await service.create(baseVoucher({ code: 'OLD', validUntil: past }));
      expect(await statusOf('OLD')).toBe('EXPIRED');
    });

    it('marks a not-yet-started voucher UPCOMING', async () => {
      await service.create(baseVoucher({ code: 'SOON', validFrom: future }));
      expect(await statusOf('SOON')).toBe('UPCOMING');
    });

    it('marks a voucher the customer already used USED', async () => {
      await service.create(
        baseVoucher({
          code: 'USED1',
          discountType: DiscountType.FIXED,
          value: 5000,
          perCustomerLimit: 1,
        }),
      );
      await service.redeem('USED1', cust, randomUUID(), 60000);
      expect(await statusOf('USED1')).toBe('USED');
    });

    it('marks a globally exhausted voucher SOLD_OUT', async () => {
      await service.create(
        baseVoucher({ code: 'GONE', discountType: DiscountType.FIXED, value: 5000, usageLimit: 1 }),
      );
      await service.redeem('GONE', randomUUID(), randomUUID(), 60000); // someone else used the last one
      expect(await statusOf('GONE')).toBe('SOLD_OUT');
    });

    it('omits inactive vouchers from the wallet', async () => {
      const v = await service.create(baseVoucher({ code: 'HIDDEN' }));
      await service.deactivate(v.id);
      const wallet = await service.myVouchers(cust);
      expect(wallet.find((w) => w.voucher.code === 'HIDDEN')).toBeUndefined();
    });
  });
});

/*
 * CA-2-65: a PERCENTAGE voucher could be created at 500%.
 *
 * The column comment says "PERCENTAGE: a percent 1..100", both DTOs repeat it in their
 * `@ApiProperty` description, and none of them enforced it — `@Min(0)` was the whole check.
 * A voucher at 500 does not fail downstream either: the discount is a fraction of the
 * subtotal, so it simply pays the customer more than the order is worth, capped only by a
 * `maxDiscount` nobody sets by default.
 */
describe('VoucherService percentage bound (CA-2-65)', () => {
  const build = () => ({
    service: new VoucherService(
      new InMemoryVoucherRepository(),
      new FakeCustomerLookup(),
      new FakeNotification(),
    ),
  });

  it('refuses a percentage above 100, at either door', async () => {
    const { service } = build();
    await expect(
      service.create(
        baseVoucher({ code: 'BONGKAR', discountType: DiscountType.PERCENTAGE, value: 500 }),
      ),
    ).rejects.toBeInstanceOf(InvalidVoucherValueError);
  });

  it('still allows exactly 100, and a fixed voucher far above it', async () => {
    const { service } = build();
    await expect(
      service.create(
        baseVoucher({ code: 'GRATIS100', discountType: DiscountType.PERCENTAGE, value: 100 }),
      ),
    ).resolves.toBeTruthy();
    // A `@Max(100)` on the field would have refused this — the bound depends on the type.
    await expect(
      service.create(
        baseVoucher({ code: 'POTONG50K', discountType: DiscountType.FIXED, value: 50_000 }),
      ),
    ).resolves.toBeTruthy();
  });
});
