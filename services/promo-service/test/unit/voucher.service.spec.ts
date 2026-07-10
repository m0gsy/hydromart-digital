import { randomUUID } from 'node:crypto';

import {
  DuplicateVoucherCodeError,
  MinSpendNotMetError,
  VoucherCustomerLimitReachedError,
  VoucherExpiredError,
} from '../../src/domain/errors';
import { DiscountType } from '../../src/domain/voucher';
import { CreateVoucherData } from '../../src/application/ports/voucher.repository';
import { VoucherService } from '../../src/application/services/voucher.service';
import { InMemoryVoucherRepository } from '../support/fakes';

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

describe('VoucherService', () => {
  let repo: InMemoryVoucherRepository;
  let service: VoucherService;

  beforeEach(() => {
    repo = new InMemoryVoucherRepository();
    service = new VoucherService(repo);
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

  it('enforces the per-customer limit on redeem', async () => {
    await service.create(baseVoucher({ discountType: DiscountType.FIXED, value: 5000, perCustomerLimit: 1 }));
    const customerId = randomUUID();

    await service.redeem('HEMAT10', customerId, randomUUID(), 60000);
    await expect(
      service.redeem('HEMAT10', customerId, randomUUID(), 60000),
    ).rejects.toBeInstanceOf(VoucherCustomerLimitReachedError);
  });
});
