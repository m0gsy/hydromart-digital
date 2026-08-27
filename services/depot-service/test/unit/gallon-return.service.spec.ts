import { GallonReturnService } from '../../src/application/services/gallon-return.service';
import { GallonCondition } from '../../src/domain/gallon-return';
import { OwnershipType } from '../../src/domain/inventory';
import { DepotNotFoundError, GallonOverReturnError } from '../../src/domain/errors';
import {
  CreateGallonReturnData,
  CreateGallonReturnFromOrderData,
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
  /** MONEY-04: the same idempotency the real repository gets from the unique index. */
  async createFromOrder(
    data: CreateGallonReturnFromOrderData,
  ): Promise<{ record: GallonReturnRecord; created: boolean }> {
    const existing = this.rows.find((r) => r.orderId === data.orderId);
    if (existing) return { record: existing, created: false };
    return { record: await this.create(data), created: true };
  }
  /** Every row written, so a test can count them instead of trusting a summary. */
  all(): GallonReturnRecord[] {
    return this.rows;
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
  async gallonsInRange(depotId: string, from: Date, to: Date) {
    const all = this.rows.filter(
      (r) => r.depotId === depotId && r.createdAt >= from && r.createdAt < to,
    );
    return {
      gallons: all.reduce((s, r) => s + r.quantity, 0),
      // Gallons, not slips: the daily report's other columns are all gallons, and a
      // row count next to them reads as one.
      damaged: all
        .filter((r) => r.condition === GallonCondition.DAMAGED)
        .reduce((s, r) => s + r.quantity, 0),
    };
  }
  /** I5: the same totals, grouped by depot instead of scoped to one. */
  async perDepotForCustomer(customerId: string) {
    const by = new Map<string, { depotId: string; gallons: number; amountIdr: number }>();
    for (const r of this.rows.filter((x) => x.customerId === customerId)) {
      const acc = by.get(r.depotId) ?? { depotId: r.depotId, gallons: 0, amountIdr: 0 };
      acc.gallons += r.quantity;
      acc.amountIdr += r.depositRefunded;
      by.set(r.depotId, acc);
    }
    return [...by.values()];
  }
  /** I2: mirrors the real repository's targeted per-customer aggregate. */
  async summaryForCustomerAtDepot(depotId: string, customerId: string) {
    const mine = this.rows.filter((r) => r.depotId === depotId && r.customerId === customerId);
    return {
      gallons: mine.reduce((s, r) => s + r.quantity, 0),
      amountIdr: mine.reduce((s, r) => s + r.depositRefunded, 0),
    };
  }
  async perCustomerForDepot(depotId: string) {
    const by = new Map<string, { customerId: string; gallons: number; amountIdr: number }>();
    for (const r of this.rows.filter((x) => x.depotId === depotId && x.customerId)) {
      const key = r.customerId as string;
      const acc = by.get(key) ?? { customerId: key, gallons: 0, amountIdr: 0 };
      acc.gallons += r.quantity;
      acc.amountIdr += r.depositRefunded;
      by.set(key, acc);
    }
    return [...by.values()];
  }
  async listForCustomerAtDepot(depotId: string, customerId: string, limit: number) {
    return this.rows
      .filter((r) => r.depotId === depotId && r.customerId === customerId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
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
  reset(): void {
    this.created = [];
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

  /**
   * I2. The cap used to be measured DEPOT-wide, so a person who had never left a gallon or
   * a rupiah at this depot could be refunded out of somebody else's deposit — and the
   * depot's own total still looked healthy, so nothing complained.
   *
   * Ani has 5 gallons out on deposit here. Budi has nothing.
   */
  const withAniOnDeposit = (): GallonReturnService => {
    const bareIssues = new InMemoryGallonIssueRepository();
    void bareIssues.create({
      depotId,
      customerId: 'ani',
      quantity: 5,
      depositHeld: 5 * GALLON_DEPOSIT_IDR,
      note: null,
      actorId: 'staff-1',
    });
    return new GallonReturnService(
      new InMemoryGallonReturnRepository() as never,
      bareIssues as never,
      depots,
      configStub,
      approvals as unknown as ApprovalService,
    );
  };

  it('refuses to refund a customer out of another customer deposit (I2)', async () => {
    await expect(
      withAniOnDeposit().record(
        depotId,
        { customerId: 'budi', quantity: 2, depositRefunded: 2 * GALLON_DEPOSIT_IDR },
        'staff-1',
      ),
      // Operator-entered money above what is held is a typo, not a physical fact, so it is
      // refused rather than clamped — and the message now names WHOSE balance ran out.
    ).rejects.toThrow(/this customer still holds \(refunding 40000, 0 held\)/);
  });

  it('still refunds the customer who actually has the deposit (I2)', async () => {
    const rec = await withAniOnDeposit().record(
      depotId,
      { customerId: 'ani', quantity: 2, depositRefunded: 2 * GALLON_DEPOSIT_IDR },
      'staff-1',
    );
    expect(rec.depositRefunded).toBe(2 * GALLON_DEPOSIT_IDR);
    expect(approvals.ofType(ApprovalType.GALLON_VARIANCE)).toHaveLength(0);
  });

  // The courier path never supplies an amount, so it clamps instead of refusing — the
  // handover is physical and refusing it would lose the gallons. What I2 changes is WHOSE
  // balance it clamps against: Budi's, which is empty, not the depot's pooled one.
  it('clamps a courier refund to the customer own deposit, not the depot pool (I2)', async () => {
    const rec = await withAniOnDeposit().recordFromCourier(
      depotId,
      { orderId: '00000000-0000-4000-8000-00000000f00d', customerId: 'budi', quantity: 2 },
      'courier-1',
    );
    expect(rec.depositRefunded).toBe(0);
    expect(approvals.ofType(ApprovalType.GALLON_VARIANCE)).toHaveLength(1);
  });

  // An anonymous counter return has no person to hold a balance against, and refusing it
  // would lose a gallon that is physically on the counter. The depot total is the only
  // bound that exists for it, so it keeps the old measure — deliberately, not by omission.
  it('measures an anonymous return against the depot, as before (I2)', async () => {
    const rec = await withAniOnDeposit().record(
      depotId,
      { quantity: 2, depositRefunded: 2 * GALLON_DEPOSIT_IDR },
      'staff-1',
    );
    expect(rec.depositRefunded).toBe(2 * GALLON_DEPOSIT_IDR);
  });

  /**
   * I1, the whole bug in one test. Every OTHER test in this file gets a 100-gallon issue
   * seeded in beforeEach — "every test needs a ledger to return AGAINST" — and that seed is
   * exactly why this was invisible: in production the issue ledger was written by nobody
   * but the manual returns screen, so it was EMPTY.
   *
   * Against an empty book, depositLeft is 0, the courier refund is min(rate × qty, 0) = Rp0,
   * and gallonsLeft is negative so every single return is queued for a manager. Here
   * fulfilment writes the book first, the way it now does, and the same return behaves.
   */
  it('refunds a real deposit once fulfilment writes the issue ledger (I1)', async () => {
    // Two independent depots-worth of books, because a return written by the first arm
    // would otherwise be counted against the second — the arms are separate scenarios,
    // not two steps of one.
    const arm = (): { svc: GallonReturnService; issues: InMemoryGallonIssueRepository } => {
      const issueBook = new InMemoryGallonIssueRepository();
      return {
        issues: issueBook,
        svc: new GallonReturnService(
          new InMemoryGallonReturnRepository() as never,
          issueBook as never,
          depots,
          configStub,
          approvals as unknown as ApprovalService,
        ),
      };
    };
    const order = (n: string): string => `00000000-0000-4000-8000-0000000000${n}`;

    // BEFORE — the production state: the issue ledger was written by nobody.
    const before = arm();
    const unbooked = await before.svc.recordFromCourier(
      depotId,
      { orderId: order('a1'), quantity: 2 },
      'c-1',
    );
    expect(unbooked.depositRefunded).toBe(0);
    expect(approvals.ofType(ApprovalType.GALLON_VARIANCE)).toHaveLength(1);

    // AFTER — fulfilment booked the empties it carried out, which is what I1 added.
    approvals.reset();
    const after = arm();
    await after.issues.createFromOrder({
      depotId,
      orderId: order('b2'),
      customerId: null,
      quantity: 2,
      depositHeld: 2 * GALLON_DEPOSIT_IDR,
      note: null,
      actorId: 'order-service',
    });
    const booked = await after.svc.recordFromCourier(
      depotId,
      { orderId: order('b2'), quantity: 2 },
      'c-1',
    );
    expect(booked.depositRefunded).toBe(2 * GALLON_DEPOSIT_IDR);
    expect(approvals.ofType(ApprovalType.GALLON_VARIANCE)).toHaveLength(0);
  });

  // The constraint the I1a migration added, seen from the service: a completion fan-out is
  // at-least-once, and a second booking would inflate what the depot appears to hold and
  // therefore what it refunds. Twice booked, once held.
  it('books a delivery once however often the completion is delivered (I1)', async () => {
    const issueBook = new InMemoryGallonIssueRepository();
    const data = {
      depotId,
      orderId: '00000000-0000-4000-8000-00000000dead',
      customerId: null,
      quantity: 3,
      depositHeld: 3 * GALLON_DEPOSIT_IDR,
      note: null,
      actorId: 'order-service',
    };
    const first = await issueBook.createFromOrder(data);
    const replay = await issueBook.createFromOrder(data);

    expect(replay.id).toBe(first.id);
    expect(await issueBook.summaryForDepot(depotId)).toMatchObject({
      issues: 1,
      gallons: 3,
      depositHeld: 3 * GALLON_DEPOSIT_IDR,
    });
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

  /**
   * MONEY-04. The courier handover is queued offline (`kind: 'gallonReturn'`), and that
   * queue is at-least-once: a POST whose response is lost — 15s timeout at a customer's
   * door, a 502 mid-deploy — is re-sent on the next flush. The server had already committed
   * the first row.
   *
   * Before the fix this wrote a SECOND gallon_returns row and refunded the deposit twice,
   * while the mirror-image issue side had been idempotent on orderId since I1.
   */
  it('books a repeated courier handover once — the deposit is not refunded twice', async () => {
    const orderId = '00000000-0000-4000-8000-00000000ab01';
    const first = await service.recordFromCourier(depotId, { orderId, quantity: 2 }, 'courier-1');
    const retry = await service.recordFromCourier(depotId, { orderId, quantity: 2 }, 'courier-1');

    expect(retry.id).toBe(first.id);
    expect(returns.all().filter((r) => r.orderId === orderId)).toHaveLength(1);
    const summary = await returns.summaryForDepot(depotId);
    expect(summary.depositRefunded).toBe(GALLON_DEPOSIT_IDR * 2);
    expect(summary.gallons).toBe(2);
  });

  /**
   * The side effects must not repeat either: a second GALLON_VARIANCE for one handover is a
   * manager asked to rule on the same gallons twice, and each approval carries a rupiah
   * amount that the queue then counts again.
   */
  it('queues no second approval when the same handover is re-sent', async () => {
    const orderId = '00000000-0000-4000-8000-00000000ab02';
    // 99 gallons against an empty issue ledger — guaranteed variance.
    await service.recordFromCourier(depotId, { orderId, quantity: 99 }, 'courier-1');
    const afterFirst = approvals.created.length;
    await service.recordFromCourier(depotId, { orderId, quantity: 99 }, 'courier-1');
    expect(approvals.created.length).toBe(afterFirst);
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
