import { generateKeyPairSync, sign } from 'node:crypto';

import { INestApplication, VersioningType } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import {
  AUDIT_MUTATION_SINK,
  AllExceptionsFilter,
  AuditEvent,
  AuditMutationSink,
  GlobalValidationPipe,
  resetExternalKeyStores,
} from '@hydromart/platform';

import { CRM_TOKENS } from '../../src/application/tokens';
import { wibDate } from '../../src/domain/morning-summary';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { PushService } from '../../src/application/services/push.service';
import { CampaignModule } from '../../src/modules/campaign.module';
import { InMemoryNotificationRepository } from '../support/fakes';

/*
 * HD-18, through the real guards, interceptor and validation pipe: only n8n's machine token with
 * `customerReminderNotify` gets in, the call is recorded first, one inbox row and push per due
 * customer, and a retry of the same call sends nothing twice.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const MACHINE = '6a1d1c55-0000-4000-8000-00000000aaaa';
const ROUTE = '/api/v1/notifications/external/customer-reminders';
const TODAY = wibDate(new Date());

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

describe('POST notifications/external/customer-reminders (HD-18)', () => {
  let app: INestApplication;
  let repo: InMemoryNotificationRepository;
  const before: AuditEvent[] = [];
  const pushed: string[] = [];
  const sink: AuditMutationSink = {
    record: async () => undefined,
    recordOrThrow: async (event) => void before.push(event),
  };
  const source = {
    subscriptionsDue: jest.fn(),
    expiringPoints: jest.fn(),
    unpaidOrders: jest.fn(),
  };
  const post = (token: string | null, body: object = { kind: 'UNPAID_ORDER', date: TODAY }) => {
    const req = request(app.getHttpServer()).post(ROUTE).set('X-Workflow', 'hd18-reminders');
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
      .overrideProvider(CRM_TOKENS.CustomerReminderSource)
      .useValue(source)
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
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
    resetExternalKeyStores();
  });

  it('admits n8n with the scope, records the call first, and files one reminder per unpaid order', async () => {
    source.unpaidOrders.mockResolvedValue([
      { orderId: 'o-1', customerId: 'c-1', orderNumber: 'HM-20261125-000001', total: 45000 },
      { orderId: 'o-2', customerId: 'c-2', orderNumber: 'HM-20261125-000002', total: 9000 },
    ]);
    const res = await post(machineToken(['customerReminderNotify'])).expect(200);
    await settle();

    expect(res.body).toEqual({
      kind: 'UNPAID_ORDER',
      date: TODAY,
      candidates: 2,
      notified: 2,
      skipped: 0,
      whatsapp: 'pending',
    });
    expect(repo.records).toHaveLength(2);
    expect(repo.records[0]).toMatchObject({
      event: 'UNPAID_ORDER',
      customerId: 'c-1',
      destination: '/orders/detail?id=o-1',
      message: expect.stringContaining('HM-20261125-000001 (Rp45.000)'),
    });
    expect(before).toEqual([
      expect.objectContaining({
        action: 'notifications.external.customer-reminders.created.requested',
        actorId: MACHINE,
        metadata: expect.objectContaining({ via: 'machine', workflow: 'hd18-reminders', kind: 'UNPAID_ORDER' }),
      }),
    ]);
    expect(pushed.sort()).toEqual(['c-1', 'c-2']);
  });

  it('files and sends nothing twice for a retry, and says so in `skipped`', async () => {
    const res = await post(machineToken(['customerReminderNotify'])).expect(200);
    await settle();
    expect(res.body).toMatchObject({ candidates: 2, notified: 0, skipped: 2 });
    expect(repo.records).toHaveLength(2);
    expect(pushed).toHaveLength(2);
  });

  it.each([
    ['a machine token without the scope', () => machineToken(['morningSummaryNotify'])],
    ['a machine token with no scopes at all', () => machineToken([])],
    [
      'the AI web token of a SUPER_ADMIN',
      () => es256({ iss: 'hydromart-auth', aud: 'hydromart-ai', sub: 'sa-1', role: 'SUPER_ADMIN', exp: exp() }),
    ],
  ])('refuses %s with 403', async (_label, token) => {
    await post(token()).expect(403);
    expect(repo.records).toHaveLength(2);
  });

  it('refuses no token with 401, another day or an unknown kind with 400, and a failed read with 503', async () => {
    await post(null).expect(401);
    const token = machineToken(['customerReminderNotify']);
    await post(token, { kind: 'UNPAID_ORDER', date: '2020-01-01' }).expect(400);
    await post(token, { kind: 'REORDER', date: TODAY }).expect(400);
    await post(token, { kind: 'UNPAID_ORDER', date: TODAY, extra: 1 }).expect(400);
    source.unpaidOrders.mockRejectedValueOnce(new Error('order-service down'));
    await post(token).expect(503);
    expect(repo.records).toHaveLength(2);
  });
});
