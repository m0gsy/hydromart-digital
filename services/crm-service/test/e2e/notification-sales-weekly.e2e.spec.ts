import { generateKeyPairSync, sign } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { loadOverrides } from '@hydromart/access';
import {
  AUDIT_MUTATION_SINK,
  AllExceptionsFilter,
  AuditEvent,
  AuditMutationSink,
  GlobalValidationPipe,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  localDayKey,
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
 * AI-26, through the real guards, interceptor and validation pipe: only n8n's machine token with
 * `salesReportNotify` gets in, the call is recorded first, and only the active accounts that may
 * read the entity's calon mitra reports are told, in words hydromart wrote from ids alone.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const MACHINE = '6a1d1c55-0000-4000-8000-00000000aaaa';
const ROUTE = '/api/v1/notifications/external/sales-weekly-ready';
const E1 = '22222222-2222-4222-8222-222222222222';
const E2 = '33333333-3333-4333-8333-333333333333';
const GONE = '44444444-4444-4444-8444-444444444444';

const DAY = 86_400_000;
const today = localDayKey(new Date());
const todayMs = Date.parse(`${today}T00:00:00Z`);
// The Monday of the week that just ended: the Monday on or before today, minus 7 days.
const lastMonday = new Date(todayMs - (((new Date(todayMs).getUTCDay() + 6) % 7) + 7) * DAY)
  .toISOString()
  .slice(0, 10);
const BODY = { eventId: `sales-weekly:${lastMonday}`, weekStart: lastMonday, legalEntityIds: [E1] };

// ho-1 holds prospectSettings through the override below (standing in for the Sales Lead custom role).
const ROLES: Record<string, string> = {
  'mk-1': 'MARKETING',
  'dir-1': 'DIREKTUR',
  'ho-1': 'HEAD_OFFICE',
  'fin-1': 'FINANCE',
  'sa-1': 'SUPER_ADMIN',
};
const GRANTS: Record<string, string[]> = {
  [E1]: ['MARKETING', 'DIREKTUR', 'HEAD_OFFICE', 'FINANCE'],
  [E2]: ['FINANCE'],
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

describe('POST notifications/external/sales-weekly-ready (AI-26)', () => {
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
    const req = request(app.getHttpServer()).post(ROUTE).set('X-Workflow', 'ai26-sales-weekly');
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
  };
  const settle = () => new Promise((r) => setTimeout(r, 20));
  const scoped = () => machineToken(['salesReportNotify']);

  beforeAll(async () => {
    loadOverrides({ prospectSettings: ['SUPER_ADMIN', 'HEAD_OFFICE'] });
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
              AI_WEB_URL: 'https://ai.test/',
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
      .overrideProvider(CRM_TOKENS.LegalEntityAudience)
      .useValue({
        audienceOf: async (id: string) =>
          GRANTS[id] ? { name: id === E1 ? 'PT Indowater' : 'PT Dua', aiReadRoles: GRANTS[id] } : null,
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
    loadOverrides({});
    resetExternalKeyStores();
  });

  it('tells MARKETING, DIREKTUR and a prospectSettings holder granted the entity, not FINANCE or SUPER_ADMIN', async () => {
    const res = await post(scoped()).expect(200);
    await settle();

    expect(res.body).toEqual({
      weekStart: lastMonday,
      legalEntities: 1,
      unknownEntities: 0,
      recipients: 3,
      notified: 3,
      whatsapp: 'pending',
    });
    expect(repo.records.map((r) => r.customerId).sort()).toEqual(['dir-1', 'ho-1', 'mk-1']);
    expect(repo.records[0]).toMatchObject({ event: 'SALES_WEEKLY_REPORT' });
    expect(repo.records[0]!.message).toMatch(
      /^Minggu \d{1,2} \w{3} - \d{1,2} \w{3}: buka laporan calon mitra untuk PT Indowater\. https:\/\/ai\.test\/calon-mitra\/laporan\?minggu=\d{4}-\d{2}-\d{2}&be=\S+$/,
    );
    expect(before).toEqual([
      expect.objectContaining({
        action: 'notifications.external.sales-weekly-ready.created.requested',
        actorId: MACHINE,
        metadata: expect.objectContaining({ via: 'machine', workflow: 'ai26-sales-weekly', eventId: BODY.eventId }),
      }),
    ]);
    expect(pushed.sort()).toEqual(['dir-1', 'ho-1', 'mk-1']);
    expect(emailed.map((e) => e.toggle)).toEqual(['salesWeekly', 'salesWeekly', 'salesWeekly']);
    expect(emailed[0]!.text).toContain(`https://ai.test/calon-mitra/laporan?minggu=${lastMonday}&be=${E1}`);
  });

  it('files and sends nothing twice for a retry of the same event', async () => {
    await post(scoped()).expect(200);
    await settle();
    expect(repo.records).toHaveLength(3);
    expect(pushed).toHaveLength(3);
    expect(emailed).toHaveLength(3);
  });

  it('skips an id that is not an entity and tells nobody when no qualifying role is granted', async () => {
    const res = await post(scoped(), { ...BODY, legalEntityIds: [E2, GONE] }).expect(200);
    expect(res.body).toMatchObject({ legalEntities: 2, unknownEntities: 1, recipients: 0, notified: 0 });
    expect(repo.records).toHaveLength(3);
  });

  it.each([
    ['a machine token without the scope', () => machineToken(['morningSummaryNotify'])],
    ['a head-office session token', () => headOffice],
    [
      'the AI web token of a SUPER_ADMIN',
      () => es256({ iss: 'hydromart-auth', aud: 'hydromart-ai', sub: 'sa-1', role: 'SUPER_ADMIN', exp: exp() }),
    ],
  ])('refuses %s with 403', async (_label, token) => {
    await post(token()).expect(403);
    expect(repo.records).toHaveLength(3);
  });

  it('refuses no token with 401, and a bad body, a stale week or a non-Monday with 400', async () => {
    await post(null).expect(401);
    const token = scoped();
    await post(token, { ...BODY, recipients: ['mk-1'] }).expect(400);
    await post(token, { ...BODY, legalEntityIds: [] }).expect(400);
    await post(token, { ...BODY, eventId: 'sales-weekly:2020-01-06' }).expect(400);
    await post(token, { ...BODY, eventId: 'sales-weekly:2020-01-06', weekStart: '2020-01-06' }).expect(400);
    await post(token, { ...BODY, eventId: `sales-weekly:${today}`, weekStart: today }).expect(400);
    expect(repo.records).toHaveLength(3);
  });
});
