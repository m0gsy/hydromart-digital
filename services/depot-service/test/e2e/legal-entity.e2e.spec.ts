import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  AllExceptionsFilter,
  GlobalValidationPipe,
  Role,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
} from '@hydromart/platform';

import { DEPOT_TOKENS } from '../../src/application/tokens';
import { envValidationSchema } from '../../src/config/env.validation';
import { OwnershipType } from '../../src/domain/inventory';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { DepotModule } from '../../src/modules/depot.module';
import { InMemoryDepotRepository } from '../support/fakes';
import { InMemoryLegalEntityRepository } from '../support/legal-entity-fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const INTERNAL_KEY = 'test-internal-service-key-01';

/** HD-5 over HTTP: who may call what, what the DTOs refuse, and the internal door for hr. */
describe('Legal entities (e2e)', () => {
  let app: INestApplication;
  let depots: InMemoryDepotRepository;
  let token: (role: Role) => string;

  beforeAll(async () => {
    process.env.DEPOT_DATABASE_URL = 'postgresql://u:p@localhost:5432/db?schema=public';
    process.env.JWT_ACCESS_SECRET = SECRET;
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    depots = new InMemoryDepotRepository();
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
              INTERNAL_SERVICE_KEY: INTERNAL_KEY,
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
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .overrideProvider(DEPOT_TOKENS.DepotRepository)
      .useValue(depots)
      .overrideProvider(DEPOT_TOKENS.LegalEntityRepository)
      .useValue(new InMemoryLegalEntityRepository(() => depots.rows))
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const jwt = app.get(JwtService);
    token = (role) =>
      jwt.sign(
        { sub: '11111111-1111-4111-8111-111111111111', role, phone: '+62', depotId: null },
        { secret: SECRET, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
      );
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const as = (role: Role) => ({ Authorization: `Bearer ${token(role)}` });

  it('is head office and the superuser only', async () => {
    await request(server()).get('/api/v1/legal-entities').expect(401);
    await request(server()).get('/api/v1/legal-entities').set(as(Role.MANAGER)).expect(403);
    await request(server()).get('/api/v1/legal-entities').set(as(Role.HR)).expect(403);
    await request(server()).get('/api/v1/legal-entities').set(as(Role.HEAD_OFFICE)).expect(200);
    await request(server()).get('/api/v1/legal-entities').set(as(Role.DIREKTUR)).expect(200);
  });

  it('creates, refuses a blank name and an unknown kind, and refuses a duplicate as 409', async () => {
    await request(server())
      .post('/api/v1/legal-entities')
      .set(as(Role.HEAD_OFFICE))
      .send({ name: '   ', kind: 'OPERATOR' })
      .expect(400);
    await request(server())
      .post('/api/v1/legal-entities')
      .set(as(Role.HEAD_OFFICE))
      .send({ name: 'PT Kelola Air', kind: 'INVESTOR' })
      .expect(400);
    const created = await request(server())
      .post('/api/v1/legal-entities')
      .set(as(Role.HEAD_OFFICE))
      .send({ name: 'PT Kelola Air', kind: 'OPERATOR' })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'PT Kelola Air', kind: 'OPERATOR', active: true });
    const dup = await request(server())
      .post('/api/v1/legal-entities')
      .set(as(Role.DIREKTUR))
      .send({ name: 'pt kelola air', kind: 'OPERATOR' })
      .expect(409);
    expect(dup.body.code).toBe('LEGAL_ENTITY_NAME_TAKEN');
  });

  it('refuses an explicit null on a patch instead of failing inside', async () => {
    const list = await request(server()).get('/api/v1/legal-entities').set(as(Role.HEAD_OFFICE)).expect(200);
    const { id, updatedAt } = list.body.entities[0] as { id: string; updatedAt: string };
    for (const body of [{ name: null }, { kind: null }, { active: null }]) {
      await request(server())
        .patch(`/api/v1/legal-entities/${id}`)
        .set(as(Role.HEAD_OFFICE))
        .send({ ...body, seenUpdatedAt: updatedAt })
        .expect(400);
    }
  });

  it('keeps the AI-web matrix with the superuser', async () => {
    const list = await request(server()).get('/api/v1/legal-entities').set(as(Role.HEAD_OFFICE)).expect(200);
    const id = list.body.entities[0].id as string;
    const body = { changes: [{ legalEntityId: id, roleKey: 'FINANCE', granted: true }] };
    await request(server()).put('/api/v1/legal-entities/ai-grants').set(as(Role.HEAD_OFFICE)).send(body).expect(403);
    const res = await request(server())
      .put('/api/v1/legal-entities/ai-grants')
      .set(as(Role.SUPER_ADMIN))
      .send(body)
      .expect(200);
    expect(res.body.entities[0].aiReadRoles).toEqual(['FINANCE']);
    await request(server())
      .put('/api/v1/legal-entities/ai-grants')
      .set(as(Role.SUPER_ADMIN))
      .send({ changes: [{ legalEntityId: id, roleKey: 'CUSTOMER', granted: true }] })
      .expect(400);
    await request(server())
      .put('/api/v1/legal-entities/ai-grants')
      .set(as(Role.SUPER_ADMIN))
      .send({ changes: [] })
      .expect(400);
  });

  it('dates a depot, refusing a day that does not exist and an empty list', async () => {
    const depot = await depots.create({
      code: 'JKT-01',
      name: 'Depot Cikini',
      ownershipType: OwnershipType.HKP,
      address: 'Jl. Cikini Raya No. 1',
      city: 'Jakarta',
      province: 'DKI Jakarta',
      lat: -6.19,
      lng: 106.84,
      serviceRadiusKm: 5,
      deliveryFee: 5000,
      minOrderAmount: null,
      ownerId: null,
      operatingHours: {},
      holidays: [],
    });
    const list = await request(server()).get('/api/v1/legal-entities').set(as(Role.HEAD_OFFICE)).expect(200);
    const legalEntityId = list.body.entities[0].id as string;
    const post = (body: object) =>
      request(server()).post('/api/v1/legal-entities/depots').set(as(Role.HEAD_OFFICE)).send(body);
    await post({ depotIds: [depot.id], legalEntityId, effectiveFrom: '2026-02-30', seen: [] }).expect(400);
    await post({ depotIds: [depot.id], legalEntityId, effectiveFrom: '2026-2-3', seen: [] }).expect(400);
    await post({ depotIds: [], legalEntityId, effectiveFrom: '2026-12-01', seen: [] }).expect(400);
    // Saying nothing about what the screen saw is not "it saw nothing".
    await post({ depotIds: [depot.id], legalEntityId, effectiveFrom: '2026-12-01' }).expect(400);
    const ok = await post({ depotIds: [depot.id], legalEntityId, effectiveFrom: '2026-12-01', seen: [] }).expect(201);
    expect(ok.body).toEqual([{ depotId: depot.id, replaced: null }]);
    // A retry of the same write is no conflict: nothing changes, nothing is refused.
    const again = await post({ depotIds: [depot.id], legalEntityId, effectiveFrom: '2026-12-01', seen: [] }).expect(201);
    expect(again.body).toEqual([]);
    // A second screen that read the depot before that write, sending another entity: refused.
    const other = await request(server())
      .post('/api/v1/legal-entities')
      .set(as(Role.HEAD_OFFICE))
      .send({ name: 'PT Mitra Lain', kind: 'FRANCHISEE' })
      .expect(201);
    const stale = await post({
      depotIds: [depot.id],
      legalEntityId: other.body.id,
      effectiveFrom: '2026-12-01',
      seen: [],
    }).expect(409);
    expect(stale.body.code).toBe('STALE_WRITE');

    const histories = await request(server())
      .get('/api/v1/legal-entities/depots')
      .set(as(Role.HEAD_OFFICE))
      .expect(200);
    const pointId = histories.body[0].points[0].id as string;
    expect(histories.body[0].points[0]).toMatchObject({ legalEntityId, effectiveFrom: '2026-12-01' });
    const del = (q: string) =>
      request(server()).delete(`/api/v1/legal-entities/depots/${pointId}${q}`).set(as(Role.HEAD_OFFICE));
    await request(server())
      .delete(`/api/v1/legal-entities/depots/${pointId}?legalEntityId=${legalEntityId}`)
      .set(as(Role.MANAGER))
      .expect(403);
    // Taking back names the entity the screen showed on the point.
    await del('').expect(400);
    await del(`?legalEntityId=${other.body.id}`).expect(409);
    await del(`?legalEntityId=${legalEntityId}`).expect(204);
    await del(`?legalEntityId=${legalEntityId}`).expect(404);
  });

  it('opens the internal summary to the internal key only', async () => {
    const list = await request(server()).get('/api/v1/legal-entities').set(as(Role.HEAD_OFFICE)).expect(200);
    const id = list.body.entities[0].id as string;
    await request(server()).get(`/api/v1/legal-entities/internal/${id}`).expect(401);
    const res = await request(server())
      .get(`/api/v1/legal-entities/internal/${id}`)
      .set({ 'x-internal-key': INTERNAL_KEY })
      .expect(200);
    expect(res.body).toEqual({ id, name: 'PT Kelola Air', kind: 'OPERATOR', active: true });
    await request(server())
      .get('/api/v1/legal-entities/internal/00000000-0000-4000-8000-000000000000')
      .set({ 'x-internal-key': INTERNAL_KEY })
      .expect(404);
  });

  it('answers the AI read API lookups to the internal key only, static routes ahead of :id', async () => {
    const depotId = depots.rows[0].id;
    const created = await request(server())
      .post('/api/v1/legal-entities')
      .set(as(Role.HEAD_OFFICE))
      .send({ name: 'PT Lookup', kind: 'OPERATOR' })
      .expect(201);
    const legalEntityId = created.body.id as string;
    await request(server())
      .post('/api/v1/legal-entities/depots')
      .set(as(Role.HEAD_OFFICE))
      .send({ legalEntityId, effectiveFrom: '2026-01-01', depotIds: [depotId], seen: [] })
      .expect(201);
    await request(server())
      .put('/api/v1/legal-entities/ai-grants')
      .set(as(Role.SUPER_ADMIN))
      .send({ changes: [{ legalEntityId, roleKey: 'FINANCE', granted: true }] })
      .expect(200);
    const key = { 'x-internal-key': INTERNAL_KEY };
    const spans = (q: string) => `/api/v1/legal-entities/internal/depot-entities?${q}`;
    const good = `from=2026-11-01&to=2026-11-30&depotIds=${depotId}`;

    await request(server()).get(spans(good)).expect(401);
    await request(server()).get(spans(good)).set(as(Role.SUPER_ADMIN)).expect(401);
    const ok = await request(server()).get(spans(good)).set(key).expect(200);
    expect(ok.body).toEqual({ spans: [{ depotId, legalEntityId, from: '2026-11-01' }] });
    await request(server()).get(spans(`from=2026-02-30&to=2026-11-30&depotIds=${depotId}`)).set(key).expect(400);
    await request(server()).get(spans(`from=2026-12-01&to=2026-11-30&depotIds=${depotId}`)).set(key).expect(400);
    await request(server()).get(spans('from=2026-11-01&to=2026-11-30')).set(key).expect(400);
    await request(server()).get(spans('from=2026-11-01&to=2026-11-30&depotIds=nope')).set(key).expect(400);

    const grants = (role: string) => request(server()).get(`/api/v1/legal-entities/internal/ai-grants/${role}`);
    await grants('FINANCE').expect(401);
    // earlier tests granted other cells of the matrix, so it is a membership check
    const finance = (await grants('FINANCE').set(key).expect(200)).body;
    expect(finance).toMatchObject({ roleKey: 'FINANCE', all: false });
    expect(finance.legalEntityIds).toContain(legalEntityId);
    expect((await grants('MANAGER').set(key).expect(200)).body.legalEntityIds).not.toContain(legalEntityId);
    expect((await grants('SUPER_ADMIN').set(key).expect(200)).body.all).toBe(true);
    // a custom role key as auth-service mints it: C_ + lower-case slug, up to 40 characters
    await grants('C_kasir_depot').set(key).expect(200);
    await grants(`C_${'a'.repeat(40)}`).set(key).expect(200);
    await grants('1bad').set(key).expect(400);
    await grants('C_bad-key').set(key).expect(400);
  });
});
