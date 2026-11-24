import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe } from '@hydromart/platform';

import { PendingApprovalsReader } from '../../src/application/ports/pending-approvals.reader';
import { PAYOUT_TOKENS } from '../../src/application/tokens';
import { envValidationSchema } from '../../src/config/env.validation';
import { PendingApprovalsPrismaReader } from '../../src/infrastructure/prisma/pending-approvals.prisma.reader';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PayoutModule } from '../../src/modules/payout.module';

const INTERNAL_KEY = 'test-internal-service-key-01';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const D1 = '22222222-2222-4222-8222-222222222222';
const OLDEST = new Date('2026-11-20T01:02:03.000Z');

/** HD-11 over HTTP: courier expense claims waiting for one reviewer, behind the internal key. */
describe('Pending approvals, internal (e2e)', () => {
  let app: INestApplication;
  const reader = {
    expenses: jest.fn<
      ReturnType<PendingApprovalsReader['expenses']>,
      [readonly string[] | undefined, number | null]
    >(async () => ({ count: 1, oldestAt: OLDEST })),
  };

  beforeAll(async () => {
    process.env.PAYOUT_DATABASE_URL = 'postgresql://u:p@localhost:5432/db?schema=public';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-long-enough-01';
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
              PAYOUT_SERVICE_PORT: 3016,
              PAYOUT_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
              INTERNAL_SERVICE_KEY: INTERNAL_KEY,
              EXPENSE_MANAGER_APPROVE_MAX_IDR: 250000,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        PayoutModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .overrideProvider(PAYOUT_TOKENS.PendingApprovalsReader)
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
    const req = request(app.getHttpServer()).get(`/api/v1/pending-approvals/internal/expenses?${query}`);
    return key ? req.set('x-internal-key', key) : req;
  };

  it("holds a manager to their depots and to what a manager may approve", async () => {
    const res = await get(`actorId=${ACTOR}&role=MANAGER&depotIds=${D1}`).expect(200);
    expect(res.body).toEqual({ count: 1, oldestAt: OLDEST.toISOString() });
    expect(reader.expenses).toHaveBeenLastCalledWith([D1], 250000);
  });

  it('counts every amount for finance, across the network', async () => {
    await get(`actorId=${ACTOR}&role=FINANCE`).expect(200);
    expect(reader.expenses).toHaveBeenLastCalledWith(undefined, null);
    await get(`actorId=${ACTOR}&role=FINANCE&depotIds=${D1}&depotIds=${D1}`).expect(200);
    expect(reader.expenses).toHaveBeenLastCalledWith([D1, D1], null);
  });

  it('turns away a call without the internal key, and a query of the wrong shape', async () => {
    await get(`actorId=${ACTOR}&role=MANAGER`, null).expect(401);
    await get(`role=MANAGER`).expect(400);
    await get(`actorId=${ACTOR}&role=MANAGER&depotIds=`).expect(400);
  });
});

describe('PendingApprovalsPrismaReader', () => {
  const aggregate = jest.fn(async () => ({ _count: { _all: 5 }, _min: { createdAt: OLDEST } }));
  const reader = new PendingApprovalsPrismaReader({ expenseClaim: { aggregate } } as unknown as PrismaService);

  it('counts PENDING claims within the depots and under the ceiling it is given', async () => {
    await expect(reader.expenses([D1], 250000)).resolves.toEqual({ count: 5, oldestAt: OLDEST });
    expect(aggregate).toHaveBeenLastCalledWith({
      where: { status: 'PENDING', depotId: { in: [D1] }, amount: { lte: 250000 } },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    await reader.expenses(undefined, null);
    expect(aggregate).toHaveBeenLastCalledWith({
      where: { status: 'PENDING' },
      _count: { _all: true },
      _min: { createdAt: true },
    });
  });
});
