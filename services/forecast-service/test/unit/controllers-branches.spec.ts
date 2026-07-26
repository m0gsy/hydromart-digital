import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';

import { Role, AuthenticatedUser } from '@hydromart/platform';

import { HealthController } from '../../src/modules/health.controller';
import { ForecastController } from '../../src/modules/forecast.controller';
import { IngestController } from '../../src/modules/ingest.controller';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { ForecastService } from '../../src/application/services/forecast.service';
import { RebuildService } from '../../src/application/services/rebuild.service';
import { DepotOwnershipPort } from '../../src/application/ports/depot-ownership.port';

const UUID = '11111111-1111-4111-8111-111111111111';
const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser =>
  ({ sub: 'owner-1', role: Role.HEAD_OFFICE, ...over } as AuthenticatedUser);

describe('HealthController', () => {
  it('reports ok when the database probe succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as unknown as PrismaService;
    const out = await new HealthController(prisma).check();
    expect(out).toMatchObject({ status: 'ok', service: 'forecast-service', checks: { database: 'up' } });
  });

  it('throws ServiceUnavailable when the database probe fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('down')) } as unknown as PrismaService;
    await expect(new HealthController(prisma).check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('ForecastController', () => {
  const forecasts = {
    demand: jest.fn().mockResolvedValue({ productId: 'p' }),
    depotRollup: jest.fn().mockResolvedValue([]),
    salesForecast: jest.fn().mockResolvedValue({ depotId: null }),
    churnList: jest.fn().mockResolvedValue({ customers: [] }),
  } as unknown as ForecastService;
  const rebuild = { rebuild: jest.fn().mockResolvedValue({ ingested: 3, pages: 1 }) } as unknown as RebuildService;
  const ownership = { ownedDepotIds: jest.fn() } as unknown as DepotOwnershipPort;
  const ctrl = new ForecastController(forecasts, rebuild, ownership);

  beforeEach(() => jest.clearAllMocks());

  it('demand delegates for a non-franchise user (ownership skipped)', async () => {
    await ctrl.demand({ productId: UUID, depotId: UUID, historyDays: 30, horizonDays: 7 }, user());
    expect(ownership.ownedDepotIds).not.toHaveBeenCalled();
    expect(forecasts.demand).toHaveBeenCalledWith({ productId: UUID, depotId: UUID, historyDays: 30, horizonDays: 7 });
  });

  it('franchise owner must name a depot', async () => {
    await expect(ctrl.demand({ productId: UUID }, user({ role: Role.FRANCHISE_OWNER }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('franchise owner is denied a depot they do not own', async () => {
    (ownership.ownedDepotIds as jest.Mock).mockResolvedValue(['other-depot']);
    await expect(
      ctrl.demand({ productId: UUID, depotId: UUID }, user({ role: Role.FRANCHISE_OWNER })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('franchise owner is allowed a depot they own', async () => {
    (ownership.ownedDepotIds as jest.Mock).mockResolvedValue([UUID]);
    await ctrl.demand({ productId: UUID, depotId: UUID }, user({ role: Role.FRANCHISE_OWNER }));
    expect(forecasts.demand).toHaveBeenCalled();
  });

  it('depotRollup delegates with the path depot id', async () => {
    await ctrl.depotRollup(UUID, { limit: 5 }, user());
    expect(forecasts.depotRollup).toHaveBeenCalledWith({ depotId: UUID, historyDays: undefined, horizonDays: undefined, limit: 5 });
  });

  it('sales delegates', async () => {
    await ctrl.sales({ depotId: UUID }, user());
    expect(forecasts.salesForecast).toHaveBeenCalledWith({ depotId: UUID, historyDays: undefined, horizonDays: undefined });
  });

  it('churn delegates (no ownership check)', async () => {
    await ctrl.churn({ depotId: UUID, limit: 10, days: 30 });
    expect(forecasts.churnList).toHaveBeenCalledWith({ depotId: UUID, limit: 10, windowDays: 30 });
  });

  it('rebuildNow delegates to the rebuild service', async () => {
    const out = await ctrl.rebuildNow({ limit: 50 });
    expect(rebuild.rebuild).toHaveBeenCalledWith(50);
    expect(out).toEqual({ ingested: 3, pages: 1 });
  });
});

describe('IngestController', () => {
  const forecasts = { ingest: jest.fn().mockResolvedValue(undefined) } as unknown as ForecastService;
  const ctrl = new IngestController(forecasts);

  beforeEach(() => jest.clearAllMocks());

  it('maps the body and stamps `at` ≈ now, defaulting a missing depot to null', async () => {
    const out = await ctrl.ingest({
      orderId: 'o1',
      customerId: 'c1',
      total: 85000,
      items: [{ productId: 'p1', productName: 'Aqua', sku: 'A', unit: 'galon', quantity: 2 }],
    } as never);
    expect(out).toEqual({ ingested: true });
    const arg = (forecasts.ingest as jest.Mock).mock.calls[0][0];
    expect(arg).toMatchObject({ orderId: 'o1', customerId: 'c1', depotId: null, total: 85000 });
    expect(arg.at).toBeInstanceOf(Date);
  });

  it('passes an explicit depot id through', async () => {
    await ctrl.ingest({ orderId: 'o2', customerId: 'c2', depotId: 'd1', total: 1, items: [] } as never);
    expect((forecasts.ingest as jest.Mock).mock.calls[0][0].depotId).toBe('d1');
  });
});
