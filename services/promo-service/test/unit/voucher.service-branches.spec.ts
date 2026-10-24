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
    await expect(service.grant('missing', 'cust-1')).rejects.toBeInstanceOf(
      VoucherNotFoundError,
    );
  });

  it('grant throws when the voucher is inactive', async () => {
    const v = await service.create(baseVoucher({ code: 'OFF' }));
    await service.deactivate(v.id);
    await expect(service.grant(v.id, 'cust-1')).rejects.toBeInstanceOf(
      VoucherNotFoundError,
    );
  });

  it('grant is a no-op notification when the customer contact cannot be resolved', async () => {
    customers.contact = null;
    const v = await service.create(baseVoucher({ code: 'SILENT' }));
    const result = await service.grant(v.id, 'cust-1');
    expect(result.granted).toBe(true);
    expect(notifications.calls).toHaveLength(0);
  });

  it('update patches an existing voucher and rejects a missing one', async () => {
    const v = await service.create(baseVoucher({ code: 'PATCH' }));
    // CA-2-53: a save says which version it started from.
    const updated = await service.update(v.id, { value: 25 }, v.updatedAt.toISOString());
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

  describe('browse narrowed to a depot scope', () => {
    const DEPOT_A = randomUUID();
    const DEPOT_B = randomUUID();
    const seed = async () => {
      await service.create(baseVoucher({ code: 'MINE', depotId: DEPOT_A }));
      await service.create(baseVoucher({ code: 'OTHER', depotId: DEPOT_B }));
      await service.create(baseVoucher({ code: 'NET' }));
    };
    const codes = (page: { items: { code: string }[] }) => page.items.map((v) => v.code).sort();

    it("lists a scoped caller's own depots' vouchers and the network-wide ones, never another depot's", async () => {
      await seed();
      const page = await service.browse(1, 20, false, [DEPOT_A]);
      expect(codes(page)).toEqual(['MINE', 'NET']);
      expect(page.total).toBe(2);
    });

    it('lists everything for head office (no scope)', async () => {
      await seed();
      expect(codes(await service.browse(1, 20, false))).toEqual(['MINE', 'NET', 'OTHER']);
    });
  });

  it('burnSummary totals redemptions per voucher and across the network', async () => {
    const a = await service.create(
      baseVoucher({ code: 'A', discountType: DiscountType.FIXED, value: 5000 }),
    );
    const b = await service.create(
      baseVoucher({ code: 'B', discountType: DiscountType.FIXED, value: 7000 }),
    );
    await service.redeem('A', randomUUID(), randomUUID(), 60000);
    await service.redeem('B', randomUUID(), randomUUID(), 60000);

    const summary = await service.burnSummary();
    expect(summary.totalUsed).toBe(12000);
    expect(summary.byVoucher[a.id]).toBe(5000);
    expect(summary.byVoucher[b.id]).toBe(7000);
  });

  /*
   * Insight dashboard audit. `voucherRead` admits MANAGER, a depot-scoped role, and the burn
   * summary carried no depot dimension — a manager read every voucher's spend network-wide.
   * A scoped caller now sees only the vouchers that belong to their own depots; a network-wide
   * voucher (no depot) belongs to head office, not to any one depot.
   */
  describe('burnSummary narrowed to a depot scope', () => {
    const DEPOT_A = randomUUID();
    const DEPOT_B = randomUUID();
    const burnAll = async () => {
      const mine = await service.create(
        baseVoucher({ code: 'MINE', discountType: DiscountType.FIXED, value: 5000, depotId: DEPOT_A }),
      );
      const other = await service.create(
        baseVoucher({ code: 'OTHER', discountType: DiscountType.FIXED, value: 7000, depotId: DEPOT_B }),
      );
      const network = await service.create(
        baseVoucher({ code: 'NET', discountType: DiscountType.FIXED, value: 3000 }),
      );
      // A depot voucher can only be spent at its own depot; a network-wide one anywhere.
      await service.redeem('MINE', randomUUID(), randomUUID(), 60000, 0, DEPOT_A);
      await service.redeem('OTHER', randomUUID(), randomUUID(), 60000, 0, DEPOT_B);
      await service.redeem('NET', randomUUID(), randomUUID(), 60000, 0, DEPOT_A);
      return { mine, other, network };
    };

    it("counts only the scoped caller's own vouchers", async () => {
      const { mine } = await burnAll();
      const summary = await service.burnSummary([DEPOT_A]);
      expect(summary).toEqual({ totalUsed: 5000, byVoucher: { [mine.id]: 5000 } });
    });

    it('lets head office (no scope) read every voucher, network-wide ones included', async () => {
      await burnAll();
      expect((await service.burnSummary()).totalUsed).toBe(15000);
    });

    it('reports nothing for a caller responsible for no depot', async () => {
      await burnAll();
      expect(await service.burnSummary([])).toEqual({ totalUsed: 0, byVoucher: {} });
    });
  });

  /*
   * CA-2-53. A discount two people edited at once used to end up as whichever of them saved
   * last, with the other's change gone and neither told.
   */
  it('refuses a voucher save built on a copy that is already out of date', async () => {
    const v = await service.create(baseVoucher({ code: 'STALE' }));
    await service.update(v.id, { value: 25 }, v.updatedAt.toISOString());

    await expect(
      service.update(v.id, { value: 90 }, v.updatedAt.toISOString()),
    ).rejects.toMatchObject({ code: 'STALE_WRITE', status: 409 });
  });

  it('refuses a voucher save that says nothing about what it saw', async () => {
    const v = await service.create(baseVoucher({ code: 'NOSEEN' }));
    await expect(service.update(v.id, { value: 90 })).rejects.toMatchObject({
      code: 'STALE_WRITE',
    });
  });
});
