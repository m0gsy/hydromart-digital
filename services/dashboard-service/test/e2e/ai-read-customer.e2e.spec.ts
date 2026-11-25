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

import { CUSTOMER_METRIC_IDS, CUSTOMER_METRICS } from '../../src/application/ai-read/customer-metrics';
import { DELIVERY_METRIC_IDS, DELIVERY_METRICS } from '../../src/application/ai-read/delivery-metrics';
import { TARGET_METRICS, TARGET_METRIC_IDS } from '../../src/application/ai-read/target-metrics';
import { GALLON_METRIC_IDS, GALLON_METRICS } from '../../src/application/ai-read/gallon-metrics';
import { envValidationSchema } from '../../src/config/env.validation';
import { DashboardModule } from '../../src/modules/dashboard.module';

/*
 * HD-6 H3 through the real guards, adapters and validation pipe: the customer, delivery and gallon routes
 * answer the envelope for the person own scope, ask the sources for exactly the days a depot was
 * readable, hold small groups back, and the contract the AI web codes against says what is served.
 * Only the network is faked.
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
type Registry = Record<string, { unit: string; month?: boolean; oneMonth?: boolean }>;
const OPS = {
  customers: contract.paths['/dashboard/api/v1/ai/read/customers'].get,
  delivery: contract.paths['/dashboard/api/v1/ai/read/delivery'].get,
  gallons: contract.paths['/dashboard/api/v1/ai/read/gallons'].get,
  targets: contract.paths['/dashboard/api/v1/ai/read/targets'].get,
};
const GROUPS = {
  customers: { ids: CUSTOMER_METRIC_IDS as string[], registry: CUSTOMER_METRICS as Registry },
  delivery: { ids: DELIVERY_METRIC_IDS as string[], registry: DELIVERY_METRICS as Registry },
  gallons: { ids: GALLON_METRIC_IDS as string[], registry: GALLON_METRICS as Registry },
  targets: { ids: TARGET_METRIC_IDS as string[], registry: TARGET_METRICS as Registry },
};

const GRANTS: Record<string, { all: boolean; legalEntityIds: string[] }> = {
  SUPER_ADMIN: { all: true, legalEntityIds: [] },
  FINANCE: { all: false, legalEntityIds: [PT_B] },
};

describe('GET ai/read/{customers,delivery,gallons}?metric= (HD-6 H3)', () => {
  let app: INestApplication;
  /** D1 moves PT_A -> PT_B on 16 Nov; D2 stays PT_B all month. */
  let gallonsDown = false;
  const posted: { path: string; body: { spans?: { depotId: string; from: string; to: string }[] } }[] = [];

  beforeAll(async () => {
    // 5 Dec 2026: November is closed, so its counts are answered (a running month is held). Only the clock is faked.
    jest.useFakeTimers({
      now: new Date('2026-12-08T03:00:00.000Z'),
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'performance', 'hrtime'],
    });
    Object.assign(process.env, testEnv);
    resetExternalKeyStores();
    configureDepotScope(async () => [D1, D2]);
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
      if (url.href === `${AUTH_URL}/api/v1/auth/jwks`) return json({ keys: [JWK] });
      if (url.href.startsWith(ORDER_URL) || url.href.startsWith('http://delivery.test')) {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        posted.push({ path: url.pathname, body });
        if (url.pathname.endsWith('/customer-metrics')) {
          return json({ active: 40, newCustomers: 12, repeat: 25, newAtDepot: [{ depotId: D2, customers: 5 }] });
        }
        if (url.pathname.endsWith('/rating-metrics')) return json({ reviews: 2, ratingSum: 9, reviewers: 2 });
        if (url.pathname.endsWith('/gallon-metrics')) {
          if (gallonsDown) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
          // 777 gallons per span asked about, grouped by depot like the real route
          const by = new Map<string, number>();
          for (const sp of body.spans ?? []) by.set(sp.depotId, (by.get(sp.depotId) ?? 0) + 777);
          return json({ gallons: 777 * (body.spans?.length ?? 0), byDepot: [...by].map(([depotId, gallons]) => ({ depotId, gallons })) });
        }
        if (url.pathname.endsWith('/ai-summary')) {
          return json({ delivered: 40, onTime: 34, storedVerdicts: 30, thresholdMinutes: 90, medianMinutes: 41.5, couriers: 5, failed: 6, noShow: 2, otherFailed: 4, byReason: { ADDRESS_NOT_FOUND: 1, CUSTOMER_REFUSED: 1, GOODS_DAMAGED: 0, CANNOT_CONTACT: 0, OTHER: 2, NO_SHOW: 2, DEPOT_CANCELLED: 0 }, rescheduled: 3 });
        }
        return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
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
      if (url.pathname === '/api/v1/gallon-outstanding/internal/ledger-summary') {
        const ids = (url.searchParams.get('depotIds') ?? '').split(',');
        return json({
          items: ids.map((depotId) => ({
            depotId,
            issuedTotal: 10,
            returnedTotal: 4,
            depositHeldTotal: 150_000,
            depositRefundedTotal: 60_000,
            issuedInWindow: 2,
            depositHeldInWindow: 30_000,
            returnedGoodInWindow: 1,
            returnedDamagedInWindow: 0,
            depositRefundedInWindow: 15_000,
          })),
        });
      }
      if (url.pathname === '/api/v1/depot-targets/internal/by-month') {
        // D1 has every goal set; D2 has none (HD-16)
        const ids = (url.searchParams.get('depotIds') ?? '').split(',');
        return json(ids.map((depotId) => ({ depotId, revenueTargetIdr: 0, ordersTarget: depotId === D1 ? 2000 : 0, newCustomersTarget: 0, gallonsTarget: depotId === D1 ? 4000 : 0 })));
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
    posted.length = 0;
  });

  afterAll(async () => {
    await app.close();
    jest.useRealTimers();
    jest.restoreAllMocks();
    resetExternalKeyStores();
    resetDepotScope();
  });

  const get = (token: string | null, group: keyof typeof GROUPS, metric: string, query = MONTH) => {
    const req = request(app.getHttpServer()).get(`/api/v1/ai/read/${group}?metric=${metric}${query ? `&${query}` : ''}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('answers C-01 for SUPER_ADMIN with one read over every readable stretch, in WIB instants', async () => {
    const res = await get(aiToken('SUPER_ADMIN'), 'customers', 'C-01').expect(200);
    expect(res.body).toMatchObject({ metricId: 'C-01', status: 'ok', unit: 'orang', scope: { depotIds: [D1, D2] } });
    expect(res.body.value).toBe(12);
    const call = posted.find((p) => p.path.endsWith('/customer-metrics'));
    // D1 is PT_A to 15 Nov then PT_B: two spans; D2 one: ONE call carries all three
    expect(call?.body.spans).toEqual([
      { depotId: D1, from: '2026-10-31T17:00:00.000Z', to: '2026-11-15T17:00:00.000Z' },
      { depotId: D1, from: '2026-11-15T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' },
      { depotId: D2, from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' },
    ]);
  });

  it('reads a depot that changed entity only for the days its role may read it', async () => {
    await get(aiToken('FINANCE'), 'customers', 'C-04').expect(200);
    const call = posted.find((p) => p.path.endsWith('/customer-metrics'));
    expect(call?.body.spans).toEqual([
      { depotId: D1, from: '2026-11-15T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' },
      { depotId: D2, from: '2026-10-31T17:00:00.000Z', to: '2026-11-30T17:00:00.000Z' },
    ]);
  });

  it('holds back a group of fewer than 3, with null and a reason, and never states a number for it', async () => {
    const rating = await get(aiToken('SUPER_ADMIN'), 'customers', 'C-10').expect(200);
    expect(rating.body).toMatchObject({ status: 'ditahan', value: null });
    expect(rating.body.reason).toContain('kurang dari 3');
    // two depots: the new customers of ONE depot are not summed across them
    expect((await get(aiToken('SUPER_ADMIN'), 'customers', 'C-02').expect(200)).body.status).toBe('ditahan');
    for (const id of ['C-03', 'C-07', 'C-09']) {
      const r = await get(aiToken('SUPER_ADMIN'), 'customers', id).expect(200);
      expect(r.body.value).toBeNull();
      expect(['belum_ada', 'ditahan']).toContain(r.body.status);
    }
  });

  it('answers target versus actual: gallons per depot with a null target where none is set, never 0%', async () => {
    const split = await get(aiToken('SUPER_ADMIN'), 'targets', 'T-02', 'period=month&date=2026-11-10&split=depot').expect(200);
    expect(split.body).toMatchObject({ metricId: 'T-02', status: 'ok', unit: 'galon' });
    // the stub sells 777 gallons per span: D1 has two spans (an entity change on 16 Nov), D2 one
    expect(split.body.value).toEqual({
      target: null,
      actual: 3 * 777,
      pct: null,
      byDepot: [
        { depotId: D1, target: 4000, actual: 2 * 777, pct: 38.9 },
        { depotId: D2, target: null, actual: 777, pct: null },
      ],
    });
    // a network answer with a depot lacking a target is belum_ada, and the revenue goal nobody set likewise
    expect((await get(aiToken('SUPER_ADMIN'), 'targets', 'T-02').expect(200)).body).toMatchObject({ status: 'belum_ada', value: null });
    expect((await get(aiToken('SUPER_ADMIN'), 'targets', 'T-01', 'period=month&date=2026-11-10&split=depot').expect(200)).body.status).toBe('belum_ada');
    // a count of people cannot be split; an open or non-month period and an unknown id are refused
    await get(aiToken('SUPER_ADMIN'), 'targets', 'T-04', 'period=month&date=2026-11-10&split=depot').expect(400);
    await get(aiToken('SUPER_ADMIN'), 'targets', 'T-02', 'period=week&date=2026-11-10').expect(400);
    await get(aiToken('SUPER_ADMIN'), 'targets', 'T-99').expect(404);
  });

  it('answers delivery and gallons, a gallon balance', async () => {
    const k2 = await get(aiToken('SUPER_ADMIN'), 'delivery', 'K-02').expect(200);
    expect(k2.body).toMatchObject({ status: 'ok', value: { ratePct: 85, onTime: 34, delivered: 40 } });
    expect(k2.body.label).toContain('30 dari 40');
    const g1 = await get(aiToken('SUPER_ADMIN'), 'gallons', 'G-01', 'period=day&date=2026-11-10').expect(200);
    // the stub answers 777 gallons per span it is asked about (three spans here)
    expect(g1.body).toMatchObject({ status: 'ok', value: 2331 });
    const g2 = await get(aiToken('SUPER_ADMIN'), 'gallons', 'G-02').expect(200);
    expect(g2.body.value).toMatchObject({ gallonsAtCustomers: 12 });
  });

  it('splits G-01 per depot (AI-7a) with ONE source read: total equals the unsplit answer', async () => {
    const plain = await get(aiToken('SUPER_ADMIN'), 'gallons', 'G-01').expect(200);
    posted.length = 0;
    const split = await get(aiToken('SUPER_ADMIN'), 'gallons', 'G-01', 'period=month&date=2026-11-10&split=depot').expect(200);
    // D1 has two stretches (PT_A, PT_B), D2 one
    expect(split.body.value).toEqual({ total: plain.body.value, byDepot: [{ depotId: D1, value: 1554 }, { depotId: D2, value: 777 }] });
    expect(posted.filter((p) => p.path.endsWith('/gallon-metrics'))).toHaveLength(1);
  });

  it('answers belum_ada, never a partial list, when the gallon source is down in split mode', async () => {
    gallonsDown = true;
    try {
      const res = await get(aiToken('SUPER_ADMIN'), 'gallons', 'G-01', 'period=month&date=2026-11-10&split=depot').expect(200);
      expect(res.body).toMatchObject({ status: 'belum_ada', value: null });
    } finally {
      gallonsDown = false;
    }
  });

  it('refuses split for people and network metrics, balances, and other groups (400)', async () => {
    const split = 'period=month&date=2026-11-10&split=depot';
    await get(aiToken('SUPER_ADMIN'), 'customers', 'C-01', split).expect(400);
    await get(aiToken('SUPER_ADMIN'), 'delivery', 'K-01', split).expect(400);
    await get(aiToken('SUPER_ADMIN'), 'gallons', 'G-02', split).expect(400);
    await get(aiToken('SUPER_ADMIN'), 'gallons', 'G-01', 'period=month&date=2026-11-10&split=x').expect(400);
    // an unknown metric is 404 before the split rule is looked at
    await get(aiToken('SUPER_ADMIN'), 'gallons', 'G-99', 'period=month&date=2026-11-10&split=depot').expect(404);
    await get(aiToken('SUPER_ADMIN'), 'customers', 'K-01', 'period=month&date=2026-11-10&split=depot').expect(404);
  });

  it('refuses a metric outside the group (404), a missing or ambiguous period and a month metric asked as a week (400)', async () => {
    await get(aiToken('SUPER_ADMIN'), 'customers', 'K-01').expect(404);
    await get(aiToken('SUPER_ADMIN'), 'delivery', 'C-01').expect(404);
    await get(aiToken('SUPER_ADMIN'), 'gallons', 'G-99').expect(404);
    await get(aiToken('SUPER_ADMIN'), 'customers', 'C-01', '').expect(400);
    await get(aiToken('SUPER_ADMIN'), 'customers', 'C-01', 'period=week&date=2026-11-10').expect(400);
    await get(aiToken('SUPER_ADMIN'), 'customers', 'C-01', 'from=2026-11-05&to=2026-11-20').expect(400);
    await get(aiToken('SUPER_ADMIN'), 'delivery', 'K-05', 'period=day&date=2026-11-10').expect(400);
    await get(aiToken('SUPER_ADMIN'), 'delivery', 'K-01', 'period=day&date=2026-11-10').expect(400);
    await get(aiToken('SUPER_ADMIN'), 'delivery', 'K-01', 'from=2026-11-01&to=2026-11-29').expect(400);
  });

  it('keeps the door: no token, a machine token and a franchise owner are refused', async () => {
    for (const group of ['customers', 'delivery', 'gallons', 'targets'] as const) {
      await get(null, group, 'X-00').expect(401);
      const machine = es256({ iss: 'hydromart-auth', aud: 'hydromart-machine', sub: PERSON, scopes: ['aiRead'], exp: exp() });
      await get(machine, group, 'X-00').expect(403);
      await get(aiToken('FRANCHISE_OWNER'), group, 'X-00').expect(403);
    }
  });

  /*
   * The AI web codes against contracts/ai-v1/read.openapi.json, in another repository: the metric
   * ids, their units, which ones are month-only and the status rules it quotes must be what is served.
   */
  it('matches the contract the AI web codes against', async () => {
    const served = { customers: 'C-04', delivery: 'K-01', gallons: 'G-01', targets: 'T-02' } as const;
    for (const group of ['customers', 'delivery', 'gallons', 'targets'] as const) {
      const op = OPS[group];
      const { ids, registry } = GROUPS[group];
      expect(op.parameters.map((p: { name: string }) => p.name).sort()).toEqual(['date', 'from', 'metric', 'period', ...(group === 'gallons' || group === 'targets' ? ['split'] : []), 'to']);
      expect(op.parameters.find((p: { name: string }) => p.name === 'metric').schema.enum).toEqual([...ids]);
      expect(Object.keys(op['x-metrics'])).toEqual([...ids]);
      for (const id of ids) {
        const m = op['x-metrics'][id];
        expect(m.unit).toBe(registry[id].unit);
        expect(m.wholeMonthOnly).toBe('month' in registry[id]);
        expect(m.exactlyOneMonth === true).toBe('oneMonth' in registry[id]);
        expect(typeof m.value).toBe('string');
        expect(m.rules.length).toBeGreaterThan(20);
      }
      expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '401', '403', '404', '429', '500', '503']);
      // what is served has exactly the fields the contract's envelope names
      const res = await get(aiToken('SUPER_ADMIN'), group, served[group]).expect(200);
      const schema = contract.components.schemas.AnswerEnvelope;
      for (const field of schema.required) expect(res.body).toHaveProperty(field);
      for (const field of Object.keys(res.body)) expect(Object.keys(schema.properties)).toContain(field);
      const example = op.responses['200'].content['application/json'].example;
      for (const field of schema.required) expect(example).toHaveProperty(field);
      for (const field of Object.keys(example)) expect(Object.keys(schema.properties)).toContain(field);
    }
    // the metrics that never carry a number say so in the contract
    for (const id of ['C-03', 'C-07', 'C-09']) expect(OPS.customers['x-metrics'][id].rules).toMatch(/Always (belum_ada|ditahan)/);
    expect(OPS.delivery['x-metrics']['K-06'].rules).toContain('Always ditahan');
  });
});
