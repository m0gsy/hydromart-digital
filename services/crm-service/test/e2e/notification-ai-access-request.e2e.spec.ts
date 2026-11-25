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
 * AI-7c, through the real guards, interceptor and validation pipe: only n8n's machine token with
 * `aiAccessRequestNotify` gets in, the call is recorded first, and every holder of
 * legalEntityAiAccess is told in words hydromart wrote from ids alone.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const MACHINE = '6a1d1c55-0000-4000-8000-00000000aaaa';
const ROUTE = '/api/v1/notifications/external/ai-access-requested';
const REQUESTER = '11111111-1111-4111-8111-111111111111';
const ENTITY = '22222222-2222-4222-8222-222222222222';
const BODY = {
  eventId: 'ai-access-request:3f1e2d4c-8b7a-4f60-9e21-5c4b3a291807',
  requesterAccountId: REQUESTER,
  legalEntityIds: [ENTITY],
};
const ROLES: Record<string, string> = {
  'sa-1': 'SUPER_ADMIN',
  'sa-2': 'SUPER_ADMIN',
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

describe('POST notifications/external/ai-access-requested (AI-7c)', () => {
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
    profileOf: async (id) =>
      id === REQUESTER ? { fullName: 'Budi Santoso', role: 'HEAD_OFFICE' } : null,
  };
  const post = (token: string | null, body: object = BODY) => {
    const req = request(app.getHttpServer()).post(ROUTE).set('X-Workflow', 'ai7-access');
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));

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
      .overrideProvider(CRM_TOKENS.LegalEntityNames)
      .useValue({
        namesOf: async (ids: string[]) => ids.filter((id) => id === ENTITY).map(() => 'Indowater'),
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

  it('admits n8n with the scope, records the call first, and tells each holder of AI access', async () => {
    const res = await post(machineToken(['aiAccessRequestNotify'])).expect(200);
    await settle();

    expect(res.body).toEqual({ recipients: 2, notified: 2, whatsapp: 'pending' });
    expect(repo.records.map((r) => r.customerId).sort()).toEqual(['sa-1', 'sa-2']);
    expect(repo.records[0]).toMatchObject({
      event: 'AI_ACCESS_REQUESTED',
      destination: '/hq/legal-entities',
      message:
        'Budi Santoso (HEAD OFFICE) meminta akses AI web untuk Indowater. Buka Badan hukum, bagian akses AI, untuk memberikannya.',
    });
    expect(before).toEqual([
      expect.objectContaining({
        action: 'notifications.external.ai-access-requested.created.requested',
        actorId: MACHINE,
        metadata: expect.objectContaining({
          via: 'machine',
          workflow: 'ai7-access',
          eventId: BODY.eventId,
        }),
      }),
    ]);
    expect(pushed.sort()).toEqual(['sa-1', 'sa-2']);
    expect(emailed.map((e) => e.toggle)).toEqual(['aiAccessRequest', 'aiAccessRequest']);
  });

  it('files and sends nothing twice for a retry of the same event', async () => {
    await post(machineToken(['aiAccessRequestNotify'])).expect(200);
    await settle();
    expect(repo.records).toHaveLength(2);
    expect(pushed).toHaveLength(2);
    expect(emailed).toHaveLength(2);
  });

  it('answers 200 with notified 0 for a requester who does not exist, saying nothing about who does', async () => {
    const res = await post(machineToken(['aiAccessRequestNotify']), {
      ...BODY,
      eventId: 'ai-access-request:4f1e2d4c-8b7a-4f60-9e21-5c4b3a291807',
      requesterAccountId: '99999999-9999-4999-8999-999999999999',
    }).expect(200);
    expect(res.body).toEqual({ recipients: 0, notified: 0, whatsapp: 'pending' });
    expect(repo.records).toHaveLength(2);
  });

  it.each([
    ['a machine token without the scope', () => machineToken(['morningSummaryNotify'])],
    ['a machine token with no scopes at all', () => machineToken([])],
    ['a head-office session token', () => headOffice],
    // SUPER_ADMIN holds every capability, yet through the AI web a person is not a machine:
    // only @ExternalAccess('machine') refuses this one.
    [
      'the AI web token of a SUPER_ADMIN',
      () =>
        es256({
          iss: 'hydromart-auth',
          aud: 'hydromart-ai',
          sub: 'sa-1',
          role: 'SUPER_ADMIN',
          exp: exp(),
        }),
    ],
  ])('refuses %s with 403', async (_label, token) => {
    await post(token()).expect(403);
    expect(repo.records).toHaveLength(2);
  });

  it('refuses no token with 401, and a body that carries more than ids or breaks its shape with 400', async () => {
    await post(null).expect(401);
    const token = machineToken(['aiAccessRequestNotify']);
    await post(token, { ...BODY, requesterName: 'Budi' }).expect(400);
    await post(token, { ...BODY, eventId: 'ai-access-request:nope' }).expect(400);
    await post(token, { ...BODY, group: 'secrets' }).expect(400);
    expect(repo.records).toHaveLength(2);
  });
});
