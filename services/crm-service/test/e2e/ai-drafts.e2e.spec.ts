import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  Role,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  resetExternalKeyStores,
} from '@hydromart/platform';

import { CRM_TOKENS } from '../../src/application/tokens';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CampaignModule } from '../../src/modules/campaign.module';
import {
  FakeActivitySegment,
  FakeBroadcastDelivery,
  FakeCustomerDirectory,
  InMemoryCampaignRepository,
} from '../support/fakes';

/*
 * HD-17 campaign draft through the real guards, interceptor and validation pipe: the AI web's
 * token (ES256, aud hydromart-ai) may make one DRAFT campaign with the capability and depot of
 * the person behind it, and nothing else in crm-service. Nothing is sent.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const PERSON = '6a1d1c55-0000-4000-8000-00000000bbbb';
const SUGGESTION = '5c1e2f3a-0000-4000-8000-0000000000a1';
const DEPOT = '00000000-0000-4000-8000-000000000001';
const OTHER_DEPOT = '00000000-0000-4000-8000-000000000002';
const ROUTE = '/api/v1/ai/drafts/campaigns';
const contract = JSON.parse(
  readFileSync(join(__dirname, '../../../../contracts/ai-v1/drafts.openapi.json'), 'utf8'),
);

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const JWK = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' };
const b64 = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
function es256(claims: Record<string, unknown>): string {
  const data = `${b64({ alg: 'ES256', kid: 'k1', typ: 'JWT' })}.${b64(claims)}`;
  const sig = sign('sha256', Buffer.from(data), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${data}.${sig.toString('base64url')}`;
}
const exp = (): number => Math.floor(Date.now() / 1000) + 600;
const aiToken = (role: string, depotId: string | null): string =>
  es256({ iss: 'hydromart-auth', aud: 'hydromart-ai', sub: PERSON, role, depotId, exp: exp() });
const machineToken = (): string =>
  es256({ iss: 'hydromart-auth', aud: 'hydromart-machine', sub: PERSON, scopes: ['depotCampaign'], exp: exp() });

describe('AI campaign draft (HD-17, e2e)', () => {
  let app: INestApplication;
  let staff: (role: Role, depot?: string | null) => string;
  const repo = new InMemoryCampaignRepository();
  const directory = new FakeCustomerDirectory();
  const activity = new FakeActivitySegment();
  const delivery = new FakeBroadcastDelivery();
  const trail: AuditEvent[] = [];
  let failTrail = false;
  const sink: AuditMutationSink = {
    record: async () => undefined,
    recordOrThrow: async (event) => {
      if (failTrail) throw new Error('audit down');
      trail.push(event);
    },
  };

  const body = () => ({
    depotId: DEPOT,
    name: 'Promo galon pekan ini',
    messageTemplate: 'Hai {{name}}, ada promo galon di depot langgananmu.',
    segment: { lapsedDays: 30 },
    reason: 'Pelanggan depot ini 30 hari tidak memesan.',
  });
  const post = (token: string | null, payload: object, id: string | null = SUGGESTION) => {
    let req = request(app.getHttpServer()).post(ROUTE).set('X-Workflow', 'ai17-drafts');
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    if (id) req = req.set('X-AI-Suggestion-Id', id);
    return req.send(payload);
  };
  const manager = () => aiToken('MANAGER', DEPOT);

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_KEY = 'test-internal-key';
    resetExternalKeyStores();
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (url) =>
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
              CRM_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              AUTH_SERVICE_URL: AUTH_URL,
              INTERNAL_SERVICE_KEY: 'test-internal-key',
            }),
          ],
        }),
        CampaignModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .overrideProvider(CRM_TOKENS.CampaignRepository)
      .useValue(repo)
      .overrideProvider(CRM_TOKENS.CustomerDirectory)
      .useValue(directory)
      .overrideProvider(CRM_TOKENS.ActivitySegment)
      .useValue(activity)
      .overrideProvider(CRM_TOKENS.BroadcastDelivery)
      .useValue(delivery)
      .overrideProvider(AUDIT_MUTATION_SINK)
      .useValue(sink)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(new GlobalValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    const jwt = app.get(JwtService);
    staff = (role, depot) =>
      jwt.sign(
        { sub: 's', role, phone: '+62', depotId: depot ?? null },
        { secret: SECRET, issuer: TOKEN_ISSUER, audience: TOKEN_AUDIENCE },
      );
  });

  beforeEach(() => {
    trail.length = 0;
    failTrail = false;
    repo.campaigns.length = 0;
    delivery.sent.length = 0;
    directory.recipients = [
      { customerId: 'c-1', name: 'Andi', phone: '+628111111111' },
      { customerId: 'c-2', name: 'Budi', phone: '+628222222222' },
    ];
    activity.customerIds = ['c-1', 'c-2'];
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  it('makes a DRAFT AI campaign, sends nothing, records the suggestion id first, and answers no recipient', async () => {
    const res = await post(manager(), body()).expect(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      source: 'AI',
      aiSuggestionId: SUGGESTION,
      aiReason: 'Pelanggan depot ini 30 hari tidak memesan.',
      createdBy: PERSON,
      totalRecipients: 2,
      sentCount: 0,
    });
    expect(res.body.recipients).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/\+628|Andi|Budi/);
    expect(repo.campaigns).toHaveLength(1);
    expect(repo.campaigns[0]!.status).toBe('DRAFT');
    expect(delivery.sent).toHaveLength(0);
    expect(trail).toHaveLength(1);
    expect(trail[0]).toMatchObject({
      action: 'ai.drafts.campaigns.created.requested',
      actorId: PERSON,
      metadata: { via: 'ai', suggestionId: SUGGESTION, workflow: 'ai17-drafts', depotId: DEPOT },
    });
  });

  it('shows up in the staff list marked AI, and the sweep does not pick a DRAFT up', async () => {
    const res = await post(manager(), body()).expect(201);
    const list = await request(app.getHttpServer())
      .get('/api/v1/campaigns')
      .set('Authorization', `Bearer ${staff(Role.SUPER_ADMIN)}`)
      .expect(200);
    expect(list.body.items[0]).toMatchObject({ id: res.body.id, source: 'AI', status: 'DRAFT' });
    const sweep = await request(app.getHttpServer())
      .post('/api/v1/campaigns/internal/process-sending')
      .set('x-internal-key', 'test-internal-key')
      .expect(200);
    expect(sweep.body.sent).toBe(0);
    expect(delivery.sent).toHaveLength(0);
  });

  it('the person who may send it presses Kirim as for any draft (and only then does it go out)', async () => {
    const res = await post(manager(), body()).expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/campaigns/${res.body.id}/send`)
      .set('Authorization', `Bearer ${staff(Role.SUPER_ADMIN)}`)
      .expect(202);
    await request(app.getHttpServer())
      .post('/api/v1/campaigns/internal/process-sending')
      .set('x-internal-key', 'test-internal-key')
      .expect(200);
    expect(delivery.sent).toHaveLength(2);
  });

  it('answers the same draft (200) for a retry, and 409 for the same id with another body', async () => {
    const first = await post(manager(), body()).expect(201);
    const again = await post(manager(), body(), SUGGESTION.toUpperCase()).expect(200);
    expect(again.body.id).toBe(first.body.id);
    const clash = await post(manager(), { ...body(), name: 'Lain' }).expect(409);
    expect(clash.body.code).toBe('AI_SUGGESTION_REUSED');
    expect(repo.campaigns).toHaveLength(1);
  });

  it('runs the same validation as a staff draft, with bounded text (400 / 422)', async () => {
    await post(manager(), body(), null).expect(400);
    await post(manager(), body(), 'not-a-uuid').expect(400);
    await post(manager(), { ...body(), reason: undefined }).expect(400);
    await post(manager(), { ...body(), reason: '   ' }).expect(400);
    await post(manager(), { ...body(), reason: 'x'.repeat(501) }).expect(400);
    await post(manager(), { ...body(), name: 'x'.repeat(121) }).expect(400);
    await post(manager(), { ...body(), messageTemplate: 'x'.repeat(2001) }).expect(400);
    await post(manager(), { ...body(), segment: { tier: 'GOLD' } }).expect(400);
    // An explicit phone list is not accepted: the audience is always the segment rules.
    await post(manager(), { ...body(), recipients: [{ phone: '+628123456789' }] }).expect(400);
    await post(manager(), { ...body(), scheduledFor: '2020-01-01T00:00:00.000Z' }).expect(422);
    activity.customerIds = [];
    await post(manager(), body()).expect(422);
    expect(repo.campaigns).toHaveLength(0);
  });

  it('keeps a schedule as a draft too (still nothing sent)', async () => {
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const res = await post(manager(), { ...body(), scheduledFor: at }).expect(201);
    expect(res.body).toMatchObject({ status: 'DRAFT', scheduledFor: at });
  });

  it('gives the person exactly what the staff depot route gives them', async () => {
    await post(aiToken('STAFF_DEPOT', DEPOT), body()).expect(403);
    await post(aiToken('MANAGER', OTHER_DEPOT), body()).expect(403);
    await post(aiToken('SUPER_ADMIN', null), body()).expect(201);
  });

  it('refuses a staff session token, a machine token and no token', async () => {
    await post(staff(Role.MANAGER, DEPOT), body()).expect(403);
    await post(staff(Role.MANAGER, DEPOT), { nonsense: true }, null).expect(403);
    await post(machineToken(), body()).expect(403);
    await post(null, body()).expect(401);
    expect(repo.campaigns).toHaveLength(0);
  });

  it('is not drafted when the audit trail cannot record the call (503)', async () => {
    failTrail = true;
    await post(manager(), body()).expect(503);
    expect(repo.campaigns).toHaveLength(0);
  });

  /*
   * The closed list: the AI token, even a SUPER_ADMIN's, is refused on everything else in
   * crm-service: no send, cancel, list, report, other campaign route, notification or broadcast.
   */
  describe('everything else refuses the AI token', () => {
    const god = () => aiToken('SUPER_ADMIN', null);
    const ID = '22222222-2222-4222-8222-222222222222';
    const cases: [string, string, object | undefined][] = [
      ['POST', `/api/v1/campaigns/${ID}/send`, undefined],
      ['POST', `/api/v1/campaigns/${ID}/cancel`, undefined],
      ['POST', `/api/v1/campaigns/depot/${ID}/send`, undefined],
      ['POST', '/api/v1/campaigns', {}],
      ['POST', '/api/v1/campaigns/depot', {}],
      ['GET', '/api/v1/campaigns', undefined],
      ['GET', `/api/v1/campaigns/${ID}`, undefined],
      ['GET', '/api/v1/campaigns/mine', undefined],
      ['POST', '/api/v1/broadcasts', {}],
      ['GET', '/api/v1/notifications/ops', undefined],
    ];
    it.each(cases)('%s %s -> 403', async (method, url, payload) => {
      const agent = request(app.getHttpServer());
      const req = method === 'GET' ? agent.get(url) : agent.post(url);
      const res = await req.set('Authorization', `Bearer ${god()}`).send(payload);
      expect(res.status).toBe(403);
    });
  });

  describe('the contract (contracts/ai-v1/drafts.openapi.json)', () => {
    const schemas = contract.components.schemas;
    it('describes the route: path, required header, status codes, body fields', () => {
      const op = contract.paths['/crm/api/v1/ai/drafts/campaigns'].post;
      expect(op.parameters.find((p: { name: string }) => p.name === 'X-AI-Suggestion-Id')).toMatchObject({
        in: 'header',
        required: true,
      });
      for (const code of ['200', '201', '400', '401', '403', '409', '422', '429']) {
        expect(op.responses[code]).toBeDefined();
      }
      const required: string[] = schemas.AiCampaignDraft.required;
      for (const field of required) expect(Object.keys(body())).toContain(field);
      expect(Object.keys(schemas.AiCampaignDraft.properties)).toEqual(
        expect.arrayContaining([...Object.keys(body()), 'scheduledFor']),
      );
      expect(schemas.AiCampaignDraft.properties.reason.maxLength).toBe(500);
      expect(schemas.AiCampaignDraft.properties.name.maxLength).toBe(120);
      expect(schemas.AiCampaignDraft.properties.messageTemplate.maxLength).toBe(2000);
    });

    it('describes the row the route answers', async () => {
      const row = (await post(manager(), body()).expect(201)).body;
      for (const field of schemas.CampaignDraft.required) expect(row).toHaveProperty(field);
      expect(Object.keys(schemas.CampaignDraft.properties)).toEqual(expect.arrayContaining(Object.keys(row)));
    });
  });
});
