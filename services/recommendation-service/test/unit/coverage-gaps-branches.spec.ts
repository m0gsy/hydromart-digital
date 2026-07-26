import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';

import { RecommendationConfigService } from '../../src/config/recommendation-config.service';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { HealthController } from '../../src/modules/health.controller';
import {
  LimitQueryDto,
  TrendingQueryDto,
  RebuildQueryDto,
  IngestItemDto,
  IngestOrderDto,
} from '../../src/modules/dto/recommendation.dto';

// Gap-fill: config getters, PrismaService lifecycle, health up/down, DTO ctors.
// No network, no DB — everything mocked/instantiated directly.

function makeConfig(map: Record<string, string>): RecommendationConfigService {
  const config = {
    get: (key: string, def?: string) => (key in map ? map[key] : def),
    getOrThrow: (key: string) => {
      if (!(key in map)) throw new Error(`missing ${key}`);
      return map[key];
    },
  } as unknown as ConfigService;
  return new RecommendationConfigService(config);
}

describe('RecommendationConfigService', () => {
  it('reads every getter with defaults and trims/splits/normalizes', () => {
    const svc = makeConfig({
      NODE_ENV: 'production',
      RECOMMENDATION_SERVICE_PORT: '3010',
      RECOMMENDATION_DATABASE_URL: 'postgres://db',
      JWT_ACCESS_SECRET: 'secret',
      INTERNAL_SERVICE_KEY: 'key-1',
      ORDER_SERVICE_URL: 'http://order:3006///',
      CORS_ALLOWED_ORIGINS: 'http://a.com, http://b.com , ,',
      RATE_LIMIT_TTL_SECONDS: '60',
      RATE_LIMIT_MAX: '100',
    });
    expect(svc.nodeEnv).toBe('production');
    expect(svc.isProduction).toBe(true);
    expect(svc.port).toBe(3010);
    expect(svc.databaseUrl).toBe('postgres://db');
    expect(svc.jwtAccessSecret).toBe('secret');
    expect(svc.internalServiceKey).toBe('key-1');
    expect(svc.orderServiceUrl).toBe('http://order:3006');
    expect(svc.corsOrigins).toEqual(['http://a.com', 'http://b.com']);
    expect(svc.rateLimit).toEqual({ ttlSeconds: 60, limit: 100 });
  });

  it('falls back to defaults when optional env is absent', () => {
    const svc = makeConfig({});
    expect(svc.nodeEnv).toBe('development');
    expect(svc.isProduction).toBe(false);
    expect(svc.internalServiceKey).toBe('');
    expect(svc.orderServiceUrl).toBe('');
    expect(svc.corsOrigins).toEqual(['http://localhost:3000']);
  });
});

describe('PrismaService lifecycle', () => {
  it('connects on init and disconnects on destroy', async () => {
    const svc = new PrismaService();
    const connect = jest.spyOn(svc, '$connect').mockResolvedValue(undefined);
    const disconnect = jest.spyOn(svc, '$disconnect').mockResolvedValue(undefined);

    await svc.onModuleInit();
    expect(connect).toHaveBeenCalledTimes(1);

    await svc.onModuleDestroy();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

describe('HealthController', () => {
  it('reports ok when the database probe succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as unknown as PrismaService;
    const out = await new HealthController(prisma).check();
    expect(out).toMatchObject({ status: 'ok', service: 'recommendation-service', checks: { database: 'up' } });
  });

  it('throws ServiceUnavailable when the database probe fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('down')) } as unknown as PrismaService;
    await expect(new HealthController(prisma).check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('DTO constructors', () => {
  it('instantiate cleanly (covers class ctors)', () => {
    expect(new LimitQueryDto()).toBeInstanceOf(LimitQueryDto);
    expect(new TrendingQueryDto()).toBeInstanceOf(TrendingQueryDto);
    expect(new RebuildQueryDto()).toBeInstanceOf(RebuildQueryDto);
    expect(new IngestItemDto()).toBeInstanceOf(IngestItemDto);
    expect(new IngestOrderDto()).toBeInstanceOf(IngestOrderDto);
  });
});
