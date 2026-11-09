import { ForbiddenException } from '@nestjs/common';

import { AuthenticatedUser, Role } from '@hydromart/platform';

import { CashierShiftService } from '../../src/application/services/cashier-shift.service';
import { CashierShift, CashierShiftStatus } from '../../src/domain/cashier-shift';
import { CashDirection } from '../../src/domain/cashbook';
import {
  CashTotalUnavailableError,
  DepotNotFoundError,
  ShiftAlreadyClosedError,
  ShiftAlreadyOpenError,
  ShiftNotFoundError,
  ShiftNotYoursError,
} from '../../src/domain/errors';
import {
  CashierShiftRepository,
  CloseShiftData,
  OpenShiftData,
} from '../../src/application/ports/cashier-shift.repository';
import {
  CashbookRepository,
  CreateCashbookEntryData,
} from '../../src/application/ports/cashbook.repository';
import { DepotCashPort } from '../../src/application/ports/depot-cash.port';

const DEPOT = 'depot-1';
const CASHIER = { id: 'cashier-1', canCloseAnyShift: false };

class InMemoryShifts implements CashierShiftRepository {
  rows: CashierShift[] = [];
  private seq = 0;

  async open(data: OpenShiftData): Promise<CashierShift> {
    const row: CashierShift = {
      id: `shift-${(this.seq += 1)}`,
      ...data,
      status: CashierShiftStatus.OPEN,
      openedAt: new Date('2026-08-03T01:00:00Z'),
      closedAt: null,
      countedCash: null,
      expectedCash: null,
      variance: null,
      note: null,
      liabilityIdr: null,
    };
    this.rows.push(row);
    return { ...row };
  }
  async findById(id: string): Promise<CashierShift | null> {
    const row = this.rows.find((r) => r.id === id);
    return row ? { ...row } : null;
  }
  async findOpen(depotId: string, cashierId: string): Promise<CashierShift | null> {
    const row = this.rows.find(
      (r) =>
        r.depotId === depotId && r.cashierId === cashierId && r.status === CashierShiftStatus.OPEN,
    );
    return row ? { ...row } : null;
  }
  async listOpen(depotId: string): Promise<CashierShift[]> {
    return this.rows.filter((r) => r.depotId === depotId && r.status === CashierShiftStatus.OPEN);
  }
  async listClosed(depotId: string, limit: number): Promise<CashierShift[]> {
    return this.rows
      .filter((r) => r.depotId === depotId && r.status === CashierShiftStatus.CLOSED)
      .slice(0, limit);
  }
  async close(id: string, data: CloseShiftData): Promise<CashierShift> {
    const row = this.rows.find((r) => r.id === id)!;
    // Port contract (D1-01): compare-and-set on OPEN, like the Prisma repository.
    if (row.status !== CashierShiftStatus.OPEN) throw new ShiftAlreadyClosedError();
    Object.assign(row, data, { status: CashierShiftStatus.CLOSED });
    return { ...row };
  }
  async recordLiability(id: string, amountIdr: number): Promise<boolean> {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.liabilityIdr !== null) return false;
    row.liabilityIdr = amountIdr;
    return true;
  }
  async outstandingLiability(depotId: string, cashierId: string, exceptShiftId?: string): Promise<number> {
    return this.rows
      .filter(
        (r) =>
          r.depotId === depotId &&
          r.cashierId === cashierId &&
          r.status === CashierShiftStatus.CLOSED &&
          r.id !== exceptShiftId,
      )
      .reduce((sum, r) => sum + (r.liabilityIdr ?? 0), 0);
  }
}

class FakeCashbook implements CashbookRepository {
  // CA-2-22: corrections are not this suite's subject, but the port grew two reads and a
  // fake that lies about the interface is worse than no fake.
  async findById(): Promise<null> {
    return null;
  }
  async findReversalOf(): Promise<null> {
    return null;
  }

  entries: CreateCashbookEntryData[] = [];
  async create(data: CreateCashbookEntryData): Promise<never> {
    this.entries.push(data);
    return undefined as never;
  }
  async listForDepot(): Promise<never> {
    return [] as never;
  }
}

class FakeDepotCash implements DepotCashPort {
  total = 0;
  error: Error | null = null;
  calls: { depotId: string; from: Date; to: Date }[] = [];
  async totalPaidCash(depotId: string, from: Date, to: Date): Promise<number> {
    this.calls.push({ depotId, from, to });
    if (this.error) throw this.error;
    return this.total;
  }
}

describe('CashierShiftService', () => {
  let shifts: InMemoryShifts;
  let cashbook: FakeCashbook;
  let depotCash: FakeDepotCash;
  let depots: { findById: jest.Mock };
  let service: CashierShiftService;
  let approvalsCreate: jest.Mock;
  let reversals: Map<string, (approval: never, decidedBy: string) => Promise<void>>;

  beforeEach(() => {
    shifts = new InMemoryShifts();
    cashbook = new FakeCashbook();
    depotCash = new FakeDepotCash();
    depots = { findById: jest.fn(async () => ({ id: DEPOT })) };
    approvalsCreate = jest.fn(async () => ({}));
    reversals = new Map();
    service = new CashierShiftService(shifts, cashbook as never, depotCash, depots as never, {
      create: approvalsCreate,
      registerReversal: (type: string, fn: never) => reversals.set(type, fn),
    } as never);
  });

  const openShift = () =>
    service.open({ depotId: DEPOT, openingFloat: 200_000 }, { id: CASHIER.id, name: '0812' });

  /*
   * DEP-05 (owner decision 2026-11-09): HQ rejecting a COD_VARIANCE records the shortfall as the
   * cashier's liability, shown at their next shift. No automatic cash movement.
   */
  describe('a rejected COD_VARIANCE (DEP-05)', () => {
    const rejected = (subjectRef: string | null, amountIdr: number) =>
      ({ id: 'ap-1', depotId: DEPOT, type: 'COD_VARIANCE', status: 'REJECTED', subjectRef, amountIdr }) as never;

    const closeShort = async (short = 50_000) => {
      const opened = await openShift();
      depotCash.total = 900_000;
      await service.close(opened.id, { countedCash: 1_100_000 - short }, CASHIER);
      return opened;
    };

    it('records the shortfall on the shift and shows it when the cashier next looks at the counter', async () => {
      const first = await closeShort(50_000);
      await reversals.get('COD_VARIANCE')!(rejected(`shift:${first.id}`, -50_000), 'hq-1');
      expect(shifts.rows.find((r) => r.id === first.id)!.liabilityIdr).toBe(50_000);

      const next = await openShift();
      expect(next.carriedLiabilityIdr).toBe(50_000);
      expect((await service.current(DEPOT, CASHIER.id))!.carriedLiabilityIdr).toBe(50_000);

      depotCash.total = 100_000;
      const closed = await service.close(next.id, { countedCash: 300_000 }, CASHIER);
      expect(closed.carriedLiabilityIdr).toBe(50_000);
    });

    it('a repeated callback does not double the liability', async () => {
      const first = await closeShort(50_000);
      const reverse = reversals.get('COD_VARIANCE')!;
      await reverse(rejected(`shift:${first.id}`, -50_000), 'hq-1');
      await reverse(rejected(`shift:${first.id}`, -50_000), 'hq-1');
      expect(shifts.rows.find((r) => r.id === first.id)!.liabilityIdr).toBe(50_000);
    });

    it('owes nothing for an overage, or for an approval that names no shift', async () => {
      const first = await closeShort(-20_000);
      const reverse = reversals.get('COD_VARIANCE')!;
      await reverse(rejected(`shift:${first.id}`, 20_000), 'hq-1');
      await reverse(rejected(null, -50_000), 'hq-1');
      await reverse(rejected('bukan-shift', -50_000), 'hq-1');
      expect(shifts.rows.every((r) => r.liabilityIdr === null)).toBe(true);
    });

    it('shows no carried liability to a cashier who owes nothing, or to a different cashier', async () => {
      const first = await closeShort(50_000);
      await reversals.get('COD_VARIANCE')!(rejected(`shift:${first.id}`, -50_000), 'hq-1');
      const other = await service.open({ depotId: DEPOT, openingFloat: 0 }, { id: 'cashier-2', name: '0813' });
      expect(other.carriedLiabilityIdr).toBe(0);
      expect(await service.current(DEPOT, 'nobody')).toBeNull();
    });
  });

  it('opens a shift with the drawer float and the cashier on it', async () => {
    const shift = await openShift();
    expect(shift).toMatchObject({
      depotId: DEPOT,
      cashierId: CASHIER.id,
      cashierName: '0812',
      openingFloat: 200_000,
      status: CashierShiftStatus.OPEN,
    });
  });

  it('refuses to open a shift at a depot that does not exist', async () => {
    depots.findById.mockResolvedValueOnce(null);
    await expect(openShift()).rejects.toBeInstanceOf(DepotNotFoundError);
  });

  // Two open shifts would each claim the same drawer, and both would balance.
  it('refuses a second open shift for the same cashier', async () => {
    await openShift();
    await expect(openShift()).rejects.toBeInstanceOf(ShiftAlreadyOpenError);
  });

  it('reports the caller own open shift, and null once there is none', async () => {
    expect(await service.current(DEPOT, CASHIER.id)).toBeNull();
    const opened = await openShift();
    expect((await service.current(DEPOT, CASHIER.id))?.id).toBe(opened.id);
  });

  describe('close', () => {
    it('measures the drawer against payment-service, not against the client', async () => {
      const opened = await openShift();
      depotCash.total = 1_250_000;

      const closed = await service.close(opened.id, { countedCash: 1_450_000 }, CASHIER);

      expect(depotCash.calls[0]).toMatchObject({ depotId: DEPOT, from: opened.openedAt });
      expect(closed.expectedCash).toBe(1_450_000); // 200k float + 1.25m taken
      expect(closed.variance).toBe(0);
      expect(closed.status).toBe(CashierShiftStatus.CLOSED);
    });

    it('records a short drawer as a negative variance', async () => {
      const opened = await openShift();
      depotCash.total = 1_000_000;

      const closed = await service.close(
        opened.id,
        { countedCash: 1_150_000, note: '  kembalian kurang  ' },
        CASHIER,
      );

      expect(closed.expectedCash).toBe(1_200_000);
      expect(closed.variance).toBe(-50_000);
      expect(closed.note).toBe('kembalian kurang');
    });

    // Fail CLOSED: a guessed expected total either accuses a cashier or absolves a real
    // shortfall, and the shift must stay open rather than record either.
    it('leaves the shift open when the takings cannot be read', async () => {
      const opened = await openShift();
      depotCash.error = new CashTotalUnavailableError();

      await expect(
        service.close(opened.id, { countedCash: 1_000_000 }, CASHIER),
      ).rejects.toBeInstanceOf(CashTotalUnavailableError);

      expect((await shifts.findById(opened.id))?.status).toBe(CashierShiftStatus.OPEN);
      expect(cashbook.entries).toHaveLength(0);
    });

    it('posts only the takings to the cashbook — never the float', async () => {
      const opened = await openShift();
      depotCash.total = 900_000;

      await service.close(opened.id, { countedCash: 1_100_000 }, CASHIER);

      expect(cashbook.entries).toHaveLength(1);
      expect(cashbook.entries[0]).toMatchObject({
        depotId: DEPOT,
        direction: CashDirection.IN,
        amountIdr: 900_000,
        sourceRef: `shift:${opened.id}`,
      });
    });

    // DEP-19: the shift is closed by a compare-and-set and the takings are posted AFTER it, so
    // a transient failure in between left a closed shift whose cash never reached the book,
    // and no second close can ever repair it. The post is retried; only the CAS winner posts,
    // so a retry cannot double-count.
    it('retries a transient cashbook failure instead of losing the takings', async () => {
      const opened = await openShift();
      depotCash.total = 900_000;
      const create = jest.spyOn(cashbook, 'create');
      create.mockRejectedValueOnce(new Error('db blip'));

      await service.close(opened.id, { countedCash: 1_100_000 }, CASHIER);

      expect(cashbook.entries.filter((e) => e.sourceRef === `shift:${opened.id}`)).toHaveLength(1);
    });

    it('names the shift even when the failure is not an Error object', async () => {
      const opened = await openShift();
      depotCash.total = 900_000;
      jest.spyOn(cashbook, 'create').mockRejectedValue('kolom penuh');

      await expect(
        service.close(opened.id, { countedCash: 1_100_000 }, CASHIER),
      ).rejects.toThrow(/kolom penuh/);
    });

    it('names the shift when the takings still cannot be posted', async () => {
      const opened = await openShift();
      depotCash.total = 900_000;
      jest.spyOn(cashbook, 'create').mockRejectedValue(new Error('db down'));

      await expect(
        service.close(opened.id, { countedCash: 1_100_000 }, CASHIER),
      ).rejects.toThrow(`shift:${opened.id}`);
    });

    // DEP-22: a drawer that does not match the till is money a manager must account for, but
    // the variance was only stored on the shift row and nothing ever queued it for approval.
    it('queues a COD_VARIANCE approval when the count does not match', async () => {
      const opened = await openShift();
      depotCash.total = 900_000; // expected = 200_000 float + 900_000
      await service.close(opened.id, { countedCash: 1_050_000 }, CASHIER); // 50_000 short

      expect(approvalsCreate).toHaveBeenCalledTimes(1);
      expect(approvalsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          depotId: DEPOT,
          type: 'COD_VARIANCE',
          amountIdr: -50_000,
          subjectRef: `shift:${opened.id}`,
        }),
        CASHIER.id,
      );
    });

    it('queues nothing when the drawer balances, and never fails the close if queueing fails', async () => {
      const balanced = await openShift();
      depotCash.total = 900_000;
      await service.close(balanced.id, { countedCash: 1_100_000 }, CASHIER);
      expect(approvalsCreate).not.toHaveBeenCalled();

      const short = await openShift();
      approvalsCreate.mockRejectedValueOnce(new Error('approvals down'));
      await expect(
        service.close(short.id, { countedCash: 1_050_000 }, CASHIER),
      ).resolves.toBeDefined();
    });

    it('writes no cashbook entry for a shift that sold nothing', async () => {
      const opened = await openShift();
      depotCash.total = 0;
      await service.close(opened.id, { countedCash: 200_000 }, CASHIER);
      expect(cashbook.entries).toHaveLength(0);
    });

    it('refuses to close another cashier drawer', async () => {
      const opened = await openShift();
      await expect(
        service.close(
          opened.id,
          { countedCash: 1 },
          { id: 'someone-else', canCloseAnyShift: false },
        ),
      ).rejects.toBeInstanceOf(ShiftNotYoursError);
    });

    // Somebody has to be able to reconcile the drawer a cashier walked away from.
    it('lets depot finance close a shift that is not theirs', async () => {
      const opened = await openShift();
      depotCash.total = 500_000;
      const closed = await service.close(
        opened.id,
        { countedCash: 700_000 },
        { id: 'manager-1', canCloseAnyShift: true },
      );
      expect(closed.variance).toBe(0);
    });

    // D1-01: two simultaneous closes must post the counter cash to the book once.
    it('posts the counter cash once when the same shift is closed twice concurrently', async () => {
      const opened = await openShift();
      depotCash.total = 500_000;
      const results = await Promise.allSettled([
        service.close(opened.id, { countedCash: 700_000 }, CASHIER),
        service.close(opened.id, { countedCash: 700_000 }, CASHIER),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const lost = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(lost.reason).toBeInstanceOf(ShiftAlreadyClosedError);
      expect(cashbook.entries.filter((e) => e.sourceRef === `shift:${opened.id}`)).toHaveLength(1);
    });

    it('rejects an unknown shift and a shift already closed', async () => {
      await expect(service.close('nope', { countedCash: 1 }, CASHIER)).rejects.toBeInstanceOf(
        ShiftNotFoundError,
      );
      const opened = await openShift();
      await service.close(opened.id, { countedCash: 200_000 }, CASHIER);
      await expect(
        service.close(opened.id, { countedCash: 200_000 }, CASHIER),
      ).rejects.toBeInstanceOf(ShiftAlreadyClosedError);
    });
  });

  /*
   * AUTHZ-A4: closing checked WHOSE shift it was and never WHICH DEPOT it was. `depotFinance`
   * is what lets a manager close a drawer a cashier walked away from — and a manager holds it
   * for their own depots. So a manager could close any depot's shift and post its counter
   * takings into that depot's cashbook, in a category ("KONTER") that reads as ordinary.
   */
  it('refuses to close a shift at a depot the caller does not run', async () => {
    const opened = await openShift();
    const outsider = {
      sub: 'manager-lain',
      role: Role.MANAGER,
      depotId: 'depot-lain',
      depotIds: ['depot-lain'],
    } as unknown as AuthenticatedUser;

    await expect(
      service.close(
        opened.id,
        { countedCash: 200_000 },
        { ...CASHIER, canCloseAnyShift: true },
        outsider,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(cashbook.entries).toHaveLength(0);
    expect(shifts.rows[0].status).toBe(CashierShiftStatus.OPEN);
  });

  it('still closes for a manager of the shift own depot', async () => {
    const opened = await openShift();
    const insider = {
      sub: 'manager',
      role: Role.MANAGER,
      depotId: DEPOT,
      depotIds: [DEPOT],
    } as unknown as AuthenticatedUser;

    await expect(
      service.close(
        opened.id,
        { countedCash: 200_000 },
        { ...CASHIER, canCloseAnyShift: true },
        insider,
      ),
    ).resolves.toMatchObject({ status: CashierShiftStatus.CLOSED });
  });

  it('lists who is on the counter now plus the shifts already reconciled', async () => {
    const opened = await openShift();
    depotCash.total = 100_000;
    await service.close(opened.id, { countedCash: 300_000 }, CASHIER);
    const second = await openShift();

    const view = await service.list(DEPOT);
    expect(view.open.map((s) => s.id)).toEqual([second.id]);
    expect(view.closed.map((s) => s.id)).toEqual([opened.id]);
  });
});
