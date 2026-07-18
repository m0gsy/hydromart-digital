import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { OrderModule } from '../../src/modules/order.module';
import { ORDER_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  FakeDepotDirectory,
  FakeLoyaltyCoordination,
  FakeReferralCoordination,
  FakeRecommendationCoordination,
  FakeForecastCoordination,
  FakeMembership,
  FakeNotification,
  FakePromo,
  FakeProductCatalog,
  InMemoryCartRepository,
  InMemoryOrderRepository,
} from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const INTERNAL_KEY = 'test-internal-service-key-01';

const ADDRESS = {
  recipientName: 'Budi',
  phone: '081234567890',
  addressLine: 'Jl. Merdeka 10',
  city: 'Bandung',
  province: 'Jawa Barat',
};

describe('Order HTTP flows (e2e)', () => {
  let app: INestApplication;
  let customerToken: string;
  let staffToken: string;
  // HQ actor: a bypass role for the by-id depot guard, so it can drive an unrouted
  // order (this e2e's ADDRESS has no coords, so orders never resolve a depot).
  let adminToken: string;
  let catalog: FakeProductCatalog;
  const productId = randomUUID();

  beforeAll(async () => {
    // Joi validationSchema validates process.env (its default '' would otherwise win over
    // load()), and InternalAuthGuard reads the key via ConfigService — seed it here.
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    catalog = new FakeProductCatalog();
    catalog.seed({ id: productId, basePrice: 20000 });

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
              ORDER_SERVICE_PORT: 3004,
              ORDER_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              PRODUCT_SERVICE_URL: 'http://localhost:3003',
              DEPOT_SERVICE_URL: 'http://localhost:3007',
              LOYALTY_SERVICE_URL: 'http://localhost:3009',
              PROMO_SERVICE_URL: 'http://localhost:3010',
              REFERRAL_SERVICE_URL: 'http://localhost:3011',
              CRM_SERVICE_URL: 'http://localhost:3012',
              INTERNAL_SERVICE_KEY: INTERNAL_KEY,
              ORDER_DELIVERY_FEE: 5000,
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
      .useValue(catalog)
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
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    customerToken = jwt.sign({ sub: randomUUID(), role: Role.CUSTOMER, phone: '+62' }, { secret });
    staffToken = jwt.sign(
      { sub: randomUUID(), role: Role.DEPOT_MANAGER, phone: '+62' },
      { secret },
    );
    adminToken = jwt.sign(
      { sub: randomUUID(), role: Role.SUPER_ADMIN, phone: '+62' },
      { secret },
    );
  });

  afterAll(async () => {
    delete process.env.INTERNAL_SERVICE_KEY;
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('requires authentication for the cart', async () => {
    await request(server()).get('/api/v1/cart').expect(401);
  });

  it('runs the cart → checkout → order happy path for a customer', async () => {
    await request(server())
      .post('/api/v1/cart/items')
      .set(auth(customerToken))
      .send({ productId, quantity: 2 })
      .expect(201);

    const cart = await request(server()).get('/api/v1/cart').set(auth(customerToken)).expect(200);
    expect(cart.body.subtotal).toBe(40000);

    const order = await request(server())
      .post('/api/v1/orders/checkout')
      .set(auth(customerToken))
      .send({ deliveryAddress: ADDRESS })
      .expect(201);
    // Delivery fee is per-galon and env-configurable, so assert the pricing identity
    // rather than a magic total: total = subtotal + deliveryFee - discount.
    expect(order.body.subtotal).toBe(40000);
    expect(order.body.total).toBe(order.body.subtotal + order.body.deliveryFee - order.body.discount);
    expect(order.body.status).toBe('CREATED');

    const list = await request(server()).get('/api/v1/orders').set(auth(customerToken)).expect(200);
    expect(list.body.total).toBe(1);
  });

  it('rejects checkout with an empty cart (422)', async () => {
    await request(server())
      .post('/api/v1/orders/checkout')
      .set(auth(staffToken))
      .send({ deliveryAddress: ADDRESS })
      .expect(422);
  });

  it('forbids a customer from driving order status (403) and lets staff do it', async () => {
    await request(server())
      .post('/api/v1/cart/items')
      .set(auth(customerToken))
      .send({ productId, quantity: 1 })
      .expect(201);
    const order = await request(server())
      .post('/api/v1/orders/checkout')
      .set(auth(customerToken))
      .send({ deliveryAddress: ADDRESS })
      .expect(201);
    const id = order.body.id;

    await request(server())
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(customerToken))
      .send({ status: 'CONFIRMED' })
      .expect(403);

    await request(server())
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(adminToken))
      .send({ status: 'CONFIRMED' })
      .expect(200);

    // Illegal jump is rejected (409).
    await request(server())
      .patch(`/api/v1/orders/${id}/status`)
      .set(auth(adminToken))
      .send({ status: 'PICKED_UP' })
      .expect(409);
  });

  it('confirms an order via the internal service-auth route (right key 200, wrong/no key 401)', async () => {
    await request(server())
      .post('/api/v1/cart/items')
      .set(auth(customerToken))
      .send({ productId, quantity: 1 })
      .expect(201);
    const order = await request(server())
      .post('/api/v1/orders/checkout')
      .set(auth(customerToken))
      .send({ deliveryAddress: ADDRESS })
      .expect(201);
    const id = order.body.id;

    await request(server()).post(`/api/v1/orders/${id}/internal-confirm`).expect(401);
    await request(server())
      .post(`/api/v1/orders/${id}/internal-confirm`)
      .set('x-internal-key', 'wrong')
      .expect(401);

    const confirmed = await request(server())
      .post(`/api/v1/orders/${id}/internal-confirm`)
      .set('x-internal-key', INTERNAL_KEY)
      .expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
  });

  it('serves the internal completed-orders feed (right key 200, wrong/no key 401)', async () => {
    await request(server())
      .post('/api/v1/cart/items')
      .set(auth(customerToken))
      .send({ productId, quantity: 3 })
      .expect(201);
    const order = await request(server())
      .post('/api/v1/orders/checkout')
      .set(auth(customerToken))
      .send({ deliveryAddress: ADDRESS })
      .expect(201);
    const id = order.body.id;
    const flow = ['CONFIRMED', 'PREPARING', 'DRIVER_ASSIGNED', 'PICKED_UP', 'ON_DELIVERY', 'DELIVERED', 'COMPLETED'];
    for (const status of flow) {
      await request(server())
        .patch(`/api/v1/orders/${id}/status`)
        .set(auth(adminToken))
        .send({ status })
        .expect(200);
    }

    await request(server()).get('/api/v1/orders/internal/completed').expect(401);
    await request(server())
      .get('/api/v1/orders/internal/completed')
      .set('x-internal-key', 'wrong')
      .expect(401);

    const page = await request(server())
      .get('/api/v1/orders/internal/completed')
      .set('x-internal-key', INTERNAL_KEY)
      .expect(200);
    const seeded = page.body.orders.find((o: { id: string }) => o.id === id);
    expect(seeded).toBeDefined();
    expect(seeded.customerId).toBeDefined();
    expect(seeded.items).toEqual([
      expect.objectContaining({ productId, sku: 'AIR-19L', unit: 'Galon 19L' }),
    ]);
    expect('nextCursor' in page.body).toBe(true);
  });

  it('validates the checkout body (400 on missing address fields)', async () => {
    await request(server())
      .post('/api/v1/orders/checkout')
      .set(auth(customerToken))
      .send({ deliveryAddress: { recipientName: 'x' } })
      .expect(400);
  });

  it("returns 404 for another customer's / missing order", async () => {
    await request(server())
      .get(`/api/v1/orders/${randomUUID()}`)
      .set(auth(customerToken))
      .expect(404);
  });

  it('gates the staff order queue: customer 403, cross-depot admin 200 sees all customers', async () => {
    await request(server()).get('/api/v1/orders/manage').set(auth(customerToken)).expect(403);

    // A cross-depot role (SUPER_ADMIN) sees every depot's orders. A depot-locked manager
    // token carries no depotId here, so depotScopeFilter fail-closes it — asserting "sees all"
    // requires the unscoped admin token (the e2e orders route to a null/other depot).
    const res = await request(server())
      .get('/api/v1/orders/manage')
      .set(auth(adminToken))
      .expect(200);
    // Prior tests placed orders for the customer; a cross-depot role sees them cross-tenant.
    expect(res.body.total).toBeGreaterThan(0);

    // Status filter is honoured.
    const cancelled = await request(server())
      .get('/api/v1/orders/manage?status=CANCELLED')
      .set(auth(adminToken))
      .expect(200);
    expect(cancelled.body.items.every((o: { status: string }) => o.status === 'CANCELLED')).toBe(true);

    await request(server())
      .get(`/api/v1/orders/manage/${randomUUID()}`)
      .set(auth(staffToken))
      .expect(404);
  });

  it('gates reports to staff: customer 403, staff 200', async () => {
    await request(server())
      .get('/api/v1/reports/sales?granularity=monthly')
      .set(auth(customerToken))
      .expect(403);
    const res = await request(server())
      .get('/api/v1/reports/sales?granularity=monthly')
      .set(auth(staffToken))
      .expect(200);
    expect(res.body.granularity).toBe('monthly');
    expect(Array.isArray(res.body.buckets)).toBe(true);
  });
});
