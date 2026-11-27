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

import { VISIT_METRIC_IDS } from '../../src/application/ai-read/visit-metrics';
import { envValidationSchema } from '../../src/config/env.validation';
import { DashboardModule } from '../../src/modules/dashboard.module';

/*
 * AI-21 through the real guards, adapters and validation pipe: the visits route answers the envelope for the
 * person's own scope, reads depot-service for exactly the depots and days the person may read, and the contract
 * the AI web codes against says what is served. Only the network is faked.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const DEPOT_URL = 'http://depot.test';
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
  FORECAST_SERVICE_URL: 'http://forecast.test',
  LOYALTY_SERVICE_URL: 'http://loyalty.test',
  REFERRAL_SERVICE_URL: 'http://referral.test',
  CRM_SERVICE_URL: 'http://crm.test',
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
const OP = contract.paths['/dashboard/api/v1/ai/read/visits'].get;

describe('GET ai/read/visits (AI-21)', () => {
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
      if (!url.href.startsWith(DEPOT_URL)) return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      if (url.pathname === '/api/v1/visits/internal/ai-summary') {
        asked.push(url);
        const ids = (url.searchParams.get('depotIds') ?? '').split(',');
        return json({
          items: ids.map((depotId) => ({ depotId, completed: 2, findings: 1, lastCompletedOn: '2026-11-20', followUpsOpen: 3, followUpsOverdue: 1 })),
        });
      }
      if (url.pathname === '/api/v1/depots/manage') {
        return json({ items: [D1, D2].map((id) => ({ id, code: id, name: id, active: true, ownershipType: 'HKP' })), totalPages: 1 });
      }
      if (url.pathname === '/api/v1/legal-entities/internal/depot-entities') {
        const from = url.searchParams.get('from') ?? '2026-11-01';
        return json({
          spans: [
            { depotId: D1, legalEntityId: PT_A, from },
            { depotId: D2, legalEntityId: PT_B, from },
          ],
        });
      }
      const role = url.pathname.split('/internal/ai-grants/')[1];
      return json({ roleKey: role, all: role === 'SUPER_ADMIN', legalEntityIds: role === 'FINANCE' ? [PT_B] : [] });
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
    const req = request(app.getHttpServer()).get(`/api/v1/ai/read/visits?metric=${metric}${query ? `&${query}` : ''}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('answers V-01 for the depots and days the role may read, and splits per depot', async () => {
    const all = await get(aiToken('SUPER_ADMIN'), 'V-01').expect(200);
    expect(all.body).toMatchObject({ metricId: 'V-01', status: 'ok', value: 4, unit: 'kunjungan' });
    expect(asked[0].searchParams.get('depotIds')).toBe(`${D1},${D2}`);
    expect(asked[0].searchParams.get('from')).toBe('2026-10-31T17:00:00.000Z');
    asked.length = 0;
    const own = await get(aiToken('FINANCE'), 'V-04', `${MONTH}&split=depot`).expect(200);
    expect(own.body.value).toEqual({ total: 1, byDepot: [{ depotId: D2, value: 1 }] });
    expect(own.body.scope.legalEntityIds).toEqual([PT_B]);
    expect(asked.map((u) => u.searchParams.get('depotIds'))).toEqual([D2]);
  });

  it('answers the point metrics for today, per depot', async () => {
    const v2 = await get(aiToken('SUPER_ADMIN'), 'V-02', 'split=depot').expect(200);
    expect(v2.body.value.byDepot.map((r: { depotId: string }) => r.depotId)).toEqual([D1, D2]);
    const v3 = await get(aiToken('SUPER_ADMIN'), 'V-03', '').expect(200);
    expect(v3.body.value).toEqual({ open: 6, overdue: 2 });
  });

  it('refuses without a token, to a role without aiRead, to an unknown metric and to split with another value', async () => {
    await get(null, 'V-01').expect(401);
    await get(aiToken('FRANCHISE_OWNER'), 'V-01').expect(403);
    await get(aiToken('SUPER_ADMIN'), 'V-09').expect(404);
    await get(aiToken('SUPER_ADMIN'), 'V-01', 'period=month&split=region').expect(400);
  });

  it('matches the contract the AI web codes against', () => {
    const metric = OP.parameters.find((p: { name: string }) => p.name === 'metric');
    expect(metric.schema.enum).toEqual(VISIT_METRIC_IDS);
    expect(Object.keys(OP['x-metrics'])).toEqual(VISIT_METRIC_IDS);
    for (const id of VISIT_METRIC_IDS) expect(OP['x-metrics'][id].splittable).toBe(true);
    expect(Object.keys(OP.responses).sort()).toEqual(['200', '400', '401', '403', '404', '429', '500', '503']);
    const schema = contract.components.schemas.AnswerEnvelope;
    const example = OP.responses['200'].content['application/json'].example;
    for (const field of schema.required) expect(example).toHaveProperty(field);
    for (const field of Object.keys(example)) expect(Object.keys(schema.properties)).toContain(field);
    expect(VISIT_METRIC_IDS).toContain(example.metricId);
  });
});
