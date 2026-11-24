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

import { PENDING_QUEUE_KEYS } from '../../src/application/ports/pending-approval-sources.port';
import { PENDING_QUEUES } from '../../src/application/services/pending-approvals.service';
import { envValidationSchema } from '../../src/config/env.validation';
import { DashboardModule } from '../../src/modules/dashboard.module';

/*
 * HD-11 through the real guards, the real adapter and the validation pipe: an AI-web token sees
 * exactly the queues its own role decides, counted over its own depots, and nothing else gets in.
 * The only thing faked is the network: the key set and the holding services' internal answers.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const INTERNAL_KEY = 'test-internal-service-key-01';
const AUTH_URL = 'http://auth.test';
const D1 = '11111111-1111-4111-8111-111111111111';
const D2 = '22222222-2222-4222-8222-222222222222';
const OLDEST = '2026-11-20T01:02:03.000Z';
const PERSON = '99999999-9999-4999-8999-999999999999';
const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DASHBOARD_SERVICE_PORT: '3008',
  JWT_ACCESS_SECRET: SECRET,
  INTERNAL_SERVICE_KEY: INTERNAL_KEY,
  ORDER_SERVICE_URL: 'http://order.test',
  DELIVERY_SERVICE_URL: 'http://delivery.test',
  DEPOT_SERVICE_URL: 'http://depot.test',
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

const ROUTE = '/api/v1/dashboard/pending-approvals';
const contract = JSON.parse(
  readFileSync(join(__dirname, '../../../../contracts/ai-v1/approvals.openapi.json'), 'utf8'),
);

describe('GET dashboard/pending-approvals (HD-11)', () => {
  let app: INestApplication;
  let staffSession: string;
  /** Internal calls the adapter made, by queue segment. */
  const asked: Array<{ segment: string; url: URL; key: unknown }> = [];
  /** A holding service that refuses, by queue segment. */
  const refusing = new Set<string>();

  beforeAll(async () => {
    Object.assign(process.env, testEnv);
    resetExternalKeyStores();
    // MANAGER resolves to their own depot plus the one the hierarchy hangs off them.
    configureDepotScope(async () => [D2]);
    jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.href === `${AUTH_URL}/api/v1/auth/jwks`) {
        return { ok: true, json: async () => ({ keys: [JWK] }) } as unknown as Response;
      }
      const segment = url.pathname.split('/pending-approvals/internal/')[1];
      if (!segment) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
      asked.push({ segment, url, key: (init?.headers as Record<string, string>)['x-internal-key'] });
      if (refusing.has(segment)) {
        return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ count: 4, oldestAt: OLDEST }) } as unknown as Response;
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
        { sub: PERSON, role: 'HEAD_OFFICE', phone: '+62811' },
        { secret: SECRET, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
      );
  });

  afterEach(() => {
    asked.length = 0;
    refusing.clear();
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
    resetExternalKeyStores();
    resetDepotScope();
  });

  const get = (token: string | null) => {
    const req = request(app.getHttpServer()).get(ROUTE);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  it('shows head office, through the AI web, exactly the queues head office decides', async () => {
    const res = await get(aiToken('HEAD_OFFICE')).expect(200);
    expect(res.body).toEqual({
      queues: [
        { key: 'priceOverrides', count: 4, oldestAt: OLDEST, href: '/hq/pricing' },
        { key: 'leave', count: 4, oldestAt: OLDEST, href: '/hr/leave' },
        { key: 'franchiseApplications', count: 4, oldestAt: OLDEST, href: '/hq/applications' },
      ],
    });
    // Network-wide role: no depot named, the internal key on every call, the person as data.
    expect(asked.map((a) => a.segment).sort()).toEqual(['franchise-applications', 'leave', 'price-overrides']);
    for (const a of asked) {
      expect(a.key).toBe(INTERNAL_KEY);
      expect(a.url.searchParams.get('actorId')).toBe(PERSON);
      expect(a.url.searchParams.get('role')).toBe('HEAD_OFFICE');
      expect(a.url.searchParams.has('depotIds')).toBe(false);
    }
  });

  it("counts a manager's queues over their own depots only", async () => {
    const res = await get(aiToken('MANAGER', D1)).expect(200);
    expect(res.body.queues.map((q: { key: string }) => q.key)).toEqual([
      'expenses',
      'settlements',
      'leave',
      'kasbon',
      'approvals',
    ]);
    expect(asked).toHaveLength(5);
    for (const a of asked) expect(a.url.searchParams.get('depotIds')).toBe(`${D1},${D2}`);
  });

  it('holds a depot-locked role to its one depot', async () => {
    const res = await get(aiToken('KEPALA_DEPOT', D2)).expect(200);
    expect(res.body.queues.map((q: { key: string }) => q.key)).toEqual(['settlements']);
    expect(asked.map((a) => a.url.searchParams.get('depotIds'))).toEqual([D2]);
  });

  it('gives a role that decides none of the queues an empty list, and asks no one', async () => {
    await expect(get(aiToken('SUPERVISOR', D1)).expect(200)).resolves.toMatchObject({ body: { queues: [] } });
    await expect(get(aiToken('MARKETING')).expect(200)).resolves.toMatchObject({ body: { queues: [] } });
    expect(asked).toEqual([]);
  });

  it('answers one unreadable queue as unavailable, and the others still count', async () => {
    refusing.add('refunds');
    const res = await get(aiToken('FINANCE')).expect(200);
    expect(res.body.queues).toEqual([
      { key: 'refunds', count: null, oldestAt: null, href: '/hq/refunds', error: 'unavailable' },
      { key: 'expenses', count: 4, oldestAt: OLDEST, href: '/dashboard/expense-claims' },
      { key: 'settlements', count: 4, oldestAt: OLDEST, href: '/dashboard/settlements' },
    ]);
  });

  it("refuses a machine token, whatever its scopes", async () => {
    const machine = es256({
      iss: 'hydromart-auth',
      aud: 'hydromart-machine',
      sub: PERSON,
      scopes: ['pendingApprovals'],
      exp: exp(),
    });
    await get(machine).expect(403);
  });

  it('refuses no token, and a token it cannot verify, with 401', async () => {
    await get(null).expect(401);
    const [head, , sig] = aiToken('HEAD_OFFICE').split('.');
    await get(`${head}.${b64({ aud: 'hydromart-ai', sub: PERSON, role: 'SUPER_ADMIN' })}.${sig}`).expect(401);
  });

  it("refuses an AI-web token for a role outside the door", async () => {
    await get(aiToken('FRANCHISE_OWNER')).expect(403);
    await get(aiToken('CUSTOMER')).expect(403);
  });

  it("answers a hydromart-digital staff session the same way (it is that person's own screens)", async () => {
    const res = await get(staffSession).expect(200);
    expect(res.body.queues.map((q: { key: string }) => q.key)).toEqual([
      'priceOverrides',
      'leave',
      'franchiseApplications',
    ]);
  });

  /*
   * The AI web codes against contracts/ai-v1/approvals.openapi.json, in another repository. The
   * queues served here and the ones written there must not drift apart in silence.
   */
  it('matches the contract the AI web codes against', async () => {
    const op = contract.paths['/dashboard/api/v1/dashboard/pending-approvals'].get;
    expect(op).toBeDefined();
    const queue = contract.components.schemas.PendingQueue;
    expect(queue.properties.key.enum).toEqual([...PENDING_QUEUE_KEYS]);
    const written = (contract['x-hydromart-queues'] as Array<Record<string, unknown>>).map((q) => ({
      key: q.key,
      href: q.href,
      decidedWith: q.decidedWith,
      depotBound: q.depotBound,
    }));
    expect(written).toEqual(
      PENDING_QUEUES.map((q) => ({
        key: q.key,
        href: q.href,
        decidedWith: [...q.decidedWith],
        depotBound: q.depotBound,
      })),
    );
    refusing.add('refunds');
    const res = await get(aiToken('SUPER_ADMIN')).expect(200);
    for (const row of res.body.queues) {
      for (const field of queue.required) expect(row).toHaveProperty(field);
      for (const field of Object.keys(row)) expect(Object.keys(queue.properties)).toContain(field);
    }
    expect(Object.keys(res.body)).toEqual(contract.components.schemas.PendingApprovals.required);
  });
});
