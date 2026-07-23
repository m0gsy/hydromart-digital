import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { ReferralModule } from '../../src/modules/referral.module';
import { REFERRAL_TOKENS } from '../../src/application/tokens';
import { SETTINGS_REPOSITORY } from '../../src/application/ports/settings.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  FakeCustomerDirectory,
  FakeLoyaltyReward,
  InMemoryReferralRepository,
  InMemorySettingsRepository,
} from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';

describe('Settings HTTP flows (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let customerToken: string;

  beforeAll(async () => {
    process.env.REFERRAL_DATABASE_URL = 'postgresql://u:p@localhost:5432/db?schema=public';
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.LOYALTY_SERVICE_URL = 'http://localhost:3009';
    const prismaStub = { onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };
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
              REFERRAL_SERVICE_PORT: 3011,
              REFERRAL_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
              LOYALTY_SERVICE_URL: 'http://localhost:3009',
              REFERRAL_REFERRER_POINTS: 500,
              REFERRAL_REFEREE_POINTS: 250,
            }),
          ],
        }),
        ReferralModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(REFERRAL_TOKENS.ReferralRepository)
      .useValue(new InMemoryReferralRepository())
      .overrideProvider(REFERRAL_TOKENS.LoyaltyReward)
      .useValue(new FakeLoyaltyReward())
      .overrideProvider(REFERRAL_TOKENS.CustomerDirectory)
      .useValue(new FakeCustomerDirectory())
      .overrideProvider(SETTINGS_REPOSITORY)
      .useValue(new InMemorySettingsRepository())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    managerToken = jwt.sign(
      { sub: randomUUID(), role: Role.DEPOT_MANAGER, phone: '+62' },
      { secret },
    );
    customerToken = jwt.sign({ sub: randomUUID(), role: Role.CUSTOMER, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('returns the schema with env-default effective values', async () => {
    const res = await request(server())
      .get('/api/v1/settings/schema')
      .set(auth(managerToken))
      .expect(200);
    expect(res.body.effective.referrerPoints).toBe(500);
    expect(res.body.effective.refereePoints).toBe(250);
  });

  it('lets a depot manager set a GLOBAL override, then reads it back', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(managerToken))
      .send({ scope: 'GLOBAL', key: 'referrerPoints', value: '600' })
      .expect(204);

    const res = await request(server())
      .get('/api/v1/settings/schema')
      .set(auth(managerToken))
      .expect(200);
    expect(res.body.effective.referrerPoints).toBe(600);
  });

  it('forbids a customer from writing settings (403)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(customerToken))
      .send({ scope: 'GLOBAL', key: 'referrerPoints', value: '700' })
      .expect(403);
  });

  it('rejects an out-of-range value (400)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(managerToken))
      .send({ scope: 'GLOBAL', key: 'referrerPoints', value: '999999' })
      .expect(400);
  });

  // The DEPOT-scope global-only rejection is unit-tested in settings.service.spec.ts;
  // exercising it here would additionally require a matching depotId on the JWT to
  // clear DepotScopeGuard first (SUPER_ADMIN is not depot-locked and would bypass the
  // guard, muddying what the test demonstrates).
});
