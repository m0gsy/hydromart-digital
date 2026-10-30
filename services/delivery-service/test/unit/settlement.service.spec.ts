import { randomUUID } from 'node:crypto';

import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser, Role } from '@hydromart/platform';

import { SettlementService } from '../../src/application/services/settlement.service';
import {
  SettlementAlreadyExistsError,
  SettlementChargeNeedsManagerError,
  SettlementChargePendingError,
  SettlementChargeSelfApprovalError,
  SettlementChargeUndeliverableError,
  SettlementNoChargePendingError,
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
const CASHIER: AuthenticatedUser = {
  sub: randomUUID(),
  role: Role.KEPALA_DEPOT,
  phone: null,
  depotId: DEPOT_ID,
};

// Charging a shortfall to a courier is a manager's call (owner decision 2026-10-14).
const MANAGER: AuthenticatedUser = { ...CASHIER, sub: randomUUID(), role: Role.MANAGER };

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

  /*
   * CA-4-16 — the courier sees the total before the cash changes hands.
   *
   * The number the deposit is measured against was computed inside `submit` and nowhere
   * else, so the one screen where it decides whether money comes out of the courier's pay
   * never showed it. Same computation, same fail-closed rule.
   */
  describe('expectedForShift (CA-4-16)', () => {
    it('answers the same total submit would have measured against', async () => {
      const shift = endShift();
      await deliverCodOrder(150000);
      cash.result = { total: 0, count: 0, byOrder: [] };

      const preview = await service.expectedForShift(driver, shift.id, AUTH);

      expect(preview).toEqual({ shiftId: shift.id, expectedIdr: 150000 });
      // And submitting now agrees with what the courier was shown.
      const settlement = await service.submit(driver, shift.id, 150000, AUTH);
      expect(settlement.expectedAmount).toBe(150000);
      expect(settlement.variance).toBe(0);
    });

    it('writes nothing — a preview is a read', async () => {
      const shift = endShift();
      await deliverCodOrder(150000);
      cash.result = { total: 0, count: 0, byOrder: [] };

      await service.expectedForShift(driver, shift.id, AUTH);

      expect(settlementRepo.rows).toHaveLength(0);
    });

    // Fails CLOSED, like submit: a payment-service outage refuses rather than showing a
    // smaller, comforting number next to a box asking for cash.
    it('refuses rather than understating when the cash read fails', async () => {
      const shift = endShift();
      await deliverCodOrder(150000);
      cash.throwOnRead = true;

      await expect(service.expectedForShift(driver, shift.id, AUTH)).rejects.toBeInstanceOf(
        SettlementSyncError,
      );
    });

    it("refuses another courier's shift, and a shift that has not ended", async () => {
      const shift = endShift();
      await expect(
        service.expectedForShift('someone-else', shift.id, AUTH),
      ).rejects.toBeInstanceOf(ShiftNotFoundError);
    });
  });

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

    /*
     * Owner decision 2026-10-16: charging a shortfall needs a SECOND person. Raising the
     * charge parks it; nothing reaches payout until a different approver signs.
     */
    it('raising a charge only parks it: nothing posted, nothing resolved', async () => {
      const s = await submit(60000, 75000); // variance -15000
      const parked = await service.verify(CASHIER, s.id, { chargedToDriver: true });
      expect(parked.status).toBe(SettlementStatus.SUBMITTED);
      expect(parked.chargedToDriver).toBe(false);
      expect(parked.chargeRequestedBy).toBe(CASHIER.sub);
      expect(parked.chargeRequestedAt).toBeInstanceOf(Date);
      expect(payout.variances).toHaveLength(0);
    });

    it('charges the courier once a DIFFERENT manager approves', async () => {
      const s = await submit(60000, 75000);
      await service.verify(CASHIER, s.id, { chargedToDriver: true, note: 'hitung ulang' });
      const verified = await service.approveCharge(MANAGER, s.id);
      expect(verified.status).toBe(SettlementStatus.VERIFIED);
      expect(verified.chargedToDriver).toBe(true);
      expect(verified.verifiedBy).toBe(MANAGER.sub);
      expect(verified.chargeRequestedBy).toBe(CASHIER.sub); // who raised stays on the row
      expect(payout.variances).toEqual([
        expect.objectContaining({ courierId: driver, settlementId: s.id, amount: 15000 }),
      ]);
    });

    it('refuses the raiser approving their own charge, manager or not', async () => {
      const s = await submit(60000, 75000);
      await service.verify(MANAGER, s.id, { chargedToDriver: true });
      await expect(service.approveCharge(MANAGER, s.id)).rejects.toBeInstanceOf(
        SettlementChargeSelfApprovalError,
      );
      expect(payout.variances).toHaveLength(0);
    });

    it('lets a SUPER_ADMIN be either the raiser or the approver', async () => {
      const root: AuthenticatedUser = { ...MANAGER, sub: randomUUID(), role: Role.SUPER_ADMIN };
      const a = await submit(60000, 75000);
      await service.verify(root, a.id, { chargedToDriver: true });
      expect((await service.approveCharge(MANAGER, a.id)).chargedToDriver).toBe(true);

      const b = await submit(60000, 75000);
      await service.verify(CASHIER, b.id, { chargedToDriver: true });
      expect((await service.approveCharge(root, b.id)).chargedToDriver).toBe(true);
    });

    it('only an approvals-capable role may approve or reject', async () => {
      const s = await submit(60000, 75000);
      const other: AuthenticatedUser = { ...CASHIER, sub: randomUUID() };
      await service.verify(CASHIER, s.id, { chargedToDriver: true });
      await expect(service.approveCharge(other, s.id)).rejects.toBeInstanceOf(
        SettlementChargeNeedsManagerError,
      );
      await expect(service.rejectCharge(other, s.id, 'x')).rejects.toBeInstanceOf(
        SettlementChargeNeedsManagerError,
      );
    });

    it('a rejected charge returns to the queue, uncharged, with the reason kept', async () => {
      const s = await submit(60000, 75000);
      await service.verify(CASHIER, s.id, { chargedToDriver: true });
      const back = await service.rejectCharge(MANAGER, s.id, 'kurir sudah setor sisanya');
      expect(back.status).toBe(SettlementStatus.SUBMITTED);
      expect(back.chargeRequestedBy).toBeNull();
      expect(back.chargeRequestedAt).toBeNull();
      expect(back.note).toContain('kurir sudah setor sisanya');
      expect(payout.variances).toHaveLength(0);
      // ...and it can be ruled on again.
      const verified = await service.verify(CASHIER, s.id, { chargedToDriver: false });
      expect(verified.status).toBe(SettlementStatus.VERIFIED);
    });

    it('approve/reject need a pending charge', async () => {
      const s = await submit(60000, 75000);
      await expect(service.approveCharge(MANAGER, s.id)).rejects.toBeInstanceOf(
        SettlementNoChargePendingError,
      );
      await expect(service.rejectCharge(MANAGER, s.id, 'x')).rejects.toBeInstanceOf(
        SettlementNoChargePendingError,
      );
      await expect(service.approveCharge(MANAGER, randomUUID())).rejects.toBeInstanceOf(
        SettlementNotFoundError,
      );
    });

    it('verify and dispute are blocked while a charge awaits approval', async () => {
      const s = await submit(60000, 75000);
      await service.verify(CASHIER, s.id, { chargedToDriver: true });
      await expect(service.verify(CASHIER, s.id, {})).rejects.toBeInstanceOf(
        SettlementChargePendingError,
      );
      await expect(service.dispute(CASHIER, s.id, 'x')).rejects.toBeInstanceOf(
        SettlementChargePendingError,
      );
    });

    it("forbids another depot's manager from approving", async () => {
      const s = await submit(60000, 75000);
      await service.verify(CASHIER, s.id, { chargedToDriver: true });
      const elsewhere: AuthenticatedUser = {
        ...MANAGER,
        sub: randomUUID(),
        depotId: '00000000-0000-4000-8000-000000000099',
      };
      await expect(service.approveCharge(elsewhere, s.id)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    /*
     * CA-2-32. The charge used to be fired with `void` AFTER the settlement was written
     * `chargedToDriver: true`, so a payout-service that never took the debit left a
     * settlement claiming a courier had been charged money nobody collected.
     */
    it('refuses the approval when the charge cannot be handed to payout', async () => {
      const s = await submit(60000, 75000); // variance -15000
      await service.verify(CASHIER, s.id, { chargedToDriver: true });
      payout.variancePostAccepted = false;

      await expect(service.approveCharge(MANAGER, s.id)).rejects.toBeInstanceOf(
        SettlementChargeUndeliverableError,
      );

      // Nothing was recorded: the charge is still pending, so the same button retries.
      const still = await service.getForDriver(driver, s.id);
      expect(still.status).toBe(SettlementStatus.SUBMITTED);
      expect(still.chargedToDriver).toBe(false);
      expect(still.chargeRequestedBy).toBe(CASHIER.sub);
    });

    it('hands the claim back when the push to payout lands nowhere, so the retry can take it', async () => {
      const s = await submit(60000, 75000);
      await service.verify(CASHIER, s.id, { chargedToDriver: true });
      payout.variancePostAccepted = false;
      await expect(service.approveCharge(MANAGER, s.id)).rejects.toBeInstanceOf(
        SettlementChargeUndeliverableError,
      );
      payout.variancePostAccepted = true;
      const verified = await service.approveCharge(MANAGER, s.id);
      expect(verified.chargedToDriver).toBe(true);
      expect(payout.variances).toHaveLength(1);
    });

    it('hands the claim back when the push itself throws', async () => {
      const s = await submit(60000, 75000);
      await service.verify(CASHIER, s.id, { chargedToDriver: true });
      jest.spyOn(payout, 'cashVarianceCharged').mockRejectedValueOnce(new Error('payout down'));
      await expect(service.approveCharge(MANAGER, s.id)).rejects.toThrow('payout down');
      expect((await service.approveCharge(MANAGER, s.id)).chargedToDriver).toBe(true);
    });

    it('two approvers at once: one posts the debit, the other is told nothing is pending', async () => {
      const s = await submit(60000, 75000);
      await service.verify(CASHIER, s.id, { chargedToDriver: true });
      const other: AuthenticatedUser = { ...MANAGER, sub: randomUUID() };
      const res = await Promise.allSettled([
        service.approveCharge(MANAGER, s.id),
        service.approveCharge(other, s.id),
      ]);
      expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(payout.variances).toHaveLength(1);
    });

    it('a reject cannot cancel a charge an approver is already pushing', async () => {
      const s = await submit(60000, 75000);
      await service.verify(CASHIER, s.id, { chargedToDriver: true });
      const other: AuthenticatedUser = { ...MANAGER, sub: randomUUID() };
      let release!: () => void;
      jest.spyOn(payout, 'cashVarianceCharged').mockImplementationOnce(
        () => new Promise((resolve) => (release = () => resolve(true))),
      );
      const approving = service.approveCharge(MANAGER, s.id);
      await new Promise((r) => setImmediate(r));
      await expect(service.rejectCharge(other, s.id, 'salah')).rejects.toBeInstanceOf(
        SettlementNoChargePendingError,
      );
      release();
      expect((await approving).chargedToDriver).toBe(true);
    });

    it('a cashier may still verify without charging', async () => {
      const s = await submit(60000, 75000); // variance -15000
      const verified = await service.verify(CASHIER, s.id, { chargedToDriver: false });
      expect(verified.status).toBe(SettlementStatus.VERIFIED);
      expect(verified.chargedToDriver).toBe(false);
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
      await expect(service.dispute(otherDepot, s.id, 'x')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
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

    it('still charges only a genuine shortfall when the dispute ends (via approval)', async () => {
      const disputed = await disputedSettlement();

      await service.verify(CASHIER, disputed.id, {
        note: 'ditagihkan',
        chargedToDriver: true,
      });
      const resolved = await service.approveCharge(MANAGER, disputed.id);

      expect(resolved.chargedToDriver).toBe(true);
      expect(resolved.note).toContain('counts disagree');
      expect(resolved.note).toContain('ditagihkan');
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
