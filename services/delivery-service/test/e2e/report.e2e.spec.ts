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

describe('Delivery SLA report (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
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
              DELIVERY_SERVICE_PORT: 3006,
              DELIVERY_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              ORDER_SERVICE_URL: 'http://localhost:3004',
              MAX_ACTIVE_DELIVERIES_PER_DRIVER: 1,
              DELIVERY_SLA_MINUTES: 120,
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
    managerToken = jwt.sign({ sub: randomUUID(), role: Role.DEPOT_MANAGER, phone: '+62' }, { secret });
    customerToken = jwt.sign({ sub: randomUUID(), role: Role.CUSTOMER, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('forbids a CUSTOMER (403)', async () => {
    await request(server()).get('/api/v1/reports/sla').set(auth(customerToken)).expect(403);
  });

  it('lets a DEPOT_MANAGER read the SLA report (200) with the default threshold', async () => {
    const res = await request(server())
      .get('/api/v1/reports/sla')
      .set(auth(managerToken))
      .expect(200);

    expect(res.body).toMatchObject({
      thresholdMinutes: 120,
      totalDelivered: 0,
      onTime: 0,
      breached: 0,
      slaRate: 0,
      avgMinutes: null,
      failedCount: 0,
    });
  });
});
