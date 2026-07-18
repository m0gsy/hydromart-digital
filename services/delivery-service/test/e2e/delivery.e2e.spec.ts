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
import {
  FakeDepotLocation,
  FakeOrderCoordination,
  InMemoryDeliveryRepository,
  InMemoryShiftRepository,
} from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
// Matches the FakeDepotLocation fixture; assignment requires an open shift there.
const DEPOT_ID = '00000000-0000-4000-8000-000000000001';
const AT_DEPOT = { lat: -6.9147, lng: 107.6098 };
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
              DEPOT_SERVICE_URL: 'http://localhost:3007',
              PAYMENT_SERVICE_URL: 'http://localhost:3005',
              MAX_ACTIVE_DELIVERIES_PER_DRIVER: 1,
              SHIFT_CHECKIN_RADIUS_M: 200,
              SHIFT_LENGTH_HOURS: 8,
              SHIFT_BREAK_QUOTA_MINUTES: 30,
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
      .overrideProvider(DELIVERY_TOKENS.ShiftRepository)
      .useValue(new InMemoryShiftRepository())
      .overrideProvider(DELIVERY_TOKENS.OrderCoordination)
      .useValue(new FakeOrderCoordination())
      .overrideProvider(DELIVERY_TOKENS.DepotLocation)
      .useValue(new FakeDepotLocation())
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
      // Depot-assigned manager: depotId gates the depot-scoped shift/dispatch routes.
      { sub: randomUUID(), role: Role.DEPOT_MANAGER, phone: '+62', depotId: DEPOT_ID },
      { secret },
    );
    driverToken = jwt.sign({ sub: driverId, role: Role.DRIVER, phone: '+62' }, { secret });

    await request(app.getHttpServer())
      .post('/api/v1/driver/shifts/check-in')
      .set({ Authorization: `Bearer ${driverToken}` })
      .send({ depotId: DEPOT_ID, ...AT_DEPOT })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  const tokenFor = (sub: string) => {
    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    return app.get(JwtService).sign({ sub, role: Role.DRIVER, phone: '+62' }, { secret });
  };

  /** Assignment requires an open ONLINE shift, so every driver clocks in first. */
  const checkIn = (sub: string) =>
    request(server())
      .post('/api/v1/driver/shifts/check-in')
      .set(auth(tokenFor(sub)))
      .send({ depotId: DEPOT_ID, ...AT_DEPOT })
      .expect(201);

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
    const other = randomUUID();
    await checkIn(other);
    const created = await request(server())
      .post('/api/v1/deliveries')
      .set(auth(staffToken))
      .send({ ...assignBody(), driverId: other })
      .expect(201);
    expect(created.body.status).toBe('ASSIGNED');
  });

  it('refuses to assign a courier who has not checked in (409)', async () => {
    await request(server())
      .post('/api/v1/deliveries')
      .set(auth(staffToken))
      .send({ ...assignBody(), driverId: randomUUID() })
      .expect(409);
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

  it('records contact attempts and gates a premature no-show (422), then reschedules', async () => {
    // Own throwaway courier so this test's active delivery never collides with others.
    const courier = randomUUID();
    const courierToken = tokenFor(courier);
    await checkIn(courier);
    const created = await request(server())
      .post('/api/v1/deliveries')
      .set(auth(staffToken))
      .send({ ...assignBody(), driverId: courier })
      .expect(201);
    const id = created.body.id;

    // No-show before any wait is rejected.
    await request(server())
      .patch(`/api/v1/driver/deliveries/${id}/no-show`)
      .set(auth(courierToken))
      .expect(422);

    const attempt = await request(server())
      .post(`/api/v1/driver/deliveries/${id}/contact-attempts`)
      .set(auth(courierToken))
      .send({ method: 'CALL' })
      .expect(201);
    expect(attempt.body.attempts).toBe(1);
    expect(attempt.body.canMarkNoShow).toBe(false);

    // Reschedule takes the delivery out of the active flow.
    const out = await request(server())
      .patch(`/api/v1/driver/deliveries/${id}/reschedule`)
      .set(auth(courierToken))
      .send({ rescheduledFor: '2026-08-01T09:00:00.000Z', slot: 'Pagi (09:00–12:00)' })
      .expect(200);
    expect(out.body.status).toBe('RESCHEDULED');
  });

  it('returns 404 for a missing delivery', async () => {
    await request(server())
      .get(`/api/v1/deliveries/${randomUUID()}`)
      .set(auth(staffToken))
      .expect(404);
  });

  describe('shifts', () => {
    it('rejects a check-in away from the depot (422)', async () => {
      await request(server())
        .post('/api/v1/driver/shifts/check-in')
        .set(auth(tokenFor(randomUUID())))
        .send({ depotId: DEPOT_ID, lat: -6.2088, lng: 106.8456 })
        .expect(422);
    });

    it('forbids staff from the courier shift endpoints (403)', async () => {
      await request(server())
        .post('/api/v1/driver/shifts/check-in')
        .set(auth(staffToken))
        .send({ depotId: DEPOT_ID, ...AT_DEPOT })
        .expect(403);
    });

    it('runs check-in → break → online → check-out', async () => {
      const sub = randomUUID();
      const token = tokenFor(sub);
      const opened = await checkIn(sub);
      const id = opened.body.id;
      expect(opened.body).toMatchObject({ status: 'ONLINE', acceptsAssignments: true });

      const paused = await request(server())
        .patch(`/api/v1/driver/shifts/${id}/status`)
        .set(auth(token))
        .send({ status: 'BREAK' })
        .expect(200);
      expect(paused.body.acceptsAssignments).toBe(false);

      await request(server())
        .patch(`/api/v1/driver/shifts/${id}/status`)
        .set(auth(token))
        .send({ status: 'ONLINE' })
        .expect(200);

      const ended = await request(server())
        .post(`/api/v1/driver/shifts/${id}/check-out`)
        .set(auth(token))
        .send(AT_DEPOT)
        .expect(201);
      expect(ended.body.status).toBe('ENDED');

      await request(server())
        .get('/api/v1/driver/shifts/current')
        .set(auth(token))
        .expect(200)
        .expect((res) => expect(res.body).toEqual({}));
    });

    it("hides another courier's shift (404)", async () => {
      const sub = randomUUID();
      const opened = await checkIn(sub);
      await request(server())
        .patch(`/api/v1/driver/shifts/${opened.body.id}/status`)
        .set(auth(tokenFor(randomUUID())))
        .send({ status: 'BREAK' })
        .expect(404);
    });

    it('lets dispatch list shifts at a depot but not a driver (403)', async () => {
      await request(server())
        .get(`/api/v1/shifts?depotId=${DEPOT_ID}`)
        .set(auth(driverToken))
        .expect(403);

      const listed = await request(server())
        .get(`/api/v1/shifts?depotId=${DEPOT_ID}`)
        .set(auth(staffToken))
        .expect(200);
      expect(listed.body.length).toBeGreaterThan(0);
    });
  });
});
