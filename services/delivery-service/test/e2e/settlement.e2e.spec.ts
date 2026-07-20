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
import { DeliveryStatus } from '../../src/domain/delivery-status';
import { ShiftStatus } from '../../src/domain/shift';
import {
  FakeCashCollection,
  InMemoryDeliveryRepository,
  InMemorySettlementRepository,
  InMemoryShiftRepository,
} from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const DEPOT_ID = '00000000-0000-4000-8000-000000000001';

describe('Cash settlement HTTP flows (e2e)', () => {
  let app: INestApplication;
  const driverId = randomUUID();
  const shiftId = randomUUID();
  const shifts = new InMemoryShiftRepository();
  const deliveries = new InMemoryDeliveryRepository();
  const settlements = new InMemorySettlementRepository();
  const cash = new FakeCashCollection();

  beforeAll(async () => {
    process.env.DELIVERY_DATABASE_URL = "postgresql://u:p@localhost:5432/db?schema=public";
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.ORDER_SERVICE_URL = "http://localhost:3004";
    process.env.DEPOT_SERVICE_URL = "http://localhost:3007";
    process.env.PAYMENT_SERVICE_URL = "http://localhost:3005";
    // An ended shift with one delivered order — the settlement window.
    shifts.rows.push({
      id: shiftId,
      driverId,
      depotId: DEPOT_ID,
      status: ShiftStatus.ENDED,
      checkInAt: new Date(0),
      checkInLat: 0,
      checkInLng: 0,
      expectedEndAt: new Date(1),
      checkOutAt: new Date(8_640_000_000_000),
      checkOutLat: 0,
      checkOutLng: 0,
      breakSecondsUsed: 0,
      breakStartedAt: null,
    });
    const delivery = await deliveries.create({
      orderId: randomUUID(),
      orderNumber: 'HM-1',
      driverId,
      depotId: DEPOT_ID,
      destinationAddress: 'x',
      destinationLat: null,
      destinationLng: null,
      recipientPhone: null,
      items: null,
      codAmount: null,
    });
    await deliveries.applyStatus(
      delivery.id,
      DeliveryStatus.DELIVERED,
      { deliveredAt: new Date() },
      driverId,
      null,
    );
    cash.result = { total: 75000, count: 1 };

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
      .useValue(deliveries)
      .overrideProvider(DELIVERY_TOKENS.ShiftRepository)
      .useValue(shifts)
      .overrideProvider(DELIVERY_TOKENS.SettlementRepository)
      .useValue(settlements)
      .overrideProvider(DELIVERY_TOKENS.CashCollection)
      .useValue(cash)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const token = (sub: string, role: Role, depotId?: string) =>
    app.get(JwtService).sign({ sub, role, phone: '+62', depotId }, {
      secret: app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET'),
    });

  let settlementId: string;

  it('lets the courier deposit a shift’s cash and snapshots the expected total', async () => {
    const res = await request(server())
      .post('/api/v1/driver/settlement')
      .set(auth(token(driverId, Role.DRIVER)))
      .send({ shiftId, depositedAmount: 60000 })
      .expect(201);
    expect(res.body).toMatchObject({
      status: 'SUBMITTED',
      expectedAmount: 75000,
      depositedAmount: 60000,
      variance: -15000,
    });
    settlementId = res.body.id;
  });

  it('forbids a courier from verifying a settlement', async () => {
    await request(server())
      .post(`/api/v1/settlements/${settlementId}/verify`)
      .set(auth(token(driverId, Role.DRIVER)))
      .send({ chargedToDriver: true })
      .expect(403);
  });

  it('lets the depot cashier verify and charge the shortfall', async () => {
    const res = await request(server())
      .post(`/api/v1/settlements/${settlementId}/verify`)
      // Cashier must be assigned to the settlement's own depot (by-id depot guard).
      .set(auth(token(randomUUID(), Role.DEPOT_MANAGER, DEPOT_ID)))
      .send({ chargedToDriver: true })
      .expect(201);
    expect(res.body).toMatchObject({ status: 'VERIFIED', chargedToDriver: true });
  });

  it("hides another courier's settlement", async () => {
    await request(server())
      .get(`/api/v1/driver/settlement/${settlementId}`)
      .set(auth(token(randomUUID(), Role.DRIVER)))
      .expect(404);
  });
});
