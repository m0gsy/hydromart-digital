import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { LoyaltyModule } from '../../src/modules/loyalty.module';
import { LOYALTY_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { InMemoryLoyaltyRepository } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';

describe('Loyalty HTTP flows (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let operatorToken: string;
  let customerToken: string;
  let superToken: string;

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
              LOYALTY_SERVICE_PORT: 3009,
              LOYALTY_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
              LOYALTY_EARN_RATE_RUPIAH: 1000,
              LOYALTY_POINT_EXPIRY_MONTHS: 12,
            }),
          ],
        }),
        LoyaltyModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(LOYALTY_TOKENS.LoyaltyRepository)
      .useValue(new InMemoryLoyaltyRepository())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    managerToken = jwt.sign({ sub: randomUUID(), role: Role.DEPOT_MANAGER, phone: '+62' }, { secret });
    operatorToken = jwt.sign({ sub: randomUUID(), role: Role.DEPOT_OPERATOR, phone: '+62' }, { secret });
    customerToken = jwt.sign({ sub: randomUUID(), role: Role.CUSTOMER, phone: '+62' }, { secret });
    superToken = jwt.sign({ sub: randomUUID(), role: Role.SUPER_ADMIN, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('lists membership tiers publicly', async () => {
    const res = await request(server()).get('/api/v1/loyalty/tiers').expect(200);
    expect(res.body).toHaveLength(4);
    expect(res.body[0]).toMatchObject({ tier: 'REGULAR', discountRate: 0 });
  });

  it('requires auth to read the current account, then lazily creates it', async () => {
    await request(server()).get('/api/v1/loyalty/me').expect(401);
    const res = await request(server()).get('/api/v1/loyalty/me').set(auth(customerToken)).expect(200);
    expect(res.body).toMatchObject({ tier: 'REGULAR', pointsBalance: 0, discountRate: 0 });
  });

  it('restricts earning to fulfilment roles (401 anon, 403 customer)', async () => {
    const body = { customerId: randomUUID(), orderId: randomUUID(), subtotal: 60000 };
    await request(server()).post('/api/v1/loyalty/earn').send(body).expect(401);
    await request(server()).post('/api/v1/loyalty/earn').set(auth(customerToken)).send(body).expect(403);
  });

  it('awards points on earn and reflects them for staff reads (BR-013)', async () => {
    const customerId = randomUUID();
    await request(server())
      .post('/api/v1/loyalty/earn')
      .set(auth(operatorToken))
      .send({ customerId, orderId: randomUUID(), subtotal: 60000 })
      .expect(201);

    const res = await request(server())
      .get(`/api/v1/loyalty/customers/${customerId}`)
      .set(auth(managerToken))
      .expect(200);
    expect(res.body).toMatchObject({ pointsBalance: 60, lifetimePoints: 60 });
  });

  it('rejects a zero-delta adjustment (validation) and enforces adjust roles', async () => {
    await request(server())
      .post('/api/v1/loyalty/adjust')
      .set(auth(customerToken))
      .send({ customerId: randomUUID(), points: 100, reason: 'x' })
      .expect(403);
    await request(server())
      .post('/api/v1/loyalty/adjust')
      .set(auth(managerToken))
      .send({ customerId: randomUUID(), points: 0, reason: 'x' })
      .expect(400);
  });

  it('runs the expiry sweep only for SUPER_ADMIN', async () => {
    await request(server()).post('/api/v1/loyalty/expire').set(auth(managerToken)).expect(403);
    const res = await request(server()).post('/api/v1/loyalty/expire').set(auth(superToken)).expect(200);
    expect(res.body).toMatchObject({ lotsExpired: expect.any(Number) });
  });
});
