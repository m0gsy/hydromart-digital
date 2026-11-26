import { generateKeyPairSync, randomUUID } from 'node:crypto';

import { INestApplication, RequestMethod, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CAPABILITIES, loadCustomRoles, loadOverrides } from '@hydromart/access';
import { EXTERNAL_ACCESS_KEY, TOKEN_AUDIENCE, TOKEN_ISSUER } from '@hydromart/platform';

import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator';
import { AccessMatrixService } from '../../src/application/services/access-matrix.service';
import { AUTH_TOKENS } from '../../src/application/tokens';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { GlobalValidationPipe } from '../../src/common/pipes/validation.pipe';
import { envValidationSchema } from '../../src/config/env.validation';
import { CustomerStatus } from '../../src/domain/customer/customer-status.enum';
import { Role } from '../../src/domain/customer/role.enum';
import { ExternalTokenSigner } from '../../src/infrastructure/security/external-token-signer';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { AuthModule } from '../../src/modules/auth/auth.module';
import {
  FakeOtpDelivery,
  InMemoryAuditLogRepository,
  InMemoryConsentRepository,
  InMemoryCustomerRepository,
  InMemoryOtpTokenRepository,
  InMemoryRefreshTokenRepository,
  makeCustomer,
} from '../support/fakes';

/*
 * HD-21 section 6 through the real guards: GET ai/crm/pic-candidates answers the AI web's token and
 * nothing else, lists only active staff whose role holds prospectCrm under the matrix in force now,
 * and carries names only.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const URL = '/api/v1/ai/crm/pic-candidates';
const PERSON = '00000000-0000-4000-8000-0000000000b1';

describe('AI CRM pic-candidates (HD-21, e2e)', () => {
  let app: INestApplication;
  let signer: ExternalTokenSigner;
  let jwt: JwtService;
  const customers = new InMemoryCustomerRepository();
  const env = {
    AUTH_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: SECRET,
    JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-1',
    OTP_PEPPER: 'test-otp-pepper-value',
    AI_TOKEN_SIGNING_KEY: generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .privateKey.export({ format: 'der', type: 'pkcs8' })
      .toString('base64'),
  };

  const staff = (role: string, name: string | null, over: Record<string, unknown> = {}) =>
    customers.seed(makeCustomer({ role: role as Role, fullName: name, phone: `+62812${Math.floor(Math.random() * 1e8)}`, ...over }));
  const ai = (role: string) =>
    signer.sign({ aud: 'hydromart-ai', sub: PERSON, role, depotId: null }, 600, new Date());
  const get = (token: string | null) => {
    const req = request(app.getHttpServer()).get(URL);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  beforeAll(async () => {
    Object.assign(process.env, env);
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
              AUTH_SERVICE_PORT: 3001,
              ...env,
              JWT_ACCESS_TTL: 900,
              JWT_REFRESH_TTL: 2592000,
              OTP_TTL_SECONDS: 300,
              OTP_LENGTH: 6,
              OTP_MAX_ATTEMPTS: 5,
              OTP_RESEND_COOLDOWN_SECONDS: 60,
              OTP_DELIVERY_CHANNEL: 'console',
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 1_000_000,
            }),
          ],
        }),
        AuthModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .overrideProvider(AUTH_TOKENS.CustomerRepository)
      .useValue(customers)
      .overrideProvider(AUTH_TOKENS.OtpTokenRepository)
      .useValue(new InMemoryOtpTokenRepository())
      .overrideProvider(AUTH_TOKENS.RefreshTokenRepository)
      .useValue(new InMemoryRefreshTokenRepository())
      .overrideProvider(AUTH_TOKENS.AuditLogRepository)
      .useValue(new InMemoryAuditLogRepository())
      .overrideProvider(AUTH_TOKENS.ConsentRepository)
      .useValue(new InMemoryConsentRepository())
      .overrideProvider(AUTH_TOKENS.OtpDeliveryPort)
      .useValue(new FakeOtpDelivery())
      // The matrix lives in the access library of this process; the database behind it is not under test.
      .overrideProvider(AccessMatrixService)
      .useValue({ snapshot: async () => ({}) })
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    signer = app.get(ExternalTokenSigner);
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    loadOverrides({});
    loadCustomRoles([]);
  });

  it('lists active staff holding prospectCrm, sorted by name, id and name only', async () => {
    staff(Role.MARKETING, 'Budi Marketing');
    staff(Role.SUPER_ADMIN, 'Ani Admin');
    staff(Role.MARKETING, 'Citra Marketing', { status: CustomerStatus.SUSPENDED });
    staff(Role.MARKETING, null);
    staff(Role.HEAD_OFFICE, 'Dodi Pusat');
    staff(Role.CUSTOMER, 'Pelanggan Biasa');
    const res = await get(ai('MARKETING')).expect(200);
    expect(res.body.people.map((p: { fullName: string }) => p.fullName)).toEqual(['Ani Admin', 'Budi Marketing']);
    expect(Object.keys(res.body.people[0]).sort()).toEqual(['fullName', 'id']);
    expect(JSON.stringify(res.body)).not.toMatch(/\+62|@/);
  });

  it('follows the matrix in force: a custom role granted prospectCrm appears, a role taken out disappears', async () => {
    loadCustomRoles([{ key: 'C_SALES', name: 'Sales', scope: 'GLOBAL' }]);
    loadOverrides({ prospectCrm: ['MARKETING', 'SUPER_ADMIN', 'C_SALES'] });
    staff('C_SALES', 'Eka Sales');
    expect((await get(ai('SUPER_ADMIN')).expect(200)).body.people.map((p: { fullName: string }) => p.fullName)).toEqual(
      expect.arrayContaining(['Eka Sales', 'Budi Marketing']),
    );
    loadOverrides({ prospectCrm: ['SUPER_ADMIN'] });
    const only = (await get(ai('SUPER_ADMIN')).expect(200)).body.people.map((p: { fullName: string }) => p.fullName);
    expect(only).toContain('Ani Admin');
    expect(only).not.toContain('Budi Marketing');
    expect(only).not.toContain('Eka Sales');
  });

  it('needs prospectRead, and admits only the AI web token', async () => {
    await get(ai('KEPALA_DEPOT')).expect(403);
    await get(ai('HEAD_OFFICE')).expect(200);
    // A staff session token, even a SUPER_ADMIN's, is not the AI web.
    const session = jwt.sign({ sub: 's', role: 'SUPER_ADMIN', phone: '+62', depotId: null }, { secret: SECRET, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE });
    await get(session).expect(403);
    // A machine token has no @ExternalAccess('machine') here.
    const machine = signer.sign({ aud: 'hydromart-machine', sub: PERSON, scopes: ['prospectRead'] }, 600, new Date());
    await get(machine).expect(403);
    await get(null).expect(401);
    await get('garbage').expect(401);
  });

  it('is refused for an expired AI token', async () => {
    const old = signer.sign({ aud: 'hydromart-ai', sub: PERSON, role: 'MARKETING' }, 60, new Date(Date.now() - 3_600_000));
    await get(old).expect(401);
    expect(CAPABILITIES.prospectCrm).toContain('MARKETING');
  });

  it('no other auth route admits the AI token: the staff list refuses it', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/staff').set('Authorization', `Bearer ${ai('SUPER_ADMIN')}`);
    expect(res.status).toBe(403);
  });

  /*
   * The regression proof for the guard change: the AI and machine tokens reach exactly ONE route in
   * auth-service. The route table is read off the controllers' own metadata, so a route added
   * tomorrow is in the table without anybody listing it here.
   */
  describe('the route table', () => {
    type Route = { verb: 'get' | 'post' | 'put' | 'patch' | 'delete'; url: string; label: string; external: boolean };
    const VERBS: readonly Route['verb'][] = ['get', 'post', 'put', 'delete', 'patch'];
    const routes: Route[] = [];
    const norm = (v: unknown): string => String(Array.isArray(v) ? v[0] : (v ?? '')).replace(/^\/+|\/+$/g, '');
    for (const controller of Reflect.getMetadata('controllers', AuthModule) as (new () => object)[]) {
      const base = norm(Reflect.getMetadata('path', controller));
      const version = String(Reflect.getMetadata('__version__', controller) ?? '1');
      const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, controller) === true;
      const classExternal = Reflect.getMetadata(EXTERNAL_ACCESS_KEY, controller) !== undefined;
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = (controller.prototype as Record<string, unknown>)[name];
        if (typeof handler !== 'function') continue;
        const method = Reflect.getMetadata('method', handler) as RequestMethod | undefined;
        if (method === undefined || method === RequestMethod.ALL) continue;
        if (classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true) continue;
        const own = norm(Reflect.getMetadata('path', handler));
        const path = [base, own].filter(Boolean).join('/').replace(/:[A-Za-z]+/g, () => randomUUID());
        routes.push({
          verb: VERBS[method as number]!,
          url: `/api/v${version}/${path}`,
          label: `${controller.name}.${name}`,
          external: classExternal || Reflect.getMetadata(EXTERNAL_ACCESS_KEY, handler) !== undefined,
        });
      }
    }

    it('reads a real table: many routes, every one behind the token check', () => {
      expect(routes.length).toBeGreaterThan(40);
      expect(routes.some((r) => r.label === 'AiCrmController.picCandidates')).toBe(true);
    });

    it('carries @ExternalAccess on exactly one route: GET ai/crm/pic-candidates', () => {
      const external = routes.filter((r) => r.external);
      expect(external.map((r) => `${r.verb.toUpperCase()} ${r.url}`)).toEqual(['GET /api/v1/ai/crm/pic-candidates']);
    });

    it('answers 403 to an AI token and to a machine token on every other non-public route', async () => {
      const ai = signer.sign({ aud: 'hydromart-ai', sub: PERSON, role: 'SUPER_ADMIN' }, 600, new Date());
      const machine = signer.sign({ aud: 'hydromart-machine', sub: PERSON, scopes: ['hqConsole'] }, 600, new Date());
      const bad: string[] = [];
      for (const r of routes.filter((x) => !x.external)) {
        for (const [who, token] of [['ai', ai], ['machine', machine]] as const) {
          const res = await request(app.getHttpServer())[r.verb](r.url).set('Authorization', `Bearer ${token}`).send({});
          if (res.status !== 403) bad.push(`${who} ${r.verb.toUpperCase()} ${r.url} (${r.label}) -> ${res.status}`);
        }
      }
      expect(bad).toEqual([]);
    });

    it('the one external route takes the AI token and refuses the machine token', async () => {
      const ai = signer.sign({ aud: 'hydromart-ai', sub: PERSON, role: 'SUPER_ADMIN' }, 600, new Date());
      const machine = signer.sign({ aud: 'hydromart-machine', sub: PERSON, scopes: ['prospectRead'] }, 600, new Date());
      await get(ai).expect(200);
      await get(machine).expect(403);
    });
  });
});
