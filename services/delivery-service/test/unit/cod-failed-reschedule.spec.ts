import { randomUUID } from 'node:crypto';

import { SettlementService } from '../../src/application/services/settlement.service';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { ShiftStatus } from '../../src/domain/shift';
import {
  FakeCashCollection,
  FakeCourierPayout,
  InMemoryDeliveryRepository,
  InMemorySettlementRepository,
  InMemoryShiftRepository,
} from '../support/fakes';

/**
 * CA-4-03 — cash the courier already collected must not vanish from the deposit because
 * the delivery ended as Gagal or Jadwal-ulang.
 *
 * The settlement used to read `status = DELIVERED` only. A courier can take the money at
 * the door and only then find the goods are wrong, or agree a new slot; both endings are
 * reachable from ON_DELIVERY. The row then failed the filter entirely, so the end-of-shift
 * expectation did not mention the money at all — no shortfall, no dispute, no trace.
 *
 * Every case below is red if `codBearingInWindow` goes back to selecting DELIVERED, and the
 * asymmetry cases are red if `owedFor` starts treating the three endings alike.
 */
describe('CA-4-03 — collected cash survives a failed or rescheduled delivery', () => {
  const DEPOT_ID = '00000000-0000-4000-8000-000000000001';
  const AUTH = 'Bearer courier-token';
  const driver = randomUUID();

  let settlementRepo: InMemorySettlementRepository;
  let shiftRepo: InMemoryShiftRepository;
  let deliveryRepo: InMemoryDeliveryRepository;
  let cash: FakeCashCollection;
  let service: SettlementService;

  beforeEach(() => {
    settlementRepo = new InMemorySettlementRepository();
    shiftRepo = new InMemoryShiftRepository();
    deliveryRepo = new InMemoryDeliveryRepository();
    cash = new FakeCashCollection();
    service = new SettlementService(
      settlementRepo,
      shiftRepo,
      deliveryRepo,
      cash,
      new FakeCourierPayout(),
      { settlementExpectFromCod: () => true } as never,
    );
  });

  const endShift = () => {
    const shift = {
      id: randomUUID(),
      driverId: driver,
      depotId: DEPOT_ID,
      status: ShiftStatus.ENDED,
      checkInAt: new Date(0),
      checkInLat: 0,
      checkInLng: 0,
      expectedEndAt: new Date(1),
      checkOutAt: new Date(8_640_000_000_000),
      checkOutLat: 0,
      checkOutLng: 0,
      breakSecondsUsed: 0,
      breakStartedAt: null,
    };
    shiftRepo.rows.push(shift);
    return shift;
  };

  /** A delivery this courier closed as `ending`, carrying `codAmount` at assignment. */
  const closeAs = async (ending: DeliveryStatus, codAmount: number | null) => {
    const d = await deliveryRepo.create({
      orderId: randomUUID(),
      orderNumber: 'ORD-COD',
      driverId: driver,
      depotId: DEPOT_ID,
      destinationAddress: 'x',
      destinationLat: null,
      destinationLng: null,
      recipientPhone: null,
      items: null,
      codAmount,
      notes: null,
    });
    const stamp =
      ending === DeliveryStatus.DELIVERED
        ? { deliveredAt: new Date() }
        : ending === DeliveryStatus.FAILED
          ? { failedAt: new Date() }
          : // RESCHEDULED writes no completion column of its own — the anchor is the
            // status-history row, and `rescheduledFor` is the FUTURE slot, not this moment.
            { rescheduledFor: new Date(9_000_000_000_000) };
    await deliveryRepo.applyStatus(d.id, DeliveryStatus.ASSIGNED, ending, stamp, driver, null);
    return d.orderId;
  };

  /** payment-service reports this much CASH still PAID against these orders. */
  const stillPaid = (byOrder: { orderId: string; amountIdr: number }[]) => {
    cash.result = {
      total: byOrder.reduce((s, r) => s + r.amountIdr, 0),
      count: byOrder.length,
      byOrder,
    };
  };

  it('asks for cash the courier collected on a delivery that then FAILED', async () => {
    const shift = endShift();
    const orderId = await closeAs(DeliveryStatus.FAILED, 90_000);
    stillPaid([{ orderId, amountIdr: 90_000 }]);

    const settlement = await service.submit(driver, shift.id, 0, AUTH);

    // Before the fix this was 0: the row was not DELIVERED, so it never reached the
    // payment read at all and the courier deposited nothing against real money.
    expect(settlement.expectedAmount).toBe(90_000);
    expect(settlement.orderIds).toContain(orderId);
  });

  it('asks for cash the courier collected on a delivery that was then RESCHEDULED', async () => {
    const shift = endShift();
    const orderId = await closeAs(DeliveryStatus.RESCHEDULED, 75_000);
    stillPaid([{ orderId, amountIdr: 75_000 }]);

    const settlement = await service.submit(driver, shift.id, 0, AUTH);

    expect(settlement.expectedAmount).toBe(75_000);
    expect(settlement.orderIds).toContain(orderId);
  });

  /*
   * The other half of the asymmetry, and the one a careless fix breaks.
   *
   * A DELIVERED order owes its COD whether or not the courier confirmed the payment (C1) —
   * the goods left the van. A FAILED one owes NOTHING by default: nothing was handed over.
   * Charging `codAmount` there would invent a debt out of a delivery that never happened
   * and take it out of a courier's pay.
   */
  it('asks for NOTHING on a failed delivery whose cash was never collected', async () => {
    const shift = endShift();
    await closeAs(DeliveryStatus.FAILED, 120_000);
    stillPaid([]);

    const settlement = await service.submit(driver, shift.id, 0, AUTH);

    expect(settlement.expectedAmount).toBe(0);
  });

  it('still charges a DELIVERED order its COD when the payment was never confirmed', async () => {
    const shift = endShift();
    await closeAs(DeliveryStatus.DELIVERED, 150_000);
    stillPaid([]);

    const settlement = await service.submit(driver, shift.id, 0, AUTH);

    expect(settlement.expectedAmount).toBe(150_000);
  });

  it('adds up a mixed shift one delivery at a time', async () => {
    const shift = endShift();
    // Delivered, payment never confirmed -> owes its COD.
    await closeAs(DeliveryStatus.DELIVERED, 50_000);
    // Failed with the cash still in the courier's pocket -> owes what is still PAID.
    const failedHeld = await closeAs(DeliveryStatus.FAILED, 30_000);
    // Failed, nothing ever collected -> owes nothing, despite carrying a COD.
    await closeAs(DeliveryStatus.FAILED, 40_000);
    // Rescheduled, cash handed back at the door: the reversal already moved the payment
    // out of PAID, so payment-service no longer reports it and it owes nothing.
    await closeAs(DeliveryStatus.RESCHEDULED, 60_000);
    stillPaid([{ orderId: failedHeld, amountIdr: 30_000 }]);

    const settlement = await service.submit(driver, shift.id, 0, AUTH);

    expect(settlement.expectedAmount).toBe(80_000);
  });

  it('ignores a delivery closed outside the shift window', async () => {
    const shift = endShift();
    const orderId = await closeAs(DeliveryStatus.FAILED, 90_000);
    // Move the failure a day past check-out. The deposit is for THIS shift.
    const row = deliveryRepo.rows.find((r) => r.orderId === orderId)!;
    row.failedAt = new Date(shift.checkOutAt!.getTime() + 86_400_000);
    stillPaid([{ orderId, amountIdr: 90_000 }]);

    const settlement = await service.submit(driver, shift.id, 0, AUTH);

    expect(settlement.expectedAmount).toBe(0);
    expect(settlement.orderIds).not.toContain(orderId);
  });
});
