import { generateKeyPairSync, sign } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { CAPABILITIES, loadCustomRoles, loadOverrides } from '@hydromart/access';

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
 * AI-11, through the real guards, interceptor and validation pipe: only a machine token with
 * `aiCsNotify` gets in, the call is recorded first, and the words come from hydromart: a link, never a customer's data.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const MACHINE = '6a1d1c55-0000-4000-8000-00000000aaaa';
const ROUTE = '/api/v1/notifications/external/ai-cs-notice';
const CONV = '7c1f0f64-0b6e-4f4e-9d6a-2f3f7c9a1b11';
const BODY = { eventId: `ai-cs:${CONV}`, kind: 'NEW', conversationId: CONV };

const ROLES: Record<string, string> = {
  'dir-1': 'DIREKTUR',
  'sa-1': 'SUPER_ADMIN',
  'fin-1': 'FINANCE',
  'mgr-1': 'MANAGER',
  'ho-1': 'HEAD_OFFICE',
  'cs-1': 'C_CS',
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

describe('POST notifications/external/ai-cs-notice (AI-11)', () => {
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
    const req = request(app.getHttpServer()).post(ROUTE).set('X-Workflow', 'ai11-cs');
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const scoped = () => machineToken(['aiCsNotify']);
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

  it('tells the CS readers (head office, SUPER_ADMIN), words and link only, and records the call first', async () => {
    const res = await post(scoped()).expect(200);
    await settle();

    expect(res.body).toEqual({ recipients: 2, notified: 2, whatsapp: 'pending' });
    expect(to()).toEqual(['ho-1', 'sa-1']);
    expect(repo.records[0]).toMatchObject({
      event: 'AI_CS_NEW',
      message: `Chat pelanggan diserahkan ke CS. Buka Inbox CS dan ambil. https://ai.test/cs/${CONV}`,
    });
    expect(before).toEqual([
      expect.objectContaining({
        action: 'notifications.external.ai-cs-notice.created.requested',
        actorId: MACHINE,
        metadata: expect.objectContaining({ via: 'machine', workflow: 'ai11-cs', eventId: BODY.eventId }),
      }),
    ]);
    expect(pushed.sort()).toEqual(['ho-1', 'sa-1']);
    expect(emailed.map((e) => e.toggle)).toEqual(['aiCs', 'aiCs']);
  });

  it('files nothing twice for a retry', async () => {
    await post(scoped()).expect(200);
    await settle();
    expect(repo.records).toHaveLength(2);
  });

  it('reminds the readers and escalates to the managers (head office, Direksi, SUPER_ADMIN), a granted custom role included', async () => {
    const remind = await post(scoped(), { ...BODY, kind: 'REMIND', eventId: `ai-cs-overdue:${CONV}:REMIND` }).expect(200);
    expect(remind.body).toMatchObject({ recipients: 2 });
    const escalate = await post(scoped(), { ...BODY, kind: 'ESCALATE', eventId: `ai-cs-overdue:${CONV}:ESCALATE` }).expect(200);
    expect(escalate.body).toMatchObject({ recipients: 3, notified: 3 });
    // Direksi (read + manage, no reply) is told of the ESCALATE only, never of a new or slow chat.
    expect(repo.records.filter((r) => r.customerId === 'dir-1').map((r) => r.event)).toEqual(['AI_CS_ESCALATE']);
    expect(repo.records.filter((r) => r.event === 'AI_CS_ESCALATE').map((r) => r.customerId).sort()).toEqual(['dir-1', 'ho-1', 'sa-1']);
    expect(repo.records.find((r) => r.event === 'AI_CS_ESCALATE')!.message).toContain('Lead CS');

    loadCustomRoles([{ key: 'C_CS', name: 'CS', scope: 'GLOBAL' }]);
    loadOverrides({ aiCsReply: [...CAPABILITIES.aiCsReply, 'C_CS'] });
    try {
      const again = await post(scoped(), { ...BODY, eventId: `${BODY.eventId}:2` }).expect(200);
      expect(again.body).toMatchObject({ recipients: 3, notified: 3 });
    } finally {
      loadOverrides({});
      loadCustomRoles([]);
    }
  });

  it.each([
    ['a machine token without the scope', () => machineToken(['aiAgentNotify'])],
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

  it('refuses no token with 401 and a body outside the shape (or an eventId of another kind or chat) with 400', async () => {
    await post(null).expect(401);
    const token = scoped();
    for (const bad of [
      { ...BODY, text: 'hello' },
      { ...BODY, conversationId: 'x' },
      { ...BODY, kind: 'DELETE' },
      { ...BODY, eventId: 'has space' },
      { ...BODY, eventId: `ai-cs-overdue:${CONV}:REMIND` },
      { ...BODY, kind: 'REMIND' },
      { ...BODY, eventId: 'ai-cs:00000000-0000-4000-8000-000000000000' },
      { ...BODY, eventId: `${BODY.eventId}:x` },
    ]) {
      const r = await post(token, bad);
      if (r.status !== 400) throw new Error(JSON.stringify(bad) + ' -> ' + r.status + ' ' + JSON.stringify(r.body));
    }
  });
});
