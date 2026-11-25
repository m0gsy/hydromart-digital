import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
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

import { DEPOT_TOKENS } from '../../src/application/tokens';
import { envValidationSchema } from '../../src/config/env.validation';
import { PriceOverrideProposalRecord } from '../../src/domain/price-override-proposal';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { DepotModule } from '../../src/modules/depot.module';
import {
  InMemoryDepotRepository,
  InMemoryInventoryRepository,
  InMemoryPurchaseOrderRepository,
  InMemorySupplierRepository,
} from '../support/fakes';

/*
 * HD-17 part A through the real guards, interceptor and validation pipe: the AI web's token
 * (ES256, aud hydromart-ai) may make exactly two drafts here, with the capability and depot of
 * the person behind it, and is refused everywhere else, including every route that decides.
 */
const SECRET = 'test-access-secret-that-is-long-enough-01';
const AUTH_URL = 'http://auth.test';
const PERSON = '6a1d1c55-0000-4000-8000-00000000bbbb';
const SUGGESTION = '5c1e2f3a-0000-4000-8000-0000000000a1';
const PRICE = '/api/v1/ai/drafts/price-overrides';
const PO = '/api/v1/ai/drafts/purchase-orders';
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
  es256({ iss: 'hydromart-auth', aud: 'hydromart-machine', sub: PERSON, scopes: ['depotAdmin'], exp: exp() });

const depotBody = {
  code: 'AID-01',
  name: 'Depot AI Draft',
  ownershipType: 'HKP',
  address: 'Jl. Cikini Raya No. 1',
  city: 'Jakarta Pusat',
  province: 'DKI Jakarta',
  lat: -6.1944,
  lng: 106.8412,
  deliveryFee: 5000,
};

/** Just the proposal store these routes touch: create, and the two reads. */
class ProposalStore {
  rows: PriceOverrideProposalRecord[] = [];
  async create(data: Record<string, unknown>) {
    const now = new Date();
    const row = {
      id: randomUUID(),
      source: 'STAFF',
      aiSuggestionId: null,
      aiReason: null,
      status: 'PENDING',
      decidedBy: null,
      decisionReason: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    } as unknown as PriceOverrideProposalRecord;
    this.rows.push(row);
    return row;
  }
  async findById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findByAiSuggestionId(id: string) {
    return this.rows.find((r) => r.aiSuggestionId === id) ?? null;
  }
}

describe('AI drafts (HD-17 part A, e2e)', () => {
  let app: INestApplication;
  let depotId: string;
  let otherDepotId: string;
  let supplierId: string;
  let proposals: ProposalStore;
  let orders: InMemoryPurchaseOrderRepository;
  let staff: (role: Role, depot?: string | null) => string;
  const trail: AuditEvent[] = [];
  let failTrail = false;
  const sink: AuditMutationSink = {
    record: async () => undefined,
    recordOrThrow: async (event) => {
      if (failTrail) throw new Error('audit down');
      trail.push(event);
    },
  };

  const priceBody = () => ({
    depotId,
    productId: '11111111-1111-4111-8111-111111111111',
    productName: 'Galon 19L isi ulang',
    currentPrice: 20000,
    adjustType: 'PERCENT',
    value: -10,
    reason: 'Pesaing sekitar menurunkan harga 10%.',
  });
  const poBody = () => ({
    depotId,
    supplierId,
    lines: [{ itemType: 'GALON', label: 'Galon 19L', quantity: 50, unitCostIdr: 18000 }],
    shippingIdr: 5000,
    reason: 'Stok galon tinggal dua hari.',
  });
  const post = (url: string, token: string | null, body: object, id: string | null = SUGGESTION) => {
    let req = request(app.getHttpServer()).post(url).set('X-Workflow', 'ai17-drafts');
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    if (id) req = req.set('X-AI-Suggestion-Id', id);
    return req.send(body);
  };
  const manager = () => aiToken('MANAGER', depotId);

  beforeAll(async () => {
    process.env.DEPOT_DATABASE_URL = 'postgresql://u:p@localhost:5432/db?schema=public';
    process.env.JWT_ACCESS_SECRET = SECRET;
    resetExternalKeyStores();
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (url) =>
        String(url) === `${AUTH_URL}/api/v1/auth/jwks`
          ? ({ ok: true, json: async () => ({ keys: [JWK] }) } as unknown as Response)
          : ({ ok: false, status: 404, json: async () => ({}) } as unknown as Response),
      );
    proposals = new ProposalStore();
    orders = new InMemoryPurchaseOrderRepository();
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validationSchema: envValidationSchema,
          validationOptions: { allowUnknown: true },
          load: [
            () => ({
              NODE_ENV: 'test',
              DEPOT_SERVICE_PORT: 3007,
              DEPOT_DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
              JWT_ACCESS_SECRET: SECRET,
              AUTH_SERVICE_URL: AUTH_URL,
              CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
              RATE_LIMIT_TTL_SECONDS: 60,
              RATE_LIMIT_MAX: 100,
            }),
          ],
        }),
        DepotModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue({ onModuleInit: jest.fn(), onModuleDestroy: jest.fn() })
      .overrideProvider(DEPOT_TOKENS.DepotRepository)
      .useValue(new InMemoryDepotRepository())
      .overrideProvider(DEPOT_TOKENS.InventoryRepository)
      .useValue(new InMemoryInventoryRepository())
      .overrideProvider(DEPOT_TOKENS.PriceOverrideProposalRepository)
      .useValue(proposals)
      .overrideProvider(DEPOT_TOKENS.PurchaseOrderRepository)
      .useValue(orders)
      .overrideProvider(DEPOT_TOKENS.SupplierRepository)
      .useValue(new InMemorySupplierRepository())
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
    const ho = staff(Role.HEAD_OFFICE);
    const open = async (code: string) =>
      (
        await request(app.getHttpServer())
          .post('/api/v1/depots')
          .set('Authorization', `Bearer ${ho}`)
          .send({ ...depotBody, code })
          .expect(201)
      ).body.id as string;
    depotId = await open('AID-01');
    otherDepotId = await open('AID-02');
    supplierId = (
      await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${staff(Role.MANAGER, depotId)}`)
        .send({ depotId, name: 'Tirta Makmur', code: 'SUP-01', categories: ['Galon 19L'] })
        .expect(201)
    ).body.id;
  });

  beforeEach(() => {
    trail.length = 0;
    failTrail = false;
    proposals.rows.length = 0;
    orders.rows.length = 0;
  });

  afterAll(async () => {
    await app.close();
    jest.restoreAllMocks();
  });

  describe('price proposal draft', () => {
    it('makes a PENDING AI proposal, records the suggestion id first, and HQ sees it', async () => {
      const res = await post(PRICE, manager(), priceBody()).expect(201);
      expect(res.body).toMatchObject({
        status: 'PENDING',
        source: 'AI',
        aiSuggestionId: SUGGESTION,
        aiReason: 'Pesaing sekitar menurunkan harga 10%.',
        proposedBy: PERSON,
        depotId,
      });
      expect(trail).toHaveLength(1);
      expect(trail[0]).toMatchObject({
        action: 'ai.drafts.price-overrides.created.requested',
        actorId: PERSON,
        metadata: { via: 'ai', suggestionId: SUGGESTION, workflow: 'ai17-drafts', depotId },
      });
      expect(proposals.rows).toHaveLength(1);
    });

    it('answers the same draft (200) for a retry, and 409 for the same id with another body', async () => {
      const first = await post(PRICE, manager(), priceBody()).expect(201);
      const again = await post(PRICE, manager(), priceBody(), SUGGESTION.toUpperCase()).expect(200);
      expect(again.body.id).toBe(first.body.id);
      const clash = await post(PRICE, manager(), { ...priceBody(), value: -30 }).expect(409);
      expect(clash.body.code).toBe('AI_SUGGESTION_REUSED');
      expect(proposals.rows).toHaveLength(1);
    });

    it('refuses without a valid X-AI-Suggestion-Id (400), and bad bodies (400)', async () => {
      await post(PRICE, manager(), priceBody(), null).expect(400);
      await post(PRICE, manager(), priceBody(), 'not-a-uuid').expect(400);
      await post(PRICE, manager(), { ...priceBody(), reason: undefined }).expect(400);
      await post(PRICE, manager(), { ...priceBody(), reason: '   ' }).expect(400);
      await post(PRICE, manager(), { ...priceBody(), reason: 'x'.repeat(501) }).expect(400);
      expect(proposals.rows).toHaveLength(0);
    });

    it('refuses a third decimal on a money field (400), and a staff token with a bad body is 403 first', async () => {
      await post(PRICE, manager(), { ...priceBody(), value: -10.555 }).expect(400);
      await post(PRICE, manager(), { ...priceBody(), currentPrice: 20000.001 }).expect(400);
      await post(PRICE, staff(Role.MANAGER, depotId), { nonsense: true }, null).expect(403);
      await post(PO, staff(Role.MANAGER, depotId), { nonsense: true }, null).expect(403);
      expect(proposals.rows).toHaveLength(0);
    });

    it('gives the person exactly what the staff route gives them', async () => {
      // No depotAdmin capability: a depot staff member, and head office, as on the staff route.
      await post(PRICE, aiToken('STAFF_DEPOT', depotId), priceBody()).expect(403);
      await post(PRICE, aiToken('HEAD_OFFICE', null), priceBody()).expect(403);
      // Another depot than theirs.
      await post(PRICE, aiToken('MANAGER', otherDepotId), priceBody()).expect(403);
      // A depot that does not exist: the same 404 the staff route gives.
      await post(PRICE, aiToken('SUPER_ADMIN', null), { ...priceBody(), depotId: randomUUID() }).expect(404);
      expect(proposals.rows).toHaveLength(0);
    });

    it('refuses a staff session token, a machine token and no token', async () => {
      await post(PRICE, staff(Role.MANAGER, depotId), priceBody()).expect(403);
      await post(PRICE, machineToken(), priceBody()).expect(403);
      await post(PRICE, null, priceBody()).expect(401);
      await post(PRICE, es256({ iss: 'hydromart-auth', aud: 'hydromart-ai', sub: PERSON, role: 'MANAGER', exp: 1 }), priceBody()).expect(401);
    });

    it('is not drafted when the audit trail cannot record the call (503)', async () => {
      failTrail = true;
      await post(PRICE, manager(), priceBody()).expect(503);
      expect(proposals.rows).toHaveLength(0);
    });
  });

  describe('purchase order draft', () => {
    it('makes a DRAFT AI order that staff then send as today (Kirim is the approval)', async () => {
      const res = await post(PO, manager(), poBody()).expect(201);
      expect(res.body).toMatchObject({
        status: 'DRAFT',
        source: 'AI',
        aiSuggestionId: SUGGESTION,
        aiReason: 'Stok galon tinggal dua hari.',
        totalIdr: 905000,
        supplierId,
      });
      expect(trail[0]).toMatchObject({
        action: 'ai.drafts.purchase-orders.created.requested',
        metadata: { via: 'ai', suggestionId: SUGGESTION },
      });
      const mgr = staff(Role.MANAGER, depotId);
      const read = await request(app.getHttpServer())
        .get(`/api/v1/purchase-orders/${res.body.id}`)
        .set('Authorization', `Bearer ${mgr}`)
        .expect(200);
      expect(read.body).toMatchObject({ source: 'AI', aiReason: 'Stok galon tinggal dua hari.' });
      const sent = await request(app.getHttpServer())
        .post(`/api/v1/purchase-orders/${res.body.id}/send`)
        .set('Authorization', `Bearer ${mgr}`)
        .expect(201);
      expect(sent.body.status).toBe('SENT');
    });

    it('keeps the note and the expected date a draft was given', async () => {
      const res = await post(PO, manager(), { ...poBody(), expectedAt: '2026-12-01' }).expect(201);
      expect(res.body.expectedAt).toContain('2026-12-01');
      const price = await post(PRICE, manager(), { ...priceBody(), note: 'Catatan.' }, '5c1e2f3a-0000-4000-8000-0000000000a3').expect(201);
      expect(price.body.note).toBe('Catatan.');
    });

    it('answers the same draft (200) for a retry, and 409 for the same id with another body', async () => {
      const first = await post(PO, manager(), poBody()).expect(201);
      const again = await post(PO, manager(), poBody()).expect(200);
      expect(again.body.id).toBe(first.body.id);
      await post(PO, manager(), { ...poBody(), shippingIdr: 1 }).expect(409);
      expect(orders.rows).toHaveLength(1);
    });

    it('refuses a missing or bad suggestion id, and a body without a reason (400)', async () => {
      await post(PO, manager(), poBody(), null).expect(400);
      await post(PO, manager(), poBody(), 'nope').expect(400);
      await post(PO, manager(), { ...poBody(), reason: undefined }).expect(400);
      expect(orders.rows).toHaveLength(0);
    });

    it('gives the person exactly what the staff route gives them', async () => {
      await post(PO, aiToken('STAFF_DEPOT', depotId), poBody()).expect(403);
      await post(PO, aiToken('MANAGER', otherDepotId), poBody()).expect(403);
      // A supplier of another depot: 404, as on the staff route.
      await post(PO, aiToken('SUPER_ADMIN', null), { ...poBody(), depotId: otherDepotId }).expect(404);
      expect(orders.rows).toHaveLength(0);
    });

    it('refuses a staff session token, a machine token and no token', async () => {
      await post(PO, staff(Role.MANAGER, depotId), poBody()).expect(403);
      await post(PO, machineToken(), poBody()).expect(403);
      await post(PO, null, poBody()).expect(401);
    });

    it('is not drafted when the audit trail cannot record the call (503)', async () => {
      failTrail = true;
      await post(PO, manager(), poBody()).expect(503);
      expect(orders.rows).toHaveLength(0);
    });
  });

  /*
   * The closed list: the AI token, even a SUPER_ADMIN's (the most any person can hold), is
   * refused on everything that decides, executes or writes outside the two drafts. 403 comes from
   * JwtAuthGuard before any handler or capability runs, because none of these routes names
   * @ExternalAccess.
   */
  describe('everything else refuses the AI token', () => {
    const god = () => aiToken('SUPER_ADMIN', null);
    const ID = '22222222-2222-4222-8222-222222222222';
    const cases: [string, string, object | undefined][] = [
      ['POST', `/api/v1/price-overrides/${ID}/approve`, undefined],
      ['POST', `/api/v1/price-overrides/${ID}/reject`, { reason: 'no' }],
      ['GET', '/api/v1/price-overrides', undefined],
      ['POST', `/api/v1/depots/${ID}/price-overrides`, {}],
      ['POST', `/api/v1/depots/${ID}/price-overrides/import`, { rows: [] }],
      ['POST', '/api/v1/purchase-orders', {}],
      ['POST', `/api/v1/purchase-orders/${ID}/send`, undefined],
      ['POST', `/api/v1/purchase-orders/${ID}/receive`, {}],
      ['GET', `/api/v1/purchase-orders/${ID}`, undefined],
      ['GET', `/api/v1/purchase-orders?depotId=${ID}`, undefined],
      ['POST', '/api/v1/suppliers', {}],
      ['POST', '/api/v1/depots', {}],
    ];
    it.each(cases)('%s %s -> 403', async (method, url, body) => {
      const agent = request(app.getHttpServer());
      const req = method === 'GET' ? agent.get(url) : agent.post(url);
      const res = await req.set('Authorization', `Bearer ${god()}`).send(body);
      expect(res.status).toBe(403);
    });
  });

  describe('the contract (contracts/ai-v1/drafts.openapi.json)', () => {
    const schemas = contract.components.schemas;
    it.each([
      [PRICE, 'AiPriceOverrideDraft', priceBody()],
      [PO, 'AiPurchaseOrderDraft', poBody()],
    ])('describes %s: path, required header, 201/200/400/401/403/409/429, required body fields', (route, schema, body) => {
      const op = contract.paths[route.replace('/api/v1', '/depot/api/v1')].post;
      expect(op.parameters.find((p: { name: string }) => p.name === 'X-AI-Suggestion-Id')).toMatchObject({ in: 'header', required: true });
      for (const code of ['200', '201', '400', '401', '403', '409', '429']) expect(op.responses[code]).toBeDefined();
      const required: string[] = schemas[schema].required;
      for (const field of required) expect(Object.keys(body)).toContain(field);
      expect(Object.keys(schemas[schema].properties)).toEqual(expect.arrayContaining(Object.keys(body)));
      expect(schemas[schema].properties.reason.maxLength).toBe(500);
    });

    it('describes the rows the routes answer', async () => {
      const price = (await post(PRICE, manager(), priceBody()).expect(201)).body;
      const po = (await post(PO, manager(), poBody(), '5c1e2f3a-0000-4000-8000-0000000000a2').expect(201)).body;
      for (const [name, row] of [['PriceOverrideProposal', price], ['PurchaseOrder', po]] as const) {
        for (const field of schemas[name].required) expect(row).toHaveProperty(field);
        expect(Object.keys(row)).toEqual(expect.arrayContaining([]));
      }
    });
  });
});
