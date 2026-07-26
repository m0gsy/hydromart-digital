import { randomUUID } from 'node:crypto';

import { InvalidVoucherValueError, VoucherNotFoundError } from '../../src/domain/errors';
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

describe('VoucherService branch gaps', () => {
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

  it('rejects a percentage voucher created with a non-positive value', async () => {
    await expect(service.create(baseVoucher({ value: 0 }))).rejects.toBeInstanceOf(
      InvalidVoucherValueError,
    );
  });

  it('allows a FREE_SHIPPING voucher with a zero value', async () => {
    const created = await service.create(
      baseVoucher({ code: 'GRATIS', discountType: DiscountType.FREE_SHIPPING, value: 0 }),
    );
    expect(created.code).toBe('GRATIS');
  });

  it('grant throws when the voucher is missing', async () => {
    await expect(service.grant('missing', 'cust-1', 'Bearer tok')).rejects.toBeInstanceOf(
      VoucherNotFoundError,
    );
  });

  it('grant throws when the voucher is inactive', async () => {
    const v = await service.create(baseVoucher({ code: 'OFF' }));
    await service.deactivate(v.id);
    await expect(service.grant(v.id, 'cust-1', 'Bearer tok')).rejects.toBeInstanceOf(
      VoucherNotFoundError,
    );
  });

  it('grant is a no-op notification when the customer contact cannot be resolved', async () => {
    customers.contact = null;
    const v = await service.create(baseVoucher({ code: 'SILENT' }));
    const result = await service.grant(v.id, 'cust-1', 'Bearer tok');
    expect(result.granted).toBe(true);
    expect(notifications.calls).toHaveLength(0);
  });

  it('update patches an existing voucher and rejects a missing one', async () => {
    const v = await service.create(baseVoucher({ code: 'PATCH' }));
    const updated = await service.update(v.id, { value: 25 });
    expect(updated.value).toBe(25);
    await expect(service.update('missing', { value: 5 })).rejects.toBeInstanceOf(
      VoucherNotFoundError,
    );
  });

  it('getByCode throws for an unknown code', async () => {
    await expect(service.getByCode('NOPE')).rejects.toBeInstanceOf(VoucherNotFoundError);
  });

  it('browse clamps page and limit and paginates', async () => {
    for (let i = 0; i < 3; i += 1) {
      await service.create(baseVoucher({ code: `V${i}` }));
    }
    const page = await service.browse(0, 999);
    expect(page.page).toBe(1); // page floored up to 1
    expect(page.limit).toBe(100); // limit clamped to MAX_LIMIT
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(3);
  });

  it('burnSummary totals redemptions per voucher and across the network', async () => {
    const a = await service.create(baseVoucher({ code: 'A', discountType: DiscountType.FIXED, value: 5000 }));
    const b = await service.create(baseVoucher({ code: 'B', discountType: DiscountType.FIXED, value: 7000 }));
    await service.redeem('A', randomUUID(), randomUUID(), 60000);
    await service.redeem('B', randomUUID(), randomUUID(), 60000);

    const summary = await service.burnSummary();
    expect(summary.totalUsed).toBe(12000);
    expect(summary.byVoucher[a.id]).toBe(5000);
    expect(summary.byVoucher[b.id]).toBe(7000);
  });
});
