import { ServiceUnavailableException } from '@nestjs/common';

import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { HealthController } from '../../src/modules/health.controller';
import { envValidationSchema } from '../../src/config/env.validation';
import { buildTestConfig } from '../support/fakes';

describe('AdminConfigService', () => {
  it('reads scalar getters and derived flags', () => {
    const config = buildTestConfig();
    expect(config.nodeEnv).toBe('test');
    expect(config.isProduction).toBe(false);
    expect(config.port).toBe(3017);
    expect(config.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
    expect(config.internalServiceKey).toBe('');
    // Peers the report sweep reads from. Blank = that dataset's run is recorded FAILED,
    // never an empty spreadsheet that reads as a quiet month.
    expect(config.paymentServiceUrl).toBe('');
    const wired = buildTestConfig({
      ORDER_SERVICE_URL: '  http://order:3004  ',
      PAYMENT_SERVICE_URL: '  http://payment:3005  ',
    });
    expect(wired.orderServiceUrl).toBe('http://order:3004');
    expect(wired.paymentServiceUrl).toBe('http://payment:3005');
  });

  it('isProduction is true when NODE_ENV=production', () => {
    expect(buildTestConfig({ NODE_ENV: 'production' }).isProduction).toBe(true);
  });

  it('corsOrigins splits, trims and drops empty entries', () => {
    const config = buildTestConfig({ CORS_ALLOWED_ORIGINS: 'https://a.com, https://b.com , ' });
    expect(config.corsOrigins).toEqual(['https://a.com', 'https://b.com']);
  });

  it('serviceRegistry includes only configured peers and strips trailing slashes', () => {
    const config = buildTestConfig({ AUTH_SERVICE_URL: 'http://auth:3001///' });
    const registry = config.serviceRegistry();
    expect(registry).toContainEqual({ name: 'auth-service', baseUrl: 'http://auth:3001' });
    // customer-service URL is unset in the test config → absent from the roll-up.
    expect(registry.some((r) => r.name === 'customer-service')).toBe(false);
  });
});

describe('envValidationSchema', () => {
  it('defaults optional vars and validates a minimal env', () => {
    const { value, error } = envValidationSchema.validate({
      ADMIN_DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
    });
    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.ADMIN_SERVICE_PORT).toBe(3017);
  });
});

describe('PrismaService lifecycle', () => {
  it('connects on init and disconnects on destroy', async () => {
    const service = new PrismaService();
    const connect = jest.spyOn(service, '$connect').mockResolvedValue(undefined);
    const disconnect = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);
    await service.onModuleInit();
    await service.onModuleDestroy();
    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('HealthController', () => {
  it('reports ok when the database probe succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    const out = await controller.check();
    expect(out.status).toBe('ok');
    expect(out.checks.database).toBe('up');
  });

  it('throws ServiceUnavailable when the database probe fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('down')) };
    const controller = new HealthController(prisma as unknown as PrismaService);
    await expect(controller.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
