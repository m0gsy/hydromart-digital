import { ServiceUnavailableException } from '@nestjs/common';

import { InvalidPricingWindowError, InvalidPurchaseOrderTransitionError } from '../../src/domain/errors';
import { DepotConfigService } from '../../src/config/depot-config.service';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { SettingsPrismaRepository } from '../../src/infrastructure/prisma/settings.prisma.repository';
import { HealthController } from '../../src/modules/health.controller';
import { LowStockAlertHttpAdapter } from '../../src/infrastructure/http/low-stock-alert.http.adapter';
import { nextShift, ShiftKind } from '../../src/domain/shift';

describe('DepotConfigService', () => {
  const env: Record<string, string> = {
    DEPOT_SERVICE_PORT: '3010',
    RATE_LIMIT_TTL_SECONDS: '60',
    RATE_LIMIT_MAX: '100',
    GALLON_DEPOSIT_IDR: '20000',
    APPROVAL_AUTO_PASS_IDR: '100000',
  };
  const config = {
    get: jest.fn((key: string, dflt?: unknown) => (key in env ? env[key] : dflt)),
    getOrThrow: jest.fn((key: string) => env[key]),
  };
  const settings = { effective: jest.fn((_k, _t, envValue: number) => envValue) };
  const svc = new DepotConfigService(config as never, settings as never);

  it('reads env-derived and tunable config values', () => {
    expect(svc.nodeEnv).toBe('development');
    expect(svc.isProduction).toBe(false);
    expect(svc.port).toBe(3010);
    expect(svc.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
    expect(svc.pricingTimeZone).toBe('Asia/Jakarta');
    expect(svc.crmServiceUrl).toBe('');
    expect(svc.alertPhone).toBe('');
    expect(svc.internalServiceKey).toBe('');
    // Both the default (no depotId) and explicit-depotId branches of each tunable getter.
    expect(svc.gallonDepositIdr()).toBe(20000);
    expect(svc.gallonDepositIdr('depot-1')).toBe(20000);
    expect(svc.approvalAutoPassIdr()).toBe(100000);
    expect(svc.approvalAutoPassIdr('depot-1')).toBe(100000);
  });

  it('trims and drops blank CORS origins', () => {
    config.get.mockImplementationOnce(() => ' a , ,b ');
    expect(svc.corsOrigins).toEqual(['a', 'b']);
  });

  it('flags production when NODE_ENV=production', () => {
    env.NODE_ENV = 'production';
    expect(svc.isProduction).toBe(true);
    delete env.NODE_ENV;
  });
});

describe('PrismaService lifecycle', () => {
  it('connects on init and disconnects on destroy', async () => {
    const prisma = new PrismaService();
    const connect = jest.spyOn(prisma, '$connect').mockResolvedValue(undefined);
    const disconnect = jest.spyOn(prisma, '$disconnect').mockResolvedValue(undefined);
    await prisma.onModuleInit();
    await prisma.onModuleDestroy();
    expect(connect).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });
});

describe('SettingsPrismaRepository', () => {
  const serviceSetting = { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn(), create: jest.fn(), deleteMany: jest.fn() };
  const prisma = { serviceSetting } as unknown as PrismaService;
  const repo = new SettingsPrismaRepository(prisma);
  beforeEach(() => jest.clearAllMocks());

  it('maps loaded rows to SettingRow', async () => {
    serviceSetting.findMany.mockResolvedValue([{ scope: 'GLOBAL', depotId: null, key: 'k', value: '1' }]);
    expect(await repo.loadAll()).toEqual([{ scope: 'GLOBAL', depotId: null, key: 'k', value: '1' }]);
  });

  it('updates an existing row on upsert', async () => {
    serviceSetting.findFirst.mockResolvedValue({ id: 'row-1' });
    await repo.upsert({ scope: 'DEPOT', depotId: 'd', key: 'k', value: '2', updatedBy: 'u' });
    expect(serviceSetting.update).toHaveBeenCalledWith({ where: { id: 'row-1' }, data: { value: '2', updatedBy: 'u' } });
    expect(serviceSetting.create).not.toHaveBeenCalled();
  });

  it('creates a new row when none exists', async () => {
    serviceSetting.findFirst.mockResolvedValue(null);
    await repo.upsert({ scope: 'GLOBAL', depotId: null, key: 'k', value: '3', updatedBy: 'u' });
    expect(serviceSetting.create).toHaveBeenCalledWith({ data: { scope: 'GLOBAL', depotId: null, key: 'k', value: '3', updatedBy: 'u' } });
  });

  it('removes by scope/depot/key', async () => {
    await repo.remove('DEPOT', 'd', 'k');
    expect(serviceSetting.deleteMany).toHaveBeenCalledWith({ where: { scope: 'DEPOT', depotId: 'd', key: 'k' } });
  });
});

describe('HealthController', () => {
  it('reports ok when the database probe succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const status = await new HealthController(prisma as never).check();
    expect(status).toMatchObject({ status: 'ok', checks: { database: 'up' } });
  });

  it('throws ServiceUnavailable when the database probe fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('down')) };
    await expect(new HealthController(prisma as never).check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('LowStockAlertHttpAdapter timeout', () => {
  afterEach(() => jest.useRealTimers());

  it('aborts the request when crm-service hangs past the timeout', async () => {
    jest.useFakeTimers();
    const abort = jest.fn(() => rejectFetch(new Error('The operation was aborted')));
    const AbortSpy = jest.spyOn(global, 'AbortController').mockImplementation(() => ({ abort, signal: {} }) as never);
    let rejectFetch: (e: Error) => void = () => {};
    global.fetch = jest.fn(() => new Promise((_resolve, reject) => { rejectFetch = reject; })) as never;
    const config = { alertPhone: '628', crmServiceUrl: 'http://crm', internalServiceKey: 'k' } as never;
    const promise = new LowStockAlertHttpAdapter(config).emit(
      { depotId: 'd', depotName: 'D', label: 'L', quantity: 1, minimum: 2 },
      'Bearer x',
    );
    jest.advanceTimersByTime(5000);
    expect(abort).toHaveBeenCalled();
    // The abort rejects the pending fetch; emit fails open (resolves) — no dangling promise.
    await expect(promise).resolves.toBeUndefined();
    AbortSpy.mockRestore();
  });
});

describe('domain errors with optional messages', () => {
  it('uses the default and a custom message for windowed errors', () => {
    expect(new InvalidPricingWindowError().message).toBe('Invalid pricing rule window.');
    expect(new InvalidPricingWindowError('custom window').message).toBe('custom window');
    expect(new InvalidPurchaseOrderTransitionError().message).toBe('This purchase order cannot make that transition.');
    expect(new InvalidPurchaseOrderTransitionError('custom transition').message).toBe('custom transition');
  });
});

describe('nextShift cycle', () => {
  it('cycles MORNING → EVENING → OFF → MORNING', () => {
    expect(nextShift(ShiftKind.MORNING)).toBe(ShiftKind.EVENING);
    expect(nextShift(ShiftKind.EVENING)).toBe(ShiftKind.OFF);
    expect(nextShift(ShiftKind.OFF)).toBe(ShiftKind.MORNING);
  });
});
