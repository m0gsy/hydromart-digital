import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { RecommendationModule } from '../../src/modules/recommendation.module';
import { RECOMMENDATION_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { FakeOrderFeed, FakeRecommendationRepository } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const INTERNAL_KEY = 'test-internal-service-key-01';

function ingestBody(overrides: Record<string, unknown> = {}) {
  return {
    orderId: randomUUID(),
    customerId: randomUUID(),
    items: [
      { productId: randomUUID(), productName: 'Aqua 19L', sku: 'AQ19', unit: 'galon' },
      { productId: randomUUID(), productName: 'Aqua 600ml', sku: 'AQ06', unit: 'botol' },
    ],
    ...overrides,
  };
}

describe('Recommendation HTTP flows (e2e)', () => {
  let app: INestApplication;
  let repo: FakeRecommendationRepository;
  let feed: FakeOrderFeed;
  let customerAId: string;
  let customerAToken: string;
  let customerBToken: string;
  let superAdminToken: string;

  beforeAll(async () => {
    // Joi's validationSchema validates raw process.env, not the `load()` factory below —
    // so every required key must be seeded here too, or ConfigModule.forRoot throws before
    // the fakes/module even compile.
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.RECOMMENDATION_DATABASE_URL = 'postgresql://u:p@localhost:5432/db?schema=public';

    repo = new FakeRecommendationRepository();
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
              RECOMMENDATION_SERVICE_PORT: 3013,
              RECOMMENDATION_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              INTERNAL_SERVICE_KEY: INTERNAL_KEY,
              ORDER_SERVICE_URL: 'http://localhost:3004',
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        RecommendationModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(RECOMMENDATION_TOKENS.Repository)
      .useValue(repo)
      .overrideProvider(RECOMMENDATION_TOKENS.OrderFeed)
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
    customerAId = randomUUID();
    customerAToken = jwt.sign({ sub: customerAId, role: Role.CUSTOMER, phone: '+62' }, { secret });
    customerBToken = jwt.sign({ sub: randomUUID(), role: Role.CUSTOMER, phone: '+62' }, { secret });
    superAdminToken = jwt.sign({ sub: randomUUID(), role: Role.SUPER_ADMIN, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('rejects ingest with no internal key (401) and a wrong key (401)', async () => {
    await request(server()).post('/api/v1/recommendations/ingest').send(ingestBody()).expect(401);
    await request(server())
      .post('/api/v1/recommendations/ingest')
      .set('x-internal-key', 'wrong-key')
      .send(ingestBody())
      .expect(401);
  });

  it('accepts ingest with the right internal key and makes the data queryable', async () => {
    const productId = randomUUID();
    const body = ingestBody({ items: [{ productId, productName: 'Aqua 19L', sku: 'AQ19', unit: 'galon' }] });

    await request(server())
      .post('/api/v1/recommendations/ingest')
      .set('x-internal-key', INTERNAL_KEY)
      .send(body)
      .expect(200);

    const trending = await request(server()).get('/api/v1/recommendations/trending').expect(200);
    expect(trending.body.map((i: { productId: string }) => i.productId)).toContain(productId);

    const related = await request(server())
      .get(`/api/v1/recommendations/products/${productId}/related`)
      .expect(200);
    expect(related.body).toEqual([]); // no co-buy partner ingested for this product
  });

  it('rejects reorder with no token (401)', async () => {
    await request(server()).get('/api/v1/recommendations/reorder').expect(401);
  });

  it('reorder returns only the calling customer\'s items (cross-customer isolation)', async () => {
    const productId = randomUUID();

    await request(server())
      .post('/api/v1/recommendations/ingest')
      .set('x-internal-key', INTERNAL_KEY)
      .send(
        ingestBody({
          customerId: customerAId,
          items: [{ productId, productName: 'Le Minerale 19L', sku: 'LM19', unit: 'galon' }],
        }),
      )
      .expect(200);

    const resA = await request(server()).get('/api/v1/recommendations/reorder').set(auth(customerAToken)).expect(200);
    expect(resA.body.map((i: { productId: string }) => i.productId)).toContain(productId);

    const resB = await request(server()).get('/api/v1/recommendations/reorder').set(auth(customerBToken)).expect(200);
    expect(resB.body.map((i: { productId: string }) => i.productId)).not.toContain(productId);
  });

  it('rebuild is restricted to SUPER_ADMIN (403 customer) and pulls the order feed (200)', async () => {
    await request(server()).post('/api/v1/recommendations/rebuild').set(auth(customerAToken)).expect(403);

    const productId = randomUUID();
    feed.orders = [
      {
        orderId: randomUUID(),
        customerId: randomUUID(),
        depotId: null,
        at: new Date(),
        items: [{ productId, productName: 'Vit 19L', sku: 'VIT19', unit: 'galon' }],
      },
    ];

    const res = await request(server())
      .post('/api/v1/recommendations/rebuild')
      .set(auth(superAdminToken))
      .expect(200);
    expect(res.body).toMatchObject({ ingested: 1 });

    const trending = await request(server()).get('/api/v1/recommendations/trending').expect(200);
    expect(trending.body.map((i: { productId: string }) => i.productId)).toContain(productId);
  });
});
