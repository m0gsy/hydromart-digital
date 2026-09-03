import { randomUUID } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AllExceptionsFilter, GlobalValidationPipe, Role } from '@hydromart/platform';

import { DepotModule } from '../../src/modules/depot.module';
import { DEPOT_TOKENS } from '../../src/application/tokens';
import { HIERARCHY_REPOSITORY } from '../../src/application/ports/hierarchy.repository';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { envValidationSchema } from '../../src/config/env.validation';
import {
  InMemoryDepotRepository,
  InMemoryHierarchyRepository,
  InMemoryInventoryRepository,
} from '../support/fakes';

const SECRET = 'test-access-secret-that-is-long-enough-01';
const INTERNAL_KEY = 'test-internal-service-key-01';

/**
 * The hierarchy over HTTP. What the unit spec cannot see and what breaks quietly if it
 * regresses: the `hierarchyAdmin` guard, the internal-key route, and the route ORDER —
 * `internal/scope/:staffId` and `depots/:depotId/assistant` must beat `:staffId`, or scope
 * resolution and depot assignment die without an error anyone would notice.
 */
describe('Staff hierarchy HTTP flows (e2e)', () => {
  let app: INestApplication;
  let superToken: string;
  let managerToken: string;
  let hierarchy: InMemoryHierarchyRepository;

  const ASSISTANT = randomUUID();
  const SUPERVISOR = randomUUID();
  const DEPOT_A = randomUUID();
  const DEPOT_B = randomUUID();

  beforeAll(async () => {
    process.env.DEPOT_DATABASE_URL = 'postgresql://u:p@localhost:5432/db?schema=public';
    process.env.JWT_ACCESS_SECRET = SECRET;
    // The validation schema defaults INTERNAL_SERVICE_KEY to '' and that shadows load().
    process.env.INTERNAL_SERVICE_KEY = INTERNAL_KEY;
    hierarchy = new InMemoryHierarchyRepository();
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
      .useValue(prismaStub)
      .overrideProvider(DEPOT_TOKENS.DepotRepository)
      .useValue(new InMemoryDepotRepository())
      .overrideProvider(DEPOT_TOKENS.InventoryRepository)
      .useValue(new InMemoryInventoryRepository())
      .overrideProvider(HIERARCHY_REPOSITORY)
      .useValue(hierarchy)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const secret = app.get(ConfigService).getOrThrow<string>('JWT_ACCESS_SECRET');
    const jwt = app.get(JwtService);
    superToken = jwt.sign({ sub: randomUUID(), role: Role.SUPER_ADMIN, phone: '+62' }, { secret });
    managerToken = jwt.sign(
      { sub: randomUUID(), role: Role.MANAGER, phone: '+62', depotId: DEPOT_A },
      { secret },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const internal = () => ({ 'x-internal-key': INTERNAL_KEY });
  const base = '/api/v1/staff-hierarchy';

  it('lets a super admin build the whole chain and reads it back', async () => {
    await request(server())
      .put(`${base}/depots/${DEPOT_A}/assistant`)
      .set(auth(superToken))
      .send({ assistantSupervisorId: ASSISTANT })
      .expect(204);
    await request(server())
      .put(`${base}/${ASSISTANT}/superior`)
      .set(auth(superToken))
      .send({ superiorId: SUPERVISOR })
      .expect(204);
    await request(server())
      .put(`${base}/${SUPERVISOR}/depots/${DEPOT_B}`)
      .set(auth(superToken))
      .expect(204);

    const res = await request(server())
      .get(`${base}/${ASSISTANT}`)
      .set(auth(superToken))
      .expect(200);
    expect(res.body).toMatchObject({ superiorId: SUPERVISOR, assistantDepotIds: [DEPOT_A] });
  });

  // The whole point of the phase: a supervisor's depots come from the chain below them,
  // plus anything granted directly.
  it('resolves a supervisor to the derived depot UNION the direct grant', async () => {
    const res = await request(server())
      .get(`${base}/internal/scope/${SUPERVISOR}?role=${Role.SUPERVISOR}`)
      .set(internal())
      .expect(200);
    expect(res.body.depotIds.sort()).toEqual([DEPOT_A, DEPOT_B].sort());
  });

  // Route order: `internal` is a static segment sitting where `:staffId` also matches.
  // If `:staffId` ever wins, this returns a describe() body (or 401) instead of a scope.
  it('serves internal/scope with the internal key and not a user token', async () => {
    await request(server())
      .get(`${base}/internal/scope/${ASSISTANT}?role=${Role.ASSISTANT_SUPERVISOR}`)
      .expect(401);
    await request(server())
      .get(`${base}/internal/scope/${ASSISTANT}?role=${Role.ASSISTANT_SUPERVISOR}`)
      .set(auth(superToken))
      .expect(401);
    const res = await request(server())
      .get(`${base}/internal/scope/${ASSISTANT}?role=${Role.ASSISTANT_SUPERVISOR}`)
      .set(internal())
      .expect(200);
    expect(res.body).toEqual({ depotIds: [DEPOT_A] });
  });

  // A manager redrawing this map would be redrawing their own scope — hierarchyAdmin is
  // SUPER_ADMIN only, and every write must say so.
  it('forbids every write to a MANAGER (403)', async () => {
    const asManager = auth(managerToken);
    await request(server())
      .put(`${base}/depots/${DEPOT_A}/assistant`)
      .set(asManager)
      .send({ assistantSupervisorId: SUPERVISOR })
      .expect(403);
    await request(server())
      .delete(`${base}/depots/${DEPOT_A}/assistant`)
      .set(asManager)
      .expect(403);
    await request(server())
      .put(`${base}/${ASSISTANT}/superior`)
      .set(asManager)
      .send({ superiorId: SUPERVISOR })
      .expect(403);
    await request(server()).delete(`${base}/${ASSISTANT}/superior`).set(asManager).expect(403);
    await request(server())
      .put(`${base}/${SUPERVISOR}/depots/${DEPOT_B}`)
      .set(asManager)
      .expect(403);
    await request(server())
      .delete(`${base}/${SUPERVISOR}/depots/${DEPOT_B}`)
      .set(asManager)
      .expect(403);
    await request(server()).get(`${base}/${ASSISTANT}`).set(asManager).expect(403);
  });

  it('requires a token at all (401)', async () => {
    await request(server()).get(`${base}/${ASSISTANT}`).expect(401);
  });

  it('rejects a non-uuid account id (400)', async () => {
    await request(server()).get(`${base}/not-a-uuid`).set(auth(superToken)).expect(400);
  });

  it('refuses a link that closes a loop (400)', async () => {
    await request(server())
      .put(`${base}/${SUPERVISOR}/superior`)
      .set(auth(superToken))
      .send({ superiorId: ASSISTANT })
      .expect(400);
  });

  it('unwinds the chain, leaving the supervisor with only their direct grant', async () => {
    await request(server())
      .delete(`${base}/depots/${DEPOT_A}/assistant`)
      .set(auth(superToken))
      .expect(204);
    await request(server())
      .delete(`${base}/${ASSISTANT}/superior`)
      .set(auth(superToken))
      .expect(204);

    const res = await request(server())
      .get(`${base}/internal/scope/${SUPERVISOR}?role=${Role.SUPERVISOR}`)
      .set(internal())
      .expect(200);
    expect(res.body).toEqual({ depotIds: [DEPOT_B] });

    await request(server())
      .delete(`${base}/${SUPERVISOR}/depots/${DEPOT_B}`)
      .set(auth(superToken))
      .expect(204);
    const empty = await request(server())
      .get(`${base}/internal/scope/${SUPERVISOR}?role=${Role.SUPERVISOR}`)
      .set(internal())
      .expect(200);
    expect(empty.body).toEqual({ depotIds: [] });
  });
});
