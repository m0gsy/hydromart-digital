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

import { FRANCHISE_METRICS, FRANCHISE_METRIC_IDS } from '../../src/application/ai-read/franchise-metrics';
import { HR_METRICS, HR_METRIC_IDS } from '../../src/application/ai-read/hr-metrics';
import { envValidationSchema } from '../../src/config/env.validation';
import { DashboardModule } from '../../src/modules/dashboard.module';

/*
 * HD-6 H5 through the real guards, adapters and validation pipe: the franchise and HR routes answer
 * the envelope for the person's own scope, read the services for exactly the depots and days a depot
 * was readable, and the contract the AI web codes against says what is served. Only the network is faked.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const DEPOT_URL = 'http://depot.test';
const HR_URL = 'http://hr.test';
const PAYOUT_URL = 'http://payout.test';
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
  ORDER_SERVICE_URL: 'http://order.test',
  DELIVERY_SERVICE_URL: 'http://delivery.test',
  DEPOT_SERVICE_URL: DEPOT_URL,
  PAYMENT_SERVICE_URL: 'http://payment.test',
  PAYOUT_SERVICE_URL: PAYOUT_URL,
  HR_SERVICE_URL: HR_URL,
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
const FRANCHISE_OP = contract.paths['/dashboard/api/v1/ai/read/franchise'].get;
const HR_OP = contract.paths['/dashboard/api/v1/ai/read/hr'].get;

const GRANTS: Record<string, { all: boolean; legalEntityIds: string[] }> = {
  SUPER_ADMIN: { all: true, legalEntityIds: [] },
  FINANCE: { all: false, legalEntityIds: [PT_B] },
};

describe('GET ai/read/franchise and ai/read/hr (HD-6 H5)', () => {
  let app: INestApplication;
  const asked: URL[] = [];

  beforeAll(async () => {
    Object.assign(process.env, testEnv);
    resetExternalKeyStores();
    configureDepotScope(async () => [D1, D2]);
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      asked.push(url);
      const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;
      const ids = (url.searchParams.get('depotIds') ?? '').split(',').filter(Boolean);
      if (url.href === `${AUTH_URL}/api/v1/auth/jwks`) return json({ keys: [JWK] });
      if (url.href.startsWith(PAYOUT_URL)) return json(ids.map((depotId) => ({ depotId, commissionIdr: 1_000 })));
      if (url.href.startsWith(HR_URL)) {
        if (url.pathname.endsWith('/depot-summaries')) {
          return json(ids.map((depotId) => ({ depotId, activeHeadcount: 4, payrollCount: 4, payrollDraftCount: 0, payrollFinalCount: 4, payrollExpectedCount: 4 })));
        }
        if (url.pathname.endsWith('/ai/attendance')) {
          return json({ rolledUp: false, rows: ids.map((depotId) => ({ depotId, present: 10, late: 1, absentRecorded: 0, leave: 0, pending: 0, people: { present: 4, late: 4, absentRecorded: 0, leave: 0, pending: 0 } })) });
        }
        if (url.pathname.endsWith('/ai/payroll')) {
          return json(ids.map((depotId) => ({ depotId, slips: 4, grossIdr: 1_000, bonusIdr: 100, deductionIdr: 10, netIdr: 1_090, gallonBonusIdr: 50, gallonPeople: 3 })));
        }
        return json(ids.map((depotId) => ({ depotId, people: 3, remainingIdr: 700 })));
      }
      if (!url.href.startsWith(DEPOT_URL)) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      if (url.pathname === '/api/v1/depots/manage') {
        return json({ items: [D1, D2].map((id) => ({ id, code: id, name: id, active: true, ownershipType: 'HKP' })), totalPages: 1 });
      }
      if (url.pathname === '/api/v1/franchise-applications/internal/summary') {
        return json({ total: 6, byStage: { PENDING: 3, DOC_VERIFICATION: 3 } });
      }
      if (url.pathname === '/api/v1/legal-entities/internal/kinds') {
        return json({ entities: [{ id: PT_A, kind: 'FRANCHISEE' }, { id: PT_B, kind: 'OPERATOR' }] });
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

  const get = (token: string | null, group: 'franchise' | 'hr', metric: string, query = MONTH) => {
    const req = request(app.getHttpServer()).get(`/api/v1/ai/read/${group}?metric=${metric}${query ? `&${query}` : ''}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('answers W-01 and W-02 for a role that holds the queue and every entity, as counts only', async () => {
    const w1 = await get(aiToken('SUPER_ADMIN'), 'franchise', 'W-01').expect(200);
    expect(w1.body).toMatchObject({ metricId: 'W-01', status: 'ok', value: 6, unit: 'pengajuan' });
    const w2 = await get(aiToken('SUPER_ADMIN'), 'franchise', 'W-02').expect(200);
    expect(w2.body.value.byStage.find((s: { stage: string }) => s.stage === 'PENDING')).toEqual({ stage: 'PENDING', value: 3 });
    const call = asked.find((u) => u.pathname.endsWith('/franchise-applications/internal/summary'));
    expect(call?.searchParams.get('from')).toBe('2026-10-31T17:00:00.000Z');
  });

  it('holds calon mitra back from a role granted only some entities', async () => {
    const res = await get(aiToken('FINANCE'), 'franchise', 'W-01').expect(200);
    expect(res.body).toMatchObject({ status: 'ditahan', value: null });
  });

  it('answers W-06 with the entity each depot had on the last day, W-04 ditahan, and W-05 over the stretches read', async () => {
    const w6 = await get(aiToken('SUPER_ADMIN'), 'franchise', 'W-06').expect(200);
    expect(w6.body.value).toEqual([
      { depotId: D1, legalEntityId: PT_B, kind: 'OPERATOR', changedInPeriod: true },
      { depotId: D2, legalEntityId: PT_B, kind: 'OPERATOR', changedInPeriod: false },
    ]);
    expect((await get(aiToken('SUPER_ADMIN'), 'franchise', 'W-04').expect(200)).body).toMatchObject({ status: 'ditahan', value: null });
    const w5 = await get(aiToken('SUPER_ADMIN'), 'franchise', 'W-05').expect(200);
    expect(w5.body.value).toBe(3_000); // D1 twice (PT_A, PT_B stretches) and D2 once
  });

  it('answers the HR metrics from the depots readable on the day: finance reads D1 only from 16 Nov', async () => {
    const h3 = await get(aiToken('FINANCE'), 'hr', 'H-03').expect(200);
    expect(h3.body).toMatchObject({ status: 'ok', value: { slips: 8, grossIdr: 2_000 }, scope: { depotIds: [D1, D2], legalEntityIds: [PT_B] } });
    const h2 = await get(aiToken('FINANCE'), 'hr', 'H-02').expect(200);
    const att = asked.filter((u) => u.pathname.endsWith('/ai/attendance'));
    expect(att.map((u) => `${u.searchParams.get('depotIds')}@${u.searchParams.get('from')}..${u.searchParams.get('to')}`).sort()).toEqual(
      [`${D1}@2026-11-16..2026-11-30`, `${D2}@2026-11-01..2026-11-30`].sort(),
    );
    expect(h2.body.value).toMatchObject({ present: 20, late: 2 });
  });

  it('answers H-06 and H-07 belum_ada', async () => {
    for (const metric of ['H-06', 'H-07']) {
      expect((await get(aiToken('SUPER_ADMIN'), 'hr', metric).expect(200)).body).toMatchObject({ status: 'belum_ada', value: null });
    }
  });

  it('refuses a metric outside the group, an ambiguous period and a month metric asked over a free range', async () => {
    await get(aiToken('SUPER_ADMIN'), 'franchise', 'H-01').expect(404);
    await get(aiToken('SUPER_ADMIN'), 'hr', 'W-01').expect(404);
    await get(aiToken('SUPER_ADMIN'), 'hr', 'H-01', '').expect(400);
    await get(aiToken('SUPER_ADMIN'), 'hr', 'H-03', 'from=2026-11-05&to=2026-11-20').expect(400);
  });

  it('keeps the door: no token, a machine token and a franchise owner are refused', async () => {
    await get(null, 'hr', 'H-01').expect(401);
    const machine = es256({ iss: 'hydromart-auth', aud: 'hydromart-machine', sub: PERSON, scopes: ['aiRead'], exp: exp() });
    await get(machine, 'franchise', 'W-01').expect(403);
    await get(aiToken('FRANCHISE_OWNER'), 'hr', 'H-01').expect(403);
  });

  /* The AI web codes against contracts/ai-v1/read.openapi.json, in another repository. */
  it.each([
    ['franchise', FRANCHISE_OP, FRANCHISE_METRIC_IDS, FRANCHISE_METRICS],
    ['hr', HR_OP, HR_METRIC_IDS, HR_METRICS],
  ] as const)('matches the contract for the %s group', async (group, op, ids, meta) => {
    expect(op.parameters.map((p: { name: string }) => p.name).sort()).toEqual(['date', 'from', 'metric', 'period', 'to']);
    expect(op.parameters.find((p: { name: string }) => p.name === 'metric').schema.enum).toEqual([...ids]);
    expect(Object.keys(op['x-metrics'])).toEqual([...ids]);
    for (const id of ids) {
      const m = op['x-metrics'][id];
      const own = (meta as Record<string, { unit: string; month?: boolean }>)[id];
      expect(m.unit).toBe(own.unit);
      expect(m.wholeMonthOnly).toBe('month' in own);
      expect(typeof m.value).toBe('string');
      expect(m.rules.length).toBeGreaterThan(20);
    }
    expect(Object.keys(op.responses).sort()).toEqual(['200', '400', '401', '403', '404', '429', '500', '503']);
    const never = group === 'franchise' ? ['W-04'] : ['H-06', 'H-07'];
    for (const id of never) expect(op['x-metrics'][id].rules).toContain(group === 'franchise' ? 'Always ditahan' : 'Always belum_ada');

    const res = await get(aiToken('SUPER_ADMIN'), group, ids[0]).expect(200);
    const schema = contract.components.schemas.AnswerEnvelope;
    for (const field of schema.required) expect(res.body).toHaveProperty(field);
    for (const field of Object.keys(res.body)) expect(Object.keys(schema.properties)).toContain(field);
    const example = op.responses['200'].content['application/json'].example;
    for (const field of schema.required) expect(example).toHaveProperty(field);
    for (const field of Object.keys(example)) expect(Object.keys(schema.properties)).toContain(field);
    expect(ids).toContain(example.metricId);
  });
});
