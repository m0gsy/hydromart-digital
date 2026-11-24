import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  AllExceptionsFilter,
  GlobalValidationPipe,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  configureDepotScope,
  resetDepotScope,
  resetExternalKeyStores,
} from '@hydromart/platform';

import { ANSWER_STATUSES } from '../../src/application/ai-read/envelope';
import { PERIOD_UNITS } from '../../src/application/ai-read/period';
import { envValidationSchema } from '../../src/config/env.validation';
import { DashboardModule } from '../../src/modules/dashboard.module';

/*
 * HD-6 H1 through the real guards, the real adapters and the validation pipe: an AI-web token's
 * scope is its own depots narrowed by the role x legal-entity matrix, over a WIB period, in one
 * envelope. The only thing faked is the network: the key set and depot-service's answers.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const INTERNAL_KEY = 'test-internal-service-key-01';
const AUTH_URL = 'http://auth.test';
const DEPOT_URL = 'http://depot.test';
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const D3 = '33333333-3333-4333-8333-333333333333';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PERSON = '99999999-9999-4999-8999-999999999999';
const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DASHBOARD_SERVICE_PORT: '3008',
  JWT_ACCESS_SECRET: SECRET,
  INTERNAL_SERVICE_KEY: INTERNAL_KEY,
  ORDER_SERVICE_URL: 'http://order.test',
  DELIVERY_SERVICE_URL: 'http://delivery.test',
  DEPOT_SERVICE_URL: DEPOT_URL,
  PAYMENT_SERVICE_URL: 'http://payment.test',
  PAYOUT_SERVICE_URL: 'http://payout.test',
  HR_SERVICE_URL: 'http://hr.test',
  AUTH_SERVICE_URL: AUTH_URL,
  CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
  RATE_LIMIT_TTL_SECONDS: '60',
  RATE_LIMIT_MAX: '100',
};

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' };
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
function es256(claims: Record<string, unknown>): string {
  const data = `${b64({ alg: 'ES256', kid: 'k1', typ: 'JWT' })}.${b64(claims)}`;
  const sig = sign('sha256', Buffer.from(data), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${data}.${sig.toString('base64url')}`;
}
const exp = (): number => Math.floor(Date.now() / 1000) + 600;
const aiToken = (role: string, depotId: string | null = null) =>
  es256({ iss: 'hydromart-auth', aud: 'hydromart-ai', sub: PERSON, role, depotId, exp: exp() });

const ROUTE = '/api/v1/ai/read/scope';
const contract = JSON.parse(readFileSync(join(__dirname, '../../../../contracts/ai-v1/read.openapi.json'), 'utf8'));

/** Which entity each depot belongs to, and which entities each role is granted. */
const ENTITY_OF: Record<string, string | null> = { [D1]: PT_A, [D2]: PT_B, [D3]: null };
const GRANTS: Record<string, { all: boolean; legalEntityIds: string[] }> = {
  SUPER_ADMIN: { all: true, legalEntityIds: [] },
  FINANCE: { all: false, legalEntityIds: [PT_A] },
  MANAGER: { all: false, legalEntityIds: [PT_A, PT_B] },
};

describe('GET ai/read/scope (HD-6 H1)', () => {
  let app: INestApplication;
  let staffSession: string;
  let depotServiceDown = false;
  /** The depot-service URLs the adapter asked, in order. */
  const asked: URL[] = [];

  beforeAll(async () => {
    Object.assign(process.env, testEnv);
    resetExternalKeyStores();
    configureDepotScope(async () => [D2]);
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.href === `${AUTH_URL}/api/v1/auth/jwks`) {
        return { ok: true, json: async () => ({ keys: [JWK] }) } as unknown as Response;
      }
      if (!url.href.startsWith(DEPOT_URL) || depotServiceDown) {
        return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      }
      asked.push(url);
      const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
      if (url.pathname === '/api/v1/depots/manage') {
        return json({ items: [D1, D2, D3].map((id) => ({ id, code: id, name: id, active: true, ownershipType: 'HKP' })), totalPages: 1 });
      }
      if (url.pathname === '/api/v1/legal-entities/internal/depot-entities') {
        const from = url.searchParams.get('from') as string;
        const ids = (url.searchParams.get('depotIds') as string).split(',');
        return json({ spans: ids.map((depotId) => ({ depotId, legalEntityId: ENTITY_OF[depotId], from })) });
      }
      const role = url.pathname.split('/internal/ai-grants/')[1];
      return json({ roleKey: role, ...(GRANTS[role] ?? { all: false, legalEntityIds: [] }) });
    });

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
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    staffSession = app
      .get(JwtService)
      .sign(
        { sub: PERSON, role: 'SUPER_ADMIN', phone: '+62811' },
        { secret: SECRET, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
      );
  });

  afterEach(() => {
    asked.length = 0;
    depotServiceDown = false;
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
    resetExternalKeyStores();
    resetDepotScope();
  });

  const get = (token: string | null, query = 'period=month&date=2026-11-10') => {
    const req = request(app.getHttpServer()).get(`${ROUTE}?${query}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('gives SUPER_ADMIN the whole network and echoes the WIB month it answered', async () => {
    const res = await get(aiToken('SUPER_ADMIN')).expect(200);
    expect(res.body).toMatchObject({
      metricId: 'meta.scope',
      status: 'ok',
      value: 3,
      unit: 'depot',
      period: {
        unit: 'month',
        from: '2026-11-01',
        to: '2026-11-30',
        timeZone: 'Asia/Jakarta',
        fromAt: '2026-10-31T17:00:00.000Z',
        toAt: '2026-11-30T17:00:00.000Z',
      },
      scope: { depotIds: [D1, D2, D3], legalEntityIds: [PT_A, PT_B] },
    });
    expect(typeof res.body.asOf).toBe('string');
    const spans = asked.find((u) => u.pathname.endsWith('depot-entities')) as URL;
    expect([spans.searchParams.get('from'), spans.searchParams.get('to')]).toEqual(['2026-11-01', '2026-11-30']);
  });

  it('narrows a network role to the entities its role is granted', async () => {
    const res = await get(aiToken('FINANCE')).expect(200);
    expect(res.body).toMatchObject({ value: 1, scope: { depotIds: [D1], legalEntityIds: [PT_A] } });
  });

  it('answers belum_ada, not 0, for a role the matrix grants nothing', async () => {
    const res = await get(aiToken('HEAD_OFFICE')).expect(200);
    expect(res.body).toMatchObject({ status: 'belum_ada', value: null, scope: { depotIds: [], legalEntityIds: [] } });
    expect(typeof res.body.reason).toBe('string');
  });

  it("holds a manager to their own depots even though both entities are granted", async () => {
    const res = await get(aiToken('MANAGER', D1)).expect(200);
    expect(res.body.scope.depotIds).toEqual([D1, D2]);
    expect(res.body.scope.depotIds).not.toContain(D3);
    const spans = asked.find((u) => u.pathname.endsWith('depot-entities')) as URL;
    expect(spans.searchParams.get('depotIds')).toBe(`${D1},${D2}`);
  });

  it("reads today in WIB and an explicit range", async () => {
    const day = await get(aiToken('SUPER_ADMIN'), 'period=day').expect(200);
    expect(day.body.period).toMatchObject({ unit: 'day', timeZone: 'Asia/Jakarta' });
    const range = await get(aiToken('SUPER_ADMIN'), 'from=2028-02-01&to=2028-02-29').expect(200);
    expect(range.body.period).toMatchObject({ unit: 'range', from: '2028-02-01', to: '2028-02-29' });
  });

  it('refuses an ambiguous, unreal or unknown period with 400', async () => {
    for (const q of [
      '',
      'period=month&from=2026-11-01&to=2026-11-30',
      'period=month&date=2026-02-30',
      'period=decade',
      'from=2026-11-30&to=2026-11-01',
      'from=2026-11-01',
      'period=month&date=nope',
      'period=month&extra=1',
    ]) {
      await get(aiToken('SUPER_ADMIN'), q).expect(400);
    }
  });

  it('fails closed with 503 when depot-service cannot answer', async () => {
    depotServiceDown = true;
    const res = await get(aiToken('SUPER_ADMIN')).expect(503);
    expect(res.body.value).toBeUndefined();
  });

  it('refuses a machine token, whatever its scopes', async () => {
    const machine = es256({ iss: 'hydromart-auth', aud: 'hydromart-machine', sub: PERSON, scopes: ['aiRead'], exp: exp() });
    await get(machine).expect(403);
  });

  it('refuses no token, and a token it cannot verify, with 401', async () => {
    await get(null).expect(401);
    const [head, , sig] = aiToken('SUPER_ADMIN').split('.');
    await get(`${head}.${b64({ aud: 'hydromart-ai', sub: PERSON, role: 'SUPER_ADMIN' })}.${sig}`).expect(401);
  });

  it('refuses an AI-web token for a role outside the door', async () => {
    await get(aiToken('FRANCHISE_OWNER')).expect(403);
    await get(aiToken('CUSTOMER')).expect(403);
  });

  it('answers a hydromart-digital staff session the same way (it is that person own scope)', async () => {
    const res = await get(staffSession).expect(200);
    expect(res.body.value).toBe(3);
  });

  /*
   * The AI web codes against contracts/ai-v1/read.openapi.json, in another repository. What is
   * served here and what is written there must not drift apart in silence.
   */
  it('matches the contract the AI web codes against', async () => {
    const op = contract.paths['/dashboard/api/v1/ai/read/scope'].get;
    expect(op).toBeDefined();
    expect(op.parameters.map((p: { name: string }) => p.name).sort()).toEqual(['date', 'from', 'period', 'to']);
    expect(op.parameters.find((p: { name: string }) => p.name === 'period').schema.enum).toEqual([...PERIOD_UNITS]);
    expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '401', '403', '429', '500', '503']);

    const schemas = contract.components.schemas;
    expect(schemas.AnswerEnvelope.properties.status.enum).toEqual([...ANSWER_STATUSES]);
    expect(schemas.Period.properties.unit.enum).toEqual([...PERIOD_UNITS, 'range']);
    // the one place a display name may travel is documented
    expect(contract.info.description).toContain('field label');
    expect(schemas.MaskedCell.properties.flag.enum).toEqual(['kurang dari 3', 'ditahan']);

    const res = await get(aiToken('FINANCE')).expect(200);
    const has = (schema: { required?: string[]; properties: object }, row: object) => {
      for (const field of schema.required ?? []) expect(row).toHaveProperty(field);
      for (const field of Object.keys(row)) expect(Object.keys(schema.properties)).toContain(field);
    };
    has(schemas.AnswerEnvelope, res.body);
    has(schemas.Period, res.body.period);
    has(schemas.Scope, res.body.scope);
    // the example in the contract is itself a valid answer
    const example = op.responses['200'].content['application/json'].example;
    has(schemas.AnswerEnvelope, example);
    has(schemas.Period, example.period);
    has(schemas.Scope, example.scope);
  });
});
