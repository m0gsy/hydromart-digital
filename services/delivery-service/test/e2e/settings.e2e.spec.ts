import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { DeliveryModule } from '../../src/modules/delivery.module';
import { DELIVERY_TOKENS } from '../../src/application/tokens';
import { SETTINGS_REPOSITORY } from '../../src/application/ports/settings.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  FakeDepotLocation,
  FakeOrderCoordination,
  InMemoryDeliveryRepository,
  InMemorySettingsRepository,
  InMemoryShiftRepository,
} from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';

describe('Settings HTTP flows (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let managerDepotId: string;
  let driverToken: string;
  let superToken: string;

  beforeAll(async () => {
    process.env.DELIVERY_DATABASE_URL = 'postgresql://u:p@localhost:5432/db?schema=public';
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.ORDER_SERVICE_URL = 'http://localhost:3004';
    process.env.DEPOT_SERVICE_URL = 'http://localhost:3007';
    process.env.PAYMENT_SERVICE_URL = 'http://localhost:3005';
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
    managerDepotId = randomUUID();
    managerToken = jwt.sign(
      { sub: randomUUID(), role: Role.DEPOT_MANAGER, phone: '+62', depotId: managerDepotId },
      { secret },
    );
    driverToken = jwt.sign({ sub: randomUUID(), role: Role.DRIVER, phone: '+62' }, { secret });
    superToken = jwt.sign({ sub: randomUUID(), role: Role.SUPER_ADMIN, phone: '+62' }, { secret });
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
    expect(res.body.effective.shiftLengthHours).toBe(8);
  });

  it('lets SUPER_ADMIN set a GLOBAL override, then reset it back to the default', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(superToken))
      .send({ scope: 'GLOBAL', key: 'shiftLengthHours', value: '6' })
      .expect(204);

    const res = await request(server())
      .get('/api/v1/settings/schema')
      .set(auth(superToken))
      .expect(200);
    expect(res.body.effective.shiftLengthHours).toBe(6);

    await request(server())
      .delete('/api/v1/settings')
      .set(auth(superToken))
      .send({ scope: 'GLOBAL', key: 'shiftLengthHours' })
      .expect(204);

    const afterReset = await request(server())
      .get('/api/v1/settings/schema')
      .set(auth(superToken))
      .expect(200);
    expect(afterReset.body.effective.shiftLengthHours).toBe(8);
  });

  it('forbids a depot manager from writing a GLOBAL override (403)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(managerToken))
      .send({ scope: 'GLOBAL', key: 'shiftLengthHours', value: '6' })
      .expect(403);
  });

  it('lets a depot manager set a DEPOT override for their own depot, then reads it back', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(managerToken))
      .send({ scope: 'DEPOT', depotId: managerDepotId, key: 'shiftLengthHours', value: '6' })
      .expect(204);

    const res = await request(server())
      .get(`/api/v1/settings/schema?depotId=${managerDepotId}`)
      .set(auth(managerToken))
      .expect(200);
    expect(res.body.effective.shiftLengthHours).toBe(6);
  });

  it('forbids a driver from writing settings (403)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(driverToken))
      .send({ scope: 'GLOBAL', key: 'shiftLengthHours', value: '7' })
      .expect(403);
  });

  it('rejects an out-of-range value (400)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(superToken))
      .send({ scope: 'GLOBAL', key: 'shiftLengthHours', value: '99' })
      .expect(400);
  });
});
