import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { DashboardModule } from '../../src/modules/dashboard.module';
import { DASHBOARD_TOKENS } from '../../src/application/tokens';
import { envValidationSchema } from '../../src/config/env.validation';
import { InMemoryDashboardSources } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const DEPOT_A = '11111111-1111-4111-8111-111111111111';
const DEPOT_B = '22222222-2222-4222-8222-222222222222';

// Unlike the DB-backed services (whose Prisma client auto-loads .env into
// process.env), this BFF has no such side-effect, so seed the vars the
// validationSchema requires before ConfigModule validates process.env.
const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DASHBOARD_SERVICE_PORT: '3008',
  JWT_ACCESS_SECRET: SECRET,
  INTERNAL_SERVICE_KEY: 'test-internal-service-key',
  ORDER_SERVICE_URL: 'http://localhost:3004',
  DELIVERY_SERVICE_URL: 'http://localhost:3006',
  DEPOT_SERVICE_URL: 'http://localhost:3007',
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
  RATE_LIMIT_TTL_SECONDS: '60',
  RATE_LIMIT_MAX: '100',
};

describe('Executive dashboard HTTP flows (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let customerToken: string;
  let ownerToken: string;

  beforeAll(async () => {
    Object.assign(process.env, testEnv);
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validationSchema: envValidationSchema,
          validationOptions: { allowUnknown: true },
          load: [() => ({ ...testEnv })],
        }),
        DashboardModule,
      ],
    })
      .overrideProvider(DASHBOARD_TOKENS.Sources)
      .useValue(new InMemoryDashboardSources())
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
      { sub: 'm', role: Role.DEPOT_MANAGER, phone: '+62', depotId: DEPOT_A },
      { secret },
    );
    customerToken = jwt.sign({ sub: 'c', role: Role.CUSTOMER, phone: '+62' }, { secret });
    ownerToken = jwt.sign({ sub: 'o', role: Role.FRANCHISE_OWNER, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('rejects anonymous requests (401)', async () => {
    await request(server()).get('/api/v1/dashboard/executive').expect(401);
  });

  it('forbids a customer (403 — head office / depot manager / super admin only)', async () => {
    await request(server())
      .get('/api/v1/dashboard/executive')
      .set(auth(customerToken))
      .expect(403);
  });

  it('returns the executive dashboard for a depot manager (200)', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/executive')
      .set(auth(managerToken))
      .expect(200);

    expect(res.body.sources).toEqual({ order: 'ok', delivery: 'ok' });
    expect(res.body.sales.buckets).toHaveLength(1);
    expect(res.body.deliverySla.slaRate).toBe(0.92);
  });

  it('rejects an invalid date filter (400)', async () => {
    await request(server())
      .get('/api/v1/dashboard/executive?from=not-a-date')
      .set(auth(managerToken))
      .expect(400);
  });

  it('returns operational monthly P&L for the manager assigned depot', async () => {
    const res = await request(server())
      .get(`/api/v1/dashboard/monthly-pnl?depotId=${DEPOT_A}&month=2026-07`)
      .set(auth(managerToken))
      .expect(200);

    expect(res.body).toMatchObject({
      depotId: DEPOT_A,
      month: '2026-07',
      reportType: 'OPERATIONAL_MANAGEMENT',
      sources: { order: 'ok', depot: 'ok' },
    });
  });

  it('forbids a depot manager from querying another depot P&L', async () => {
    await request(server())
      .get(`/api/v1/dashboard/monthly-pnl?depotId=${DEPOT_B}&month=2026-07`)
      .set(auth(managerToken))
      .expect(403);
  });

  it('rejects an invalid P&L month', async () => {
    await request(server())
      .get(`/api/v1/dashboard/monthly-pnl?depotId=${DEPOT_A}&month=2026-13`)
      .set(auth(managerToken))
      .expect(400);
  });

  it('forbids a depot manager on the franchise route (403 — franchise owner only)', async () => {
    await request(server())
      .get('/api/v1/dashboard/franchise')
      .set(auth(managerToken))
      .expect(403);
  });

  it('returns the franchise dashboard for a franchise owner (200)', async () => {
    const res = await request(server())
      .get('/api/v1/dashboard/franchise')
      .set(auth(ownerToken))
      .expect(200);

    expect(res.body.depots).toHaveLength(2);
    expect(res.body.totals.revenue).toBe(900_000);
    expect(res.body.sources).toEqual({
      depot: 'ok',
      order: 'ok',
      delivery: 'ok',
      inventory: 'ok',
    });
  });
});
