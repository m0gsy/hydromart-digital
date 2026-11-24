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

import { LOYALTY_METRIC_IDS, LOYALTY_METRICS } from '../../src/application/ai-read/loyalty-metrics';
import { STOCK_METRIC_IDS, STOCK_METRICS } from '../../src/application/ai-read/stock-metrics';
import { envValidationSchema } from '../../src/config/env.validation';
import { DashboardModule } from '../../src/modules/dashboard.module';

/*
 * HD-6 H4 through the real guards, adapters and validation pipe: the stock route answers the
 * envelope for the person's own scope, reads depot-, order- and forecast-service for exactly the
 * depots and days the person may read, and the contract the AI web codes against says what is
 * served. Only the network is faked.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const DEPOT_URL = 'http://depot.test';
const ORDER_URL = 'http://order.test';
const FORECAST_URL = 'http://forecast.test';
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
  FORECAST_SERVICE_URL: FORECAST_URL,
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
const aiToken = (role: string) => es256({ iss: 'hydromart-auth', aud: 'hydromart-ai', sub: PERSON, role, depotId: null, exp: exp() });

const MONTH = 'period=month&date=2026-11-10';
const contract = JSON.parse(readFileSync(join(__dirname, '../../../../contracts/ai-v1/read.openapi.json'), 'utf8'));
const STOCK_OP = contract.paths['/dashboard/api/v1/ai/read/stock'].get;
const LOYALTY_OP = contract.paths['/dashboard/api/v1/ai/read/loyalty'].get;

const GRANTS: Record<string, { all: boolean; legalEntityIds: string[] }> = {
  SUPER_ADMIN: { all: true, legalEntityIds: [] },
  FINANCE: { all: false, legalEntityIds: [PT_B] },
};

describe('GET ai/read/stock and ai/read/loyalty (HD-6 H4)', () => {
  let app: INestApplication;
  const asked: URL[] = [];

  beforeAll(async () => {
    Object.assign(process.env, testEnv);
    resetExternalKeyStores();
    configureDepotScope(async () => [D1, D2]);
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
      if (url.href === `${AUTH_URL}/api/v1/auth/jwks`) return json({ keys: [JWK] });
      if (url.href.startsWith(FORECAST_URL)) {
        asked.push(url);
        return json({ depotId: url.searchParams.get('depotId'), predictedDaily: [10, 10, 10, 10, 10, 10, 10], predictedTotal: 70 });
      }
      if (url.href.startsWith(ORDER_URL)) {
        asked.push(url);
        const day = url.searchParams.get('from');
        return json([{ day, meterLiters: 2600, soldLiters: 2430, varianceLiters: 170, varianceGallons: 8.95, varianceIdr: 179_000, roYieldPct: null }]);
      }
      if (!url.href.startsWith(DEPOT_URL)) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      if (url.pathname.startsWith('/api/v1/internal/ai-stock/')) {
        asked.push(url);
        const ids = (url.searchParams.get('depotIds') ?? '').split(',');
        return json({ items: ids.map((depotId) => ({ depotId, lines: 3, lowLines: 1, outLines: 0, byType: [{ itemType: 'GALON', availableUnits: 30, lines: 3 }] })) });
      }
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

  const get = (token: string | null, group: 'stock' | 'loyalty', metric: string, query = MONTH) => {
    const req = request(app.getHttpServer()).get(`/api/v1/ai/read/${group}?metric=${metric}${query ? `&${query}` : ''}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('answers the water meter for a depot that changed entity only for the days its role may read', async () => {
    const res = await get(aiToken('FINANCE'), 'stock', 'S-04').expect(200);
    // FINANCE is granted PT_B: D1 from 16 Nov, D2 the whole month: two history reads, one closed day each
    expect(res.body).toMatchObject({ metricId: 'S-04', status: 'ok', value: { daysWithReading: 2, meterLiters: 5200, varianceIdr: 358_000 } });
    const reads = asked.map((u) => `${u.pathname.split('/').pop()}@${u.searchParams.get('from')}..${u.searchParams.get('to')}`).sort();
    expect(reads).toEqual([`${D1}@2026-11-16..2026-11-30`, `${D2}@2026-11-01..2026-11-30`].sort());
    expect(res.body.scope.legalEntityIds).toEqual([PT_B]);
  });

  it('answers S-01 for the depots readable today and S-06 as a forecast', async () => {
    const res = await get(aiToken('SUPER_ADMIN'), 'stock', 'S-01', 'period=month&date=2026-11-10').expect(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.value.lines).toBe('number');
    const f = await get(aiToken('SUPER_ADMIN'), 'stock', 'S-06').expect(200);
    expect(f.body.label).toContain('PERKIRAAN');
  });

  it('answers every loyalty metric belum_ada with null and a reason', async () => {
    for (const id of LOYALTY_METRIC_IDS) {
      const res = await get(aiToken('SUPER_ADMIN'), 'loyalty', id).expect(200);
      expect(res.body).toMatchObject({ metricId: id, status: 'belum_ada', value: null });
      expect(typeof res.body.reason).toBe('string');
    }
  });

  it('refuses a metric outside the group, an ambiguous period, and keeps the door', async () => {
    await get(aiToken('SUPER_ADMIN'), 'stock', 'P-01').expect(404);
    await get(aiToken('SUPER_ADMIN'), 'loyalty', 'S-01').expect(404);
    await get(aiToken('SUPER_ADMIN'), 'stock', 'S-04', '').expect(400);
    await get(aiToken('SUPER_ADMIN'), 'stock', 'S-01', 'period=fortnight').expect(400);
    // a metric about now needs no period: it is answered over today
    await get(aiToken('SUPER_ADMIN'), 'stock', 'S-01', '').expect(200);
    await get(null, 'stock', 'S-01').expect(401);
    const machine = es256({ iss: 'hydromart-auth', aud: 'hydromart-machine', sub: PERSON, scopes: ['aiRead'], exp: exp() });
    await get(machine, 'stock', 'S-01').expect(403);
    await get(aiToken('FRANCHISE_OWNER'), 'loyalty', 'O-04').expect(403);
  });

  /*
   * The AI web codes against contracts/ai-v1/read.openapi.json, in another repository: the metric
   * ids, their units and the status rules it quotes must be what is served.
   */
  it('matches the contract the AI web codes against', async () => {
    const groups = [
      { op: STOCK_OP, ids: [...STOCK_METRIC_IDS], units: (id: string) => STOCK_METRICS[id as keyof typeof STOCK_METRICS].unit },
      { op: LOYALTY_OP, ids: [...LOYALTY_METRIC_IDS], units: (id: string) => LOYALTY_METRICS[id as keyof typeof LOYALTY_METRICS].unit },
    ];
    for (const { op, ids, units } of groups) {
      expect(op.parameters.map((p: { name: string }) => p.name).sort()).toEqual(['date', 'from', 'metric', 'period', 'to']);
      expect(op.parameters.find((p: { name: string }) => p.name === 'metric').schema.enum).toEqual(ids);
      expect(Object.keys(op['x-metrics'])).toEqual(ids);
      for (const id of ids) {
        const m = op['x-metrics'][id];
        expect(m.unit).toBe(units(id));
        expect(m.wholeMonthOnly).toBe(false);
        expect(typeof m.value).toBe('string');
        expect(m.rules.length).toBeGreaterThan(20);
      }
      expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '401', '403', '404', '429', '500', '503']);
    }
    for (const id of LOYALTY_METRIC_IDS) expect(LOYALTY_OP['x-metrics'][id].rules).toContain('Always belum_ada');

    // what is served has exactly the fields the contract's envelope names, for both routes
    const schema = contract.components.schemas.AnswerEnvelope;
    for (const [group, metric] of [['stock', 'S-01'], ['loyalty', 'O-04']] as const) {
      const res = await get(aiToken('SUPER_ADMIN'), group, metric).expect(200);
      for (const field of schema.required) expect(res.body).toHaveProperty(field);
      for (const field of Object.keys(res.body)) expect(Object.keys(schema.properties)).toContain(field);
      const example = (group === 'stock' ? STOCK_OP : LOYALTY_OP).responses['200'].content['application/json'].example;
      for (const field of schema.required) expect(example).toHaveProperty(field);
      for (const field of Object.keys(example)) expect(Object.keys(schema.properties)).toContain(field);
    }
  });
});
