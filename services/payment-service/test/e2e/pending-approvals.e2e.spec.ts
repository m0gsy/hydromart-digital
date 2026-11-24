import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe } from '@hydromart/platform';

import { PendingApprovalsReader } from '../../src/application/ports/pending-approvals.reader';
import { PAYMENT_TOKENS } from '../../src/application/tokens';
import { RefundApproval } from '../../src/domain/payment';
import { PendingApprovalsPrismaReader } from '../../src/infrastructure/prisma/pending-approvals.prisma.reader';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PaymentModule } from '../../src/modules/payment.module';

const INTERNAL_KEY = 'test-internal-service-key-01';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const OLDEST = new Date('2026-11-20T01:02:03.000Z');

/** HD-11 over HTTP: the refund queue's count for one person, behind the internal key only. */
describe('Pending approvals, internal (e2e)', () => {
  let app: INestApplication;
  const reader = {
    refunds: jest.fn<ReturnType<PendingApprovalsReader['refunds']>, [string | null]>(async () => ({
      count: 3,
      oldestAt: OLDEST,
    })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              PAYMENT_SERVICE_PORT: 3005,
              PAYMENT_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
              INTERNAL_SERVICE_KEY: INTERNAL_KEY,
              PAYMENT_GATEWAY_BASE_URL: '',
              PAYMENT_GATEWAY_API_KEY: '',
              PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret-e2e-01',
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        PaymentModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .overrideProvider(PAYMENT_TOKENS.PendingApprovalsReader)
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
    const req = request(app.getHttpServer()).get(`/api/v1/pending-approvals/internal/refunds?${query}`);
    return key ? req.set('x-internal-key', key) : req;
  };

  it("leaves out the refunds the person raised: they may not release their own", async () => {
    const res = await get(`actorId=${ACTOR}&role=FINANCE`).expect(200);
    expect(res.body).toEqual({ count: 3, oldestAt: OLDEST.toISOString() });
    expect(reader.refunds).toHaveBeenLastCalledWith(ACTOR);
  });

  it('counts them all for the superuser, the one exception the approval itself makes', async () => {
    await get(`actorId=${ACTOR}&role=SUPER_ADMIN`).expect(200);
    expect(reader.refunds).toHaveBeenLastCalledWith(null);
  });

  it('ignores the depots it is sent: the queue has none, and deciding it is network-wide', async () => {
    await get(`actorId=${ACTOR}&role=FINANCE&depotIds=${ACTOR}&depotIds=${ACTOR}`).expect(200);
    expect(reader.refunds).toHaveBeenLastCalledWith(ACTOR);
  });

  it('turns away a call without the internal key, and a query of the wrong shape', async () => {
    await get(`actorId=${ACTOR}&role=FINANCE`, null).expect(401);
    await get(`actorId=nope&role=FINANCE`).expect(400);
    await get(`actorId=${ACTOR}&role=FINANCE&depotIds=`).expect(400);
  });
});

describe('PendingApprovalsPrismaReader', () => {
  const aggregate = jest.fn(async () => ({ _count: { _all: 2 }, _min: { updatedAt: OLDEST } }));
  const reader = new PendingApprovalsPrismaReader({ payment: { aggregate } } as unknown as PrismaService);

  it('counts PENDING refunds, keeping rows with no requester recorded', async () => {
    await expect(reader.refunds(ACTOR)).resolves.toEqual({ count: 2, oldestAt: OLDEST });
    expect(aggregate).toHaveBeenLastCalledWith({
      where: {
        refundApproval: RefundApproval.PENDING,
        OR: [{ refundRequestedBy: null }, { refundRequestedBy: { not: ACTOR } }],
      },
      _count: { _all: true },
      _min: { updatedAt: true },
    });
    await reader.refunds(null);
    expect(aggregate).toHaveBeenLastCalledWith({
      where: { refundApproval: RefundApproval.PENDING },
      _count: { _all: true },
      _min: { updatedAt: true },
    });
  });
});
