import {
  ProposeVoucherRequestInput,
  VoucherRequestService,
} from '../../src/application/services/voucher-request.service';
import { VoucherService } from '../../src/application/services/voucher.service';
import { DiscountType } from '../../src/domain/voucher';
import { VoucherRequestRecord, VoucherRequestStatus } from '../../src/domain/voucher-request';
import {
  VoucherRequestDecidedError,
  VoucherRequestNotFoundError,
} from '../../src/domain/errors';
import {
  CreateVoucherRequestData,
  ListVoucherRequestsFilter,
  UpdateVoucherRequestData,
  VoucherRequestRepository,
} from '../../src/application/ports/voucher-request.repository';
import {
  FakeCustomerLookup,
  FakeNotification,
  InMemoryVoucherRepository,
} from '../support/fakes';

class InMemoryVoucherRequestRepository implements VoucherRequestRepository {
  rows: VoucherRequestRecord[] = [];
  private seq = 0;

  async create(data: CreateVoucherRequestData): Promise<VoucherRequestRecord> {
    const at = new Date(1_800_000_000_000 + this.seq * 1000);
    const row: VoucherRequestRecord = {
      id: `r${++this.seq}`,
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

function build() {
  const requests = new InMemoryVoucherRequestRepository();
  const vouchers = new InMemoryVoucherRepository();
  const voucherService = new VoucherService(
    vouchers,
    new FakeCustomerLookup(),
    new FakeNotification(),
  );
  const service = new VoucherRequestService(requests, voucherService);
  return { service, requests, vouchers };
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
  note: 'boost repeat orders',
};

describe('VoucherRequestService', () => {
  it('proposes a pending request with the depot + requester captured', async () => {
    const { service, requests } = build();
    const rec = await service.propose('depot-1', 'user-1', INPUT);
    expect(rec.status).toBe(VoucherRequestStatus.PENDING);
    expect(rec.depotId).toBe('depot-1');
    expect(rec.requestedBy).toBe('user-1');
    expect(requests.rows).toHaveLength(1);
  });

  it('approve creates the real voucher (uppercased) and stores its id', async () => {
    const { service, vouchers } = build();
    const rec = await service.propose('depot-1', 'user-1', INPUT);
    const decided = await service.approve(rec.id, 'hq-1');

    expect(decided.status).toBe(VoucherRequestStatus.APPROVED);
    expect(decided.decidedBy).toBe('hq-1');
    expect(decided.createdVoucherId).toBeTruthy();
    // The voucher exists via the existing VoucherService.create (code normalised).
    const created = await vouchers.findByCode('DEPOT10');
    expect(created).not.toBeNull();
    expect(created!.id).toBe(decided.createdVoucherId);
    expect(created!.value).toBe(10);
  });

  it('reject closes the request without creating a voucher', async () => {
    const { service, vouchers } = build();
    const rec = await service.propose('depot-1', 'user-1', INPUT);
    const decided = await service.reject(rec.id, 'hq-1');
    expect(decided.status).toBe(VoucherRequestStatus.REJECTED);
    expect(await vouchers.findByCode('DEPOT10')).toBeNull();
  });

  it('rejects a second decision on a terminal request', async () => {
    const { service } = build();
    const rec = await service.propose('depot-1', 'user-1', INPUT);
    await service.approve(rec.id, 'hq-1');
    await expect(service.approve(rec.id, 'hq-1')).rejects.toBeInstanceOf(
      VoucherRequestDecidedError,
    );
  });

  it('throws when the request is missing', async () => {
    const { service } = build();
    await expect(service.approve('nope', 'hq-1')).rejects.toBeInstanceOf(
      VoucherRequestNotFoundError,
    );
  });
});
