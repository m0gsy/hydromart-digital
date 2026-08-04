import {
  PromotionNotFoundError,
  VoucherRequestDecidedError,
} from '../../src/domain/errors';
import { DiscountType } from '../../src/domain/voucher';
import { VoucherRequestStatus, VoucherRequestRecord } from '../../src/domain/voucher-request';
import { PromotionService } from '../../src/application/services/promotion.service';
import {
  ProposeVoucherRequestInput,
  VoucherRequestService,
} from '../../src/application/services/voucher-request.service';
import { VoucherService } from '../../src/application/services/voucher.service';
import {
  CreateVoucherRequestData,
  ListVoucherRequestsFilter,
  UpdateVoucherRequestData,
  VoucherRequestRepository,
} from '../../src/application/ports/voucher-request.repository';
import {
  FakeCustomerLookup,
  FakeNotification,
  InMemoryPromotionRepository,
  InMemoryVoucherRepository,
} from '../support/fakes';
import { PromoConfigService } from '../../src/config/promo-config.service';
/** Only `businessTimeZone` is read; WIB pinned so a UTC-bucket regression (H-16) fails here. */
const promoTestConfig = (timeZone = 'Asia/Jakarta'): PromoConfigService =>
  ({ businessTimeZone: timeZone }) as PromoConfigService;


class FakeOrderValues {
  async findOrderValues(): Promise<{ orderId: string; totalIdr: number }[] | null> {
    return [];
  }
}

const basePromotion = () => ({
  title: 'Promo',
  subtitle: null,
  imageUrl: null,
  ctaLabel: null,
  ctaHref: null,
  voucherCode: null,
  sortOrder: 0,
  startsAt: null,
  endsAt: null,
});

describe('PromotionService branch gaps', () => {
  let repo: InMemoryPromotionRepository;
  let service: PromotionService;

  beforeEach(() => {
    repo = new InMemoryPromotionRepository();
    service = new PromotionService(
      repo,
      new InMemoryVoucherRepository(),
      new FakeOrderValues() as never,
      promoTestConfig(),
    );
  });

  it('listAll returns every promotion incl. inactive', async () => {
    const created = await service.create(basePromotion());
    await service.update(created.id, { active: false });
    const all = await service.listAll();
    expect(all.map((p) => p.id)).toContain(created.id);
  });

  it('remove deletes an existing promotion', async () => {
    const created = await service.create(basePromotion());
    await service.remove(created.id);
    expect(await service.listAll()).toHaveLength(0);
  });

  it('remove throws for a missing promotion', async () => {
    await expect(service.remove('missing')).rejects.toBeInstanceOf(PromotionNotFoundError);
  });
});

class InMemoryVoucherRequestRepository implements VoucherRequestRepository {
  rows: VoucherRequestRecord[] = [];
  private seq = 0;

  async create(data: CreateVoucherRequestData): Promise<VoucherRequestRecord> {
    const at = new Date(1_800_000_000_000 + this.seq * 1000);
    const row: VoucherRequestRecord = {
      id: `r${(this.seq += 1)}`,
      ...data,
      status: VoucherRequestStatus.PENDING,
      decidedBy: null,
      createdVoucherId: null,
      createdAt: at,
      updatedAt: at,
    };
    this.rows.push(row);
    return row;
  }
  async list(filter: ListVoucherRequestsFilter) {
    const all = this.rows
      .filter((r) => !filter.status || r.status === filter.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const start = (filter.page - 1) * filter.limit;
    return { items: all.slice(start, start + filter.limit), total: all.length };
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async update(id: string, patch: UpdateVoucherRequestData) {
    const row = this.rows.find((r) => r.id === id)!;
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.decidedBy !== undefined) row.decidedBy = patch.decidedBy;
    if (patch.createdVoucherId !== undefined) row.createdVoucherId = patch.createdVoucherId;
    return row;
  }
}

const INPUT: ProposeVoucherRequestInput = {
  depotName: 'Depot Bandung',
  code: 'depot10',
  description: '10% off',
  discountType: DiscountType.PERCENTAGE,
  value: 10,
  minSpend: 50000,
  maxDiscount: 20000,
  usageLimit: 1000,
  perCustomerLimit: 1,
  note: null,
};

describe('VoucherRequestService branch gaps', () => {
  function build() {
    const requests = new InMemoryVoucherRequestRepository();
    const voucherService = new VoucherService(
      new InMemoryVoucherRepository(),
      new FakeCustomerLookup(),
      new FakeNotification(),
    );
    return { service: new VoucherRequestService(requests, voucherService), requests };
  }

  it('list paginates requests through buildPage', async () => {
    const { service } = build();
    await service.propose('depot-1', 'user-1', INPUT);
    const page = await service.list({ page: 1, limit: 10 });
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.totalPages).toBe(1);
  });

  it('reject throws when the request was already decided', async () => {
    const { service } = build();
    const rec = await service.propose('depot-1', 'user-1', INPUT);
    await service.reject(rec.id, 'hq-1');
    await expect(service.reject(rec.id, 'hq-1')).rejects.toBeInstanceOf(
      VoucherRequestDecidedError,
    );
  });
});
