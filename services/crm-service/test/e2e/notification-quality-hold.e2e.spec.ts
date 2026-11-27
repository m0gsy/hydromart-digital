import { generateKeyPairSync, sign } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  AUDIT_MUTATION_SINK,
  AllExceptionsFilter,
  AuditEvent,
  AuditMutationSink,
  GlobalValidationPipe,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  resetExternalKeyStores,
} from '@hydromart/platform';

import { ApproverDirectoryPort } from '../../src/application/ports/approver-directory.port';
import { StaffEmail } from '../../src/application/ports/staff-email.port';
import { PushService } from '../../src/application/services/push.service';
import { CRM_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CampaignModule } from '../../src/modules/campaign.module';
import { FakeHeldDepots, InMemoryNotificationRepository } from '../support/fakes';

/*
 * HD-14, through the real guards, interceptor and validation pipe: only n8n's machine token with
 * `qualityHoldNotify` gets in, the call is recorded first, and the words come from hydromart; the depot's live hold state decides.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const MACHINE = '6a1d1c55-0000-4000-8000-00000000aaaa';
const ROUTE = '/api/v1/notifications/external/quality-hold';
const DEPOT = '33333333-3333-4333-8333-333333333333';
const AT = '2026-11-27T03:15:00.000Z';
const BODY = { holdDepotId: DEPOT, status: 'ACTIVE', changedAt: AT };

const ROLES: Record<string, string> = {
  'mk-1': 'MARKETING',
  'mk-2': 'MARKETING',
  'ho-1': 'HEAD_OFFICE',
  'kd-1': 'KEPALA_DEPOT',
  'dir-1': 'DIREKTUR',
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
const machineToken = (scopes: string[]): string =>
  es256({ iss: 'hydromart-auth', aud: 'hydromart-machine', sub: MACHINE, scopes, exp: exp() });

describe('POST notifications/external/quality-hold (HD-14)', () => {
  let app: INestApplication;
  let repo: InMemoryNotificationRepository;
  let headOffice: string;
  const depots = new FakeHeldDepots();
  const before: AuditEvent[] = [];
  const pushed: string[] = [];
  const emailed: StaffEmail[] = [];
  const sink: AuditMutationSink = {
    record: async () => undefined,
    recordOrThrow: async (event) => void before.push(event),
  };
  const approvers: ApproverDirectoryPort = {
    staffIdsByRoles: async (roles) => Object.keys(ROLES).filter((id) => roles.includes(ROLES[id]!)),
    rolesOf: async (ids) => new Map(ids.map((id) => [id, ROLES[id]!])),
    profileOf: async () => null,
  };
  const post = (token: string | null, body: object = BODY) => {
    const req = request(app.getHttpServer()).post(ROUTE).set('X-Workflow', 'hd14-hold');
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const scoped = () => machineToken(['qualityHoldNotify']);
  const to = () => repo.records.map((r) => r.customerId).sort();

  beforeAll(async () => {
    resetExternalKeyStores();
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (url) =>
        String(url) === `${AUTH_URL}/api/v1/auth/jwks`
          ? ({ ok: true, json: async () => ({ keys: [JWK] }) } as unknown as Response)
          : ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response),
      );
    repo = new InMemoryNotificationRepository();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              CRM_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              AUTH_SERVICE_URL: AUTH_URL,
              AI_WEB_URL: 'https://ai.test',
            }),
          ],
        }),
        CampaignModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .overrideProvider(CRM_TOKENS.NotificationRepository)
      .useValue(repo)
      .overrideProvider(CRM_TOKENS.ApproverDirectory)
      .useValue(approvers)
      .overrideProvider(CRM_TOKENS.HeldDepots)
      .useValue(depots)
      .overrideProvider(CRM_TOKENS.DepotStaff)
      .useValue({ staffIdsForDepot: async () => ['kd-1'] })
      .overrideProvider(CRM_TOKENS.DepotOverseers)
      .useValue({ overseersOfDepot: async () => [] })
      .overrideProvider(PushService)
      .useValue({ sendToCustomer: async (id: string) => void pushed.push(id) })
      .overrideProvider(CRM_TOKENS.StaffEmail)
      .useValue({ send: async (email: StaffEmail) => void emailed.push(email) })
      .overrideProvider(AUDIT_MUTATION_SINK)
      .useValue(sink)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    headOffice = app
      .get(JwtService)
      .sign(
        { sub: 'ho-1', role: 'HEAD_OFFICE', phone: '+62811' },
        { secret: SECRET, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
      );
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
    resetExternalKeyStores();
  });

  it('tells the depot management and Marketing, records the call first, and files nothing twice on a retry', async () => {
    depots.known.set(DEPOT, 'Cikini');
    depots.held.add(DEPOT);
    depots.since.set(DEPOT, AT);
    const res = await post(scoped()).expect(200);
    await settle();
    expect(res.body).toEqual({ notified: 4 });
    expect(to()).toEqual(['ho-1', 'kd-1', 'mk-1', 'mk-2']);
    expect(repo.records[0]).toMatchObject({ event: 'QUALITY_HOLD' });
    expect(repo.records[0]!.message).toContain('Depot Cikini sedang quality hold sejak 10:15 WIB.');
    expect(before).toEqual([expect.objectContaining({ action: 'notifications.external.quality-hold.created.requested', actorId: MACHINE })]);
    expect(pushed).toHaveLength(4);
    expect(emailed).toHaveLength(4);
    expect((await post(scoped()).expect(200)).body).toEqual({ notified: 0 });
    expect(repo.records).toHaveLength(4);
  });

  it('answers 200 stale when the live state disagrees, and 503 when the directory is down', async () => {
    const count = repo.records.length;
    const ended = await post(scoped(), { ...BODY, status: 'ENDED' }).expect(200);
    expect(ended.body).toEqual({ notified: 0, stale: true });
    expect(repo.records).toHaveLength(count);
    depots.fail = true;
    await post(scoped()).expect(503);
    depots.fail = false;
  });

  it.each([
    ['a machine token without the scope', () => machineToken(['complianceDueNotify'])],
    ['a head-office session token', () => headOffice],
  ])('refuses %s with 403', async (_label, token) => {
    await post(token()).expect(403);
  });

  it('refuses a body named depotId (the depot-scope guard reads it), no token, and a body outside the shape', async () => {
    await post(scoped(), { depotId: DEPOT, status: 'ACTIVE', changedAt: AT }).expect(403);
    await post(null).expect(401);
    for (const bad of [{ ...BODY, holdDepotId: 'x' }, { ...BODY, status: 'GONE' }, { ...BODY, changedAt: 'yesterday' }]) {
      await post(scoped(), bad).expect(400);
    }
  });
});
