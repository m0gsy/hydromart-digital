import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { PricingAdjustType } from '../../src/domain/pricing-rule';
import { DepotModule } from '../../src/modules/depot.module';
import { DEPOT_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  FakePricingRuleRepository,
  InMemoryDepotRepository,
  InMemoryInventoryRepository,
} from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';

const depotBody = {
  code: 'PRC-01',
  name: 'Depot Pricing',
  ownershipType: 'HKP',
  address: 'Jl. Cikini Raya No. 1',
  city: 'Jakarta Pusat',
  province: 'DKI Jakarta',
  lat: -6.1944,
  lng: 106.8412,
  deliveryFee: 5000,
};

describe('Pricing rules HTTP flows (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let customerToken: string;
  let signStaff: (role: Role, depotId?: string | null) => string;
  let rulesRepo: FakePricingRuleRepository;

  beforeAll(async () => {
    const prismaStub = { onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };
    rulesRepo = new FakePricingRuleRepository();
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
      .overrideProvider(DEPOT_TOKENS.PricingRuleRepository)
      .useValue(rulesRepo)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    // Depot managers are locked to their assignedDepotId by DepotScopeGuard — bind the token
    // to the depot under test for the `/depots/:depotId/...` routes.
    signStaff = (role, depotId) =>
      jwt.sign({ sub: 's', role, phone: '+62', depotId: depotId ?? null }, { secret });
    managerToken = signStaff(Role.DEPOT_MANAGER);
    customerToken = jwt.sign({ sub: 'c', role: Role.CUSTOMER, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('runs the pricing rule CRUD lifecycle and the public prices endpoint', async () => {
    const depotId = (
      await request(server())
        .post('/api/v1/depots')
        .set(auth(managerToken))
        .send(depotBody)
        .expect(201)
    ).body.id;
    const mgrAt = signStaff(Role.DEPOT_MANAGER, depotId);

    // manager creates a rule
    const created = await request(server())
      .post(`/api/v1/depots/${depotId}/pricing/rules`)
      .set(auth(mgrAt))
      .send({ adjustType: 'PERCENT', value: -10 })
      .expect(201);
    expect(created.body.adjustType).toBe('PERCENT');
    expect(created.body.value).toBe(-10);
    const ruleId = created.body.id;

    // a customer cannot create a rule
    await request(server())
      .post(`/api/v1/depots/${depotId}/pricing/rules`)
      .set(auth(customerToken))
      .send({ adjustType: 'PERCENT', value: -10 })
      .expect(403);

    // manager lists the rule
    await request(server())
      .get(`/api/v1/depots/${depotId}/pricing/rules`)
      .set(auth(mgrAt))
      .expect(200)
      .expect((r) => {
        expect(r.body).toHaveLength(1);
        expect(r.body[0].id).toBe(ruleId);
      });

    // manager patches the rule
    await request(server())
      .patch(`/api/v1/depots/${depotId}/pricing/rules/${ruleId}`)
      .set(auth(mgrAt))
      .send({ value: -20 })
      .expect(200)
      .expect((r) => expect(r.body.value).toBe(-20));

    // manager deletes the rule
    await request(server())
      .delete(`/api/v1/depots/${depotId}/pricing/rules/${ruleId}`)
      .set(auth(mgrAt))
      .expect(200)
      .expect((r) => expect(r.body).toEqual({ deleted: true }));

    // public prices endpoint carries a seeded active depot-wide FIXED rule
    const productId = '77777777-7777-4777-8777-777777777777';
    await rulesRepo.create({
      depotId,
      productId: null,
      adjustType: PricingAdjustType.FIXED,
      value: -500,
      daysOfWeek: [],
      startMinute: null,
      endMinute: null,
      validFrom: null,
      validUntil: null,
      priority: 0,
      active: true,
    });

    await request(server())
      .get(`/api/v1/depots/${depotId}/inventory/prices?productIds=${productId}`)
      .expect(200)
      .expect((r) => {
        expect(r.body).toEqual([
          expect.objectContaining({ productId, adjustType: 'FIXED', value: -500 }),
        ]);
      });
  });
});
