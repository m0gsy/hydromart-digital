import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { AdminModule } from '../../src/modules/admin.module';
import { ADMIN_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  FakeHealthProbe,
  InMemoryFeatureFlagRepository,
  InMemorySystemSettingsRepository,
  makeFlag,
} from '../support/fakes';
import { FlagState } from '../../src/domain/flag-state';

const SECRET = 'test-access-secret-that-is-long-enough-01';

describe('Admin HTTP flows (e2e)', () => {
  let app: INestApplication;
  let superToken: string;
  let headOfficeToken: string;
  let customerToken: string;
  const flagRepo = new InMemoryFeatureFlagRepository();

  beforeAll(async () => {
    flagRepo.flags = [makeFlag({ key: 'payments.va', state: FlagState.ROLLOUT, rolloutPct: 50 })];

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
              ADMIN_SERVICE_PORT: 3017,
              ADMIN_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
              AUTH_SERVICE_URL: 'http://auth:3001',
              ORDER_SERVICE_URL: 'http://order:3004',
            }),
          ],
        }),
        AdminModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(ADMIN_TOKENS.FeatureFlagRepository)
      .useValue(flagRepo)
      .overrideProvider(ADMIN_TOKENS.SystemSettingsRepository)
      .useValue(new InMemorySystemSettingsRepository())
      .overrideProvider(ADMIN_TOKENS.HealthProbe)
      .useValue(new FakeHealthProbe())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    const mint = (role: Role) => jwt.sign({ sub: randomUUID(), role, phone: '+62' }, { secret });
    superToken = mint(Role.SUPER_ADMIN);
    headOfficeToken = mint(Role.HEAD_OFFICE);
    customerToken = mint(Role.CUSTOMER);
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  describe('feature flags (8b)', () => {
    it('lists flags for head-office and super-admin, rejects customer (403) and anon (401)', async () => {
      await request(server()).get('/api/v1/feature-flags').expect(401);
      await request(server()).get('/api/v1/feature-flags').set(auth(customerToken)).expect(403);
      await request(server()).get('/api/v1/feature-flags').set(auth(headOfficeToken)).expect(200);
      const res = await request(server()).get('/api/v1/feature-flags').set(auth(superToken)).expect(200);
      expect(res.body).toEqual([expect.objectContaining({ key: 'payments.va', state: 'ROLLOUT' })]);
    });

    it('lets super-admin PATCH a flag but forbids head-office (403)', async () => {
      await request(server())
        .patch('/api/v1/feature-flags/payments.va')
        .set(auth(headOfficeToken))
        .send({ state: 'ACTIVE' })
        .expect(403);
      const res = await request(server())
        .patch('/api/v1/feature-flags/payments.va')
        .set(auth(superToken))
        .send({ state: 'ACTIVE', rolloutPct: null })
        .expect(200);
      expect(res.body).toMatchObject({ state: 'ACTIVE', rolloutPct: null });
    });

    it('returns 404 for an unknown flag key', async () => {
      await request(server())
        .patch('/api/v1/feature-flags/does.not.exist')
        .set(auth(superToken))
        .send({ state: 'OFF' })
        .expect(404);
    });

    it('rejects an invalid state (400)', async () => {
      await request(server())
        .patch('/api/v1/feature-flags/payments.va')
        .set(auth(superToken))
        .send({ state: 'BOGUS' })
        .expect(400);
    });
  });

  describe('system settings (8b)', () => {
    it('is super-admin only; head-office is forbidden (403)', async () => {
      await request(server()).get('/api/v1/system-settings').set(auth(headOfficeToken)).expect(403);
      const res = await request(server()).get('/api/v1/system-settings').set(auth(superToken)).expect(200);
      expect(res.body).toMatchObject({ defaultTimezone: 'Asia/Jakarta', currency: 'IDR' });
    });

    it('saves settings via PUT and reads them back', async () => {
      await request(server())
        .put('/api/v1/system-settings')
        .set(auth(superToken))
        .send({ defaultTimezone: 'Asia/Makassar', currency: 'IDR', serviceRadiusKm: 9 })
        .expect(200);
      const res = await request(server()).get('/api/v1/system-settings').set(auth(superToken)).expect(200);
      expect(res.body).toMatchObject({ defaultTimezone: 'Asia/Makassar', serviceRadiusKm: 9 });
    });
  });

  describe('system health (13b)', () => {
    it('rolls up per-service probes for head-office/super-admin', async () => {
      const res = await request(server()).get('/api/v1/system-health').set(auth(superToken)).expect(200);
      // The configured registry drives `total`; every probe is a healthy fake, so all are up.
      expect(res.body.total).toBeGreaterThanOrEqual(2);
      expect(res.body.upCount).toBe(res.body.total);
      expect(res.body.services).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'auth-service', status: 'up' }),
          expect.objectContaining({ name: 'order-service', status: 'up' }),
        ]),
      );
      expect(typeof res.body.checkedAt).toBe('string');
    });

    it('forbids a customer (403)', async () => {
      await request(server()).get('/api/v1/system-health').set(auth(customerToken)).expect(403);
    });
  });
});
