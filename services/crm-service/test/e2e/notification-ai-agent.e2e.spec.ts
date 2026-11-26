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
import { InMemoryNotificationRepository } from '../support/fakes';

/*
 * AI-31, through the real guards, interceptor and validation pipe: only n8n's machine token with
 * `aiAgentNotify` gets in, the call is recorded first, and the words come from hydromart.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const MACHINE = '6a1d1c55-0000-4000-8000-00000000aaaa';
const ROUTE = '/api/v1/notifications/external/ai-agent-notice';
const BODY = { eventId: 'agent-flag:abc-1', agentId: 'stok-depot', agentName: 'Stok', kind: 'FLAG' };

const ROLES: Record<string, string> = {
  'dir-1': 'DIREKTUR',
  'sa-1': 'SUPER_ADMIN',
  'fin-1': 'FINANCE',
  'fin-2': 'FINANCE',
  'mgr-1': 'MANAGER',
  'ho-1': 'HEAD_OFFICE',
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

describe('POST notifications/external/ai-agent-notice (AI-31)', () => {
  let app: INestApplication;
  let repo: InMemoryNotificationRepository;
  let headOffice: string;
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
    const req = request(app.getHttpServer()).post(ROUTE).set('X-Workflow', 'ai31-agent');
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const scoped = () => machineToken(['aiAgentNotify']);
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

  it('tells the AI team managers, in hydromart words with the agent link, and records the call first', async () => {
    const res = await post(scoped()).expect(200);
    await settle();

    expect(res.body).toEqual({ recipients: 2, notified: 2, whatsapp: 'pending' });
    expect(to()).toEqual(['dir-1', 'sa-1']);
    expect(repo.records[0]).toMatchObject({
      event: 'AI_AGENT_FLAG',
      message: 'Agen Stok menandai kejanggalan baru. Buka Tim AI untuk detail. https://ai.test/tim-ai/stok-depot',
    });
    expect(before).toEqual([
      expect.objectContaining({
        action: 'notifications.external.ai-agent-notice.created.requested',
        actorId: MACHINE,
        metadata: expect.objectContaining({ via: 'machine', workflow: 'ai31-agent', eventId: BODY.eventId }),
      }),
    ]);
    expect(pushed.sort()).toEqual(['dir-1', 'sa-1']);
    expect(emailed.map((e) => e.toggle)).toEqual(['aiAgent', 'aiAgent']);
  });

  it('files nothing twice for a retry', async () => {
    await post(scoped()).expect(200);
    await settle();
    expect(repo.records).toHaveLength(2);
  });

  it('adds the boss role only when it may read the AI team, and says STOPPED_ALL and CAP in their own words', async () => {
    const cap = await post(scoped(), { ...BODY, eventId: 'cap:1', kind: 'CAP_REACHED', bossRole: 'FINANCE' }).expect(200);
    expect(cap.body).toMatchObject({ recipients: 4, notified: 4 });
    expect(repo.records.filter((r) => r.event === 'AI_AGENT_CAP')[0]!.message).toContain('plafon bulan ini tercapai');
    // MANAGER holds no aiTeamRead: a wrong key is refused, not silently ignored
    const wrong = await post(scoped(), { ...BODY, eventId: 'stop:1', kind: 'STOPPED', bossRole: 'MANAGER' }).expect(400);
    expect(wrong.body.code).toBe('BOSS_ROLE_UNKNOWN');
    expect(await post(scoped(), { ...BODY, eventId: 'stop:1', kind: 'STOPPED' }).expect(200)).toMatchObject({ body: { recipients: 2 } });
    const all = await post(scoped(), { ...BODY, eventId: 'stop:2', kind: 'STOPPED_ALL', bossRole: 'HEAD_OFFICE' }).expect(200);
    expect(all.body).toMatchObject({ recipients: 3 });
    const last = repo.records.filter((r) => r.event === 'AI_AGENT_STOPPED').pop()!;
    expect(last.message).toBe('Semua agen AI dihentikan. Buka Tim AI untuk detail. https://ai.test/tim-ai');
  });

  it('treats a reused eventId for another kind or agent as a new notice, not a duplicate', async () => {
    const base = repo.records.length;
    await post(scoped(), { ...BODY, eventId: 'reuse:1', kind: 'FLAG' }).expect(200);
    const cap = await post(scoped(), { ...BODY, eventId: 'reuse:1', kind: 'CAP_REACHED' }).expect(200);
    const other = await post(scoped(), { ...BODY, eventId: 'reuse:1', kind: 'CAP_REACHED', agentId: 'kas-depot' }).expect(200);
    expect(cap.body.notified).toBe(2);
    expect(other.body.notified).toBe(2);
    expect(repo.records).toHaveLength(base + 6);
    // and the same notice twice is still one
    await post(scoped(), { ...BODY, eventId: 'reuse:1', kind: 'FLAG' }).expect(200);
    expect(repo.records).toHaveLength(base + 6);
  });

  it.each([
    ['a machine token without the scope', () => machineToken(['salesReportNotify'])],
    ['a head-office session token', () => headOffice],
    [
      'the AI web token of a SUPER_ADMIN',
      () => es256({ iss: 'hydromart-auth', aud: 'hydromart-ai', sub: 'sa-1', role: 'SUPER_ADMIN', exp: exp() }),
    ],
  ])('refuses %s with 403', async (_label, token) => {
    const count = repo.records.length;
    await post(token()).expect(403);
    expect(repo.records).toHaveLength(count);
  });

  it('refuses a body carrying depotId with 403: the depot-scope guard reads it before validation', async () => {
    await post(scoped(), { ...BODY, depotId: '33333333-3333-4333-8333-333333333333' }).expect(403);
  });

  it('refuses no token with 401 and a body outside the shape with 400', async () => {
    await post(null).expect(401);
    const token = scoped();
    for (const bad of [
      { ...BODY, text: 'free' },
      { ...BODY, eventId: 'has space' },
      { ...BODY, eventId: 'x'.repeat(121) },
      { ...BODY, agentId: 'Bad_Id' },
      { ...BODY, agentName: 'Agen <b>' },
      { ...BODY, agentName: 'x'.repeat(41) },
      { ...BODY, kind: 'DELETE' },
      { ...BODY, bossRole: 'bad role' },
    ]) {
      const r = await post(token, bad);
      if (r.status !== 400) throw new Error(JSON.stringify(bad) + ' -> ' + r.status + ' ' + JSON.stringify(r.body));
    }
  });
});
