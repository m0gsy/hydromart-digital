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
    Object.assign(row, data, { status: CashierShiftStatus.CLOSED });
    return { ...row };
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

  beforeEach(() => {
    shifts = new InMemoryShifts();
    cashbook = new FakeCashbook();
    depotCash = new FakeDepotCash();
    depots = { findById: jest.fn(async () => ({ id: DEPOT })) };
    service = new CashierShiftService(shifts, cashbook as never, depotCash, depots as never);
  });

  const openShift = () =>
    service.open({ depotId: DEPOT, openingFloat: 200_000 }, { id: CASHIER.id, name: '0812' });

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
