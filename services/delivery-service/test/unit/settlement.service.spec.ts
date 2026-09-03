import { randomUUID } from 'node:crypto';

import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser, Role } from '@hydromart/platform';

import { SettlementService } from '../../src/application/services/settlement.service';
import {
  SettlementAlreadyExistsError,
  SettlementChargeUndeliverableError,
  SettlementNotFoundError,
  SettlementNotSubmittedError,
  SettlementSurplusNoteRequiredError,
  SettlementSyncError,
  ShiftNotEndedError,
  ShiftNotFoundError,
} from '../../src/domain/errors';
import { SettlementStatus } from '../../src/domain/settlement';
import { ShiftStatus } from '../../src/domain/shift';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import {
  FakeCashCollection,
  FakeCourierPayout,
  InMemoryDeliveryRepository,
  InMemorySettlementRepository,
  InMemoryShiftRepository,
} from '../support/fakes';

const DEPOT_ID = '00000000-0000-4000-8000-000000000001';
const AUTH = 'Bearer courier-token';
// Cashier at the settlement's own depot (passes assertDepotAccess).
const CASHIER: AuthenticatedUser = { sub: randomUUID(), role: Role.KEPALA_DEPOT, phone: null, depotId: DEPOT_ID };

describe('SettlementService', () => {
  let settlementRepo: InMemorySettlementRepository;
  let shiftRepo: InMemoryShiftRepository;
  let deliveryRepo: InMemoryDeliveryRepository;
  let cash: FakeCashCollection;
  let payout: FakeCourierPayout;
  let service: SettlementService;
  // C1 kill switch, flipped per test. Only this one getter is read here.
  let expectFromCod: boolean;
  const driver = randomUUID();

  beforeEach(() => {
    settlementRepo = new InMemorySettlementRepository();
    shiftRepo = new InMemoryShiftRepository();
    deliveryRepo = new InMemoryDeliveryRepository();
    cash = new FakeCashCollection();
    payout = new FakeCourierPayout();
    expectFromCod = true;
    service = new SettlementService(settlementRepo, shiftRepo, deliveryRepo, cash, payout, {
      settlementExpectFromCod: () => expectFromCod,
    } as never);
  });

  // An ended shift with a window wide enough to hold every delivery made in the test.
  const endShift = (status = ShiftStatus.ENDED, driverId = driver) => {
    const shift = {
      id: randomUUID(),
      driverId,
      depotId: DEPOT_ID,
      status,
      checkInAt: new Date(0),
      checkInLat: 0,
      checkInLng: 0,
      expectedEndAt: new Date(1),
      checkOutAt: status === ShiftStatus.ENDED ? new Date(8_640_000_000_000) : null,
      checkOutLat: 0,
      checkOutLng: 0,
      breakSecondsUsed: 0,
      breakStartedAt: null,
    };
    shiftRepo.rows.push(shift);
    return shift;
  };

  const deliverOrder = async (driverId = driver) => {
    const d = await deliveryRepo.create({
      orderId: randomUUID(),
      orderNumber: 'ORD-1',
      driverId,
      depotId: DEPOT_ID,
      destinationAddress: 'x',
      destinationLat: null,
      destinationLng: null,
      recipientPhone: null,
      items: null,
      codAmount: null,
      notes: null,
    });
    await deliveryRepo.applyStatus(
      d.id,
      DeliveryStatus.ASSIGNED,
      DeliveryStatus.DELIVERED,
      { deliveredAt: new Date() },
      driverId,
      null,
    );
    return d.orderId;
  };

  /*
   * C1. A COD delivery the courier closed with proof of delivery but never confirmed
   * the payment for. `codAmount` is on the delivery row; payment-service still says
   * PENDING, so the PAID-cash read answers zero — and the deposit the courier owes has
   * to come from the delivery row, not from the payment book.
   */
  const deliverCodOrder = async (codAmount: number, driverId = driver) => {
    const d = await deliveryRepo.create({
      orderId: randomUUID(),
      orderNumber: 'ORD-COD',
      driverId,
      depotId: DEPOT_ID,
      destinationAddress: 'x',
      destinationLat: null,
      destinationLng: null,
      recipientPhone: null,
      items: null,
      codAmount,
      notes: null,
    });
    await deliveryRepo.applyStatus(
      d.id,
      DeliveryStatus.ASSIGNED,
      DeliveryStatus.DELIVERED,
      { deliveredAt: new Date() },
      driverId,
      null,
    );
    return d.orderId;
  };

  describe('submit', () => {
    // C1, the leak itself: proof of delivery does not touch the payment, so a courier who
    // collects the cash and skips "Terima uang" used to settle against an expected of zero.
    it('expects the COD amount even when the payment was never confirmed', async () => {
      const shift = endShift();
      await deliverCodOrder(150000);
      cash.result = { total: 0, count: 0, byOrder: [] };

      const settlement = await service.submit(driver, shift.id, 0, AUTH);

      expect(settlement.expectedAmount).toBe(150000);
      expect(settlement.variance).toBe(-150000);
    });

    /*
     * Why the max is taken PER ORDER and not over the two totals. One unconfirmed COD of
     * 150k plus one confirmed cash payment of 200k on a different order: the courier is
     * holding 350k. `max(sum cod, sum paid)` would answer 200k and lose the whole COD.
     */
    it('adds an unconfirmed COD to cash PAID on a different order', async () => {
      const shift = endShift();
      await deliverCodOrder(150000);
      const prepaid = await deliverOrder();
      cash.result = { total: 200000, count: 1, byOrder: [{ orderId: prepaid, amountIdr: 200000 }] };

      const settlement = await service.submit(driver, shift.id, 0, AUTH);

      expect(settlement.expectedAmount).toBe(350000);
    });

    // A confirmed COD is counted once, not twice: the two sources agree on that order.
    it('does not double-count a COD the courier did confirm', async () => {
      const shift = endShift();
      const orderId = await deliverCodOrder(150000);
      cash.result = { total: 150000, count: 1, byOrder: [{ orderId, amountIdr: 150000 }] };

      const settlement = await service.submit(driver, shift.id, 150000, AUTH);

      expect(settlement.expectedAmount).toBe(150000);
      expect(settlement.variance).toBe(0);
    });

    // The kill switch, proven to actually reverse the behaviour rather than merely exist.
    it('falls back to summing PAID cash alone when settlementExpectFromCod is off', async () => {
      expectFromCod = false;
      const shift = endShift();
      await deliverCodOrder(150000);
      cash.result = { total: 0, count: 0, byOrder: [] };

      const settlement = await service.submit(driver, shift.id, 0, AUTH);

      expect(settlement.expectedAmount).toBe(0);
      expect(settlement.variance).toBe(0);
    });

    it('snapshots the PAID-cash total and computes the variance', async () => {
      const shift = endShift();
      const a = await deliverOrder();
      const b = await deliverOrder();
      cash.result = {
        total: 75000,
        count: 2,
        byOrder: [
          { orderId: a, amountIdr: 50000 },
          { orderId: b, amountIdr: 25000 },
        ],
      };

      const settlement = await service.submit(driver, shift.id, 60000, AUTH);

      expect(settlement).toMatchObject({
        status: SettlementStatus.SUBMITTED,
        expectedAmount: 75000,
        depositedAmount: 60000,
        variance: -15000,
        depotId: DEPOT_ID,
      });
      // Forwards the caller's bearer and every delivered order to payment-service.
      expect(cash.calls).toHaveLength(1);
      expect(cash.calls[0].authorization).toBe(AUTH);
      expect(cash.calls[0].orderIds).toHaveLength(2);
    });

    it("rejects a shift that is not this courier's", async () => {
      const other = endShift(ShiftStatus.ENDED, randomUUID());
      await expect(service.submit(driver, other.id, 1000, AUTH)).rejects.toBeInstanceOf(
        ShiftNotFoundError,
      );
    });

    it('rejects a shift that has not been checked out', async () => {
      const open = endShift(ShiftStatus.ONLINE);
      await expect(service.submit(driver, open.id, 1000, AUTH)).rejects.toBeInstanceOf(
        ShiftNotEndedError,
      );
    });

    it('rejects settling the same shift twice', async () => {
      const shift = endShift();
      cash.result = { total: 0, count: 0, byOrder: [] };
      await service.submit(driver, shift.id, 0, AUTH);
      await expect(service.submit(driver, shift.id, 0, AUTH)).rejects.toBeInstanceOf(
        SettlementAlreadyExistsError,
      );
    });

    it('fails closed when payment-service is unreachable', async () => {
      const shift = endShift();
      cash.throwOnRead = true;
      await expect(service.submit(driver, shift.id, 1000, AUTH)).rejects.toBeInstanceOf(
        SettlementSyncError,
      );
      expect(settlementRepo.rows).toHaveLength(0);
    });
  });

  describe('verify', () => {
    // One confirmed COD delivery in the window: expected == `total`, the normal case.
    const submit = async (deposited: number, total: number) => {
      const shift = endShift();
      const orderId = await deliverCodOrder(total);
      cash.result = { total, count: 1, byOrder: [{ orderId, amountIdr: total }] };
      return service.submit(driver, shift.id, deposited, AUTH);
    };

    it('charges a shortfall to the courier only when asked', async () => {
      const s = await submit(60000, 75000); // variance -15000
      const verified = await service.verify(CASHIER, s.id, { chargedToDriver: true });
      expect(verified.status).toBe(SettlementStatus.VERIFIED);
      expect(verified.chargedToDriver).toBe(true);
      expect(verified.verifiedBy).not.toBeNull();
      // The shortfall is pushed to payout as a positive magnitude keyed by settlement id.
      expect(payout.variances).toEqual([
        expect.objectContaining({ courierId: driver, settlementId: s.id, amount: 15000 }),
      ]);
    });

    /*
     * CA-2-32. The charge used to be fired with `void` AFTER the settlement was written
     * `chargedToDriver: true`, so a payout-service that never took the debit left a
     * settlement claiming a courier had been charged money nobody collected.
     */
    it('refuses the verify when the charge cannot be handed to payout', async () => {
      const s = await submit(60000, 75000); // variance -15000
      payout.variancePostAccepted = false;

      await expect(
        service.verify(CASHIER, s.id, { chargedToDriver: true }),
      ).rejects.toBeInstanceOf(SettlementChargeUndeliverableError);

      // Nothing was recorded: the deposit is still awaiting a ruling, so the same
      // button retries it once payout is back.
      const still = await service.getForDriver(driver, s.id);
      expect(still.status).toBe(SettlementStatus.SUBMITTED);
      expect(still.chargedToDriver).toBe(false);
    });

    it('verifies without asking payout at all when nothing is charged', async () => {
      const s = await submit(60000, 75000);
      payout.variancePostAccepted = false;

      const verified = await service.verify(CASHIER, s.id, { chargedToDriver: false });

      expect(verified.status).toBe(SettlementStatus.VERIFIED);
      expect(verified.chargedToDriver).toBe(false);
    });

    it('never charges when the deposit covers the expected total', async () => {
      const s = await submit(75000, 75000); // variance 0
      const verified = await service.verify(CASHIER, s.id, { chargedToDriver: true });
      expect(verified.chargedToDriver).toBe(false);
      expect(payout.variances).toHaveLength(0);
    });

    /*
     * Surplus rule (C1). A courier cannot raise an order, so cash over the expected total
     * means goods left without one. Small change passes; anything real has to be written
     * down — and writing it down is all it is: a surplus stays uncharged either way.
     */
    it('lets a small surplus through with no note', async () => {
      const s = await submit(78000, 75000); // +3000
      const verified = await service.verify(CASHIER, s.id, {});
      expect(verified.status).toBe(SettlementStatus.VERIFIED);
    });

    it('refuses a surplus over the threshold with no note', async () => {
      const s = await submit(85000, 75000); // +10000
      await expect(service.verify(CASHIER, s.id, {})).rejects.toBeInstanceOf(
        SettlementSurplusNoteRequiredError,
      );
      await expect(service.verify(CASHIER, s.id, { note: '   ' })).rejects.toBeInstanceOf(
        SettlementSurplusNoteRequiredError,
      );
      // Refused, not resolved: the cashier can still rule on it after writing the note.
      expect((await service.getForDriver(driver, s.id)).status).toBe(SettlementStatus.SUBMITTED);
    });

    it('accepts the same surplus with a note, and still never charges it', async () => {
      const s = await submit(85000, 75000); // +10000
      const verified = await service.verify(CASHIER, s.id, {
        chargedToDriver: true,
        note: 'pelanggan menambah 1 galon di tempat',
      });
      expect(verified.status).toBe(SettlementStatus.VERIFIED);
      expect(verified.note).toBe('pelanggan menambah 1 galon di tempat');
      expect(verified.chargedToDriver).toBe(false);
      expect(payout.variances).toHaveLength(0);
    });

    it('rejects verifying an already-resolved settlement', async () => {
      const s = await submit(75000, 75000);
      await service.verify(CASHIER, s.id, {});
      await expect(service.verify(CASHIER, s.id, {})).rejects.toBeInstanceOf(
        SettlementNotSubmittedError,
      );
    });

    it("forbids a cashier from another depot resolving this depot's settlement", async () => {
      const s = await submit(75000, 75000);
      const otherDepot: AuthenticatedUser = {
        sub: randomUUID(),
        role: Role.KEPALA_DEPOT,
        phone: null,
        depotId: '00000000-0000-4000-8000-000000000099',
      };
      await expect(service.verify(otherDepot, s.id, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.dispute(otherDepot, s.id, 'x')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('disputes a submitted settlement', async () => {
    const shift = endShift();
    const orderId = await deliverCodOrder(50000);
    cash.result = { total: 50000, count: 1, byOrder: [{ orderId, amountIdr: 50000 }] };
    const s = await service.submit(driver, shift.id, 40000, AUTH);
    const disputed = await service.dispute(CASHIER, s.id, 'counts disagree');
    expect(disputed.status).toBe(SettlementStatus.DISPUTED);
    expect(disputed.note).toBe('counts disagree');
  });

  /**
   * C10 · DISPUTED used to be a one-way door.
   *
   * `dispute()` wrote it, `canResolve` accepted only SUBMITTED, and nothing anywhere writes
   * any other status — so a deposit parked "for offline resolution" could never be resolved.
   * The money hung there permanently and the courier's account never settled either way.
   * That is also why C1's surplus rule refuses to auto-dispute: throwing money in here was
   * throwing it away.
   */
  describe('C10 · a dispute can be resolved', () => {
    const disputedSettlement = async (deposited = 40000) => {
      const shift = endShift();
      const orderId = await deliverCodOrder(50000);
      cash.result = { total: 50000, count: 1, byOrder: [{ orderId, amountIdr: 50000 }] };
      const s = await service.submit(driver, shift.id, deposited, AUTH);
      return service.dispute(CASHIER, s.id, 'counts disagree');
    };

    it('verifies a settlement that was parked for investigation', async () => {
      const disputed = await disputedSettlement();

      const resolved = await service.verify(CASHIER, disputed.id, {
        note: 'kurir setor kekurangannya tunai',
      });

      expect(resolved.status).toBe(SettlementStatus.VERIFIED);
    });

    it('keeps WHY it was disputed next to HOW it ended', async () => {
      const disputed = await disputedSettlement();

      const resolved = await service.verify(CASHIER, disputed.id, { note: 'selisih ditemukan' });

      expect(resolved.note).toContain('counts disagree');
      expect(resolved.note).toContain('selisih ditemukan');
    });

    it('refuses to end a dispute silently, whatever the variance was', async () => {
      const disputed = await disputedSettlement();

      await expect(service.verify(CASHIER, disputed.id, {})).rejects.toBeInstanceOf(
        SettlementSurplusNoteRequiredError,
      );
    });

    it('still charges only a genuine shortfall when the dispute ends', async () => {
      const disputed = await disputedSettlement();

      const resolved = await service.verify(CASHIER, disputed.id, {
        note: 'ditagihkan',
        chargedToDriver: true,
      });

      expect(resolved.chargedToDriver).toBe(true);
    });

    it('never makes a surplus chargeable, dispute or not', async () => {
      const disputed = await disputedSettlement(60000);

      const resolved = await service.verify(CASHIER, disputed.id, {
        note: 'lebih, dicatat',
        chargedToDriver: true,
      });

      expect(resolved.chargedToDriver).toBe(false);
    });
  });

  it("hides another courier's settlement from getForDriver", async () => {
    const shift = endShift();
    cash.result = { total: 0, count: 0, byOrder: [] };
    const s = await service.submit(driver, shift.id, 0, AUTH);
    await expect(service.getForDriver(randomUUID(), s.id)).rejects.toBeInstanceOf(
      SettlementNotFoundError,
    );
  });
});
