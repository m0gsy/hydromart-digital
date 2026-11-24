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
import { PendingQueueAnswer } from '../../src/application/ports/pending-approvals.port';
import { StaffEmail } from '../../src/application/ports/staff-email.port';
import { PushService } from '../../src/application/services/push.service';
import { CRM_TOKENS } from '../../src/application/tokens';
import { wibDate } from '../../src/domain/morning-summary';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CampaignModule } from '../../src/modules/campaign.module';
import { InMemoryNotificationRepository } from '../support/fakes';

/*
 * AI-9, through the real guards, interceptor and validation pipe: only n8n's machine token with
 * `morningSummaryNotify` gets in, the call is recorded first, and each Direksi account is told
 * what waits for THEM (the dashboard answer for that account, faked here).
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const MACHINE = '6a1d1c55-0000-4000-8000-00000000aaaa';
const ROUTE = '/api/v1/notifications/external/morning-summary';
const TODAY = wibDate(new Date());
const BODY = { eventId: `morning-summary:${TODAY}`, date: TODAY };
const ROLES: Record<string, string> = { 'di-1': 'DIREKTUR', 'di-2': 'DIREKTUR', 'ho-1': 'HEAD_OFFICE' };
const ANSWERS: Record<string, PendingQueueAnswer[]> = {
  'di-1': [
    { key: 'priceOverrides', count: 2, oldestAt: '2026-11-20T01:00:00.000Z', href: '/hq/pricing' },
    { key: 'refunds', count: null, oldestAt: null, href: '/hq/refunds', error: 'unavailable' },
  ],
  'di-2': [{ key: 'leave', count: 0, oldestAt: null, href: '/hr/leave' }],
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

describe('POST notifications/external/morning-summary (AI-9)', () => {
  let app: INestApplication;
  let repo: InMemoryNotificationRepository;
  let direktur: string;
  const before: AuditEvent[] = [];
  const pushed: string[] = [];
  const emailed: StaffEmail[] = [];
  const asked: string[] = [];
  const sink: AuditMutationSink = {
    record: async () => undefined,
    recordOrThrow: async (event) => void before.push(event),
  };
  const approvers: ApproverDirectoryPort = {
    staffIdsByRoles: async (roles) => Object.keys(ROLES).filter((id) => roles.includes(ROLES[id]!)),
    rolesOf: async (ids) => new Map(ids.map((id) => [id, ROLES[id]!])),
  };
  const post = (token: string | null, body: object = BODY) => {
    const req = request(app.getHttpServer()).post(ROUTE).set('X-Workflow', 'ai9-summary');
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));

  beforeAll(async () => {
    resetExternalKeyStores();
    jest.spyOn(global, 'fetch').mockImplementation(async (url) =>
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
      .overrideProvider(CRM_TOKENS.PendingApprovals)
      .useValue({
        forAccount: async (id: string) => {
          asked.push(id);
          return ANSWERS[id] ?? [];
        },
      })
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
    direktur = app
      .get(JwtService)
      .sign(
        { sub: 'di-1', role: 'DIREKTUR', phone: '+62811' },
        { secret: SECRET, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
      );
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
    resetExternalKeyStores();
  });

  it('admits n8n with the scope, records the call first, and tells each director what waits for them', async () => {
    const res = await post(machineToken(['morningSummaryNotify'])).expect(200);
    await settle();

    expect(res.body).toEqual({ date: TODAY, recipients: 2, notified: 1, nothingWaiting: 1, whatsapp: 'pending' });
    // Only the Direksi were asked; head office holds another role.
    expect(asked.sort()).toEqual(['di-1', 'di-2']);
    expect(repo.records).toHaveLength(1);
    expect(repo.records[0]).toMatchObject({
      event: 'MORNING_SUMMARY',
      customerId: 'di-1',
      destination: '/hq/pricing',
      message: 'Persetujuan yang menunggu Anda: Usulan harga 2, Refund belum terbaca. Tertua sejak 20 Nov.',
    });
    expect(before).toEqual([
      expect.objectContaining({
        action: 'notifications.external.morning-summary.created.requested',
        actorId: MACHINE,
        metadata: expect.objectContaining({ via: 'machine', workflow: 'ai9-summary', eventId: BODY.eventId }),
      }),
    ]);
    expect(pushed).toEqual(['di-1']);
    expect(emailed).toHaveLength(1);
    expect(emailed[0]).toMatchObject({ accountIds: ['di-1'], toggle: 'morningSummary', path: '/hq/pricing' });
  });

  it('files and sends nothing twice for a retry of the same trigger', async () => {
    await post(machineToken(['morningSummaryNotify'])).expect(200);
    await settle();
    expect(repo.records).toHaveLength(1);
    expect(pushed).toHaveLength(1);
    expect(emailed).toHaveLength(1);
  });

  it.each([
    ['a machine token without the scope', () => machineToken(['franchiseApplicationNotify'])],
    ["a director's own session token", () => direktur],
    [
      'a director through the AI web',
      () => es256({ iss: 'hydromart-auth', aud: 'hydromart-ai', sub: 'di-1', role: 'DIREKTUR', exp: exp() }),
    ],
  ])('refuses %s with 403', async (_label, token) => {
    await post(token()).expect(403);
    expect(repo.records).toHaveLength(1);
  });

  it('refuses no token with 401, and a trigger for another day with 400', async () => {
    await post(null).expect(401);
    const token = machineToken(['morningSummaryNotify']);
    await post(token, { eventId: 'morning-summary:2020-01-01', date: '2020-01-01' }).expect(400);
    await post(token, { ...BODY, extra: 1 }).expect(400);
    expect(repo.records).toHaveLength(1);
  });
});
