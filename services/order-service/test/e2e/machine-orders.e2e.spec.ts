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

import { CUSTOMER_OUTREACH_REPOSITORY } from '../../src/application/ports/customer-outreach.repository';
import { ORDER_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { OrderModule } from '../../src/modules/order.module';

/*
 * HD-18, through the real guards, interceptor and validation pipe: only n8n's machine token with
 * `orderStatusByPhone` gets in, the call is recorded first WITHOUT the number, and the answer
 * carries no address, name or courier.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const MACHINE = '6a1d1c55-0000-4000-8000-00000000aaaa';
const ROUTE = '/api/v1/machine/orders/by-phone';
const PHONE = '081234567890';

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

describe('POST machine/orders/by-phone (HD-18)', () => {
  let app: INestApplication;
  const before: AuditEvent[] = [];
  const sink: AuditMutationSink = {
    record: async () => undefined,
    recordOrThrow: async (event) => void before.push(event),
  };
  const lookups: string[] = [];
  const post = (token: string | null, body: object = { msisdn: PHONE }) => {
    const req = request(app.getHttpServer()).post(ROUTE).set('X-Workflow', 'hd18-wa-status');
    return (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);
  };

  beforeAll(async () => {
    resetExternalKeyStores();
    jest.spyOn(global, 'fetch').mockImplementation(async (url) =>
      String(url) === `${AUTH_URL}/api/v1/auth/jwks`
        ? ({ ok: true, json: async () => ({ keys: [JWK] }) } as unknown as Response)
        : ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response),
    );
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              NODE_ENV: 'test',
              ORDER_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              AUTH_SERVICE_URL: AUTH_URL,
              PRODUCT_SERVICE_URL: 'http://localhost:3003',
              DEPOT_SERVICE_URL: 'http://localhost:3007',
              LOYALTY_SERVICE_URL: 'http://localhost:3009',
              PROMO_SERVICE_URL: 'http://localhost:3010',
              REFERRAL_SERVICE_URL: 'http://localhost:3011',
              CRM_SERVICE_URL: 'http://localhost:3012',
              ORDER_ABANDON_MINUTES: 60,
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        OrderModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .overrideProvider(CUSTOMER_OUTREACH_REPOSITORY)
      .useValue({
        statusOrders: async () => ({
          running: [
            {
              id: 'o-1',
              orderNumber: 'HM-20261125-000001',
              createdAt: new Date('2026-11-25T02:00:00.000Z'),
              status: 'PREPARING',
              total: 38000,
              depotId: 'd-1',
              deliveryWindow: null,
              scheduledFor: null,
              items: [{ productName: 'Galon 19L', quantity: 2 }],
            },
          ],
          recent: [],
        }),
      })
      .overrideProvider(ORDER_TOKENS.AccountByPhone)
      .useValue({
        customerIdByPhone: async (phone: string) => {
          lookups.push(phone);
          return phone === PHONE ? 'c-1' : null;
        },
      })
      .overrideProvider(ORDER_TOKENS.PaymentsOfOrders)
      .useValue({ latestByOrder: async () => new Map([['o-1', { orderId: 'o-1', method: 'QRIS', status: 'PENDING' }]]) })
      .overrideProvider(ORDER_TOKENS.DepotDirectory)
      .useValue({ listContacts: async () => [{ id: 'd-1', name: 'Depot Pekayon', contactPhone: null }] })
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

  it('answers that number\'s orders, records the call first without the number', async () => {
    const res = await post(machineToken(['orderStatusByPhone'])).expect(200);
    expect(res.body.orders).toEqual([
      {
        orderNumber: 'HM-20261125-000001',
        createdAt: '2026-11-25 09:00',
        items: [{ name: 'Galon 19L', quantity: 2 }],
        total: 38000,
        paymentStatus: 'PENDING',
        paymentMethod: 'QRIS',
        status: 'PREPARING',
        depot: 'Depot Pekayon',
        deliveryWindow: null,
        scheduledFor: null,
      },
    ]);
    expect(lookups).toEqual([PHONE]);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({
      action: 'machine.orders.by-phone.created.requested',
      actorId: MACHINE,
      metadata: { msisdn: '[redacted]', via: 'machine', workflow: 'hd18-wa-status' },
    });
    expect(JSON.stringify(before)).not.toContain(PHONE);
  });

  it('says an empty list for a number nobody holds, never an error', async () => {
    const res = await post(machineToken(['orderStatusByPhone']), { msisdn: '08999999999' }).expect(200);
    expect(res.body).toEqual({ orders: [] });
  });

  it.each([
    ['a machine token without the scope', () => machineToken(['customerReminderNotify'])],
    ['a machine token with no scopes', () => machineToken([])],
    [
      'the AI web token of a SUPER_ADMIN',
      () => es256({ iss: 'hydromart-auth', aud: 'hydromart-ai', sub: 'sa-1', role: 'SUPER_ADMIN', exp: exp() }),
    ],
  ])('refuses %s with 403', async (_label, token) => {
    const count = lookups.length;
    await post(token()).expect(403);
    expect(lookups).toHaveLength(count);
  });

  it('refuses no token with 401, and a body without the number, or with extras, with 400', async () => {
    await post(null).expect(401);
    const token = machineToken(['orderStatusByPhone']);
    await post(token, {}).expect(400);
    await post(token, { msisdn: PHONE, extra: 1 }).expect(400);
  });

  it('does not take the number in the query string', async () => {
    await request(app.getHttpServer())
      .get(`${ROUTE}?phone=${PHONE}`)
      .set('Authorization', `Bearer ${machineToken(['orderStatusByPhone'])}`)
      .expect(404);
  });
});
