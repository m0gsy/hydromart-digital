import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { LoyaltyModule } from '../../src/modules/loyalty.module';
import { LOYALTY_TOKENS } from '../../src/application/tokens';
import { SETTINGS_REPOSITORY } from '../../src/application/ports/settings.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { InMemoryLoyaltyRepository, InMemorySettingsRepository } from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';

describe('Settings HTTP flows (e2e)', () => {
  let app: INestApplication;
  let managerToken: string;
  let managerDepotId: string;
  let customerToken: string;
  let superToken: string;

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
              LOYALTY_SERVICE_PORT: 3009,
              LOYALTY_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
              LOYALTY_EARN_RATE_RUPIAH: 1000,
              LOYALTY_POINT_EXPIRY_MONTHS: 12,
            }),
          ],
        }),
        LoyaltyModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaStub)
      .overrideProvider(LOYALTY_TOKENS.LoyaltyRepository)
      .useValue(new InMemoryLoyaltyRepository())
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
    customerToken = jwt.sign({ sub: randomUUID(), role: Role.CUSTOMER, phone: '+62' }, { secret });
    // SUPER_ADMIN is not depot-locked (DepotScopeGuard), so it can target any depotId
    // without the JWT itself carrying a matching depotId claim.
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
    expect(res.body.effective.earnRateRupiah).toBe(1000);
  });

  it('lets SUPER_ADMIN set a GLOBAL override, then reads it back', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(superToken))
      .send({ scope: 'GLOBAL', key: 'earnRateRupiah', value: '500' })
      .expect(204);

    const res = await request(server())
      .get('/api/v1/settings/schema')
      .set(auth(superToken))
      .expect(200);
    expect(res.body.effective.earnRateRupiah).toBe(500);
  });

  it('forbids a depot manager from writing a GLOBAL override (403)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(managerToken))
      .send({ scope: 'GLOBAL', key: 'earnRateRupiah', value: '500' })
      .expect(403);
  });

  it('lets a depot manager set a DEPOT override for their own depot, then reads it back', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(managerToken))
      .send({ scope: 'DEPOT', depotId: managerDepotId, key: 'earnRateRupiah', value: '500' })
      .expect(204);

    const res = await request(server())
      .get(`/api/v1/settings/schema?depotId=${managerDepotId}`)
      .set(auth(managerToken))
      .expect(200);
    expect(res.body.effective.earnRateRupiah).toBe(500);
  });

  it('lets SUPER_ADMIN set a DEPOT override, then reset it back to the parent scope', async () => {
    const depotId = randomUUID();
    await request(server())
      .put('/api/v1/settings')
      .set(auth(superToken))
      .send({ scope: 'DEPOT', depotId, key: 'pointExpiryMonths', value: '3' })
      .expect(204);

    const withOverride = await request(server())
      .get(`/api/v1/settings/schema?depotId=${depotId}`)
      .set(auth(superToken))
      .expect(200);
    expect(withOverride.body.effective.pointExpiryMonths).toBe(3);

    await request(server())
      .delete('/api/v1/settings')
      .set(auth(superToken))
      .send({ scope: 'DEPOT', depotId, key: 'pointExpiryMonths' })
      .expect(204);

    const afterReset = await request(server())
      .get(`/api/v1/settings/schema?depotId=${depotId}`)
      .set(auth(superToken))
      .expect(200);
    expect(afterReset.body.effective.pointExpiryMonths).toBe(12);
  });

  it('forbids a customer from writing settings (403)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(customerToken))
      .send({ scope: 'GLOBAL', key: 'earnRateRupiah', value: '700' })
      .expect(403);
  });

  it('rejects an out-of-range value (400)', async () => {
    await request(server())
      .put('/api/v1/settings')
      .set(auth(superToken))
      .send({ scope: 'GLOBAL', key: 'pointExpiryMonths', value: '999' })
      .expect(400);
  });
});
