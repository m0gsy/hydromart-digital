import { createHmac, randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { PaymentModule } from '../../src/modules/payment.module';
import { PAYMENT_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { FakeGateway, FakeOrderCoordination, InMemoryPaymentRepository } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';

describe('Payment HTTP flows (e2e)', () => {
  let app: INestApplication;
  let customerToken: string;
  let financeToken: string;
  let webhookSecret: string;

  beforeAll(async () => {
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
              PAYMENT_SERVICE_PORT: 3005,
              PAYMENT_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
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
      .useValue(prismaStub)
      .overrideProvider(PAYMENT_TOKENS.PaymentRepository)
      .useValue(new InMemoryPaymentRepository())
      .overrideProvider(PAYMENT_TOKENS.PaymentGateway)
      .useValue(new FakeGateway())
      // Keep the e2e hermetic: the real coordination adapter would try a live
      // order-service fetch (SEC-1 total lookup) if ORDER_SERVICE_URL/INTERNAL_SERVICE_KEY
      // leak in from the environment. The fake returns null → validation skipped.
      .overrideProvider(PAYMENT_TOKENS.OrderCoordination)
      .useValue(new FakeOrderCoordination())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const config = app.get(ConfigService);
    const secret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
    // Sign webhooks with whatever secret the service actually resolved (may come
    // from .env rather than the in-test load()), so the HMAC matches.
    webhookSecret = config.getOrThrow<string>('PAYMENT_WEBHOOK_SECRET');
    const jwt = app.get(JwtService);
    customerToken = jwt.sign({ sub: randomUUID(), role: Role.CUSTOMER, phone: '+62' }, { secret });
    financeToken = jwt.sign({ sub: randomUUID(), role: Role.FINANCE, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('requires authentication to initiate a payment', async () => {
    await request(server())
      .post('/api/v1/payments')
      .send({ orderId: randomUUID(), method: 'CASH', amount: 45000 })
      .expect(401);
  });

  it('initiates a cash payment, then forbids a customer from confirming it', async () => {
    const created = await request(server())
      .post('/api/v1/payments')
      .set(auth(customerToken))
      .send({ orderId: randomUUID(), method: 'CASH', amount: 45000 })
      .expect(201);
    expect(created.body.status).toBe('PENDING');
    const id = created.body.id;

    await request(server())
      .post(`/api/v1/payments/${id}/confirm`)
      .set(auth(customerToken))
      .expect(403);

    const confirmed = await request(server())
      .post(`/api/v1/payments/${id}/confirm`)
      .set(auth(financeToken))
      .expect(201);
    expect(confirmed.body.status).toBe('PAID');

    const refunded = await request(server())
      .post(`/api/v1/payments/${id}/refund`)
      .set(auth(financeToken))
      .send({ reason: 'cancelled' })
      .expect(201);
    expect(refunded.body.status).toBe('REFUNDED');
  });

  it('settles an online payment through the signed webhook (no bearer token)', async () => {
    const created = await request(server())
      .post('/api/v1/payments')
      .set(auth(customerToken))
      .send({ orderId: randomUUID(), method: 'VA', amount: 30000 })
      .expect(201);
    const reference = created.body.reference as string;
    const signature = createHmac('sha256', webhookSecret).update(`${reference}.PAID`).digest('hex');

    const hook = await request(server())
      .post('/api/v1/payments/webhook')
      .send({ reference, event: 'PAID', signature })
      .expect(200);
    expect(hook.body.handled).toBe(true);

    const fetched = await request(server())
      .get(`/api/v1/payments/${created.body.id}`)
      .set(auth(customerToken))
      .expect(200);
    expect(fetched.body.status).toBe('PAID');
  });

  it('rejects a webhook with a forged signature (401)', async () => {
    await request(server())
      .post('/api/v1/payments/webhook')
      .send({ reference: 'x', event: 'PAID', signature: 'forged' })
      .expect(401);
  });

  it('validates the initiate body (400 on bad amount)', async () => {
    await request(server())
      .post('/api/v1/payments')
      .set(auth(customerToken))
      .send({ orderId: randomUUID(), method: 'CASH', amount: -1 })
      .expect(400);
  });

  it("returns 404 for a missing / other customer's payment", async () => {
    await request(server())
      .get(`/api/v1/payments/${randomUUID()}`)
      .set(auth(customerToken))
      .expect(404);
  });
});
