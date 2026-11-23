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
import { PushService } from '../../src/application/services/push.service';
import { CRM_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CampaignModule } from '../../src/modules/campaign.module';
import { InMemoryNotificationRepository } from '../support/fakes';

/*
 * AI-5, through the real guards, interceptor and validation pipe: only n8n's machine token with
 * `franchiseApplicationNotify` in its scopes gets in, every call is in the audit trail before it
 * runs, and the reviewers of franchise applications are the ones told.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const MACHINE = '6a1d1c55-0000-4000-8000-00000000aaaa';
const APP = '3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807';
const ROUTE = '/api/v1/notifications/external/franchise-application-submitted';
const BODY = {
  eventId: `franchise.application_submitted:${APP}`,
  applicationId: APP,
  city: 'Bekasi',
  province: 'Jawa Barat',
};
const ROLES: Record<string, string> = { 'ho-1': 'HEAD_OFFICE', 'di-1': 'DIREKTUR', 'sa-1': 'SUPER_ADMIN' };

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

describe('POST notifications/external/franchise-application-submitted (AI-5)', () => {
  let app: INestApplication;
  let repo: InMemoryNotificationRepository;
  let headOffice: string;
  let jwks: unknown[] = [JWK];
  let auditDown = false;
  const before: AuditEvent[] = [];
  const after: AuditEvent[] = [];
  const pushed: string[] = [];
  const sink: AuditMutationSink = {
    record: async (event) => void after.push(event),
    recordOrThrow: async (event) => {
      if (auditDown) throw new Error('auth-service down');
      before.push(event);
    },
  };
  const approvers: ApproverDirectoryPort = {
    staffIdsByRoles: async (roles) => Object.keys(ROLES).filter((id) => roles.includes(ROLES[id]!)),
    rolesOf: async (ids) => new Map(ids.map((id) => [id, ROLES[id]!])),
  };
  const post = (token: string | null, body: object = BODY) => {
    const req = request(app.getHttpServer()).post(ROUTE).set('X-Workflow', 'ai5-notify');
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));

  beforeAll(async () => {
    resetExternalKeyStores();
    // The only outbound call on this path is the key set; everything else is a fake below.
    jest.spyOn(global, 'fetch').mockImplementation(async (url) =>
      String(url) === `${AUTH_URL}/api/v1/auth/jwks`
        ? ({ ok: true, json: async () => ({ keys: jwks }) } as unknown as Response)
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
      .overrideProvider(PushService)
      .useValue({ sendToCustomer: async (id: string) => void pushed.push(id) })
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

  it('admits n8n with the scope, records the call first, and tells the application reviewers', async () => {
    const res = await post(machineToken(['franchiseApplicationNotify'])).expect(200);
    await settle();

    expect(res.body).toEqual({ id: repo.records[0]!.id });
    expect(repo.records[0]).toMatchObject({
      event: 'FRANCHISE_APPLICATION_SUBMITTED',
      phone: '',
      depotId: null,
      destination: `/hq/applications/detail?id=${APP}`,
    });
    expect(repo.records[0]!.message).toContain('calon mitra di Bekasi, Jawa Barat');
    expect(before).toEqual([
      expect.objectContaining({
        action: 'notifications.external.franchise-application-submitted.created.requested',
        actorId: MACHINE,
        metadata: expect.objectContaining({ via: 'machine', workflow: 'ai5-notify', eventId: BODY.eventId }),
      }),
    ]);
    expect(after).toEqual([expect.objectContaining({ success: true, actorId: MACHINE })]);
    // Head office and the director; the superuser holds the capability but owns no queue.
    expect(pushed.sort()).toEqual(['di-1', 'ho-1']);
  });

  it('answers a repeated eventId with the same row and tells nobody twice', async () => {
    const res = await post(machineToken(['franchiseApplicationNotify'])).expect(200);
    await settle();
    expect(res.body).toEqual({ id: repo.records[0]!.id });
    expect(repo.records).toHaveLength(1);
    expect(pushed).toHaveLength(2);
  });

  it.each([
    ['a machine token without the scope', () => machineToken(['franchiseApplications'])],
    ["head office's own session token", () => headOffice],
    [
      'a head-office person through the AI web',
      () => es256({ iss: 'hydromart-auth', aud: 'hydromart-ai', sub: 'ho-1', role: 'HEAD_OFFICE', exp: exp() }),
    ],
  ])('refuses %s with 403', async (_label, token) => {
    await post(token()).expect(403);
    expect(repo.records).toHaveLength(1);
  });

  it('refuses no token, and a token it cannot verify, with 401', async () => {
    await post(null).expect(401);
    const [head, , sig] = machineToken(['franchiseApplicationNotify']).split('.');
    const forged = `${head}.${b64({ aud: 'hydromart-machine', sub: MACHINE, scopes: ['franchiseApplicationNotify'] })}.${sig}`;
    await post(forged).expect(401);
  });

  it('refuses a body the contract does not allow, after recording the attempt', async () => {
    const token = machineToken(['franchiseApplicationNotify']);
    const other = '00000000-0000-4000-8000-000000000000';
    await post(token, { ...BODY, phone: '+62811' }).expect(400);
    await post(token, { ...BODY, eventId: `franchise.application_submitted:${other}` }).expect(400);
    await post(token, { ...BODY, eventId: `franchise.application_submitted:${other}`, applicationId: other, city: ' \n\t ' }).expect(400);
    expect(repo.records).toHaveLength(1);
    expect(after.slice(-3).map((e) => e.success)).toEqual([false, false, false]);
  });

  it('refuses with 503 and tells nobody when the audit trail cannot record the call', async () => {
    auditDown = true;
    const other = '00000000-0000-4000-8000-000000000001';
    const res = await post(machineToken(['franchiseApplicationNotify']), {
      ...BODY,
      eventId: `franchise.application_submitted:${other}`,
      applicationId: other,
    }).expect(503);
    auditDown = false;
    await settle();
    expect(res.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(repo.records).toHaveLength(1);
    expect(pushed).toHaveLength(2);
  });

  it('turns every machine token away once auth-service publishes an empty key set', async () => {
    jwks = [];
    resetExternalKeyStores();
    await post(machineToken(['franchiseApplicationNotify'])).expect(401);
  });
});
