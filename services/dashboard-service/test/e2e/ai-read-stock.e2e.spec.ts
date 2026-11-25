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
const LOYALTY_URL = 'http://loyalty.test';
const REFERRAL_URL = 'http://referral.test';
const CRM_URL = 'http://crm.test';
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
  LOYALTY_SERVICE_URL: LOYALTY_URL,
  REFERRAL_SERVICE_URL: REFERRAL_URL,
  CRM_SERVICE_URL: CRM_URL,
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
// A month that is over whenever this runs.
const CLOSED = 'period=month&date=2026-01-10';
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
  const bodies: unknown[] = [];

  beforeAll(async () => {
    Object.assign(process.env, testEnv);
    resetExternalKeyStores();
    configureDepotScope(async () => [D1, D2]);
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
      if (url.href === `${AUTH_URL}/api/v1/auth/jwks`) return json({ keys: [JWK] });
      if (url.href.startsWith(LOYALTY_URL) || url.href.startsWith(REFERRAL_URL) || url.href.startsWith(CRM_URL)) {
        asked.push(url);
        if (init?.body) bodies.push(JSON.parse(String(init.body)));
        if (url.pathname.endsWith('/redemptions')) return json({ redemptions: 9, points: 4500, redeemers: 6, unplaced: 0 });
        if (url.pathname.endsWith('/points-outstanding')) return json({ accounts: 1234, points: 987_650 });
        if (url.pathname.startsWith('/api/v1/referrals/')) return json({ invited: 30, qualified: 12, qualifiedReferrers: 8, referrerPoints: 600, refereePoints: 300 });
        return json({ campaigns: 3, sent: 900, failed: 40, skipped: 60, other: 0 });
      }
      if (url.pathname === '/api/v1/reports/internal/discount-metrics') {
        asked.push(url);
        bodies.push(JSON.parse(String(init?.body)));
        return json({ orders: 400, discountedOrders: 90, discountIdr: 1_234_567 });
      }
      if (url.pathname === '/api/v1/reports/internal/subscription-metrics') {
        asked.push(url);
        return json({ subscriptions: 25, subscribers: 20 });
      }
      if (url.pathname === '/api/v1/internal/ai-queues/open') {
        asked.push(url);
        const ids = (url.searchParams.get('depotIds') ?? '').split(',');
        return json({ items: ids.map((depotId) => ({ depotId, incidents: 2, disputes: 1, approvals: 3, maintenanceOverdue: 1 })) });
      }
      if (url.href.startsWith(FORECAST_URL)) {
        asked.push(url);
        return json({ depotId: url.searchParams.get('depotId'), predictedDaily: [10, 10, 10, 10, 10, 10, 10], predictedTotal: 70 });
      }
      if (url.href.startsWith(ORDER_URL)) {
        asked.push(url);
        const day = url.searchParams.get('from');
        return json([{ day, meterLiters: 2600, soldLiters: 2430, varianceLiters: 170, varianceGallons: 8.95, varianceIdr: 179_000, sourceLiters: null, roYieldPct: null }]);
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
        const asked = url.searchParams.get('from') ?? '2026-11-01';
        const clip = (day: string) => (day < asked ? asked : day);
        return json({
          spans: [
            { depotId: D1, legalEntityId: PT_A, from: clip('2026-11-01') },
            { depotId: D1, legalEntityId: PT_B, from: clip('2026-11-16') },
            { depotId: D2, legalEntityId: PT_B, from: clip('2026-11-01') },
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
    bodies.length = 0;
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

  it('answers O-01, O-03 and O-05 belum_ada with null and a reason', async () => {
    for (const id of ['O-01', 'O-03', 'O-05']) {
      const res = await get(aiToken('SUPER_ADMIN'), 'loyalty', id).expect(200);
      expect(res.body).toMatchObject({ metricId: id, status: 'belum_ada', value: null });
      expect(typeof res.body.reason).toBe('string');
    }
  });

  it('answers the network metrics for a role that reads every entity, one closed month at a time', async () => {
    const points = await get(aiToken('SUPER_ADMIN'), 'loyalty', 'O-04', CLOSED).expect(200);
    expect(points.body).toMatchObject({ status: 'ok', value: { asOf: '2026-01-31', points: 987_650, accounts: 1235 } });
    expect(asked[asked.length - 1].searchParams.get('before')).toBe('2026-01-31T17:00:00.000Z');
    expect((await get(aiToken('SUPER_ADMIN'), 'loyalty', 'O-06', CLOSED).expect(200)).body.value).toMatchObject({ invited: { value: 30 }, conversionPct: 40 });
    expect((await get(aiToken('SUPER_ADMIN'), 'loyalty', 'O-08', CLOSED).expect(200)).body.value).toMatchObject({ new: { subscriptions: 25, subscribers: 20 } });
    expect((await get(aiToken('SUPER_ADMIN'), 'loyalty', 'O-09', CLOSED).expect(200)).body.value).toMatchObject({ campaigns: 3, recipients: 1000 });
    // a role that does not read every legal entity is not given the network's numbers
    expect((await get(aiToken('FINANCE'), 'loyalty', 'O-04', CLOSED).expect(200)).body).toMatchObject({ status: 'ditahan', value: null });
    // the running month, and anything but one whole month, are refused. Today's UTC date always names a
    // month still running or closed under 8 days in WIB, so this never turns into a date bomb.
    const running = `period=month&date=${new Date().toISOString().slice(0, 10)}`;
    expect((await get(aiToken('SUPER_ADMIN'), 'loyalty', 'O-04', running).expect(200)).body).toMatchObject({ status: 'ditahan' });
    await get(aiToken('SUPER_ADMIN'), 'loyalty', 'O-04', 'period=week&date=2026-01-10').expect(400);
    await get(aiToken('SUPER_ADMIN'), 'loyalty', 'O-06', 'from=2026-01-01&to=2026-02-28').expect(400);
  });

  it('answers O-02 and O-07 over the depot stretches the role may read, and A-01 over today', async () => {
    const redeemed = await get(aiToken('FINANCE'), 'loyalty', 'O-02', CLOSED).expect(200);
    expect(redeemed.body).toMatchObject({ status: 'ok', value: { points: 4500, redeemers: 6 } });
    expect((bodies[0] as { spans: { depotId: string; from: string; to: string }[] }).spans.map((s) => s.depotId).sort()).toEqual([D1, D2].sort());
    bodies.length = 0;
    const cost = await get(aiToken('FINANCE'), 'loyalty', 'O-07', MONTH).expect(200);
    expect(cost.body).toMatchObject({ status: 'ok', value: { orders: 400, discountedOrders: 90, discountIdr: 1_234_567 } });
    // FINANCE reads D1 only from 16 Nov: 15 Nov is the last instant before it
    expect((bodies[0] as { spans: { depotId: string; from: string }[] }).spans.find((s) => s.depotId === D1)?.from).toBe('2026-11-15T17:00:00.000Z');
    const queues = await get(aiToken('SUPER_ADMIN'), 'loyalty', 'A-01', '').expect(200);
    expect(queues.body).toMatchObject({ status: 'ok', period: { unit: 'day' } });
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

  it('refuses split=depot on every metric of these groups (AI-7a): people, network and non-sum figures are never split', async () => {
    const query = 'period=month&date=2026-11-10&split=depot';
    await get(aiToken('SUPER_ADMIN'), 'stock', 'S-02', query).expect(400);
    await get(aiToken('SUPER_ADMIN'), 'loyalty', 'A-01', query).expect(400);
  });

  /*
   * The AI web codes against contracts/ai-v1/read.openapi.json, in another repository: the metric
   * ids, their units and the status rules it quotes must be what is served.
   */
  it('matches the contract the AI web codes against', async () => {
    const wholeMonth = (id: string): boolean => (id in LOYALTY_METRICS ? 'month' in LOYALTY_METRICS[id as keyof typeof LOYALTY_METRICS] : false);
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
        expect(m.wholeMonthOnly).toBe(wholeMonth(id));
        expect(typeof m.value).toBe('string');
        expect(m.rules.length).toBeGreaterThan(20);
      }
      expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '401', '403', '404', '429', '500', '503']);
    }
    for (const id of ['O-01', 'O-03', 'O-05']) expect(LOYALTY_OP['x-metrics'][id].rules).toContain('Always belum_ada');
    for (const id of LOYALTY_METRIC_IDS) expect(LOYALTY_OP['x-metrics'][id].exactlyOneMonth === true).toBe('month' in LOYALTY_METRICS[id]);

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
