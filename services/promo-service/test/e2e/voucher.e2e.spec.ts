import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { PromoModule } from '../../src/modules/promo.module';
import { PROMO_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { InMemoryVoucherRepository } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const INTERNAL_KEY = 'test-internal-service-key-0123456789';

describe('Voucher HTTP flows (e2e)', () => {
  let app: INestApplication;
  let marketingToken: string;
  let customerToken: string;

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
          validationSchema: envValidationSchema,
          validationOptions: { allowUnknown: true },
          load: [
            () => ({
              NODE_ENV: 'test',
              PROMO_SERVICE_PORT: 3010,
              PROMO_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
              INTERNAL_SERVICE_KEY: INTERNAL_KEY,
            }),
          ],
        }),
        PromoModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(PROMO_TOKENS.VoucherRepository)
      .useValue(new InMemoryVoucherRepository())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    marketingToken = jwt.sign({ sub: randomUUID(), role: Role.MARKETING, phone: '+62' }, { secret });
    customerToken = jwt.sign({ sub: randomUUID(), role: Role.CUSTOMER, phone: '+62' }, { secret });

    // Seed one voucher for the whole suite (the repo is shared across tests).
    await request(server())
      .post('/api/v1/vouchers')
      .set(auth(marketingToken))
      .send({ code: 'HEMAT10', discountType: 'PERCENTAGE', value: 10 })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const internal = (k: string) => ({ 'x-internal-key': k });

  it('creates a voucher (marketing) and previews it publicly by code', async () => {
    const res = await request(server()).get('/api/v1/vouchers/HEMAT10').expect(200);
    expect(res.body).toMatchObject({ code: 'HEMAT10', discountType: 'PERCENTAGE', value: 10 });
  });

  it('forbids a customer from creating a voucher', async () => {
    await request(server())
      .post('/api/v1/vouchers')
      .set(auth(customerToken))
      .send({ code: 'NOPE5', discountType: 'FIXED', value: 5000 })
      .expect(403);
  });

  it('quotes a discount for an authenticated customer, 401 for anonymous', async () => {
    await request(server()).post('/api/v1/vouchers/quote').send({ code: 'HEMAT10', subtotal: 60000 }).expect(401);

    const res = await request(server())
      .post('/api/v1/vouchers/quote')
      .set(auth(customerToken))
      .send({ code: 'HEMAT10', subtotal: 60000 })
      .expect(200);
    expect(res.body).toMatchObject({ code: 'HEMAT10', discount: 6000, valid: true });
  });

  it('requires the internal service key to redeem (401 without/wrong key)', async () => {
    const body = { code: 'HEMAT10', customerId: randomUUID(), orderId: randomUUID(), subtotal: 60000 };
    await request(server()).post('/api/v1/vouchers/redeem').send(body).expect(401);
    await request(server()).post('/api/v1/vouchers/redeem').set(auth(customerToken)).send(body).expect(401);
    await request(server()).post('/api/v1/vouchers/redeem').set(internal('wrong-key')).send(body).expect(401);
  });

  it('redeems a voucher via internal auth and returns the applied discount', async () => {
    const res = await request(server())
      .post('/api/v1/vouchers/redeem')
      .set(internal(INTERNAL_KEY))
      .send({ code: 'HEMAT10', customerId: randomUUID(), orderId: randomUUID(), subtotal: 60000 })
      .expect(200);
    expect(res.body).toMatchObject({ discountApplied: 6000 });
  });
});
