import { plainToInstance } from 'class-transformer';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { SettingsCache } from '@hydromart/platform';

import { ReferralConfigService } from '../../src/config/referral-config.service';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { HealthController } from '../../src/modules/health.controller';
import {
  DepotReferralSummaryDto,
  ReferralCodeDto,
  ReferralDto,
  ReferralPageQueryDto,
  ReferralSummaryDto,
} from '../../src/modules/dto/referral.dto';
import { ReferralStatus } from '../../src/domain/referral-status';

// Config getters (each maps env → typed value incl. defaults / split / trim / filter), the
// PrismaService connect/disconnect lifecycle (spied — no real Postgres), the HealthController
// up/down branches, and the response-DTO `.from()` mappers + query-DTO transforms. These are
// the units the e2e Fake* stand-ins and happy-path service specs never execute.

function cfg(values: Record<string, string>): ReferralConfigService {
  const config = {
    get: <T>(key: string, def?: T): T => (key in values ? (values[key] as unknown as T) : (def as T)),
    getOrThrow: (key: string): string => {
      if (!(key in values)) throw new Error(`missing ${key}`);
      return values[key];
    },
  } as unknown as ConfigService;
  // Empty settings cache — the plain env-backed getters never touch it.
  return new ReferralConfigService(config, new SettingsCache({ loadAll: async () => [] }));
}

describe('ReferralConfigService getters', () => {
  it('defaults nodeEnv to development and isProduction to false', () => {
    const c = cfg({});
    expect(c.nodeEnv).toBe('development');
    expect(c.isProduction).toBe(false);
  });

  it('reports production when NODE_ENV=production', () => {
    expect(cfg({ NODE_ENV: 'production' }).isProduction).toBe(true);
  });

  it('coerces the numeric port via getOrThrow', () => {
    expect(cfg({ REFERRAL_SERVICE_PORT: '3011' }).port).toBe(3011);
  });

  it('splits, trims and drops blank CORS origins', () => {
    expect(cfg({ CORS_ALLOWED_ORIGINS: 'http://a , http://b ,' }).corsOrigins).toEqual([
      'http://a',
      'http://b',
    ]);
  });

  it('defaults CORS origins to localhost:3000', () => {
    expect(cfg({}).corsOrigins).toEqual(['http://localhost:3000']);
  });

  it('reads the rate-limit pair', () => {
    expect(cfg({ RATE_LIMIT_TTL_SECONDS: '60', RATE_LIMIT_MAX: '100' }).rateLimit).toEqual({
      ttlSeconds: 60,
      limit: 100,
    });
  });

  it('reads the loyalty-service URL (getOrThrow)', () => {
    expect(cfg({ LOYALTY_SERVICE_URL: 'http://loyalty:3009' }).loyaltyServiceUrl).toBe(
      'http://loyalty:3009',
    );
  });

  it('defaults the internal service key and customer-service URL to blank', () => {
    const c = cfg({});
    expect(c.internalServiceKey).toBe('');
    expect(c.customerServiceUrl).toBe('');
  });

  it('reads the internal service key and customer-service URL when set', () => {
    const c = cfg({ INTERNAL_SERVICE_KEY: 'k1', CUSTOMER_SERVICE_URL: 'http://cust' });
    expect(c.internalServiceKey).toBe('k1');
    expect(c.customerServiceUrl).toBe('http://cust');
  });
});

describe('PrismaService lifecycle', () => {
  it('connects on module init and disconnects on destroy', async () => {
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
    const out = await new HealthController(prisma as never).check();
    expect(out.status).toBe('ok');
    expect(out.checks.database).toBe('up');
    expect(out.service).toBe('referral-service');
  });

  it('throws ServiceUnavailable when the database probe fails', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('down')) };
    await expect(new HealthController(prisma as never).check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('response DTO mappers', () => {
  const codeRecord = {
    id: 'code-1',
    customerId: 'cust-1',
    code: 'BUDI10',
    createdAt: new Date('2026-01-01'),
  };
  const referralRecord = {
    id: 'ref-1',
    referrerCustomerId: 'cust-1',
    refereeCustomerId: 'cust-2',
    code: 'BUDI10',
    status: ReferralStatus.QUALIFIED,
    qualifyingOrderId: 'ord-1',
    referrerPoints: 500,
    refereePoints: 250,
    qualifiedAt: new Date('2026-01-02'),
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  it('ReferralCodeDto.from maps the code record', () => {
    expect(ReferralCodeDto.from(codeRecord)).toEqual({
      customerId: 'cust-1',
      code: 'BUDI10',
      createdAt: new Date('2026-01-01'),
    });
  });

  it('ReferralDto.from maps every referral field', () => {
    expect(ReferralDto.from(referralRecord)).toMatchObject({
      id: 'ref-1',
      status: ReferralStatus.QUALIFIED,
      qualifyingOrderId: 'ord-1',
      referrerPoints: 500,
      refereePoints: 250,
    });
  });

  it('DepotReferralSummaryDto.from copies the aggregate', () => {
    const summary = {
      depotId: 'd1',
      invited: 10,
      qualified: 4,
      conversionPct: 40,
      pointsAwarded: 2000,
      topReferrers: [{ customerId: 'cust-1', referralCount: 4, pointsEarned: 2000 }],
    };
    expect(DepotReferralSummaryDto.from(summary)).toEqual(summary);
  });

  it('ReferralSummaryDto.from flattens the page + counts', () => {
    const dto = ReferralSummaryDto.from({
      code: codeRecord,
      referrals: { items: [referralRecord], total: 1, page: 1, limit: 20, totalPages: 1 },
      referredCount: 3,
      qualifiedCount: 1,
      pointsEarned: 500,
    });
    expect(dto).toMatchObject({
      referredCount: 3,
      qualifiedCount: 1,
      pointsEarned: 500,
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    expect(dto.referrals).toHaveLength(1);
    expect(dto.code.code).toBe('BUDI10');
  });
});

describe('ReferralPageQueryDto transform', () => {
  it('coerces string query params to numbers via @Type', () => {
    const dto = plainToInstance(ReferralPageQueryDto, { page: '3', limit: '7' });
    expect(dto.page).toBe(3);
    expect(dto.limit).toBe(7);
  });

  it('applies the page/limit defaults when omitted', () => {
    const dto = plainToInstance(ReferralPageQueryDto, {});
    expect(dto.page).toBe(1);
    expect(dto.limit).toBe(20);
  });
});
