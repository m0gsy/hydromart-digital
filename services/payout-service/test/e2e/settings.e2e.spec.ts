import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role, SettingRow } from '@hydromart/platform';

import { PayoutModule } from '../../src/modules/payout.module';
import { SETTINGS_REPOSITORY, SettingsRepository } from '../../src/application/ports/settings.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';

// ponytail: no shared test/support/fakes.ts exists yet in this service — a single
// in-memory repo doesn't earn one; add it if a second e2e spec needs fakes too.
class InMemorySettingsRepository implements SettingsRepository {
  rows: (SettingRow & { updatedBy: string })[] = [];

  async loadAll(): Promise<SettingRow[]> {
    return this.rows.map(({ scope, depotId, key, value }) => ({ scope, depotId, key, value }));
  }
  async upsert(row: SettingRow & { updatedBy: string }): Promise<void> {
    const i = this.rows.findIndex(
      (r) => r.scope === row.scope && r.depotId === row.depotId && r.key === row.key,
    );
    if (i >= 0) this.rows[i] = row;
    else this.rows.push(row);
  }
  async remove(scope: 'GLOBAL' | 'DEPOT', depotId: string | null, key: string): Promise<void> {
    const i = this.rows.findIndex((r) => r.scope === scope && r.depotId === depotId && r.key === key);
    if (i >= 0) this.rows.splice(i, 1);
  }
}

const SECRET = 'test-access-secret-that-is-long-enough-01';

describe('Settings HTTP flows (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let managerDepotId: string;
  let driverToken: string;
  let superToken: string;

  beforeAll(async () => {
    process.env.PAYOUT_DATABASE_URL = 'postgresql://u:p@localhost:5432/db?schema=public';
    process.env.JWT_ACCESS_SECRET = SECRET;
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
              PAYOUT_SERVICE_PORT: 3016,
              PAYOUT_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              PAYOUT_COMMISSION_RATE: 0.05,
              EXPENSE_AUTO_APPROVE_MAX_IDR: 50000,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        PayoutModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
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
    expect(res.body.effective.expenseAutoApproveMaxIdr).toBe(50000);
  });

  it('lets SUPER_ADMIN set a GLOBAL override, then reset it back to the default', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(superToken))
      .send({ scope: 'GLOBAL', key: 'expenseAutoApproveMaxIdr', value: '80000' })
      .expect(204);

    const res = await request(server())
      .get('/api/v1/settings/schema')
      .set(auth(superToken))
      .expect(200);
    expect(res.body.effective.expenseAutoApproveMaxIdr).toBe(80000);

    await request(server())
      .delete('/api/v1/settings')
      .set(auth(superToken))
      .send({ scope: 'GLOBAL', key: 'expenseAutoApproveMaxIdr' })
      .expect(204);

    const afterReset = await request(server())
      .get('/api/v1/settings/schema')
      .set(auth(superToken))
      .expect(200);
    expect(afterReset.body.effective.expenseAutoApproveMaxIdr).toBe(50000);
  });

  it('forbids a depot manager from writing a GLOBAL override (403)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(managerToken))
      .send({ scope: 'GLOBAL', key: 'expenseAutoApproveMaxIdr', value: '80000' })
      .expect(403);
  });

  it('lets a depot manager set a DEPOT override for their own depot, then reads it back', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(managerToken))
      .send({ scope: 'DEPOT', depotId: managerDepotId, key: 'expenseAutoApproveMaxIdr', value: '75000' })
      .expect(204);

    const res = await request(server())
      .get(`/api/v1/settings/schema?depotId=${managerDepotId}`)
      .set(auth(managerToken))
      .expect(200);
    expect(res.body.effective.expenseAutoApproveMaxIdr).toBe(75000);
  });

  it('forbids a driver from writing settings (403)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(driverToken))
      .send({ scope: 'GLOBAL', key: 'expenseAutoApproveMaxIdr', value: '90000' })
      .expect(403);
  });

  it('rejects an out-of-range value (400)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(superToken))
      .send({ scope: 'GLOBAL', key: 'expenseAutoApproveMaxIdr', value: '99999999' })
      .expect(400);
  });
});
