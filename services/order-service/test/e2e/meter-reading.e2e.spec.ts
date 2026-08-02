import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { OrderModule } from '../../src/modules/order.module';
import { ORDER_TOKENS } from '../../src/application/tokens';
import { SETTINGS_REPOSITORY } from '../../src/application/ports/settings.repository';
import { MeterReading } from '../../src/domain/meter-reading';
import {
  MeterReadingRepository,
  UpsertMeterReadingData,
} from '../../src/application/ports/meter-reading.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import {
  FakeDepotDirectory,
  FakeForecastCoordination,
  FakeLoyaltyCoordination,
  FakeMembership,
  FakeNotification,
  FakePromo,
  FakeProductCatalog,
  FakeReferralCoordination,
  FakeRecommendationCoordination,
  InMemoryCartRepository,
  InMemoryOrderRepository,
  InMemorySettingsRepository,
} from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const DATE = '2026-08-02';

/** Minimal in-memory stand-in; the Prisma mapping is unit-tested separately. */
class InMemoryMeterReadings implements MeterReadingRepository {
  rows = new Map<string, MeterReading>();

  async upsertForDate(data: UpsertMeterReadingData): Promise<MeterReading | null> {
    const key = `${data.depotId}|${data.date}`;
    const existing = this.rows.get(key);
    if (!existing) {
      if (data.openingM3 === undefined) return null;
      const created: MeterReading = {
        depotId: data.depotId,
        date: data.date,
        openingM3: data.openingM3,
        closingM3: data.closingM3 ?? null,
        sourceOpeningM3: data.sourceOpeningM3 ?? null,
        sourceClosingM3: data.sourceClosingM3 ?? null,
        openedBy: data.actorId,
        openedAt: new Date(),
        closedBy: data.closingM3 === undefined ? null : data.actorId,
        closedAt: data.closingM3 === undefined ? null : new Date(),
        alertedAt: null,
        note: data.note ?? null,
      };
      this.rows.set(key, created);
      return created;
    }
    const merged: MeterReading = {
      ...existing,
      ...(data.openingM3 !== undefined ? { openingM3: data.openingM3 } : {}),
      ...(data.closingM3 !== undefined
        ? { closingM3: data.closingM3, closedBy: data.actorId, closedAt: new Date() }
        : {}),
      ...(data.note !== undefined ? { note: data.note } : {}),
    };
    this.rows.set(key, merged);
    return merged;
  }

  async findForDate(depotId: string, date: string): Promise<MeterReading | null> {
    return this.rows.get(`${depotId}|${date}`) ?? null;
  }

  async listForRange(depotId: string, from: string, to: string): Promise<MeterReading[]> {
    return [...this.rows.values()]
      .filter((r) => r.depotId === depotId && r.date >= from && r.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async markAlerted(depotId: string, date: string): Promise<void> {
    const key = `${depotId}|${date}`;
    const row = this.rows.get(key);
    if (row) this.rows.set(key, { ...row, alertedAt: new Date() });
  }
}

describe('Meter reading HTTP flows (e2e)', () => {
  let app: INestApplication;
  let staffToken: string;
  let managerToken: string;
  let outsiderToken: string;
  let depotId: string;

  beforeAll(async () => {
    const prismaStub = { onModuleInit: jest.fn(), onModuleDestroy: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
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
              ORDER_DELIVERY_FEE: 1000,
              ORDER_ABANDON_MINUTES: 60,
              ORDER_METER_REFERENCE_VOLUME_ML: 19000,
              ORDER_METER_VARIANCE_TOLERANCE_LITERS: 200,
              ORDER_ALERT_PHONE: '',
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
      .overrideProvider(ORDER_TOKENS.MeterReadingRepository)
      .useValue(new InMemoryMeterReadings())
      .overrideProvider(ORDER_TOKENS.ProductCatalog)
      .useValue(new FakeProductCatalog())
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
    depotId = randomUUID();
    staffToken = jwt.sign(
      { sub: randomUUID(), role: Role.STAFF_DEPOT, phone: '+62', depotId },
      { secret },
    );
    managerToken = jwt.sign(
      { sub: randomUUID(), role: Role.MANAGER, phone: '+62', depotId },
      { secret },
    );
    outsiderToken = jwt.sign({ sub: randomUUID(), role: Role.CUSTOMER, phone: '+62' }, { secret });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const path = `/api/v1/reports/meter`;

  it('lets the operator on shift write the morning reading', async () => {
    const res = await request(server())
      .put(`${path}/${depotId}/${DATE}`)
      .set(auth(staffToken))
      .send({ openingM3: 1000 })
      .expect(200);
    expect(res.body.meterLiters).toBeNull();
    expect(res.body.reading.openingM3).toBe(1000);
  });

  it('closes the same day through the same route and reports the variance', async () => {
    const res = await request(server())
      .put(`${path}/${depotId}/${DATE}`)
      .set(auth(staffToken))
      .send({ closingM3: 1002.6 })
      .expect(200);
    expect(res.body.meterLiters).toBe(2600);
    expect(res.body.varianceLiters).toBe(2600); // no sales seeded
    expect(res.body.varianceIdr).toBeNull(); // nothing delivered to price it with
  });

  it('serves the reconciliation back on GET', async () => {
    const res = await request(server())
      .get(`${path}/${depotId}/${DATE}`)
      .set(auth(managerToken))
      .expect(200);
    expect(res.body.meterLiters).toBe(2600);
    expect(res.body.referenceVolumeMl).toBe(19000);
  });

  it('serves the history window', async () => {
    const res = await request(server())
      .get(`${path}/${depotId}?from=2026-08-01&to=2026-08-03`)
      .set(auth(managerToken))
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ day: DATE, meterLiters: 2600 });
  });

  it('rejects a closing reading below the opening one', async () => {
    await request(server())
      .put(`${path}/${depotId}/${DATE}`)
      .set(auth(staffToken))
      .send({ closingM3: 999 })
      .expect(422);
  });

  it('rejects a malformed date', async () => {
    await request(server())
      .put(`${path}/${depotId}/02-08-2026`)
      .set(auth(staffToken))
      .send({ openingM3: 1000 })
      .expect(400);
  });

  // The whole reason meterWrite exists as its own capability: inventoryWrite and the
  // depot report roles both exclude STAFF_DEPOT, while nobody outside the depot may
  // touch the dial at all.
  it('denies a non-staff caller both reading and writing', async () => {
    await request(server())
      .put(`${path}/${depotId}/${DATE}`)
      .set(auth(outsiderToken))
      .send({ openingM3: 1000 })
      .expect(403);
    await request(server()).get(`${path}/${depotId}/${DATE}`).set(auth(outsiderToken)).expect(403);
  });

  it('rejects an unauthenticated caller', async () => {
    await request(server()).get(`${path}/${depotId}/${DATE}`).expect(401);
  });
});
