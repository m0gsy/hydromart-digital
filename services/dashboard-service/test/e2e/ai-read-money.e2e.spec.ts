import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  AllExceptionsFilter,
  GlobalValidationPipe,
  configureDepotScope,
  resetDepotScope,
  resetExternalKeyStores,
} from '@hydromart/platform';

import { MONEY_METRICS, MONEY_METRIC_IDS } from '../../src/application/ai-read/money-metrics';
import { envValidationSchema } from '../../src/config/env.validation';
import { DashboardModule } from '../../src/modules/dashboard.module';

/*
 * HD-6 H2 through the real guards, adapters and validation pipe: the money route answers the
 * envelope for the person's own scope, reads order-service for exactly the days a depot was
 * readable, and the contract the AI web codes against says what is served. Only the network is faked.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const DEPOT_URL = 'http://depot.test';
const ORDER_URL = 'http://order.test';
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const PT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PERSON = '99999999-9999-4999-8999-999999999999';
const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DASHBOARD_SERVICE_PORT: '3008',
  JWT_ACCESS_SECRET: SECRET,
  INTERNAL_SERVICE_KEY: 'test-internal-service-key-01',
  ORDER_SERVICE_URL: ORDER_URL,
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
const aiToken = (role: string) =>
  es256({ iss: 'hydromart-auth', aud: 'hydromart-ai', sub: PERSON, role, depotId: null, exp: exp() });

const MONTH = 'period=month&date=2026-11-10';
const contract = JSON.parse(readFileSync(join(__dirname, '../../../../contracts/ai-v1/read.openapi.json'), 'utf8'));
const OP = contract.paths['/dashboard/api/v1/ai/read/money'].get;

const GRANTS: Record<string, { all: boolean; legalEntityIds: string[] }> = {
  SUPER_ADMIN: { all: true, legalEntityIds: [] },
  FINANCE: { all: false, legalEntityIds: [PT_B] },
};

describe('GET ai/read/money?metric= (HD-6 H2)', () => {
  let app: INestApplication;
  /** D1 moves PT_A -> PT_B on 16 Nov; D2 stays PT_B all month. */
  const asked: URL[] = [];

  beforeAll(async () => {
    Object.assign(process.env, testEnv);
    resetExternalKeyStores();
    configureDepotScope(async () => [D1, D2]);
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
      if (url.href === `${AUTH_URL}/api/v1/auth/jwks`) return json({ keys: [JWK] });
      if (url.href.startsWith(ORDER_URL)) {
        asked.push(url);
        const ids = (url.searchParams.get('depotIds') ?? '').split(',');
        return json({
          items: ids.map((depotId) => ({
            depotId,
            orders: 2,
            revenueIdr: 200_000,
            shippingIdr: 0,
            appOrders: 2,
            appRevenueIdr: 200_000,
            counterOrders: 0,
            counterRevenueIdr: 0,
            cancelledOrders: 0,
            deliveredOrders: 1,
          })),
        });
      }
      if (!url.href.startsWith(DEPOT_URL)) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      if (url.pathname === '/api/v1/depots/manage') {
        return json({ items: [D1, D2].map((id) => ({ id, code: id, name: id, active: true, ownershipType: 'HKP' })), totalPages: 1 });
      }
      if (url.pathname === '/api/v1/legal-entities/internal/depot-entities') {
        return json({
          spans: [
            { depotId: D1, legalEntityId: PT_A, from: '2026-11-01' },
            { depotId: D1, legalEntityId: PT_B, from: '2026-11-16' },
            { depotId: D2, legalEntityId: PT_B, from: '2026-11-01' },
          ],
        });
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
  });

  afterEach(() => {
    asked.length = 0;
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
    resetExternalKeyStores();
    resetDepotScope();
  });

  const get = (token: string | null, metric: string, query = MONTH) => {
    const req = request(app.getHttpServer()).get(`/api/v1/ai/read/money?metric=${metric}${query ? `&${query}` : ''}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('answers P-01 over the whole network for SUPER_ADMIN, from the WIB month', async () => {
    const res = await get(aiToken('SUPER_ADMIN'), 'P-01').expect(200);
    expect(res.body).toMatchObject({
      metricId: 'P-01',
      status: 'ok',
      unit: 'Rp',
      value: 600_000,
      period: { from: '2026-11-01', to: '2026-11-30', timeZone: 'Asia/Jakarta' },
      scope: { depotIds: [D1, D2], legalEntityIds: [PT_A, PT_B] },
    });
    expect(typeof res.body.value).toBe('number');
    expect(res.body.label).toContain('omzet');
    // D1 has two stretches (PT_A to 15 Nov, PT_B from 16 Nov), D2 one whole month: three reads
    const windows = asked.map((u) => `${u.searchParams.get('depotIds')}@${u.searchParams.get('from')}..${u.searchParams.get('to')}`);
    expect(windows.sort()).toEqual(
      [
        `${D1}@2026-10-31T17:00:00.000Z..2026-11-15T17:00:00.000Z`,
        `${D1}@2026-11-15T17:00:00.000Z..2026-11-30T17:00:00.000Z`,
        `${D2}@2026-10-31T17:00:00.000Z..2026-11-30T17:00:00.000Z`,
      ].sort(),
    );
  });

  it('reads a depot that changed entity only for the days its role may read it', async () => {
    const res = await get(aiToken('FINANCE'), 'P-01').expect(200);
    // FINANCE is granted PT_B only: D1 from 16 Nov 00:00 WIB, D2 all month. 200k x 2 depots.
    expect(res.body.value).toBe(400_000);
    const d1 = asked.find((u) => u.searchParams.get('depotIds') === D1);
    expect(d1?.searchParams.get('from')).toBe('2026-11-15T17:00:00.000Z');
    expect(res.body.scope.legalEntityIds).toEqual([PT_B]);
  });

  it('answers the unbuilt metrics belum_ada and the held one ditahan, with null and a reason', async () => {
    for (const [metric, status] of [['P-11', 'belum_ada'], ['U-03', 'belum_ada'], ['P-14', 'ditahan']]) {
      const res = await get(aiToken('SUPER_ADMIN'), metric).expect(200);
      expect(res.body).toMatchObject({ metricId: metric, status, value: null });
      expect(typeof res.body.reason).toBe('string');
    }
  });

  it('refuses a metric outside the money group, an ambiguous period and a month metric asked over a free range', async () => {
    await get(aiToken('SUPER_ADMIN'), 'P-99').expect(404);
    await get(aiToken('SUPER_ADMIN'), 'P-01', '').expect(400);
    await request(app.getHttpServer())
      .get('/api/v1/ai/read/money?period=month')
      .set('Authorization', `Bearer ${aiToken('SUPER_ADMIN')}`)
      .expect(400);
    await get(aiToken('SUPER_ADMIN'), 'L-07', 'from=2026-11-05&to=2026-11-20').expect(400);
  });

  it('keeps the door: no token, a machine token and a franchise owner are refused', async () => {
    await get(null, 'P-01').expect(401);
    const machine = es256({ iss: 'hydromart-auth', aud: 'hydromart-machine', sub: PERSON, scopes: ['aiRead'], exp: exp() });
    await get(machine, 'P-01').expect(403);
    await get(aiToken('FRANCHISE_OWNER'), 'P-01').expect(403);
  });

  /*
   * The AI web codes against contracts/ai-v1/read.openapi.json, in another repository: the metric
   * ids, their units, which ones are monthly and the status rules it quotes must be what is served.
   */
  it('matches the contract the AI web codes against', async () => {
    expect(OP.parameters.map((p: { name: string }) => p.name).sort()).toEqual(['date', 'from', 'metric', 'period', 'to']);
    expect(OP.parameters.find((p: { name: string }) => p.name === 'metric').schema.enum).toEqual([...MONEY_METRIC_IDS]);
    expect(Object.keys(OP['x-metrics'])).toEqual([...MONEY_METRIC_IDS]);
    for (const id of MONEY_METRIC_IDS) {
      const m = OP['x-metrics'][id];
      expect(m.unit).toBe(MONEY_METRICS[id].unit);
      expect(m.wholeMonthOnly).toBe('month' in MONEY_METRICS[id]);
      expect(typeof m.value).toBe('string');
      expect(m.rules.length).toBeGreaterThan(20);
    }
    expect(Object.keys(OP.responses).sort()).toEqual(['200', '400', '401', '403', '404', '429', '500', '503']);
    expect(contract.components.schemas.AnswerEnvelope.properties.label).toBeDefined();
    // the three that never carry a number say so in the contract
    for (const id of ['P-11', 'U-03']) expect(OP['x-metrics'][id].rules).toContain('Always belum_ada');
    expect(OP['x-metrics']['P-14'].rules).toContain('Always ditahan');

    // what is served has exactly the fields the contract's envelope names
    const res = await get(aiToken('SUPER_ADMIN'), 'P-01').expect(200);
    const schema = contract.components.schemas.AnswerEnvelope;
    for (const field of schema.required) expect(res.body).toHaveProperty(field);
    for (const field of Object.keys(res.body)) expect(Object.keys(schema.properties)).toContain(field);
    const example = OP.responses['200'].content['application/json'].example;
    for (const field of schema.required) expect(example).toHaveProperty(field);
    for (const field of Object.keys(example)) expect(Object.keys(schema.properties)).toContain(field);
  });
});
