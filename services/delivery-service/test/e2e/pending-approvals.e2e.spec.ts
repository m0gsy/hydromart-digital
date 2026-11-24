import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe } from '@hydromart/platform';

import { PendingApprovalsReader } from '../../src/application/ports/pending-approvals.reader';
import { DELIVERY_TOKENS } from '../../src/application/tokens';
import { envValidationSchema } from '../../src/config/env.validation';
import { SettlementStatus } from '../../src/domain/settlement';
import { PendingApprovalsPrismaReader } from '../../src/infrastructure/prisma/pending-approvals.prisma.reader';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { DeliveryModule } from '../../src/modules/delivery.module';

const INTERNAL_KEY = 'test-internal-service-key-01';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const D1 = '22222222-2222-4222-8222-222222222222';
const OLDEST = new Date('2026-11-20T01:02:03.000Z');

/** HD-11 over HTTP: courier deposits waiting for one cashier, behind the internal key only. */
describe('Pending approvals, internal (e2e)', () => {
  let app: INestApplication;
  const reader = {
    settlements: jest.fn<
      ReturnType<PendingApprovalsReader['settlements']>,
      [readonly string[] | undefined, string | null]
    >(async () => ({ count: 2, oldestAt: OLDEST })),
  };

  beforeAll(async () => {
    process.env.DELIVERY_DATABASE_URL = 'postgresql://u:p@localhost:5432/db?schema=public';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-long-enough-01';
    process.env.ORDER_SERVICE_URL = 'http://localhost:3004';
    process.env.DEPOT_SERVICE_URL = 'http://localhost:3007';
    process.env.PAYMENT_SERVICE_URL = 'http://localhost:3005';
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validationSchema: envValidationSchema,
          validationOptions: { allowUnknown: true },
          load: [
            () => ({
              NODE_ENV: 'test',
              DELIVERY_SERVICE_PORT: 3006,
              DELIVERY_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
              INTERNAL_SERVICE_KEY: INTERNAL_KEY,
              ORDER_SERVICE_URL: 'http://localhost:3004',
              DEPOT_SERVICE_URL: 'http://localhost:3007',
              PAYMENT_SERVICE_URL: 'http://localhost:3005',
              MAX_ACTIVE_DELIVERIES_PER_DRIVER: 1,
              SHIFT_CHECKIN_RADIUS_M: 200,
              SHIFT_LENGTH_HOURS: 8,
              SHIFT_BREAK_QUOTA_MINUTES: 60,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        DeliveryModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .overrideProvider(DELIVERY_TOKENS.PendingApprovalsReader)
      .useValue(reader)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const get = (query: string, key: string | null = INTERNAL_KEY) => {
    const req = request(app.getHttpServer()).get(`/api/v1/pending-approvals/internal/settlements?${query}`);
    return key ? req.set('x-internal-key', key) : req;
  };

  it('counts raised charges for a manager, who may sign them, within their depots', async () => {
    const res = await get(`actorId=${ACTOR}&role=MANAGER&depotIds=${D1}`).expect(200);
    expect(res.body).toEqual({ count: 2, oldestAt: OLDEST.toISOString() });
    expect(reader.settlements).toHaveBeenLastCalledWith([D1], ACTOR);
  });

  it('leaves raised charges out for a cashier, who may not sign one', async () => {
    await get(`actorId=${ACTOR}&role=KEPALA_DEPOT&depotIds=${D1}&depotIds=${D1}`).expect(200);
    expect(reader.settlements).toHaveBeenLastCalledWith([D1, D1], null);
    await get(`actorId=${ACTOR}&role=FINANCE`).expect(200);
    expect(reader.settlements).toHaveBeenLastCalledWith(undefined, null);
  });

  it('turns away a call without the internal key, and a query of the wrong shape', async () => {
    await get(`actorId=${ACTOR}&role=MANAGER`, null).expect(401);
    await get(`actorId=${ACTOR}`).expect(400);
    await get(`actorId=${ACTOR}&role=MANAGER&depotIds=`).expect(400);
  });
});

describe('PendingApprovalsPrismaReader', () => {
  const aggregate = jest.fn(async () => ({ _count: { _all: 3 }, _min: { createdAt: OLDEST } }));
  const reader = new PendingApprovalsPrismaReader({ cashSettlement: { aggregate } } as unknown as PrismaService);

  it('counts SUBMITTED deposits, a raised charge only for a second signer', async () => {
    await expect(reader.settlements([D1], ACTOR)).resolves.toEqual({ count: 3, oldestAt: OLDEST });
    expect(aggregate).toHaveBeenLastCalledWith({
      where: {
        status: SettlementStatus.SUBMITTED,
        depotId: { in: [D1] },
        OR: [{ chargeRequestedBy: null }, { chargeRequestedBy: { not: ACTOR } }],
      },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    await reader.settlements(undefined, null);
    expect(aggregate).toHaveBeenLastCalledWith({
      where: { status: SettlementStatus.SUBMITTED, OR: [{ chargeRequestedBy: null }] },
      _count: { _all: true },
      _min: { createdAt: true },
    });
  });
});
