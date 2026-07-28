import { GallonReturnService } from '../../src/application/services/gallon-return.service';
import { GallonCondition } from '../../src/domain/gallon-return';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotNotFoundError, GallonOverReturnError } from '../../src/domain/errors';
import {
  CreateGallonReturnData,
  GallonReturnRecord,
  GallonReturnRepository,
  GallonReturnSummary,
} from '../../src/application/ports/gallon-return.repository';
import { DepotConfigService } from '../../src/config/depot-config.service';
import {
  ApprovalService,
  CreateApprovalInput,
} from '../../src/application/services/approval.service';
import { ApprovalType } from '../../src/domain/approval';
import { InMemoryDepotRepository, InMemoryGallonIssueRepository } from '../support/fakes';

const GALLON_DEPOSIT_IDR = 20000;
const configStub = { gallonDepositIdr: () => GALLON_DEPOSIT_IDR } as DepotConfigService;

class InMemoryGallonReturnRepository implements GallonReturnRepository {
  private rows: GallonReturnRecord[] = [];
  private seq = 0;

  async create(data: CreateGallonReturnData): Promise<GallonReturnRecord> {
    const row: GallonReturnRecord = { id: `r${++this.seq}`, createdAt: new Date(), ...data };
    this.rows.push(row);
    return row;
  }
  async listForDepot(depotId: string, page: number, limit: number) {
    const all = this.rows.filter((r) => r.depotId === depotId).reverse();
    return { items: all.slice((page - 1) * limit, page * limit), total: all.length };
  }
  async summaryForDepot(depotId: string): Promise<GallonReturnSummary> {
    const all = this.rows.filter((r) => r.depotId === depotId);
    return {
      returns: all.length,
      gallons: all.reduce((s, r) => s + r.quantity, 0),
      damaged: all.filter((r) => r.condition === GallonCondition.DAMAGED).length,
      depositRefunded: all.reduce((s, r) => s + r.depositRefunded, 0),
    };
  }
  async networkSummary() {
    const map = new Map<string, { gallons: number; depositRefunded: number }>();
    for (const r of this.rows) {
      const e = map.get(r.depotId) ?? { gallons: 0, depositRefunded: 0 };
      e.gallons += r.quantity;
      e.depositRefunded += r.depositRefunded;
      map.set(r.depotId, e);
    }
    return [...map.entries()].map(([depotId, v]) => ({ depotId, ...v }));
  }
}

const DEPOT = {
  code: 'JKT-01',
  name: 'Depot Cikini',
  ownershipType: OwnershipType.HKP,
  address: 'Jl. Cikini Raya No. 1',
  city: 'Jakarta',
  province: 'DKI Jakarta',
  lat: -6.19,
  lng: 106.84,
  serviceRadiusKm: 5,
  deliveryFee: 5000,
  minOrderAmount: null,
  ownerId: null,
  operatingHours: {},
  holidays: [],
};

/** Records what the service pushed into the approval queue (M15-11 / M15-04). */
class SpyApprovalService {
  created: CreateApprovalInput[] = [];
  async create(input: CreateApprovalInput, _submittedBy: string): Promise<unknown> {
    this.created.push(input);
    return { id: `approval-${this.created.length}` };
  }
  ofType(type: ApprovalType): CreateApprovalInput[] {
    return this.created.filter((c) => c.type === type);
  }
}

describe('GallonReturnService', () => {
  let depots: InMemoryDepotRepository;
  let returns: InMemoryGallonReturnRepository;
  let issues: InMemoryGallonIssueRepository;
  let approvals: SpyApprovalService;
  let service: GallonReturnService;
  let depotId: string;

  beforeEach(async () => {
    depots = new InMemoryDepotRepository();
    returns = new InMemoryGallonReturnRepository();
    issues = new InMemoryGallonIssueRepository();
    approvals = new SpyApprovalService();
    service = new GallonReturnService(
      returns,
      issues,
      depots,
      configStub,
      approvals as unknown as ApprovalService,
    );
    depotId = (await depots.create(DEPOT)).id;
    // Returns are now capped by what the depot has outstanding, so every test needs a
    // ledger to return AGAINST. Plenty of headroom: the cap itself is asserted below.
    await issues.create({
      depotId,
      customerId: null,
      quantity: 100,
      depositHeld: 100 * GALLON_DEPOSIT_IDR,
      note: null,
      actorId: 'staff-1',
    });
  });

  it('records an over-return and queues it for review instead of rejecting it (M15-11)', async () => {
    await service.record(depotId, { quantity: 98 }, 'staff-1');
    const record = await service.record(depotId, { quantity: 5 }, 'staff-1');

    // The empties are physically there, so they are recorded...
    expect((await service.summary(depotId)).gallons).toBe(103);
    // ...and the 3 unexplained ones become a manager's problem, priced at deposit value.
    const variances = approvals.ofType(ApprovalType.GALLON_VARIANCE);
    expect(variances).toHaveLength(1);
    expect(variances[0]).toMatchObject({
      depotId,
      subjectRef: record.id,
      amountIdr: 3 * GALLON_DEPOSIT_IDR,
      payload: { excessGallons: 3, returnId: record.id },
    });
  });

  it('queues nothing when the return is within the outstanding balance (M15-11)', async () => {
    await service.record(depotId, { quantity: 10 }, 'staff-1');
    expect(approvals.ofType(ApprovalType.GALLON_VARIANCE)).toHaveLength(0);
  });

  it('queues a damaged return as a deposit-refund decision (M15-04)', async () => {
    const record = await service.record(
      depotId,
      { quantity: 2, condition: GallonCondition.DAMAGED, depositRefunded: 15000, note: 'retak' },
      'staff-1',
    );

    const refunds = approvals.ofType(ApprovalType.DEPOSIT_REFUND);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      depotId,
      subjectRef: record.id,
      amountIdr: 15000, // the value the operator proposed
      payload: { quantity: 2, reason: 'retak' },
    });
  });

  it('prices a damaged return at the deposit at stake when the operator proposes nothing (M15-04)', async () => {
    await service.record(depotId, { quantity: 2, condition: GallonCondition.DAMAGED }, 'staff-1');
    expect(approvals.ofType(ApprovalType.DEPOSIT_REFUND)[0]).toMatchObject({
      amountIdr: 2 * GALLON_DEPOSIT_IDR,
      payload: { reason: null },
    });
  });

  it('queues a courier-reported damaged return too, refunding nothing automatically (M15-04)', async () => {
    const record = await service.recordFromCourier(
      depotId,
      {
        orderId: '00000000-0000-4000-8000-00000000000a',
        quantity: 1,
        condition: GallonCondition.DAMAGED,
        note: 'pecah di jalan',
      },
      'courier-1',
    );
    expect(record.depositRefunded).toBe(0);
    expect(approvals.ofType(ApprovalType.DEPOSIT_REFUND)[0]).toMatchObject({
      payload: { reason: 'pecah di jalan', depositRefunded: 0 },
    });
  });

  it('does not queue a deposit decision for a good return (M15-04)', async () => {
    await service.record(depotId, { quantity: 2, condition: GallonCondition.GOOD }, 'staff-1');
    expect(approvals.ofType(ApprovalType.DEPOSIT_REFUND)).toHaveLength(0);
  });

  it('never refunds more deposit than the depot still holds', async () => {
    await expect(
      service.record(
        depotId,
        { quantity: 1, depositRefunded: 100 * GALLON_DEPOSIT_IDR + 1 },
        'staff-1',
      ),
    ).rejects.toBeInstanceOf(GallonOverReturnError);
    expect((await service.summary(depotId)).depositRefunded).toBe(0);
  });

  it('caps a courier refund at the deposit held and queues the excess (M15-11)', async () => {
    const record = await service.recordFromCourier(
      depotId,
      { orderId: '00000000-0000-4000-8000-00000000000a', quantity: 101 },
      'courier-1',
    );
    // 100 gallons were issued, so only 100 deposits are held — never refund the 101st.
    expect(record.depositRefunded).toBe(100 * GALLON_DEPOSIT_IDR);
    expect(record.quantity).toBe(101);
    expect(approvals.ofType(ApprovalType.GALLON_VARIANCE)[0]).toMatchObject({
      amountIdr: 1 * GALLON_DEPOSIT_IDR,
      payload: { excessGallons: 1 },
    });
  });

  it('rejects recording a return against an unknown depot', async () => {
    await expect(
      service.record('00000000-0000-4000-8000-000000000000', { quantity: 2 }, 'staff-1'),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  it('records a return and rolls it into the depot summary', async () => {
    await service.record(depotId, { quantity: 3, depositRefunded: 15000 }, 'staff-1');
    await service.record(depotId, { quantity: 1, condition: GallonCondition.DAMAGED }, 'staff-1');

    const summary = await service.summary(depotId);
    expect(summary).toEqual({ returns: 2, gallons: 4, damaged: 1, depositRefunded: 15000 });

    const page = await service.list(depotId, 1, 20);
    expect(page.total).toBe(2);
    expect(page.items[0].condition).toBe(GallonCondition.DAMAGED); // newest first
  });

  it('derives the deposit from config on a courier return (deposit × qty)', async () => {
    const rec = await service.recordFromCourier(
      depotId,
      { orderId: '00000000-0000-4000-8000-00000000abcd', quantity: 2 },
      'courier-1',
    );
    expect(rec.depositRefunded).toBe(GALLON_DEPOSIT_IDR * 2);
    expect(rec.orderId).toBe('00000000-0000-4000-8000-00000000abcd');
    expect(rec.actorId).toBe('courier-1');
  });

  it('refunds nothing for a DAMAGED courier return but still records the empties', async () => {
    const rec = await service.recordFromCourier(
      depotId,
      {
        orderId: '00000000-0000-4000-8000-00000000abce',
        quantity: 3,
        condition: GallonCondition.DAMAGED,
      },
      'courier-1',
    );
    expect(rec.depositRefunded).toBe(0);
    expect(rec.quantity).toBe(3);
  });

  it('rejects a courier return against an unknown depot', async () => {
    await expect(
      service.recordFromCourier(
        '00000000-0000-4000-8000-000000000000',
        { orderId: '00000000-0000-4000-8000-00000000abcf', quantity: 1 },
        'courier-1',
      ),
    ).rejects.toBeInstanceOf(DepotNotFoundError);
  });
});
