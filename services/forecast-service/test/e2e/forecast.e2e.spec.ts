import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { ForecastModule } from '../../src/modules/forecast.module';
import { FORECAST_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { FakeForecastRepository, FakeOrderFeed } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const INTERNAL_KEY = 'test-internal-service-key-01';

function ingestBody(overrides: Record<string, unknown> = {}) {
  return {
    orderId: randomUUID(),
    depotId: randomUUID(),
    items: [
      { productId: randomUUID(), productName: 'Aqua 19L', sku: 'AQ19', unit: 'galon', quantity: 3 },
      { productId: randomUUID(), productName: 'Aqua 600ml', sku: 'AQ06', unit: 'botol', quantity: 5 },
    ],
    ...overrides,
  };
}

describe('Forecast HTTP flows (e2e)', () => {
  let app: INestApplication;
  let repo: FakeForecastRepository;
  let feed: FakeOrderFeed;
  let managerToken: string;
  let customerToken: string;
  let superAdminToken: string;

  beforeAll(async () => {
    // Joi's validationSchema validates raw process.env, not the `load()` factory below —
    // so every required key must be seeded here too (and INTERNAL_SERVICE_KEY defaults to ''
    // → the guard would fail closed), or ConfigModule.forRoot throws before compile.
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.FORECAST_DATABASE_URL = 'postgresql://u:p@localhost:5432/db?schema=public';

    repo = new FakeForecastRepository();
    feed = new FakeOrderFeed();

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
              FORECAST_SERVICE_PORT: 3014,
              FORECAST_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              INTERNAL_SERVICE_KEY: INTERNAL_KEY,
              ORDER_SERVICE_URL: 'http://localhost:3004',
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        ForecastModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(FORECAST_TOKENS.Repository)
      .useValue(repo)
      .overrideProvider(FORECAST_TOKENS.OrderFeed)
      .useValue(feed)
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
    customerToken = jwt.sign({ sub: randomUUID(), role: Role.CUSTOMER, phone: '+62' }, { secret });
    superAdminToken = jwt.sign({ sub: randomUUID(), role: Role.SUPER_ADMIN, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('rejects ingest with no internal key (401) and a wrong key (401)', async () => {
    await request(server()).post('/api/v1/forecast/ingest').send(ingestBody()).expect(401);
    await request(server())
      .post('/api/v1/forecast/ingest')
      .set('x-internal-key', 'wrong-key')
      .send(ingestBody())
      .expect(401);
  });

  it('accepts ingest with the right internal key and makes the data queryable', async () => {
    const productId = randomUUID();
    const depotId = randomUUID();
    const body = ingestBody({
      depotId,
      items: [{ productId, productName: 'Aqua 19L', sku: 'AQ19', unit: 'galon', quantity: 4 }],
    });

    await request(server())
      .post('/api/v1/forecast/ingest')
      .set('x-internal-key', INTERNAL_KEY)
      .send(body)
      .expect(200);

    const demand = await request(server())
      .get('/api/v1/forecast/demand')
      .query({ productId, depotId })
      .set(auth(managerToken))
      .expect(200);
    expect(demand.body.productId).toBe(productId);
    expect(demand.body.name).toBe('Aqua 19L');
    expect(demand.body.predictedDaily.length).toBe(7); // default horizon

    const rollup = await request(server())
      .get(`/api/v1/forecast/depot/${depotId}`)
      .set(auth(managerToken))
      .expect(200);
    expect(rollup.body.map((i: { productId: string }) => i.productId)).toContain(productId);
  });

  it('gates demand + depot rollup to planning staff (403 customer, 401 anon)', async () => {
    const productId = randomUUID();
    const depotId = randomUUID();

    await request(server()).get('/api/v1/forecast/demand').query({ productId }).expect(401);
    await request(server())
      .get('/api/v1/forecast/demand')
      .query({ productId })
      .set(auth(customerToken))
      .expect(403);
    await request(server()).get(`/api/v1/forecast/depot/${depotId}`).set(auth(customerToken)).expect(403);
  });

  it('rebuild is restricted to SUPER_ADMIN (403 customer) and pulls the order feed (200)', async () => {
    await request(server()).post('/api/v1/forecast/rebuild').set(auth(customerToken)).expect(403);
    // A planning role that is not SUPER_ADMIN is also rejected (method-level @Roles override).
    await request(server()).post('/api/v1/forecast/rebuild').set(auth(managerToken)).expect(403);

    const productId = randomUUID();
    const depotId = randomUUID();
    feed.orders = [
      {
        orderId: randomUUID(),
        depotId,
        at: new Date(),
        items: [{ productId, productName: 'Vit 19L', sku: 'VIT19', unit: 'galon', quantity: 2 }],
      },
    ];

    const res = await request(server())
      .post('/api/v1/forecast/rebuild')
      .set(auth(superAdminToken))
      .expect(200);
    expect(res.body).toMatchObject({ ingested: 1, pages: 1 });

    const demand = await request(server())
      .get('/api/v1/forecast/demand')
      .query({ productId, depotId })
      .set(auth(superAdminToken))
      .expect(200);
    expect(demand.body.productId).toBe(productId);
  });
});
