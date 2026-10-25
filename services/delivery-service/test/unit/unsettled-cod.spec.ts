import { randomUUID } from 'node:crypto';

import { DeliveryStatus } from '../../src/domain/delivery-status';
import {
  SettlementService,
  UNSETTLED_DAYS,
} from '../../src/application/services/settlement.service';
import { SettlementController } from '../../src/modules/settlement.controller';
import {
  FakeCashCollection,
  FakeCourierPayout,
  InMemoryDeliveryRepository,
  InMemorySettlementRepository,
  InMemoryShiftRepository,
} from '../support/fakes';

/**
 * The COD couriers delivered and no settlement covers yet. "Not covered" is the only test: a
 * delivery stops counting the moment ANY settlement lists its order, whatever that settlement's
 * status, because from then on the cashier chases the money, not the courier.
 */
const DEPOT = '00000000-0000-4000-8000-000000000001';
const NOW = new Date('2026-10-25T05:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('SettlementService.unsettledCod', () => {
  let deliveries: InMemoryDeliveryRepository;
  let cash: FakeCashCollection;
  let service: SettlementService;
  const driverA = randomUUID();
  const driverB = randomUUID();

  beforeEach(() => {
    deliveries = new InMemoryDeliveryRepository();
    cash = new FakeCashCollection();
    service = new SettlementService(
      new InMemorySettlementRepository(),
      new InMemoryShiftRepository(),
      deliveries,
      cash,
      new FakeCourierPayout(),
      { settlementExpectFromCod: () => true } as never,
    );
  });

  /** A delivery that ended `status`, with `cod` rupiah to collect, delivered `ago` days back. */
  const add = async (
    driverId: string,
    cod: number | null,
    ago: number,
    status: DeliveryStatus = DeliveryStatus.DELIVERED,
    depotId = DEPOT,
  ) => {
    const d = await deliveries.create({
      orderId: randomUUID(),
      orderNumber: 'ORD',
      driverId,
      depotId,
      destinationAddress: 'x',
      destinationLat: null,
      destinationLng: null,
      recipientPhone: null,
      items: null,
      codAmount: cod,
      notes: null,
    });
    await deliveries.applyStatus(
      d.id,
      DeliveryStatus.ASSIGNED,
      status,
      status === DeliveryStatus.DELIVERED ? { deliveredAt: days(ago) } : { failedAt: days(ago) },
      driverId,
      null,
    );
    return d;
  };

  it('totals delivered COD per courier, biggest first, with the oldest delivery', async () => {
    await add(driverA, 50_000, 2);
    await add(driverA, 30_000, 5);
    await add(driverB, 100_000, 1);
    const out = await service.unsettledCod(DEPOT, '', NOW);
    expect(out.amountIdr).toBe(180_000);
    expect(out.deliveries).toBe(3);
    expect(out.couriers.map((c) => [c.driverId, c.amountIdr, c.deliveries])).toEqual([
      [driverB, 100_000, 1],
      [driverA, 80_000, 2],
    ]);
    expect(out.couriers[1]!.oldestDeliveredAt).toBe(days(5).toISOString());
  });

  it('stops counting a delivery once any settlement lists its order', async () => {
    const settled = await add(driverA, 40_000, 3);
    await add(driverA, 10_000, 1);
    deliveries.settledOrderIds.add(settled.orderId);
    const out = await service.unsettledCod(DEPOT, '', NOW);
    expect(out.amountIdr).toBe(10_000);
    expect(out.deliveries).toBe(1);
  });

  it('leaves out what is not delivered cash-on-delivery in this depot and window', async () => {
    await add(driverA, null, 1); // no COD recorded
    await add(driverA, 0, 1); // zero COD
    await add(driverA, 70_000, 1, DeliveryStatus.FAILED); // never delivered
    await add(driverA, 70_000, 1, DeliveryStatus.DELIVERED, randomUUID()); // another depot
    await add(driverA, 70_000, UNSETTLED_DAYS + 1); // older than the window
    const out = await service.unsettledCod(DEPOT, '', NOW);
    expect(out).toMatchObject({ amountIdr: 0, deliveries: 0, couriers: [] });
  });

  it('says how far back it looked', async () => {
    const out = await service.unsettledCod(DEPOT, '', NOW);
    expect(out.since).toBe(days(UNSETTLED_DAYS).toISOString());
  });

  it('looks back from now when no clock is given', async () => {
    const out = await service.unsettledCod(DEPOT);
    expect(Date.parse(out.since)).toBeLessThan(Date.now() - (UNSETTLED_DAYS - 1) * 86_400_000);
  });

  describe('cash taken on deliveries handed back unfinished', () => {
    it('adds the PAID cash payment-service still reports, per courier, and says it was read', async () => {
      await add(driverA, 50_000, 2);
      const failed = await add(driverA, 70_000, 1, DeliveryStatus.FAILED);
      const other = await add(driverB, 20_000, 1, DeliveryStatus.FAILED);
      const resched = await add(driverB, null, 1, DeliveryStatus.RESCHEDULED);
      cash.result = {
        total: 130_000,
        count: 3,
        byOrder: [
          { orderId: failed.orderId, amountIdr: 70_000 },
          { orderId: other.orderId, amountIdr: 20_000 },
          { orderId: resched.orderId, amountIdr: 40_000 },
        ],
      };
      const out = await service.unsettledCod(DEPOT, 'Bearer x', NOW);
      expect(out.failedCashSource).toBe('ok');
      expect(out.failedCashIdr).toBe(130_000);
      expect(out.amountIdr).toBe(180_000);
      const a = out.couriers.find((c) => c.driverId === driverA)!;
      expect(a).toMatchObject({ amountIdr: 120_000, failedCashIdr: 70_000, deliveries: 2 });
      const b = out.couriers.find((c) => c.driverId === driverB)!;
      expect(b).toMatchObject({ amountIdr: 60_000, failedCashIdr: 60_000, deliveries: 2 });
      expect(cash.calls[0]!.authorization).toBe('Bearer x');
    });

    it('counts nothing for a handed-back delivery whose cash was returned at the door', async () => {
      await add(driverA, 50_000, 2);
      await add(driverA, 70_000, 1, DeliveryStatus.FAILED);
      cash.result = { total: 0, count: 0, byOrder: [] }; // the payment went REFUNDED: not PAID
      const out = await service.unsettledCod(DEPOT, '', NOW);
      expect(out.failedCashIdr).toBe(0);
      expect(out.failedCashSource).toBe('ok');
      expect(out.amountIdr).toBe(50_000);
    });

    it('is a courier with only handed-back cash: listed, with that cash alone', async () => {
      const failed = await add(driverB, null, 1, DeliveryStatus.FAILED);
      cash.result = {
        total: 9_000,
        count: 1,
        byOrder: [{ orderId: failed.orderId, amountIdr: 9_000 }],
      };
      const out = await service.unsettledCod(DEPOT, '', NOW);
      expect(out.couriers).toHaveLength(1);
      expect(out.couriers[0]).toMatchObject({
        driverId: driverB,
        amountIdr: 9_000,
        failedCashIdr: 9_000,
      });
    });

    it("keeps the oldest of the two halves as the courier's oldest", async () => {
      await add(driverA, 50_000, 2);
      const failed = await add(driverA, null, 6, DeliveryStatus.FAILED);
      // The handed-back time the SQL reads is the row's updatedAt.
      deliveries.rows.find((r) => r.id === failed.id)!.updatedAt = days(6);
      cash.result = {
        total: 5_000,
        count: 1,
        byOrder: [{ orderId: failed.orderId, amountIdr: 5_000 }],
      };
      const out = await service.unsettledCod(DEPOT, '', NOW);
      expect(Date.parse(out.couriers[0]!.oldestDeliveredAt)).toBe(days(6).getTime());
    });

    it('says the second half could not be read, and still reports the first, when payment-service is down', async () => {
      await add(driverA, 50_000, 2);
      await add(driverA, 70_000, 1, DeliveryStatus.FAILED);
      cash.throwOnRead = true;
      const out = await service.unsettledCod(DEPOT, '', NOW);
      expect(out.failedCashSource).toBe('unavailable');
      expect(out.failedCashIdr).toBe(0);
      expect(out.amountIdr).toBe(50_000);
    });

    it('does not call payment-service when nothing was handed back', async () => {
      await add(driverA, 50_000, 2);
      await service.unsettledCod(DEPOT, '', NOW);
      expect(cash.calls).toHaveLength(0);
    });

    it('leaves a handed-back delivery that a settlement already lists out of the probe', async () => {
      const failed = await add(driverA, 70_000, 1, DeliveryStatus.FAILED);
      deliveries.settledOrderIds.add(failed.orderId);
      await service.unsettledCod(DEPOT, '', NOW);
      expect(cash.calls).toHaveLength(0);
    });
  });

  it('breaks an amount tie by courier so the order never flips between loads', async () => {
    const first = randomUUID();
    const second = randomUUID();
    await add(second, 5_000, 1);
    await add(first, 5_000, 1);
    const out = await service.unsettledCod(DEPOT, '', NOW);
    expect(out.couriers.map((c) => c.driverId)).toEqual([first, second].sort());
  });
});

describe('SettlementController.unsettled', () => {
  it('reads the depot it was asked for', async () => {
    const unsettledCod = jest.fn().mockResolvedValue('report');
    const controller = new SettlementController({ unsettledCod } as never);
    await expect(controller.unsettled({ depotId: DEPOT }, 'Bearer t')).resolves.toBe('report');
    expect(unsettledCod).toHaveBeenCalledWith(DEPOT, 'Bearer t');
    await controller.unsettled({ depotId: DEPOT });
    expect(unsettledCod).toHaveBeenLastCalledWith(DEPOT, '');
  });
});
