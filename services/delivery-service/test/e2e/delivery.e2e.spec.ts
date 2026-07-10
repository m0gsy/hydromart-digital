import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { DeliveryModule } from '../../src/modules/delivery.module';
import { DELIVERY_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { FakeOrderCoordination, InMemoryDeliveryRepository } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const PROOF = {
  photoUrl: 'https://cdn/x.jpg',
  signatureUrl: 'https://cdn/sig.png',
  recipientName: 'Budi',
  latitude: -6.9147,
  longitude: 107.6098,
};

describe('Delivery HTTP flows (e2e)', () => {
  let app: INestApplication;
  let staffToken: string;
  let driverToken: string;
  const driverId = randomUUID();

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
              DELIVERY_SERVICE_PORT: 3006,
              DELIVERY_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              ORDER_SERVICE_URL: 'http://localhost:3004',
              MAX_ACTIVE_DELIVERIES_PER_DRIVER: 1,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        DeliveryModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(DELIVERY_TOKENS.DeliveryRepository)
      .useValue(new InMemoryDeliveryRepository())
      .overrideProvider(DELIVERY_TOKENS.OrderCoordination)
      .useValue(new FakeOrderCoordination())
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    staffToken = jwt.sign(
      { sub: randomUUID(), role: Role.DEPOT_MANAGER, phone: '+62' },
      { secret },
    );
    driverToken = jwt.sign({ sub: driverId, role: Role.DRIVER, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const assignBody = () => ({
    orderId: randomUUID(),
    orderNumber: 'HM-20260710-000123',
    driverId,
    destinationAddress: 'Jl. Merdeka No. 10, Bandung',
  });

  it('requires authentication', async () => {
    await request(server()).post('/api/v1/deliveries').send(assignBody()).expect(401);
  });

  it('forbids a driver from assigning (403) and lets staff assign', async () => {
    await request(server())
      .post('/api/v1/deliveries')
      .set(auth(driverToken))
      .send(assignBody())
      .expect(403);

    // Assign to a throwaway driver so the acting driver stays free for later tests.
    const created = await request(server())
      .post('/api/v1/deliveries')
      .set(auth(staffToken))
      .send({ ...assignBody(), driverId: randomUUID() })
      .expect(201);
    expect(created.body.status).toBe('ASSIGNED');
  });

  it('runs the driver pickup → start → complete flow with proof', async () => {
    const created = await request(server())
      .post('/api/v1/deliveries')
      .set(auth(staffToken))
      .send({ ...assignBody(), driverId })
      .expect(201);
    const id = created.body.id;

    await request(server())
      .patch(`/api/v1/driver/deliveries/${id}/pickup`)
      .set(auth(driverToken))
      .expect(200);
    await request(server())
      .patch(`/api/v1/driver/deliveries/${id}/start`)
      .set(auth(driverToken))
      .expect(200);

    const done = await request(server())
      .post(`/api/v1/driver/deliveries/${id}/complete`)
      .set(auth(driverToken))
      .send(PROOF)
      .expect(201);
    expect(done.body.status).toBe('DELIVERED');
    expect(done.body.proof.recipientName).toBe('Budi');
  });

  it('rejects completion without full proof (400)', async () => {
    const created = await request(server())
      .post('/api/v1/deliveries')
      .set(auth(staffToken))
      .send(assignBody())
      .expect(201);
    const id = created.body.id;
    await request(server())
      .patch(`/api/v1/driver/deliveries/${id}/pickup`)
      .set(auth(driverToken))
      .expect(200);
    await request(server())
      .patch(`/api/v1/driver/deliveries/${id}/start`)
      .set(auth(driverToken))
      .expect(200);
    await request(server())
      .post(`/api/v1/driver/deliveries/${id}/complete`)
      .set(auth(driverToken))
      .send({ photoUrl: 'https://cdn/x.jpg' })
      .expect(400);
  });

  it('forbids staff from using the driver endpoints (403)', async () => {
    await request(server())
      .patch(`/api/v1/driver/deliveries/${randomUUID()}/pickup`)
      .set(auth(staffToken))
      .expect(403);
  });

  it('returns 404 for a missing delivery', async () => {
    await request(server())
      .get(`/api/v1/deliveries/${randomUUID()}`)
      .set(auth(staffToken))
      .expect(404);
  });
});
