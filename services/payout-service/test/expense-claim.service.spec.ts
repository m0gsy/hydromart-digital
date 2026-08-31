import { ForbiddenException } from '@nestjs/common';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import {
  ExpenseClaimNotFoundError,
  ExpenseClaimNotPendingError,
  InvalidExpenseAmountError,
} from '../src/domain/errors';
import { ExpenseClaimService } from '../src/application/services/expense-claim.service';
import type { PayoutConfigService } from '../src/config/payout-config.service';
import type {
  CourierLedgerEntryRecord,
  CourierLedgerRepository,
  CreateCourierLedgerData,
} from '../src/application/ports/courier-ledger.repository';
import type {
  CreateExpenseClaimData,
  ExpenseClaimRecord,
  ExpenseClaimRepository,
  ReviewExpenseClaimData,
} from '../src/application/ports/expense-claim.repository';

// Minimal ledger fake: the service only credits + checks idempotency here.
class FakeLedger implements CourierLedgerRepository {
  entries: CourierLedgerEntryRecord[] = [];
  async create(data: CreateCourierLedgerData): Promise<CourierLedgerEntryRecord> {
    const row: CourierLedgerEntryRecord = {
      id: `e-${this.entries.length}`,
      courierId: data.courierId,
      depotId: data.depotId,
      type: data.type,
      amount: data.amount,
      description: data.description,
      sourceRef: data.sourceRef ?? null,
      occurredAt: data.occurredAt ?? new Date(),
      createdAt: new Date(),
    };
    this.entries.push(row);
    return row;
  }
  async findBySourceRef(sourceRef: string): Promise<CourierLedgerEntryRecord | null> {
    return this.entries.find((e) => e.sourceRef === sourceRef) ?? null;
  }
  async balanceFor(courierId: string): Promise<number> {
    return this.entries.filter((e) => e.courierId === courierId).reduce((s, e) => s + e.amount, 0);
  }
  async sumByType(): Promise<number> {
    return 0;
  }
  async earningsByDepot(): Promise<{ courierId: string; earnedIdr: number; paidDeliveries: number }[]> {
    return [];
  }
  async countByType(): Promise<number> {
    return 0;
  }
  async listForCourier() {
    return { items: [], total: 0 };
  }
  async currentRule() {
    return null;
  }
  async listRules() {
    return [];
  }
  async findRule() {
    return null;
  }
  async deleteRule() {
    return undefined;
  }
  createRule(): Promise<never> {
    throw new Error('not used');
  }
}

class FakeClaims implements ExpenseClaimRepository {
  rows: ExpenseClaimRecord[] = [];
  async create(data: CreateExpenseClaimData): Promise<ExpenseClaimRecord> {
    const row: ExpenseClaimRecord = {
      id: `c-${this.rows.length}`,
      courierId: data.courierId,
      depotId: data.depotId,
      category: data.category,
      amount: data.amount,
      description: data.description,
      receiptUrl: data.receiptUrl ?? null,
      status: data.status,
      reviewedBy: data.reviewedBy ?? null,
      reviewedAt: data.reviewedAt ?? null,
      reviewNote: data.reviewNote ?? null,
      ledgerEntryId: data.ledgerEntryId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
  async findById(id: string): Promise<ExpenseClaimRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async markReviewed(id: string, data: ReviewExpenseClaimData): Promise<ExpenseClaimRecord> {
    const row = this.rows.find((r) => r.id === id)!;
    Object.assign(row, {
      status: data.status,
      reviewedBy: data.reviewedBy,
      reviewNote: data.reviewNote,
      ledgerEntryId: data.ledgerEntryId ?? null,
      reviewedAt: new Date(),
    });
    return row;
  }
  async listForCourier(courierId: string) {
    const items = this.rows.filter((r) => r.courierId === courierId);
    return { items, total: items.length };
  }
  async searchForDepot(depotIds: readonly string[] | null, status: string | null) {
    const items = this.rows.filter(
      (r) =>
        (!depotIds || (r.depotId !== null && depotIds.includes(r.depotId))) &&
        (!status || r.status === status),
    );
    return { items, total: items.length };
  }
}

const COURIER = 'c-courier';
const REVIEWER = 'r-reviewer';
const config = { expenseAutoApproveMaxIdr: () => 50000 } as unknown as PayoutConfigService;

// M20-15: a receipt is part of the happy path — auto-approve requires one, so the
// default input carries one and the no-receipt cases pass null explicitly.
const input = (amount: number, receiptUrl: string | null = 'https://x/receipt.jpg') => ({
  category: 'FUEL' as const,
  amount,
  description: 'Bensin',
  depotId: 'depot-1',
  receiptUrl,
});

describe('ExpenseClaimService', () => {
  let ledger: FakeLedger;
  let claims: FakeClaims;
  let service: ExpenseClaimService;

  beforeEach(() => {
    ledger = new FakeLedger();
    claims = new FakeClaims();
    service = new ExpenseClaimService(claims, ledger, config);
  });

  it('rejects a non-positive amount', async () => {
    await expect(service.submit(COURIER, input(0))).rejects.toBeInstanceOf(
      InvalidExpenseAmountError,
    );
  });

  it('auto-approves and credits a claim under the threshold', async () => {
    const claim = await service.submit(COURIER, input(25000));
    expect(claim.status).toBe('APPROVED');
    expect(claim.reviewedBy).toBeNull();
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({ type: 'ADJUSTMENT', amount: 25000 });
    expect(await ledger.balanceFor(COURIER)).toBe(25000);
  });

  it('queues a claim with no receipt even when it is under the threshold (M20-15)', async () => {
    const claim = await service.submit(COURIER, input(25000, null));
    expect(claim.status).toBe('PENDING');
    expect(ledger.entries).toHaveLength(0);
  });

  it('treats a blank receipt url as no receipt (M20-15)', async () => {
    const claim = await service.submit(COURIER, input(25000, '   '));
    expect(claim.status).toBe('PENDING');
    expect(claim.receiptUrl).toBeNull();
    expect(ledger.entries).toHaveLength(0);
  });

  it('leaves a claim over the threshold pending with no ledger movement', async () => {
    const claim = await service.submit(COURIER, input(80000));
    expect(claim.status).toBe('PENDING');
    expect(ledger.entries).toHaveLength(0);
  });

  it('a zero threshold disables auto-approve', async () => {
    const strict = new ExpenseClaimService(claims, ledger, {
      expenseAutoApproveMaxIdr: () => 0,
    } as unknown as PayoutConfigService);
    const claim = await strict.submit(COURIER, input(1000));
    expect(claim.status).toBe('PENDING');
    expect(ledger.entries).toHaveLength(0);
  });

  it('approving a pending claim credits the ledger and marks it approved', async () => {
    const pending = await service.submit(COURIER, input(80000));
    const approved = await service.approve(pending.id, REVIEWER, 'ok');
    expect(approved.status).toBe('APPROVED');
    expect(approved.reviewedBy).toBe(REVIEWER);
    expect(approved.ledgerEntryId).toBe(ledger.entries[0].id);
    expect(await ledger.balanceFor(COURIER)).toBe(80000);
  });

  it('rejecting a pending claim moves no money', async () => {
    const pending = await service.submit(COURIER, input(80000));
    const rejected = await service.reject(pending.id, REVIEWER, 'no receipt');
    expect(rejected.status).toBe('REJECTED');
    expect(ledger.entries).toHaveLength(0);
  });

  it('cannot approve a claim that is not pending', async () => {
    const claim = await service.submit(COURIER, input(25000)); // auto-approved
    await expect(service.approve(claim.id, REVIEWER)).rejects.toBeInstanceOf(
      ExpenseClaimNotPendingError,
    );
  });

  it('throws for an unknown claim id', async () => {
    await expect(service.approve('nope', REVIEWER)).rejects.toBeInstanceOf(
      ExpenseClaimNotFoundError,
    );
  });

  it('cannot reject a claim that is not pending', async () => {
    const claim = await service.submit(COURIER, input(25000)); // auto-approved
    await expect(service.reject(claim.id, REVIEWER)).rejects.toBeInstanceOf(
      ExpenseClaimNotPendingError,
    );
  });

  it('paginates a courier own claims', async () => {
    await service.submit(COURIER, input(80000));
    await service.submit(COURIER, input(90000));
    const page = await service.listForCourier(COURIER, 1, 10);
    expect(page).toMatchObject({ page: 1, limit: 10, total: 2, totalPages: 1 });
    expect(page.items).toHaveLength(2);
  });

  it('searches depot claims filtered by status', async () => {
    const pending = await service.submit(COURIER, input(80000)); // PENDING
    await service.reject(pending.id, REVIEWER); // -> REJECTED
    await service.submit(COURIER, input(70000)); // PENDING

    const rejected = await service.searchForDepot('depot-1', 'REJECTED', 1, 10);
    expect(rejected.total).toBe(1);
    expect(rejected.items[0].status).toBe('REJECTED');

    // Null filters return everything for the depot.
    const all = await service.searchForDepot(null, null, 1, 10);
    expect(all.total).toBe(2);
  });

  /*
   * AUTHZ-A5. Approving a claim credits a courier's ledger — real money — and neither
   * approve nor reject ever looked at which depot the claim came from. `expenseApprove` is
   * held by depot leadership, so any of them could approve any depot's claims. The queue
   * they read is the other half: with no `depotId` filter it answered with every depot's
   * claims, which is where the ids come from.
   */
  describe('reviewing another depot claim', () => {
    const outsider = {
      sub: REVIEWER,
      role: Role.KEPALA_DEPOT,
      depotId: 'depot-lain',
      depotIds: ['depot-lain'],
    } as unknown as AuthenticatedUser;
    const insider = {
      sub: REVIEWER,
      role: Role.KEPALA_DEPOT,
      depotId: 'depot-1',
      depotIds: ['depot-1'],
    } as unknown as AuthenticatedUser;

    const pendingClaim = async () => service.submit(COURIER, input(200_000));

    it('refuses approve and reject, and moves no money', async () => {
      const claim = await pendingClaim();
      await expect(service.approve(claim.id, REVIEWER, 'ok', outsider)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.reject(claim.id, REVIEWER, 'no', outsider)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(ledger.entries).toHaveLength(0);
      expect(claims.rows[0].status).toBe('PENDING');
    });

    it('still lets the claim own depot approve it', async () => {
      const claim = await pendingClaim();
      await expect(service.approve(claim.id, REVIEWER, 'ok', insider)).resolves.toMatchObject({
        status: 'APPROVED',
      });
      expect(ledger.entries).toHaveLength(1);
    });

    // An unfiltered queue is how a reviewer learns another depot's claim ids in the first
    // place. Asked for "all depots", a depot-scoped reviewer gets their own.
    it('narrows an unfiltered queue to the reviewer own depots', async () => {
      await service.submit(COURIER, input(200_000));
      await service.submit(COURIER, { ...input(200_000), depotId: 'depot-lain' });

      const mine = await service.searchForDepot(null, null, 1, 20, insider);
      expect(mine.items.map((c) => c.depotId)).toEqual(['depot-1']);

      // ...and an unscoped reviewer (finance/HQ) still sees the network.
      const all = await service.searchForDepot(null, null, 1, 20);
      expect(all.items).toHaveLength(2);
    });

    it('refuses a depot filter that is not the reviewer own', async () => {
      await expect(
        service.searchForDepot('depot-lain', null, 1, 20, insider),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
