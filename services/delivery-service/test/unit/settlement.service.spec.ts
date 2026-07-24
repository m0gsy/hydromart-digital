import { randomUUID } from 'node:crypto';

import { ForbiddenException } from '@nestjs/common';
import { AuthenticatedUser, Role } from '@hydromart/platform';

import { SettlementService } from '../../src/application/services/settlement.service';
import {
  SettlementAlreadyExistsError,
  SettlementNotFoundError,
  SettlementNotSubmittedError,
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
const CASHIER: AuthenticatedUser = { sub: randomUUID(), role: Role.DEPOT_OPERATOR, phone: null, depotId: DEPOT_ID };

describe('SettlementService', () => {
  let settlementRepo: InMemorySettlementRepository;
  let shiftRepo: InMemoryShiftRepository;
  let deliveryRepo: InMemoryDeliveryRepository;
  let cash: FakeCashCollection;
  let payout: FakeCourierPayout;
  let service: SettlementService;
  const driver = randomUUID();

  beforeEach(() => {
    settlementRepo = new InMemorySettlementRepository();
    shiftRepo = new InMemoryShiftRepository();
    deliveryRepo = new InMemoryDeliveryRepository();
    cash = new FakeCashCollection();
    payout = new FakeCourierPayout();
    service = new SettlementService(settlementRepo, shiftRepo, deliveryRepo, cash, payout);
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
    await deliveryRepo.applyStatus(d.id, DeliveryStatus.DELIVERED, { deliveredAt: new Date() }, driverId, null);
    return d.orderId;
  };

  describe('submit', () => {
    it('snapshots the PAID-cash total and computes the variance', async () => {
      const shift = endShift();
      await deliverOrder();
      await deliverOrder();
      cash.result = { total: 75000, count: 2 };

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
      cash.result = { total: 0, count: 0 };
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
    const submit = async (deposited: number, total: number) => {
      const shift = endShift();
      cash.result = { total, count: 1 };
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

    it('never charges when the deposit covers the expected total', async () => {
      const s = await submit(75000, 75000); // variance 0
      const verified = await service.verify(CASHIER, s.id, { chargedToDriver: true });
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
        role: Role.DEPOT_OPERATOR,
        phone: null,
        depotId: '00000000-0000-4000-8000-000000000099',
      };
      await expect(service.verify(otherDepot, s.id, {})).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.dispute(otherDepot, s.id, 'x')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('disputes a submitted settlement', async () => {
    const shift = endShift();
    cash.result = { total: 50000, count: 1 };
    const s = await service.submit(driver, shift.id, 40000, AUTH);
    const disputed = await service.dispute(CASHIER, s.id, 'counts disagree');
    expect(disputed.status).toBe(SettlementStatus.DISPUTED);
    expect(disputed.note).toBe('counts disagree');
  });

  it("hides another courier's settlement from getForDriver", async () => {
    const shift = endShift();
    cash.result = { total: 0, count: 0 };
    const s = await service.submit(driver, shift.id, 0, AUTH);
    await expect(service.getForDriver(randomUUID(), s.id)).rejects.toBeInstanceOf(
      SettlementNotFoundError,
    );
  });
});
