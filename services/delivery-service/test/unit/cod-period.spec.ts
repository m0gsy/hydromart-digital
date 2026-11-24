import { randomUUID } from 'node:crypto';

import { SettlementService } from '../../src/application/services/settlement.service';
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { SettlementPrismaRepository } from '../../src/infrastructure/prisma/settlement.prisma.repository';
import { DeliveryPrismaRepository } from '../../src/infrastructure/prisma/delivery.prisma.repository';
import { SettlementController } from '../../src/modules/settlement.controller';
import {
  FakeCashCollection,
  FakeCourierPayout,
  InMemoryDeliveryRepository,
  InMemorySettlementRepository,
  InMemoryShiftRepository,
} from '../support/fakes';

/*
 * HD-6 H2: the COD of a period, three numbers plus the variance apart. Windows are instants, so a
 * delivery at 23:30 WIB on the last day is in and one at 00:10 WIB is out.
 */
const DEPOT = '11111111-1111-4111-8111-111111111111';
const FROM = new Date('2026-10-31T17:00:00.000Z');
const TO = new Date('2026-11-30T17:00:00.000Z');

describe('SettlementService.codPeriod', () => {
  it('reports deposited, expected, shortfall and surplus apart, and what is still undeposited', async () => {
    const settlements = new InMemorySettlementRepository();
    const deliveries = new InMemoryDeliveryRepository();
    const service = new SettlementService(settlements, new InMemoryShiftRepository(), deliveries, new FakeCashCollection(), new FakeCourierPayout(), {} as never);
    const verified = (expected: number, deposited: number, at: string) =>
      settlements.rows.push({
        id: randomUUID(),
        depotId: DEPOT,
        status: 'VERIFIED',
        verifiedAt: new Date(at),
        expectedAmount: expected,
        depositedAmount: deposited,
      } as never);
    verified(100_000, 90_000, '2026-11-10T03:00:00.000Z'); // short 10k
    verified(100_000, 105_000, '2026-11-11T03:00:00.000Z'); // over 5k
    verified(50_000, 50_000, '2026-11-12T03:00:00.000Z');
    verified(70_000, 10_000, '2026-11-30T17:10:00.000Z'); // 00:10 WIB next day: out
    const delivered = async (cod: number, at: string) => {
      const d = await deliveries.create({
        orderId: randomUUID(), orderNumber: 'HM-1', driverId: randomUUID(), depotId: DEPOT, destinationAddress: 'x',
        destinationLat: null, destinationLng: null, recipientPhone: null, items: null, codAmount: cod, notes: null,
      } as never);
      Object.assign(deliveries.rows.find((r) => r.id === d.id)!, { status: DeliveryStatus.DELIVERED, deliveredAt: new Date(at) });
      return d;
    };
    await delivered(30_000, '2026-11-30T16:30:00.000Z'); // 23:30 WIB last day: in
    await delivered(40_000, '2026-11-30T17:10:00.000Z'); // out
    const settled = await delivered(20_000, '2026-11-05T03:00:00.000Z');
    deliveries.settledOrderIds.add(settled.orderId);

    await expect(service.codPeriod(DEPOT, FROM, TO)).resolves.toEqual({
      depositedIdr: 245_000,
      expectedIdr: 250_000,
      shortfallIdr: 10_000,
      surplusIdr: 5_000,
      undepositedIdr: 30_000,
      undepositedDeliveries: 1,
    });
  });

  it('is served by the internal route', async () => {
    const codPeriod = jest.fn().mockResolvedValue({ ok: 1 });
    const controller = new SettlementController({ codPeriod } as never);
    await expect(controller.codPeriod({ depotId: DEPOT, from: FROM.toISOString(), to: TO.toISOString() } as never)).resolves.toEqual({ ok: 1 });
    expect(codPeriod).toHaveBeenCalledWith(DEPOT, FROM, TO);
  });
});

describe('the COD period readers (prisma)', () => {
  it('sums shortfalls and surpluses of verified settlements separately, as positive amounts', async () => {
    const aggregate = jest.fn().mockResolvedValueOnce({ _sum: { variance: -12_000 } }).mockResolvedValueOnce({ _sum: { variance: 7_000 } });
    const repo = new SettlementPrismaRepository({ cashSettlement: { aggregate } } as never);
    await expect(repo.varianceInWindow(DEPOT, FROM, TO)).resolves.toEqual({ shortfallIdr: 12_000, surplusIdr: 7_000 });
    expect(aggregate.mock.calls[0][0].where).toMatchObject({ status: 'VERIFIED', variance: { lt: 0 }, verifiedAt: { gte: FROM, lt: TO } });
    expect(aggregate.mock.calls[1][0].where.variance).toEqual({ gt: 0 });
    aggregate.mockResolvedValue({ _sum: { variance: null } });
    await expect(repo.varianceInWindow(DEPOT, FROM, TO)).resolves.toEqual({ shortfallIdr: 0, surplusIdr: 0 });
  });

  it('counts delivered COD in the window that no settlement lists', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ deliveries: 2n, amount: 70_000n }]);
    const repo = new DeliveryPrismaRepository({ $queryRaw } as never);
    await expect(repo.undepositedCodInWindow(DEPOT, FROM, TO)).resolves.toEqual({ deliveries: 2, amountIdr: 70_000 });
    const q = $queryRaw.mock.calls[0][0] as { sql: string; values: unknown[] };
    expect(q.sql).toContain('NOT EXISTS');
    expect(q.values).toEqual(expect.arrayContaining([FROM, TO]));
    $queryRaw.mockResolvedValue([]);
    await expect(repo.undepositedCodInWindow(DEPOT, FROM, TO)).resolves.toEqual({ deliveries: 0, amountIdr: 0 });
  });
});
