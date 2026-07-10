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
    managerToken = jwt.sign({ sub: 'm', role: Role.DEPOT_MANAGER, phone: '+62' }, { secret });
    operatorToken = jwt.sign({ sub: 'o', role: Role.DEPOT_OPERATOR, phone: '+62' }, { secret });
    customerToken = jwt.sign({ sub: 'c', role: Role.CUSTOMER, phone: '+62' }, { secret });
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

    // depot shows in public browse
    await request(server()).get('/api/v1/depots?search=cikini').expect(200).expect((r) => {
      expect(r.body.total).toBe(1);
    });

    // operator adds a galon stock line with opening balance
    const line = await request(server())
      .post(`/api/v1/depots/${depotId}/inventory`)
      .set(auth(operatorToken))
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
      .set(auth(managerToken))
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
});
