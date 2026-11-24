import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  AllExceptionsFilter,
  GlobalValidationPipe,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
} from '@hydromart/platform';

import { PendingApprovalsReader } from '../../src/application/ports/pending-approvals.reader';
import { DEPOT_TOKENS } from '../../src/application/tokens';
import { envValidationSchema } from '../../src/config/env.validation';
import { ApprovalStatus } from '../../src/domain/approval';
import { FranchiseAppStage } from '../../src/domain/franchise-application';
import { PriceOverrideStatus } from '../../src/domain/price-override-proposal';
import { PendingApprovalsPrismaReader } from '../../src/infrastructure/prisma/pending-approvals.prisma.reader';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { DepotModule } from '../../src/modules/depot.module';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const INTERNAL_KEY = 'test-internal-service-key-01';
const ACTOR = '11111111-1111-4111-8111-111111111111';
const D1 = '22222222-2222-4222-8222-222222222222';
const D2 = '33333333-3333-4333-8333-333333333333';
const OLDEST = new Date('2026-11-20T01:02:03.000Z');

/** HD-11 over HTTP: the internal key is the only way in, and the query is held to its shape. */
describe('Pending approvals, internal (e2e)', () => {
  let app: INestApplication;
  const reader = {
    priceOverrides: jest.fn<ReturnType<PendingApprovalsReader['priceOverrides']>, [readonly string[] | undefined]>(
      async () => ({ count: 2, oldestAt: OLDEST }),
    ),
    franchiseApplications: jest.fn(async () => ({ count: 1, oldestAt: OLDEST })),
    approvals: jest.fn<ReturnType<PendingApprovalsReader['approvals']>, [readonly string[] | undefined, string]>(
      async () => ({ count: 0, oldestAt: null }),
    ),
  };

  beforeAll(async () => {
    process.env.DEPOT_DATABASE_URL = 'postgresql://u:p@localhost:5432/db?schema=public';
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
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
              DEPOT_SERVICE_PORT: 3007,
              DEPOT_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              INTERNAL_SERVICE_KEY: INTERNAL_KEY,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        DepotModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .overrideProvider(DEPOT_TOKENS.PendingApprovalsReader)
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

  const get = (path: string, key: string | null = INTERNAL_KEY) => {
    const req = request(app.getHttpServer()).get(`/api/v1/pending-approvals/internal/${path}`);
    return key ? req.set('x-internal-key', key) : req;
  };
  const who = `actorId=${ACTOR}&role=MANAGER`;

  it('answers the depots it is given, as a count and the oldest time', async () => {
    const res = await get(`price-overrides?${who}&depotIds=${D1},${D2}`).expect(200);
    expect(res.body).toEqual({ count: 2, oldestAt: OLDEST.toISOString() });
    expect(reader.priceOverrides).toHaveBeenLastCalledWith([D1, D2]);
  });

  it('reads the whole network when no depot is named', async () => {
    await get(`price-overrides?${who}`).expect(200);
    expect(reader.priceOverrides).toHaveBeenLastCalledWith(undefined);
    await get(`franchise-applications?${who}`).expect(200);
    expect(reader.franchiseApplications).toHaveBeenCalledWith();
  });

  it('leaves out what the person raised, for every depot named, repeated or listed', async () => {
    const res = await get(`approvals?${who}&depotIds=${D1}&depotIds=${D2}`).expect(200);
    expect(res.body).toEqual({ count: 0, oldestAt: null });
    expect(reader.approvals).toHaveBeenLastCalledWith([D1, D2], ACTOR);
  });

  it('turns away anyone without the internal key, a staff session included', async () => {
    await get(`approvals?${who}`, null).expect(401);
    await get(`approvals?${who}`, 'not-the-key').expect(401);
    const staff = app
      .get(JwtService)
      .sign(
        { sub: ACTOR, role: 'SUPER_ADMIN', phone: '+62', depotId: null },
        { secret: SECRET, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
      );
    await request(app.getHttpServer())
      .get(`/api/v1/pending-approvals/internal/approvals?${who}`)
      .set('Authorization', `Bearer ${staff}`)
      .expect(401);
  });

  it.each([
    ['no actor', 'role=MANAGER'],
    ['an actor that is not a uuid', 'actorId=system&role=MANAGER'],
    ['no role', `actorId=${ACTOR}`],
    ['an empty depot list (never "every depot")', `${who}&depotIds=`],
    ['a depot that is not a uuid', `${who}&depotIds=${D1},nope`],
    ['an unknown parameter', `${who}&status=PENDING`],
  ])('refuses %s with 400', async (_label, query) => {
    const calls = reader.approvals.mock.calls.length;
    await get(`approvals?${query}`).expect(400);
    expect(reader.approvals.mock.calls).toHaveLength(calls);
  });
});

describe('PendingApprovalsPrismaReader', () => {
  const aggregate = (min: Record<string, Date | null>) =>
    jest.fn(async () => ({ _count: { _all: 4 }, _min: min }));
  const prisma = {
    priceOverrideProposal: { aggregate: aggregate({ createdAt: OLDEST }) },
    franchiseApplication: { aggregate: aggregate({ submittedAt: OLDEST }) },
    approval: { aggregate: aggregate({ createdAt: null }) },
  };
  const reader = new PendingApprovalsPrismaReader(prisma as unknown as PrismaService);

  it('counts PENDING price changes, held to the depots given or the whole network', async () => {
    await expect(reader.priceOverrides([D1])).resolves.toEqual({ count: 4, oldestAt: OLDEST });
    expect(prisma.priceOverrideProposal.aggregate).toHaveBeenLastCalledWith({
      where: { status: PriceOverrideStatus.PENDING, depotId: { in: [D1] } },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    await reader.priceOverrides(undefined);
    expect(prisma.priceOverrideProposal.aggregate).toHaveBeenLastCalledWith({
      where: { status: PriceOverrideStatus.PENDING },
      _count: { _all: true },
      _min: { createdAt: true },
    });
  });

  it('counts every application not yet approved or rejected, by when it was sent', async () => {
    await expect(reader.franchiseApplications()).resolves.toEqual({ count: 4, oldestAt: OLDEST });
    expect(prisma.franchiseApplication.aggregate).toHaveBeenCalledWith({
      where: { stage: { notIn: [FranchiseAppStage.APPROVED, FranchiseAppStage.REJECTED] } },
      _count: { _all: true },
      _min: { submittedAt: true },
    });
  });

  it('counts PENDING and HELD items, never the ones the person raised', async () => {
    await expect(reader.approvals([D1, D2], ACTOR)).resolves.toEqual({ count: 4, oldestAt: null });
    expect(prisma.approval.aggregate).toHaveBeenLastCalledWith({
      where: {
        status: { in: [ApprovalStatus.PENDING, ApprovalStatus.HELD] },
        depotId: { in: [D1, D2] },
        submittedBy: { not: ACTOR },
      },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    await reader.approvals(undefined, ACTOR);
    expect(prisma.approval.aggregate).toHaveBeenLastCalledWith({
      where: {
        status: { in: [ApprovalStatus.PENDING, ApprovalStatus.HELD] },
        submittedBy: { not: ACTOR },
      },
      _count: { _all: true },
      _min: { createdAt: true },
    });
  });
});
