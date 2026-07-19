import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { ReferralModule } from '../../src/modules/referral.module';
import { REFERRAL_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { FakeLoyaltyReward, InMemoryReferralRepository } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const INTERNAL_KEY = 'test-internal-service-key-0123456789';

describe('Referral HTTP flows (e2e)', () => {
  let app: INestApplication;
  let customerAToken: string;
  let customerBToken: string;
  let customerAId: string;
  let customerBId: string;

  beforeAll(async () => {
    // Joi validationSchema validates process.env and its default('') beats load(), so the
    // InternalAuthGuard would read a blank key. Seed process.env before ConfigModule compiles.
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    const prismaStub = { onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
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
              INTERNAL_SERVICE_KEY: INTERNAL_KEY,
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
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    customerAId = randomUUID();
    customerBId = randomUUID();
    customerAToken = jwt.sign({ sub: customerAId, role: Role.CUSTOMER, phone: '+62' }, { secret });
    customerBToken = jwt.sign({ sub: customerBId, role: Role.CUSTOMER, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const internal = (k: string) => ({ 'x-internal-key': k });

  let sharedCode: string;

  it('returns a lazily-created referral code for the current customer', async () => {
    const res = await request(server()).get('/api/v1/referrals/me/code').set(auth(customerAToken)).expect(200);
    expect(res.body).toMatchObject({ customerId: customerAId });
    expect(res.body.code).toMatch(/^[A-Z0-9]{8}$/);
    sharedCode = res.body.code;
  });

  it('lets a customer redeem a code (happy path)', async () => {
    const res = await request(server())
      .post('/api/v1/referrals')
      .set(auth(customerBToken))
      .send({ code: sharedCode })
      .expect(201);
    expect(res.body).toMatchObject({
      referrerCustomerId: customerAId,
      refereeCustomerId: customerBId,
      status: 'PENDING',
    });
  });

  it('rejects redeeming your own code with 422 (self-referral)', async () => {
    await request(server())
      .post('/api/v1/referrals')
      .set(auth(customerAToken))
      .send({ code: sharedCode })
      .expect(422);
  });

  it('rejects a duplicate redemption with 409', async () => {
    await request(server())
      .post('/api/v1/referrals')
      .set(auth(customerBToken))
      .send({ code: sharedCode })
      .expect(409);
  });

  it('requires the internal service key to qualify (401 without/wrong key, 200 with key)', async () => {
    const body = { customerId: customerBId, orderId: randomUUID() };
    await request(server()).post('/api/v1/referrals/qualify').send(body).expect(401);
    await request(server())
      .post('/api/v1/referrals/qualify')
      .set(auth(customerBToken))
      .send(body)
      .expect(401);
    await request(server())
      .post('/api/v1/referrals/qualify')
      .set(internal('wrong-key'))
      .send(body)
      .expect(401);
    const res = await request(server())
      .post('/api/v1/referrals/qualify')
      .set(internal(INTERNAL_KEY))
      .send(body)
      .expect(200);
    expect(res.body).toMatchObject({ qualified: true });
  });
});
