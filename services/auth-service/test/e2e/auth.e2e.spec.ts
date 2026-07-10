import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule as _AppModule } from '../../src/app.module';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { HealthModule } from '../../src/modules/health/health.module';
import { AUTH_TOKENS } from '../../src/application/tokens';
import { OtpPurpose } from '../../src/domain/otp/otp-purpose.enum';
import { GlobalValidationPipe } from '../../src/common/pipes/validation.pipe';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  FakeOtpDelivery,
  InMemoryAuditLogRepository,
  InMemoryCustomerRepository,
  InMemoryOtpTokenRepository,
  InMemoryRefreshTokenRepository,
} from '../support/fakes';

// Reference AppModule so the import is retained for coverage of the compiled graph.
void _AppModule;

describe('Auth HTTP flows (e2e)', () => {
  let app: INestApplication;
  let delivery: FakeOtpDelivery;

  beforeAll(async () => {
    delivery = new FakeOtpDelivery();
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
              AUTH_SERVICE_PORT: 3001,
              AUTH_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-01',
              JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-1',
              JWT_ACCESS_TTL: 900,
              JWT_REFRESH_TTL: 2592000,
              OTP_TTL_SECONDS: 300,
              OTP_LENGTH: 6,
              OTP_MAX_ATTEMPTS: 5,
              OTP_RESEND_COOLDOWN_SECONDS: 60,
              OTP_DELIVERY_CHANNEL: 'console',
              OTP_PEPPER: 'test-otp-pepper-value',
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        AuthModule,
        HealthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(AUTH_TOKENS.CustomerRepository)
      .useValue(new InMemoryCustomerRepository())
      .overrideProvider(AUTH_TOKENS.OtpTokenRepository)
      .useValue(new InMemoryOtpTokenRepository())
      .overrideProvider(AUTH_TOKENS.RefreshTokenRepository)
      .useValue(new InMemoryRefreshTokenRepository())
      .overrideProvider(AUTH_TOKENS.AuditLogRepository)
      .useValue(new InMemoryAuditLogRepository())
      .overrideProvider(AUTH_TOKENS.OtpDeliveryPort)
      .useValue(delivery)
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

  const server = () => app.getHttpServer();

  it('completes the register → verify → me → refresh journey', async () => {
    const phone = '081234567890';

    const register = await request(server())
      .post('/api/v1/auth/register')
      .send({ phone, fullName: 'Budi' })
      .expect(200);
    expect(register.body.phoneMasked).toContain('*');

    const code = delivery.lastCode as string;
    expect(code).toMatch(/^\d{6}$/);

    const verify = await request(server())
      .post('/api/v1/auth/otp/verify')
      .send({ phone, code, purpose: OtpPurpose.REGISTRATION })
      .expect(200);
    expect(verify.body.accessToken).toBeDefined();
    expect(verify.body.refreshToken).toBeDefined();
    expect(verify.body.customer.status).toBe('ACTIVE');

    const { accessToken, refreshToken } = verify.body;

    const me = await request(server())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.phone).toBe('+6281234567890');

    const refreshed = await request(server())
      .post('/api/v1/auth/token/refresh')
      .send({ refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).not.toBe(refreshToken);
  });

  it('rejects access to a protected route without a token', async () => {
    await request(server()).get('/api/v1/auth/me').expect(401);
  });

  it('returns 422 for an invalid phone number', async () => {
    const res = await request(server())
      .post('/api/v1/auth/register')
      .send({ phone: '12345' })
      .expect(422);
    expect(res.body.code).toBe('AUTH_INVALID_PHONE');
  });

  it('returns 400 for a payload that fails validation', async () => {
    const res = await request(server())
      .post('/api/v1/auth/register')
      .send({ phone: '', extra: 'nope' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('serves the health endpoint as public', async () => {
    // Prisma is stubbed (no $queryRaw), so the DB check reports down → 503,
    // but the route is reachable without auth, proving @Public() works.
    await request(server()).get('/api/v1/health').expect(503);
  });
});
