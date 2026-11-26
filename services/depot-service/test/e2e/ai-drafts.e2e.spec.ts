import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { INestApplication, VersioningType } from '@nestjs/common';
import { CAPABILITIES, loadCustomRoles, loadDepotOverrides, loadOverrides, loadRoleSettings } from '@hydromart/access';
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
import { DepotDraftRecord } from '../../src/domain/depot-draft';
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

const ENTITY = '00000000-0000-4000-8000-000000000001';

/** Just the depot-draft store the CRM routes touch: one row per prospect. */
class DraftStore {
  rows: DepotDraftRecord[] = [];
  async findByProspectId(id: string) {
    return this.rows.find((r) => r.prospectId === id) ?? null;
  }
  async create(data: Record<string, unknown>) {
    const now = new Date();
    const row = {
      id: randomUUID(),
      status: 'DRAFT',
      decisionNote: null,
      decidedBy: null,
      decidedAt: null,
      depotId: null,
      createdAt: now,
      updatedAt: now,
      ...data,
    } as unknown as DepotDraftRecord;
    this.rows.push(row);
    return row;
  }
  /** Like the repository: only a REJECTED row reopens; the prospect and createdAt stay. */
  async reopen(id: string, data: Record<string, unknown>) {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.status !== 'REJECTED') return null;
    const { prospectId: _kept, ...content } = data;
    Object.assign(row, content, { status: 'DRAFT', decisionNote: null, decidedBy: null, decidedAt: null, updatedAt: new Date() });
    return row;
  }
}

/** The HD-5 matrix as the AI web sees it: the custom Sales role may act for one entity. */
const legalEntities = {
  list: async () => [{ id: ENTITY, name: 'PT Contoh Waralaba', active: true }],
  grantedEntityIds: async (role: string) => (role === 'C_SALES' ? [ENTITY] : []),
};

describe('AI drafts (HD-17 part A, e2e)', () => {
  let app: INestApplication;
  let depotId: string;
  let otherDepotId: string;
  let supplierId: string;
  let proposals: ProposalStore;
  let orders: InMemoryPurchaseOrderRepository;
  let crmDrafts: DraftStore;
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
    crmDrafts = new DraftStore();
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
      .overrideProvider(DEPOT_TOKENS.DepotDraftRepository)
      .useValue(crmDrafts)
      .overrideProvider(DEPOT_TOKENS.LegalEntityRepository)
      .useValue(legalEntities)
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

    it('stores a third decimal rounded to 2 dp (a retry still replays), and a staff token with a bad body is 403 first', async () => {
      const body = { ...priceBody(), value: -10.555, currentPrice: 20000.004 };
      const first = await post(PRICE, manager(), body).expect(201);
      expect(first.body.currentPrice).toBe(20000);
      expect(String(first.body.value)).toMatch(/^-10.5[56]$/);
      await post(PRICE, manager(), body).expect(200);
      await post(PRICE, staff(Role.MANAGER, depotId), { nonsense: true }, null).expect(403);
      await post(PO, staff(Role.MANAGER, depotId), { nonsense: true }, null).expect(403);
      expect(proposals.rows).toHaveLength(1);
    });

    it('the staff CSV import accepts a cell with many decimals, stored rounded', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/depots/${depotId}/price-overrides/import`)
        .set('Authorization', `Bearer ${staff(Role.MANAGER, depotId)}`)
        .send({ rows: [{ ...priceBody(), reason: undefined, depotId: undefined, value: 15.3333333 }] })
        .expect(201);
      expect(res.body.created).toBe(1);
      expect(proposals.rows[0]!.value).toBe(15.33);
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

  describe('CRM calon mitra (HD-21a)', () => {
    const FROM_CRM = '/api/v1/ai/drafts/depots/from-crm';
    const ACCESS = '/api/v1/ai/crm/access';
    const PROSPECT = '00000000-0000-4000-8000-0000000000a1';
    const crm = () => aiToken('MARKETING', null);
    const crmBody = () => ({
      prospectId: PROSPECT,
      legacyApplicationId: null,
      proposedName: 'Depot Contoh',
      city: 'Bekasi',
      province: 'Jawa Barat',
      owner: { fullName: 'Budi Santoso', phoneE164: '+6281234567890' },
      prospectusHandedOn: '2026-10-01',
      prospectusSha256: 'a'.repeat(64),
      prospectusVersionLabel: 'v1',
      prospectusReceipt: 'Tanda terima 1',
      agreementSignedOn: '2026-11-01',
      checklist: { ktpNpwp: 'VERIFIED', locationProof: 'VERIFIED', capitalDeposit: 'VERIFIED', fieldSurvey: 'VERIFIED' },
    });
    const get = (url: string, token: string | null) => {
      const req = request(app.getHttpServer()).get(url);
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };

    beforeEach(() => {
      crmDrafts.rows.length = 0;
    });
    afterEach(() => {
      loadOverrides({});
      loadCustomRoles([]);
      loadDepotOverrides([]);
      loadRoleSettings([]);
    });

    it('drafts a depot (201), replays (200), refuses another body (409), and sends nothing else', async () => {
      const first = await post(FROM_CRM, crm(), crmBody(), PROSPECT).expect(201);
      expect(first.body).toMatchObject({ status: 'DRAFT' });
      expect(first.body.draftId).toEqual(expect.any(String));
      expect(trail[0]).toMatchObject({
        action: 'ai.drafts.depots.from-crm.created.requested',
        actorId: PERSON,
        metadata: { via: 'ai', suggestionId: PROSPECT },
      });
      const again = await post(FROM_CRM, crm(), crmBody(), PROSPECT).expect(200);
      expect(again.body.draftId).toBe(first.body.draftId);
      const clash = await post(FROM_CRM, crm(), { ...crmBody(), city: 'Depok' }, PROSPECT).expect(409);
      expect(clash.body.code).toBe('DRAFT_CONFLICT');
      expect(crmDrafts.rows).toHaveLength(1);
      const status = await get(`${FROM_CRM}/${PROSPECT}`, crm()).expect(200);
      expect(status.body).toMatchObject({ draftId: first.body.draftId, status: 'DRAFT', depotId: null, depotCode: null });
    });

    it('treats an upper-case prospect id as the same prospect (replay), and the header must equal it', async () => {
      const upper = { ...crmBody(), prospectId: PROSPECT.toUpperCase() };
      const first = await post(FROM_CRM, crm(), crmBody(), PROSPECT).expect(201);
      const again = await post(FROM_CRM, crm(), upper, PROSPECT.toUpperCase()).expect(200);
      expect(again.body.draftId).toBe(first.body.draftId);
      expect(crmDrafts.rows).toHaveLength(1);
      expect(crmDrafts.rows[0]!.prospectId).toBe(PROSPECT);
      const other = '00000000-0000-4000-8000-0000000000a9';
      const mismatch = await post(FROM_CRM, crm(), crmBody(), other).expect(400);
      expect(mismatch.body.message).toContain('prospectId');
      expect(crmDrafts.rows).toHaveLength(1);
    });

    it('reopens a REJECTED draft for the new caller and keeps the first createdAt', async () => {
      const first = await post(FROM_CRM, crm(), crmBody(), PROSPECT).expect(201);
      const row = crmDrafts.rows[0]!;
      Object.assign(row, { status: 'REJECTED', decisionNote: 'kurang dokumen' });
      const reopened = await post(FROM_CRM, crm(), { ...crmBody(), city: 'Depok' }, PROSPECT).expect(201);
      expect(reopened.body).toMatchObject({ draftId: first.body.draftId, status: 'DRAFT' });
      expect(reopened.body.createdAt).toBe(first.body.createdAt);
      expect(crmDrafts.rows).toHaveLength(1);
      expect(row).toMatchObject({ status: 'DRAFT', city: 'Depok', decisionNote: null, createdBy: PERSON });
    });

    it('re-checks D1: 422 with items / earliestOn, 400 for a future signing, nothing stored', async () => {
      const lacking = await post(
        FROM_CRM,
        crm(),
        { ...crmBody(), checklist: { ...crmBody().checklist, fieldSurvey: 'SUBMITTED' } },
        PROSPECT,
      ).expect(422);
      expect(lacking.body).toMatchObject({ code: 'CHECKLIST_INCOMPLETE', items: ['fieldSurvey'] });
      const early = await post(FROM_CRM, crm(), { ...crmBody(), agreementSignedOn: '2026-10-14' }, PROSPECT).expect(422);
      expect(early.body).toMatchObject({ code: 'COOLING_OFF_NOT_MET', earliestOn: '2026-10-15' });
      await post(FROM_CRM, crm(), { ...crmBody(), agreementSignedOn: '2099-01-01' }, PROSPECT).expect(400);
      await post(FROM_CRM, crm(), { ...crmBody(), prospectusSha256: 'zz' }, PROSPECT).expect(400);
      await post(FROM_CRM, crm(), crmBody(), null).expect(400);
      expect(crmDrafts.rows).toHaveLength(0);
    });

    it('answers ALREADY_ONBOARDED with depotId and depotCode once the draft is a depot', async () => {
      await post(FROM_CRM, crm(), crmBody(), PROSPECT).expect(201);
      Object.assign(crmDrafts.rows[0]!, { status: 'ACTIVATED', depotId });
      const res = await post(FROM_CRM, crm(), crmBody(), PROSPECT).expect(409);
      expect(res.body).toMatchObject({ code: 'ALREADY_ONBOARDED', depotId, depotCode: 'AID-01' });
    });

    it('is 404 for a prospect with no draft', async () => {
      await get(`${FROM_CRM}/${PROSPECT}`, crm()).expect(404);
      await get(`${FROM_CRM}/not-a-uuid`, crm()).expect(400);
    });

    it('refuses the AI token without prospectCrm, a staff token, a machine token and no token', async () => {
      await post(FROM_CRM, aiToken('HEAD_OFFICE', null), crmBody(), PROSPECT).expect(403);
      await post(FROM_CRM, aiToken('MANAGER', depotId), crmBody(), PROSPECT).expect(403);
      await get(`${FROM_CRM}/${PROSPECT}`, aiToken('HEAD_OFFICE', null)).expect(403);
      await post(FROM_CRM, staff(Role.SUPER_ADMIN), crmBody(), PROSPECT).expect(403);
      await post(FROM_CRM, machineToken(), crmBody(), PROSPECT).expect(403);
      await post(FROM_CRM, null, crmBody(), PROSPECT).expect(401);
      await get(`${FROM_CRM}/${PROSPECT}`, staff(Role.SUPER_ADMIN)).expect(403);
      expect(crmDrafts.rows).toHaveLength(0);
    });

    it('access: summary for HEAD_OFFICE, full for MARKETING, everything for SUPER_ADMIN, 403 below', async () => {
      const read = async (token: string) => (await get(ACCESS, token).expect(200)).body;
      expect(await read(aiToken('HEAD_OFFICE', null))).toEqual({ full: false, settings: false, legalEntities: [] });
      expect(await read(crm())).toEqual({ full: true, settings: false, legalEntities: [] });
      expect(await read(aiToken('SUPER_ADMIN', null))).toEqual({
        full: true,
        settings: true,
        legalEntities: [{ id: ENTITY, name: 'PT Contoh Waralaba' }],
      });
      await get(ACCESS, aiToken('MANAGER', depotId)).expect(403);
      await get(ACCESS, staff(Role.SUPER_ADMIN)).expect(403);
      await get(ACCESS, null).expect(401);
    });

    it('access follows the RUNTIME matrix: a custom role granted by override, with its legal entities', async () => {
      const sales = aiToken('C_SALES', null);
      await get(ACCESS, sales).expect(403);
      loadCustomRoles([{ key: 'C_SALES', name: 'Sales', scope: 'GLOBAL' }]);
      loadOverrides({ prospectRead: [...CAPABILITIES.prospectRead, 'C_SALES'], prospectCrm: [...CAPABILITIES.prospectCrm, 'C_SALES'] });
      expect((await get(ACCESS, sales).expect(200)).body).toEqual({ full: true, settings: false, legalEntities: [{ id: ENTITY, name: 'PT Contoh Waralaba' }] });
      loadOverrides({ prospectRead: [...CAPABILITIES.prospectRead, 'C_SALES'], prospectSettings: ['SUPER_ADMIN', 'C_SALES'] });
      expect((await get(ACCESS, sales).expect(200)).body).toMatchObject({ full: false, settings: true });
      await post(FROM_CRM, sales, crmBody(), PROSPECT).expect(403);
    });

    it('access judges a depot-locked role at its own depot: a per-depot grant shows, a deny hides', async () => {
      const mgr = aiToken('KEPALA_DEPOT', depotId);
      await get(ACCESS, mgr).expect(403);
      loadOverrides({ prospectRead: [...CAPABILITIES.prospectRead, 'KEPALA_DEPOT'] });
      expect((await get(ACCESS, mgr).expect(200)).body).toMatchObject({ full: false, settings: false });
      loadDepotOverrides([{ capability: 'prospectCrm', roleKey: 'KEPALA_DEPOT', depotId, effect: 'GRANT' }]);
      expect((await get(ACCESS, mgr).expect(200)).body).toMatchObject({ full: true, settings: false });
      // Another depot's grant does nothing here.
      loadDepotOverrides([{ capability: 'prospectCrm', roleKey: 'KEPALA_DEPOT', depotId: otherDepotId, effect: 'GRANT' }]);
      expect((await get(ACCESS, mgr).expect(200)).body).toMatchObject({ full: false });
      // A deny at the person's depot beats the global list.
      loadOverrides({ prospectRead: [...CAPABILITIES.prospectRead, 'KEPALA_DEPOT'], prospectCrm: [...CAPABILITIES.prospectCrm, 'KEPALA_DEPOT'] });
      expect((await get(ACCESS, mgr).expect(200)).body).toMatchObject({ full: true });
      loadDepotOverrides([{ capability: 'prospectCrm', roleKey: 'KEPALA_DEPOT', depotId, effect: 'DENY' }]);
      expect((await get(ACCESS, mgr).expect(200)).body).toMatchObject({ full: false });
    });

    it('a disabled built-in role holds nothing: 403 on access and on the draft', async () => {
      loadRoleSettings([{ roleKey: 'MARKETING', disabled: true }]);
      await get(ACCESS, crm()).expect(403);
      await post(FROM_CRM, crm(), crmBody(), PROSPECT).expect(403);
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
