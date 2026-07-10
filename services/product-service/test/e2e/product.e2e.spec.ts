import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { ProductModule } from '../../src/modules/product.module';
import { PRODUCT_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { InMemoryCategoryRepository, InMemoryProductRepository } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';

describe('Product HTTP flows (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let customerToken: string;

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
              PRODUCT_SERVICE_PORT: 3003,
              PRODUCT_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        ProductModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(PRODUCT_TOKENS.ProductRepository)
      .useValue(new InMemoryProductRepository())
      .overrideProvider(PRODUCT_TOKENS.CategoryRepository)
      .useValue(new InMemoryCategoryRepository())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    adminToken = jwt.sign({ sub: 'a', role: Role.DEPOT_MANAGER, phone: '+62' }, { secret });
    customerToken = jwt.sign({ sub: 'c', role: Role.CUSTOMER, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();

  it('browses the catalog publicly (no token)', async () => {
    const res = await request(server()).get('/api/v1/products').expect(200);
    expect(res.body).toMatchObject({ total: 0, page: 1 });
  });

  it('forbids product creation for a customer (403) and anonymous (401)', async () => {
    const body = { name: 'Air Galon 19L', sku: 'AIR-19L', unit: 'Galon 19L', basePrice: 20000 };
    await request(server()).post('/api/v1/products').send(body).expect(401);
    await request(server())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${customerToken}`)
      .send(body)
      .expect(403);
  });

  it('lets an admin create a product, then it appears in public browse', async () => {
    const created = await request(server())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Air Galon 19L', sku: 'AIR-19L', unit: 'Galon 19L', basePrice: 20000 })
      .expect(201);
    expect(created.body.basePrice).toBe(20000);

    const list = await request(server()).get('/api/v1/products?search=galon').expect(200);
    expect(list.body.total).toBe(1);
  });

  it('rejects an invalid basePrice (400)', async () => {
    await request(server())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'x', sku: 'Y', unit: 'u', basePrice: -5 })
      .expect(400);
  });

  it('returns 404 for a missing product', async () => {
    await request(server())
      .get('/api/v1/products/11111111-1111-1111-1111-111111111111')
      .expect(404);
  });
});
