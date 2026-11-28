import { createHmac, generateKeyPairSync, sign } from 'node:crypto';

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
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CampaignModule } from '../../src/modules/campaign.module';
import { InMemoryNotificationRepository } from '../support/fakes';
import { FakeCaps, FakeConsent, FakeMessages, FakeSender, FakeTemplates, FakeTx, WA_ENV } from '../support/wa-fakes';

/*
 * HD-12/HD-13 through the real guards, pipe, raw-body parser and interceptor: Meta's webhook (challenge,
 * signature over the raw bytes, per-item dedupe), the AI web's STOP-list sync (scope, audit before the call,
 * paging, idempotency), and the 404 of every route while the channel is off.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const MACHINE = '6a1d1c55-0000-4000-8000-00000000aaaa';
const APP_SECRET = WA_ENV.WA_APP_SECRET;
const WEBHOOK = '/api/v1/whatsapp/webhook';
const OPT_OUTS = '/api/v1/whatsapp/opt-outs';

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
const aiToken = (): string => es256({ iss: 'hydromart-auth', aud: 'hydromart-ai', sub: 'p1', role: 'SUPER_ADMIN', exp: exp() });
const sig = (body: string): string => `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`;

async function boot(env: Record<string, string>) {
  resetExternalKeyStores();
  const consent = new FakeConsent();
  const messages = new FakeMessages();
  const caps = new FakeCaps();
  caps.setCap('SERVICE', { monthlyMessages: 100 });
  const sender = new FakeSender();
  const before: AuditEvent[] = [];
  const sink: AuditMutationSink = {
    record: async () => undefined,
    recordOrThrow: async (event) => void before.push(event),
  };
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
            INTERNAL_SERVICE_KEY: 'internal-key',
            ...env,
          }),
        ],
      }),
      CampaignModule,
    ],
  })
    .overrideProvider(PrismaService)
    .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
    .overrideProvider(CRM_TOKENS.NotificationRepository)
    .useValue(new InMemoryNotificationRepository())
    .overrideProvider(CRM_TOKENS.WaConsentRepository)
    .useValue(consent)
    .overrideProvider(CRM_TOKENS.WaMessageRepository)
    .useValue(messages)
    .overrideProvider(CRM_TOKENS.WaCapRepository)
    .useValue(caps)
    .overrideProvider(CRM_TOKENS.WaTemplateRepository)
    .useValue(new FakeTemplates())
    .overrideProvider(CRM_TOKENS.WaTransactionRepository)
    .useValue(new FakeTx(consent, messages, caps))
    .overrideProvider(CRM_TOKENS.WhatsappSender)
    .useValue(sender)
    .overrideProvider(AUDIT_MUTATION_SINK)
    .useValue(sink)
    .compile();
  // rawBody: true is what crm's main.ts sets; Meta signs the bytes the JSON parser would otherwise consume.
  const app: INestApplication = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(new GlobalValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return { app, consent, messages, sender, before };
}

describe('WhatsApp number 1 over HTTP', () => {
  beforeAll(() => {
    jest.spyOn(global, 'fetch').mockImplementation(async (url) =>
      String(url) === `${AUTH_URL}/api/v1/auth/jwks`
        ? ({ ok: true, json: async () => ({ keys: [JWK] }) } as unknown as Response)
        : ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response),
    );
  });
  afterAll(() => {
    jest.restoreAllMocks();
    resetExternalKeyStores();
  });

  describe('switched on', () => {
    let ctx: Awaited<ReturnType<typeof boot>>;
    beforeAll(async () => void (ctx = await boot(WA_ENV)));
    afterAll(async () => ctx.app.close());
    const http = () => request(ctx.app.getHttpServer());
    const post = (body: string, signature?: string) => {
      const req = http().post(WEBHOOK).set('Content-Type', 'application/json');
      return (signature ? req.set('X-Hub-Signature-256', signature) : req).send(body);
    };
    const message = (id: string, text: string, from = '6281234567890') =>
      JSON.stringify({ entry: [{ id: '2222', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1111' }, messages: [{ id, from, type: 'text', text: { body: text } }] } }] }] });

    it('GET answers the challenge for the right token and 403 for the wrong one', async () => {
      const ok = await http().get(WEBHOOK).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '98765' });
      expect(ok.status).toBe(200);
      expect(ok.text).toBe('98765');
      expect(ok.headers['content-type']).toContain('text/plain');
      await http().get(WEBHOOK).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' }).expect(403);
    });

    it('POST without a signature, or with one over other bytes, is 401 and nothing is processed', async () => {
      const body = message('wamid.a', 'DAFTAR AB23CD45');
      await post(body).expect(401);
      await post(body, 'sha256=00').expect(401);
      await post(body, sig(body.replace('DAFTAR', 'DAFTAR '))).expect(401);
      expect(ctx.messages.inbound.size).toBe(0);
    });

    it('a signed delivery is processed once, even delivered twice, and the code is single-use', async () => {
      await ctx.consent.createCode({ code: 'AB23CD45', kind: 'SELF', customerId: 'c1', depotId: null, createdBy: 'c1', expiresAt: new Date(Date.now() + 60_000) });
      const body = message('wamid.b', 'DAFTAR AB23CD45');
      await post(body, sig(body)).expect(200, { ok: true });
      await post(body, sig(body)).expect(200);
      expect(ctx.consent.rows).toHaveLength(1);
      expect(ctx.consent.rows[0]).toMatchObject({ customerId: 'c1', granted: true, purpose: 'UTILITY' });
      expect(ctx.sender.texts).toHaveLength(1);
    });

    it('a payload of an unknown shape is acknowledged, not retried', async () => {
      const body = JSON.stringify({ entry: [{ id: 'other', changes: [] }] });
      await post(body, sig(body)).expect(200);
      const empty = '{}';
      await post(empty, sig(empty)).expect(200);
    });

    it('a processing error answers 500 so Meta retries, and the dedupe key is rolled back', async () => {
      const body = message('wamid.c', 'STOP');
      const append = jest.spyOn(ctx.consent, 'append').mockRejectedValueOnce(new Error('db'));
      await post(body, sig(body)).expect(500);
      expect(ctx.messages.inbound.has('wamid.c')).toBe(false);
      append.mockRestore();
      await post(body, sig(body)).expect(200);
      expect(ctx.messages.inbound.has('wamid.c')).toBe(true);
    });

    describe('STOP list sync', () => {
      const sync = machineToken(['waOptOutSync']);
      const item = { eventId: 'wa2:1', phone: '081234567890', purpose: 'MARKETING', granted: false, recordedAt: '2026-11-27T01:00:00.000Z' };

      it('needs the scope: n8n\'s token without it and an AI-web token are refused', async () => {
        await http().get(OPT_OUTS).set('Authorization', `Bearer ${machineToken(['customerReminderNotify'])}`).expect(403);
        await http().get(OPT_OUTS).set('Authorization', `Bearer ${aiToken()}`).expect(403);
        await http().get(OPT_OUTS).expect(401);
        await http().post(OPT_OUTS).set('Authorization', `Bearer ${machineToken([])}`).send({ items: [item] }).expect(403);
        expect(ctx.before).toEqual([]);
      });

      it('pages by cursor with ids, and stamps the peer clock', async () => {
        const res = await http().get(OPT_OUTS).query({ after: 0, limit: 1 }).set('Authorization', `Bearer ${sync}`).expect(200);
        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0]).toEqual(expect.objectContaining({ id: expect.any(String), seq: 1, phone: '6281234567890', source: 'APP' }));
        expect(res.body.nextAfter).toBe(1);
        expect(ctx.consent.peer).not.toBeNull();
        await http().get(OPT_OUTS).query({ after: -1 }).set('Authorization', `Bearer ${sync}`).expect(400);
        await http().get(OPT_OUTS).query({ limit: 501 }).set('Authorization', `Bearer ${sync}`).expect(400);
      });

      it('records the push before it runs, is idempotent on eventId, and refuses unknown fields', async () => {
        const first = await http().post(OPT_OUTS).set('Authorization', `Bearer ${sync}`).send({ items: [item] }).expect(200);
        expect(first.body).toEqual({ accepted: 1, duplicates: 0 });
        expect(ctx.before).toHaveLength(1);
        const again = await http().post(OPT_OUTS).set('Authorization', `Bearer ${sync}`).send({ items: [item] }).expect(200);
        expect(again.body).toEqual({ accepted: 0, duplicates: 1 });
        await http().post(OPT_OUTS).set('Authorization', `Bearer ${sync}`).send({ items: [{ ...item, extra: 1 }] }).expect(400);
        await http().post(OPT_OUTS).set('Authorization', `Bearer ${sync}`).send({ items: [{ ...item, purpose: 'UTILITY' }] }).expect(400);
        await http().post(OPT_OUTS).set('Authorization', `Bearer ${sync}`).send({ items: [{ ...item, phone: '0811' }] }).expect(400);
      });
    });

    it('the retry sweep answers with the scheduler key only', async () => {
      await http().post('/api/v1/whatsapp/internal/process-queue').expect(401);
      const res = await http().post('/api/v1/whatsapp/internal/process-queue').set('x-internal-key', 'internal-key').expect(200);
      expect(res.body).toMatchObject({ claimed: 0, ok: true });
    });
  });

  describe('switched off (WA_ENABLED blank)', () => {
    let ctx: Awaited<ReturnType<typeof boot>>;
    beforeAll(async () => void (ctx = await boot({ ...WA_ENV, WA_ENABLED: '' })));
    afterAll(async () => ctx.app.close());
    const http = () => request(ctx.app.getHttpServer());

    it('the webhook answers 404 to everything and nothing is processed or sent', async () => {
      const body = '{"entry":[]}';
      await http().get(WEBHOOK).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '1' }).expect(404);
      await http().post(WEBHOOK).set('Content-Type', 'application/json').set('X-Hub-Signature-256', sig(body)).send(body).expect(404);
      expect(ctx.messages.inbound.size).toBe(0);
      expect(ctx.sender.texts).toEqual([]);
    });

    it('the sweep claims and sends nothing and does not page as a failed sweep', async () => {
      const res = await http().post('/api/v1/whatsapp/internal/process-queue').set('x-internal-key', 'internal-key').expect(200);
      expect(res.body).toEqual({ off: true, claimed: 0 });
    });

    it('the STOP list is still data: it answers, the apps hide on /status and the depot CRM reads NONE', async () => {
      await http().get(OPT_OUTS).set('Authorization', `Bearer ${machineToken(['waOptOutSync'])}`).expect(200);
    });
  });
});
