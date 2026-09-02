import { ConfigService } from '@nestjs/config';

import { DashboardConfigService } from '../../src/config/dashboard-config.service';
import { DashboardController } from '../../src/modules/dashboard.controller';
import { HealthController } from '../../src/modules/health.controller';
import { DashboardService } from '../../src/application/services/dashboard.service';

/** Minimal ConfigService stand-in backed by a plain map. */
function fakeConfig(store: Record<string, string | undefined>): ConfigService {
  return {
    get<T>(key: string, def?: T): T {
      const v = store[key];
      return (v === undefined ? def : v) as T;
    },
    getOrThrow<T>(key: string): T {
      const v = store[key];
      if (v === undefined) throw new Error(`Missing config ${key}`);
      return v as T;
    },
  } as unknown as ConfigService;
}

describe('DashboardConfigService', () => {
  it('reads required + numeric config and strips trailing slashes from URLs', () => {
    const svc = new DashboardConfigService(
      fakeConfig({
        NODE_ENV: 'production',
        DASHBOARD_SERVICE_PORT: '3008',
        ORDER_SERVICE_URL: 'http://order///',
        DELIVERY_SERVICE_URL: 'http://delivery/',
        DEPOT_SERVICE_URL: 'http://depot',
        INTERNAL_SERVICE_KEY: 'secret-key',
        RATE_LIMIT_TTL_SECONDS: '60',
        RATE_LIMIT_MAX: '100',
      }),
    );

    expect(svc.nodeEnv).toBe('production');
    expect(svc.isProduction).toBe(true);
    expect(svc.port).toBe(3008);
    expect(svc.orderServiceUrl).toBe('http://order');
    expect(svc.deliveryServiceUrl).toBe('http://delivery');
    expect(svc.depotServiceUrl).toBe('http://depot');
    expect(svc.internalServiceKey).toBe('secret-key');
    expect(svc.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
  });

  it('defaults nodeEnv/cors and treats optional service URLs as undefined', () => {
    const svc = new DashboardConfigService(fakeConfig({}));

    expect(svc.nodeEnv).toBe('development');
    expect(svc.isProduction).toBe(false);
    expect(svc.adminServiceUrl).toBeUndefined();
    expect(svc.hrServiceUrl).toBeUndefined();
    expect(svc.customerServiceUrl).toBeUndefined();
    // corsOrigins default split.
    expect(svc.corsOrigins).toEqual(['http://localhost:3000']);
  });

  it('strips slashes from optional URLs and parses/filters CORS origins', () => {
    const svc = new DashboardConfigService(
      fakeConfig({
        ADMIN_SERVICE_URL: 'http://admin/',
        HR_SERVICE_URL: 'http://hr//',
        CUSTOMER_SERVICE_URL: 'http://customer/',
        CORS_ALLOWED_ORIGINS: 'http://a.com, http://b.com , ,',
      }),
    );

    expect(svc.adminServiceUrl).toBe('http://admin');
    expect(svc.hrServiceUrl).toBe('http://hr');
    expect(svc.customerServiceUrl).toBe('http://customer');
    expect(svc.corsOrigins).toEqual(['http://a.com', 'http://b.com']);
  });
});

describe('HealthController', () => {
  it('reports the service as ok with a timestamp', () => {
    const result = new HealthController().check();
    expect(result.status).toBe('ok');
    expect(result.service).toBe('dashboard-service');
    expect(typeof result.timestamp).toBe('string');
  });
});

describe('DashboardController', () => {
  const stub = {
    executive: jest.fn().mockResolvedValue('exec'),
    monthlyPnl: jest.fn().mockResolvedValue('pnl'),
    network: jest.fn().mockResolvedValue('net'),
    franchise: jest.fn().mockResolvedValue('fr'),
  } as unknown as DashboardService;
  const controller = new DashboardController(stub);

  const headOffice = { sub: 'hq-1', role: 'HEAD_OFFICE', phone: null, depotId: null } as never;
  const manager = (...depotIds: string[]) =>
    ({ sub: 'mgr-1', role: 'MANAGER', phone: null, depotId: depotIds[0] ?? null, depotIds }) as never;

  it('delegates executive with the parsed range + token', async () => {
    await expect(controller.executive({ from: 'a', to: 'b' }, 'Bearer t', headOffice)).resolves.toBe(
      'exec',
    );
    expect(stub.executive).toHaveBeenCalledWith({ from: 'a', to: 'b' }, 'Bearer t', undefined);
  });

  /*
   * CA-4-06. `dashboard` admits three depot-scoped roles and this route carries no depotId,
   * so DepotScopeGuard had nothing to compare: a depot manager was served the network's
   * revenue, and the mobile console printed it under one depot's name.
   */
  it("scopes the executive dashboard to a manager's own depots", async () => {
    await controller.executive({}, 'Bearer t', manager('d1', 'd2'));
    expect(stub.executive).toHaveBeenLastCalledWith({ from: undefined, to: undefined }, 'Bearer t', [
      'd1',
      'd2',
    ]);
  });

  it('lets a manager narrow to ONE of their depots, and refuses one that is not theirs', async () => {
    await controller.executive({ depotId: 'd2' }, 'Bearer t', manager('d1', 'd2'));
    expect(stub.executive).toHaveBeenLastCalledWith(expect.anything(), 'Bearer t', ['d2']);
    expect(() => controller.executive({ depotId: 'd9' }, 'Bearer t', manager('d1'))).toThrow();
  });

  it('delegates monthlyPnl with depotId + month', async () => {
    await expect(controller.monthlyPnl({ depotId: 'd1', month: '2026-07' }, 'Bearer t')).resolves.toBe('pnl');
    expect(stub.monthlyPnl).toHaveBeenCalledWith('d1', '2026-07', 'Bearer t');
  });

  it('delegates network with the parsed range + token', async () => {
    await expect(controller.network({ from: 'a', to: 'b' }, 'Bearer t')).resolves.toBe('net');
    expect(stub.network).toHaveBeenCalledWith({ from: 'a', to: 'b' }, 'Bearer t');
  });

  it('delegates franchise with the parsed range + token', async () => {
    await expect(controller.franchise({}, 'Bearer t')).resolves.toBe('fr');
    expect(stub.franchise).toHaveBeenCalledWith({ from: undefined, to: undefined }, 'Bearer t');
  });
});
