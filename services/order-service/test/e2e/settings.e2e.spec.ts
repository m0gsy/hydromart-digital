import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { OrderModule } from '../../src/modules/order.module';
import { ORDER_TOKENS } from '../../src/application/tokens';
import { SETTINGS_REPOSITORY } from '../../src/application/ports/settings.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import {
  FakeDepotDirectory,
  FakeForecastCoordination,
  FakeLoyaltyCoordination,
  FakeMembership,
  FakeNotification,
  FakePromo,
  FakeProductCatalog,
  FakeReferralCoordination,
  FakeRecommendationCoordination,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  InMemorySettingsRepository,
} from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';

describe('Settings HTTP flows (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let driverToken: string;

  beforeAll(async () => {
    const prismaStub = { onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              ORDER_SERVICE_PORT: 3004,
              ORDER_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              PRODUCT_SERVICE_URL: 'http://localhost:3003',
              DEPOT_SERVICE_URL: 'http://localhost:3007',
              LOYALTY_SERVICE_URL: 'http://localhost:3009',
              PROMO_SERVICE_URL: 'http://localhost:3010',
              REFERRAL_SERVICE_URL: 'http://localhost:3011',
              CRM_SERVICE_URL: 'http://localhost:3012',
              ORDER_DELIVERY_FEE: 1000,
              ORDER_ABANDON_MINUTES: 60,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        OrderModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(ORDER_TOKENS.CartRepository)
      .useValue(new InMemoryCartRepository())
      .overrideProvider(ORDER_TOKENS.OrderRepository)
      .useValue(new InMemoryOrderRepository())
      .overrideProvider(ORDER_TOKENS.ProductCatalog)
      .useValue(new FakeProductCatalog())
      .overrideProvider(ORDER_TOKENS.DepotDirectory)
      .useValue(new FakeDepotDirectory())
      .overrideProvider(ORDER_TOKENS.LoyaltyCoordination)
      .useValue(new FakeLoyaltyCoordination())
      .overrideProvider(ORDER_TOKENS.ReferralCoordination)
      .useValue(new FakeReferralCoordination())
      .overrideProvider(ORDER_TOKENS.RecommendationCoordination)
      .useValue(new FakeRecommendationCoordination())
      .overrideProvider(ORDER_TOKENS.ForecastCoordination)
      .useValue(new FakeForecastCoordination())
      .overrideProvider(ORDER_TOKENS.Membership)
      .useValue(new FakeMembership())
      .overrideProvider(ORDER_TOKENS.Notification)
      .useValue(new FakeNotification())
      .overrideProvider(ORDER_TOKENS.Promo)
      .useValue(new FakePromo())
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
    driverToken = jwt.sign({ sub: randomUUID(), role: Role.DRIVER, phone: '+62' }, { secret });
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
    expect(res.body.effective.deliveryFee).toBe(1000);
  });

  it('lets a depot manager set a GLOBAL override, then reads it back', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(managerToken))
      .send({ scope: 'GLOBAL', key: 'deliveryFee', value: '2500' })
      .expect(204);

    const res = await request(server())
      .get('/api/v1/settings/schema')
      .set(auth(managerToken))
      .expect(200);
    expect(res.body.effective.deliveryFee).toBe(2500);
  });

  it('forbids a driver from writing settings (403)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(driverToken))
      .send({ scope: 'GLOBAL', key: 'deliveryFee', value: '3000' })
      .expect(403);
  });

  it('rejects an out-of-range value (400)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(managerToken))
      .send({ scope: 'GLOBAL', key: 'deliveryFee', value: '999999' })
      .expect(400);
  });
});
