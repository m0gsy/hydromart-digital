import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { DepotModule } from '../../src/modules/depot.module';
import { DEPOT_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { InMemoryDepotRepository, InMemoryInventoryRepository } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';

const depotBody = {
  code: 'JKT-01',
  name: 'Depot Cikini',
  ownershipType: 'HKP',
  address: 'Jl. Cikini Raya No. 1',
  city: 'Jakarta Pusat',
  province: 'DKI Jakarta',
  lat: -6.1944,
  lng: 106.8412,
  deliveryFee: 5000,
};

describe('Depot & Inventory HTTP flows (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let operatorToken: string;
  let customerToken: string;
  let ownerToken: string;
  // Mint a staff token optionally bound to a depot — depot operators/managers are locked to
  // their assignedDepotId by the platform DepotScopeGuard, so `:depotId`/`?depotId` calls need
  // a token carrying the depot they act on.
  let signStaff: (role: Role, depotId?: string | null) => string;
  const OWNER_SUB = '99999999-9999-4999-8999-999999999999';

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
              DEPOT_SERVICE_PORT: 3007,
              DEPOT_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        DepotModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(DEPOT_TOKENS.DepotRepository)
      .useValue(new InMemoryDepotRepository())
      .overrideProvider(DEPOT_TOKENS.InventoryRepository)
      .useValue(new InMemoryInventoryRepository())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    signStaff = (role, depotId) =>
      jwt.sign({ sub: 's', role, phone: '+62', depotId: depotId ?? null }, { secret });
    managerToken = signStaff(Role.DEPOT_MANAGER);
    operatorToken = signStaff(Role.DEPOT_OPERATOR);
    customerToken = jwt.sign({ sub: 'c', role: Role.CUSTOMER, phone: '+62' }, { secret });
    ownerToken = jwt.sign({ sub: OWNER_SUB, role: Role.FRANCHISE_OWNER, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('browses depots publicly (no token)', async () => {
    const res = await request(server()).get('/api/v1/depots').expect(200);
    expect(res.body).toMatchObject({ total: 0, page: 1 });
  });

  it('forbids depot creation for anonymous (401) and customer (403)', async () => {
    await request(server()).post('/api/v1/depots').send(depotBody).expect(401);
    await request(server())
      .post('/api/v1/depots')
      .set(auth(customerToken))
      .send(depotBody)
      .expect(403);
  });

  it('forbids depot creation for a depot operator (403 — manager only)', async () => {
    await request(server())
      .post('/api/v1/depots')
      .set(auth(operatorToken))
      .send(depotBody)
      .expect(403);
  });

  it('runs the full depot + inventory lifecycle', async () => {
    // manager creates a depot
    const created = await request(server())
      .post('/api/v1/depots')
      .set(auth(managerToken))
      .send(depotBody)
      .expect(201);
    const depotId = created.body.id;
    expect(created.body.deliveryFee).toBe(5000);
    // Depot staff are now locked to their own depot — bind tokens to the created depot.
    const oprAt = signStaff(Role.DEPOT_OPERATOR, depotId);
    const mgrAt = signStaff(Role.DEPOT_MANAGER, depotId);

    // depot shows in public browse
    await request(server()).get('/api/v1/depots?search=cikini').expect(200).expect((r) => {
      expect(r.body.total).toBe(1);
    });

    // operator adds a galon stock line with opening balance
    const line = await request(server())
      .post(`/api/v1/depots/${depotId}/inventory`)
      .set(auth(oprAt))
      .send({ itemType: 'GALON', label: 'Galon 19L', unit: 'unit', quantity: 100, minimumStock: 20 })
      .expect(201);
    const itemId = line.body.id;
    expect(line.body.quantity).toBe(100);

    // a customer cannot touch inventory (403)
    await request(server())
      .post(`/api/v1/inventory/${itemId}/adjust`)
      .set(auth(customerToken))
      .send({ delta: -5 })
      .expect(403);

    // operator adjusts stock below the minimum
    await request(server())
      .post(`/api/v1/inventory/${itemId}/adjust`)
      .set(auth(operatorToken))
      .send({ delta: -85, reason: 'sales' })
      .expect(201)
      .expect((r) => {
        expect(r.body.quantity).toBe(15);
        expect(r.body.lowStock).toBe(true);
      });

    // low-stock report surfaces the line
    await request(server())
      .get(`/api/v1/inventory/low-stock?depotId=${depotId}`)
      .set(auth(mgrAt))
      .expect(200)
      .expect((r) => {
        expect(r.body).toHaveLength(1);
        expect(r.body[0].id).toBe(itemId);
      });

    // opname reconciles to a counted quantity and records variance
    await request(server())
      .post(`/api/v1/inventory/${itemId}/opname`)
      .set(auth(operatorToken))
      .send({ countedQuantity: 12, reason: 'monthly' })
      .expect(201)
      .expect((r) => expect(r.body.quantity).toBe(12));

    // movement history: RECEIPT + ADJUSTMENT + OPNAME
    await request(server())
      .get(`/api/v1/inventory/${itemId}/movements`)
      .set(auth(operatorToken))
      .expect(200)
      .expect((r) => expect(r.body).toHaveLength(3));
  });

  it('deducts PRODUK stock on order completion (consume), customer forbidden', async () => {
    const productId = '44444444-4444-4444-8444-444444444444';
    const unstockedId = '66666666-6666-4666-8666-666666666666';
    const orderId = '55555555-5555-4555-8555-555555555555';
    const depotId = (
      await request(server())
        .post('/api/v1/depots')
        .set(auth(managerToken))
        .send({ ...depotBody, code: 'CONS-01' })
        .expect(201)
    ).body.id;
    const oprAt = signStaff(Role.DEPOT_OPERATOR, depotId);
    const itemId = (
      await request(server())
        .post(`/api/v1/depots/${depotId}/inventory`)
        .set(auth(oprAt))
        .send({ itemType: 'PRODUK', productId, label: 'Air RO', unit: 'unit', quantity: 50, minimumStock: 0 })
        .expect(201)
    ).body.id;

    // a customer cannot trigger consumption
    await request(server())
      .post(`/api/v1/depots/${depotId}/inventory/consume`)
      .set(auth(customerToken))
      .send({ orderId, items: [{ productId, quantity: 4 }] })
      .expect(403);

    // operator (order-completion token) consumes; unstocked product is skipped
    await request(server())
      .post(`/api/v1/depots/${depotId}/inventory/consume`)
      .set(auth(oprAt))
      .send({
        orderId,
        items: [
          { productId, quantity: 4 },
          { productId: unstockedId, quantity: 1 },
        ],
      })
      .expect(201)
      .expect((r) => {
        expect(r.body.consumed).toEqual([productId]);
        expect(r.body.skipped).toEqual([unstockedId]);
      });

    await request(server())
      .get(`/api/v1/inventory/${itemId}`)
      .set(auth(operatorToken))
      .expect(200)
      .expect((r) => expect(r.body.quantity).toBe(46));
  });

  it('rejects an unauthenticated adjustment as 400 (bad uuid) only after auth — 401 first', async () => {
    await request(server())
      .post('/api/v1/inventory/11111111-1111-1111-1111-111111111111/adjust')
      .send({ delta: 1 })
      .expect(401);
  });

  it('returns 404 for a missing depot', async () => {
    await request(server())
      .get('/api/v1/depots/11111111-1111-1111-1111-111111111111')
      .expect(404);
  });

  it('rejects an invalid depot payload (400)', async () => {
    await request(server())
      .post('/api/v1/depots')
      .set(auth(managerToken))
      .send({ ...depotBody, deliveryFee: -5 })
      .expect(400);
  });

  it('franchise owner sees only their own depots via /depots/mine; RBAC enforced', async () => {
    const OTHER_OWNER = '88888888-8888-4888-8888-888888888888';
    // manager provisions two depots for our owner (one later deactivated) and one for another owner
    const a = (
      await request(server())
        .post('/api/v1/depots')
        .set(auth(managerToken))
        .send({ ...depotBody, code: 'OWN-A', ownerId: OWNER_SUB })
        .expect(201)
    ).body;
    expect(a.ownerId).toBe(OWNER_SUB);
    const b = (
      await request(server())
        .post('/api/v1/depots')
        .set(auth(managerToken))
        .send({ ...depotBody, code: 'OWN-B', ownerId: OWNER_SUB })
        .expect(201)
    ).body;
    await request(server())
      .post('/api/v1/depots')
      .set(auth(managerToken))
      .send({ ...depotBody, code: 'OWN-C', ownerId: OTHER_OWNER })
      .expect(201);
    // deactivate one of the owner's depots — listMine still returns it
    await request(server())
      .delete(`/api/v1/depots/${b.id}`)
      .set(auth(signStaff(Role.DEPOT_MANAGER, b.id)))
      .expect(200);

    await request(server())
      .get('/api/v1/depots/mine')
      .set(auth(ownerToken))
      .expect(200)
      .expect((r) => {
        const ids = (r.body as Array<{ id: string; active: boolean }>).map((d) => d.id).sort();
        expect(ids).toEqual([a.id, b.id].sort());
        expect(r.body.some((d: { active: boolean }) => !d.active)).toBe(true);
      });

    // RBAC: staff (manager) and customer are not franchise owners
    await request(server()).get('/api/v1/depots/mine').set(auth(managerToken)).expect(403);
    await request(server()).get('/api/v1/depots/mine').set(auth(customerToken)).expect(403);
  });

  it('admin manage lists a deactivated depot that public browse hides; customer forbidden', async () => {
    const depotId = (
      await request(server())
        .post('/api/v1/depots')
        .set(auth(managerToken))
        .send({ ...depotBody, code: 'MNG-01', name: 'Depot Manage' })
        .expect(201)
    ).body.id;
    const mgrAt = signStaff(Role.DEPOT_MANAGER, depotId);

    // deactivate (soft delete)
    await request(server()).delete(`/api/v1/depots/${depotId}`).set(auth(mgrAt)).expect(200);

    // public browse no longer surfaces it
    await request(server())
      .get('/api/v1/depots?search=manage')
      .expect(200)
      .expect((r) => expect(r.body.total).toBe(0));

    // admin manage still returns it (so it can be reactivated)
    await request(server())
      .get('/api/v1/depots/manage?search=manage')
      .set(auth(managerToken))
      .expect(200)
      .expect((r) => {
        expect(r.body.total).toBe(1);
        expect(r.body.items[0].active).toBe(false);
      });

    // customer forbidden
    await request(server()).get('/api/v1/depots/manage').set(auth(customerToken)).expect(403);

    // reactivate via PATCH
    await request(server())
      .patch(`/api/v1/depots/${depotId}`)
      .set(auth(mgrAt))
      .send({ active: true })
      .expect(200)
      .expect((r) => expect(r.body.active).toBe(true));
  });
});
