import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DepotDraftService } from '../../src/application/services/depot-draft.service';
import { CreateDepotData } from '../../src/application/ports/depot.repository';
import { depotOnboarded, depotOnboardedEventId, DepotDraftRecord } from '../../src/domain/depot-draft';
import { DepotDraftConflictError, DuplicateDepotCodeError } from '../../src/domain/errors';
import { DepotDraftPrismaRepository } from '../../src/infrastructure/prisma/depot-draft.prisma.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

const DRAFT = '00000000-0000-4000-8000-0000000000d1';
const PROSPECT = '00000000-0000-4000-8000-0000000000a1';
const LEGACY = '00000000-0000-4000-8000-0000000000e1';
const DEPOT = '00000000-0000-4000-8000-0000000000c1';
const HQ = '00000000-0000-4000-8000-0000000000b1';
const AT = new Date('2026-11-26T03:00:00Z');

const draft = (over: Partial<DepotDraftRecord> = {}): DepotDraftRecord => ({
  id: DRAFT,
  prospectId: PROSPECT,
  legacyApplicationId: LEGACY,
  proposedName: 'Depot Contoh',
  city: 'Bekasi',
  province: 'Jawa Barat',
  ownerFullName: 'Budi Santoso',
  ownerPhoneE164: '+6281234567890',
  prospectusHandedOn: '2026-10-01',
  agreementSignedOn: '2026-11-01',
  prospectusSha256: 'a'.repeat(64),
  prospectusVersionLabel: 'v1',
  prospectusReceipt: 'Tanda terima 1',
  checklist: { ktpNpwp: 'VERIFIED', locationProof: 'VERIFIED', capitalDeposit: 'VERIFIED', fieldSurvey: 'VERIFIED' },
  requestHash: 'h',
  suggestionId: PROSPECT,
  status: 'DRAFT',
  decisionNote: null,
  decidedBy: null,
  decidedAt: null,
  depotId: null,
  createdBy: HQ,
  createdAt: AT,
  updatedAt: AT,
  ...over,
});

describe('depot.onboarded (domain)', () => {
  it('carries ids and the depot code only, keyed by the depot', () => {
    const e = depotOnboarded({ depotId: DEPOT, depotCode: 'BKS-01', prospectId: PROSPECT, legacyApplicationId: null, occurredAt: AT });
    expect(e).toMatchObject({ event: 'depot.onboarded', eventId: `depot.onboarded:${DEPOT}`, occurredAt: AT });
    expect(depotOnboardedEventId(DEPOT)).toBe(`depot.onboarded:${DEPOT}`);
    // Whatever the draft holds about the owner, the event never says it.
    expect(JSON.stringify(e)).not.toMatch(/Budi|\+62|Bekasi|Contoh/);
    expect(Object.keys(e.payload).sort()).toEqual(['depotCode', 'depotId', 'legacyApplicationId', 'occurredAt', 'prospectId']);
  });

  it('matches the contract the AI web codes against', () => {
    const contract = JSON.parse(readFileSync(join(__dirname, '../../../../contracts/ai-v1/events.openapi.json'), 'utf8'));
    const e = depotOnboarded({ depotId: DEPOT, depotCode: 'BKS-01', prospectId: PROSPECT, legacyApplicationId: LEGACY, occurredAt: AT });
    const envelope = contract.components.schemas.DepotOnboarded;
    const data = contract.components.schemas.DepotOnboardedData;
    expect(Object.keys(contract.webhooks)).toContain(e.event);
    expect(envelope.properties.event.const).toBe(e.event);
    expect(e.eventId).toMatch(new RegExp(envelope.properties.eventId.pattern));
    expect(Object.keys(e.payload).sort()).toEqual([...data.required].sort());
    expect(Object.keys(data.properties).sort()).toEqual([...data.required].sort());
    expect(e.payload).toEqual({
      depotId: DEPOT,
      depotCode: 'BKS-01',
      prospectId: PROSPECT,
      legacyApplicationId: LEGACY,
      occurredAt: '2026-11-26T03:00:00.000Z',
    });
  });
});

describe('DepotDraftService HQ actions', () => {
  const body = { code: 'BKS-01', name: 'Depot Contoh', ownershipType: 'WARALABA' } as unknown as CreateDepotData;
  const make = () => {
    const drafts = {
      list: jest.fn(async () => ({ items: [draft()], total: 41 })),
      findById: jest.fn(async (): Promise<DepotDraftRecord | null> => draft()),
      reject: jest.fn(async (): Promise<DepotDraftRecord | null> => draft({ status: 'REJECTED', ownerFullName: null, ownerPhoneE164: null })),
      activate: jest.fn(async (): Promise<unknown> => ({ draft: draft({ status: 'ACTIVATED' }), depotId: DEPOT, depotCode: 'BKS-01' })),
    };
    const depots = { findById: jest.fn(async (): Promise<unknown> => ({ id: DEPOT, code: 'BKS-01' })) };
    const depotService = { prepareCreate: jest.fn(async (d: CreateDepotData) => ({ ...d, checked: true })) };
    const relay = { flush: jest.fn(async () => undefined) };
    const service = new DepotDraftService(drafts as never, depots as never, depotService as never, relay as never);
    return { drafts, depots, depotService, relay, service };
  };

  it('lists a page of trimmed items with their age, and reads one without its hash (404 when unknown)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-30T03:00:00Z'));
    const { service, drafts } = make();
    const page = await service.list({ page: 2, limit: 20 });
    expect(page).toMatchObject({ total: 41, page: 2, limit: 20, totalPages: 3 });
    expect(page.items[0]).toEqual({
      id: DRAFT,
      proposedName: 'Depot Contoh',
      city: 'Bekasi',
      province: 'Jawa Barat',
      status: 'DRAFT',
      checklist: { verified: 4, total: 4 },
      createdAt: AT,
      decidedAt: null,
      ageDays: 4,
    });
    // Nothing personal and nothing internal in a list item.
    expect(JSON.stringify(page.items[0])).not.toMatch(/Budi|\+62|requestHash|suggestionId|createdBy/);
    drafts.list.mockResolvedValueOnce({ items: [draft({ status: 'REJECTED', decidedAt: new Date('2026-11-28T03:00:00Z') })], total: 1 });
    expect((await service.list({ page: 1, limit: 5 })).items[0]!.ageDays).toBe(2);
    jest.useRealTimers();
    const view = await service.view(DRAFT);
    expect(view).toMatchObject({ id: DRAFT, ownerFullName: 'Budi Santoso' });
    expect(view).not.toHaveProperty('requestHash');
    await expect(service.get(DRAFT)).resolves.toMatchObject({ id: DRAFT });
    drafts.findById.mockResolvedValueOnce(null);
    await expect(service.get(DRAFT)).rejects.toMatchObject({ code: 'DEPOT_DRAFT_NOT_FOUND', status: 404 });
  });

  it('rejects with a trimmed note and the actor; the owner fields come back cleared', async () => {
    const { service, drafts } = make();
    const done = await service.reject(DRAFT, '  kurang dokumen ', HQ);
    expect(drafts.reject).toHaveBeenCalledWith(DRAFT, 'kurang dokumen', HQ, expect.any(Date));
    expect(done).toMatchObject({ status: 'REJECTED', ownerFullName: null, ownerPhoneE164: null });
  });

  it('refuses a second decision: reject of a decided draft is 409', async () => {
    const { service, drafts } = make();
    drafts.reject.mockResolvedValueOnce(null);
    await expect(service.reject(DRAFT, 'x', HQ)).rejects.toMatchObject({ code: 'DEPOT_DRAFT_NOT_OPEN', status: 409 });
  });

  it('activates: checks the depot like a plain create, commits once, flushes the event after', async () => {
    const { service, drafts, depotService, relay, depots } = make();
    await expect(service.activate(DRAFT, body, HQ)).resolves.toMatchObject({ id: DEPOT, code: 'BKS-01' });
    expect(depotService.prepareCreate).toHaveBeenCalledWith(body);
    expect(drafts.activate).toHaveBeenCalledWith(DRAFT, { ...body, checked: true }, HQ, expect.any(Date));
    expect(relay.flush).toHaveBeenCalledWith(`depot.onboarded:${DEPOT}`);
    expect(depots.findById).toHaveBeenCalledWith(DEPOT, false);
    // The flush is called after the commit.
    expect(drafts.activate.mock.invocationCallOrder[0]).toBeLessThan(relay.flush.mock.invocationCallOrder[0]!);
  });

  it('refuses to activate a non-franchise depot (400) before anything is checked or written', async () => {
    const { service, drafts, depotService } = make();
    await expect(service.activate(DRAFT, { ...body, ownershipType: 'HKP' } as never, HQ)).rejects.toMatchObject({ code: 'DEPOT_DRAFT_NOT_FRANCHISE', status: 400 });
    expect(depotService.prepareCreate).not.toHaveBeenCalled();
    expect(drafts.activate).not.toHaveBeenCalled();
  });

  it('a validation failure (owner required, duplicate code, schedule) stops before anything is written', async () => {
    const { service, drafts, depotService, relay } = make();
    depotService.prepareCreate.mockRejectedValueOnce(Object.assign(new Error('owner'), { code: 'FRANCHISE_OWNER_REQUIRED' }));
    await expect(service.activate(DRAFT, body, HQ)).rejects.toMatchObject({ code: 'FRANCHISE_OWNER_REQUIRED' });
    expect(drafts.activate).not.toHaveBeenCalled();
    expect(relay.flush).not.toHaveBeenCalled();
  });

  it.each([['ACTIVATED'], ['REJECTED']] as const)('refuses to activate a %s draft (409) and a missing one (404)', async (status) => {
    const { service, drafts, relay } = make();
    drafts.findById.mockResolvedValueOnce(draft({ status }));
    await expect(service.activate(DRAFT, body, HQ)).rejects.toMatchObject({ code: 'DEPOT_DRAFT_NOT_OPEN', status: 409 });
    drafts.findById.mockResolvedValueOnce(null);
    await expect(service.activate(DRAFT, body, HQ)).rejects.toMatchObject({ code: 'DEPOT_DRAFT_NOT_FOUND' });
    expect(drafts.activate).not.toHaveBeenCalled();
    expect(relay.flush).not.toHaveBeenCalled();
  });

  it('answers 409 when the draft was decided between the read and the write, and sends no event', async () => {
    const { service, drafts, relay } = make();
    drafts.activate.mockResolvedValueOnce(null);
    await expect(service.activate(DRAFT, body, HQ)).rejects.toMatchObject({ code: 'DEPOT_DRAFT_NOT_OPEN' });
    expect(relay.flush).not.toHaveBeenCalled();
  });

  it('a relay that rejects does not fail the activation, and a depot that vanished is a 404', async () => {
    const { service, relay, depots } = make();
    relay.flush.mockRejectedValueOnce(new Error('admin down'));
    await expect(service.activate(DRAFT, body, HQ)).resolves.toMatchObject({ id: DEPOT });
    depots.findById.mockResolvedValueOnce(null);
    await expect(service.activate(DRAFT, body, HQ)).rejects.toMatchObject({ status: 404 });
  });
});

/**
 * A tiny database whose `$transaction` rolls back every write when the callback throws, so the
 * test proves what the repository puts INSIDE the one transaction, not only what it calls.
 */
function fakeDb(opts: { failOutbox?: boolean; takenByOther?: boolean; dupCode?: boolean | string[] | string } = {}) {
  const state = {
    depots: [] as Record<string, unknown>[],
    drafts: [draft()] as DepotDraftRecord[],
    outbox: [] as Record<string, unknown>[],
  };
  const tx = {
    depotDraft: {
      findUnique: async () => state.drafts[0] ?? null,
      findUniqueOrThrow: async () => state.drafts[0]!,
      updateMany: async ({ where, data }: { where: { status?: string }; data: Partial<DepotDraftRecord> }) => {
        if (opts.takenByOther) return { count: 0 };
        if (where.status && state.drafts[0]!.status !== where.status) return { count: 0 };
        Object.assign(state.drafts[0]!, data);
        return { count: 1 };
      },
    },
    depot: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (opts.dupCode) throw Object.assign(new Error('unique'), { code: 'P2002', meta: { target: opts.dupCode === true ? ['code'] : opts.dupCode } });
        const row = { id: DEPOT, ...data };
        state.depots.push(row);
        return row;
      },
    },
    webhookEventOutbox: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (opts.failOutbox) throw new Error('outbox down');
        state.outbox.push(data);
      },
    },
  };
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      const snap = structuredClone(state);
      try {
        return await fn(tx);
      } catch (e) {
        Object.assign(state, snap);
        throw e;
      }
    },
    depotDraft: { ...tx.depotDraft, updateMany: tx.depotDraft.updateMany, findUnique: async () => state.drafts[0] ?? null },
  };
  return { state, repo: new DepotDraftPrismaRepository(prisma as unknown as PrismaService) };
}

describe('DepotDraftPrismaRepository.activate (one transaction)', () => {
  const data = { code: 'BKS-01', name: 'Depot', operatingHours: {}, holidays: [], owners: [{ ownerId: HQ, sharePct: 100, isPrimary: true }] } as unknown as CreateDepotData;

  it('writes the depot with its CRM links, the ACTIVATED draft with the owner data cleared, and the outbox row', async () => {
    const { repo, state } = fakeDb();
    const done = await repo.activate(DRAFT, data, HQ, AT);
    expect(done).toMatchObject({ depotId: DEPOT, depotCode: 'BKS-01' });
    expect(state.depots[0]).toMatchObject({ crmProspectId: PROSPECT, franchiseApplicationId: LEGACY });
    expect(state.drafts[0]).toMatchObject({ status: 'ACTIVATED', depotId: DEPOT, decidedBy: HQ, decidedAt: AT, ownerFullName: null, ownerPhoneE164: null, requestHash: null });
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0]).toMatchObject({ event: 'depot.onboarded', eventId: `depot.onboarded:${DEPOT}` });
    expect(JSON.stringify(state.outbox[0])).not.toMatch(/Budi|\+6281234567890/);
  });

  it('leaves nothing behind when a step in the middle fails', async () => {
    const { repo, state } = fakeDb({ failOutbox: true });
    await expect(repo.activate(DRAFT, data, HQ, AT)).rejects.toThrow('outbox down');
    expect(state.depots).toHaveLength(0);
    expect(state.outbox).toHaveLength(0);
    expect(state.drafts[0]).toMatchObject({ status: 'DRAFT', depotId: null, ownerFullName: 'Budi Santoso' });
  });

  it('answers null (and writes nothing) when the draft is not DRAFT, or loses the guarded write', async () => {
    const decided = fakeDb();
    decided.state.drafts[0]!.status = 'REJECTED';
    await expect(decided.repo.activate(DRAFT, data, HQ, AT)).resolves.toBeNull();
    expect(decided.state.depots).toHaveLength(0);
    const raced = fakeDb({ takenByOther: true });
    await expect(raced.repo.activate(DRAFT, data, HQ, AT)).resolves.toBeNull();
    expect(raced.state.depots).toHaveLength(0);
    const gone = fakeDb();
    gone.state.drafts.length = 0;
    await expect(gone.repo.activate(DRAFT, data, HQ, AT)).resolves.toBeNull();
  });

  it('maps only the depot code clash to DuplicateDepotCodeError; any other unique clash is a 409 conflict, never a raw error', async () => {
    await expect(fakeDb({ dupCode: true }).repo.activate(DRAFT, data, HQ, AT)).rejects.toBeInstanceOf(DuplicateDepotCodeError);
    await expect(fakeDb({ dupCode: 'depots_code_key' }).repo.activate(DRAFT, data, HQ, AT)).rejects.toBeInstanceOf(DuplicateDepotCodeError);
    for (const target of [['depotId'], ['code', 'ownerId'], 'depot_owners_pkey', []]) {
      const db = fakeDb({ dupCode: target });
      const err = await db.repo.activate(DRAFT, data, HQ, AT).catch((e) => e);
      expect(err).toBeInstanceOf(DepotDraftConflictError);
      expect(err).toMatchObject({ code: 'DEPOT_DRAFT_CONFLICT', status: 409 });
      expect(db.state.depots).toHaveLength(0);
    }
  });

  it('writes a depot with no owner and no drawn area (company depot)', async () => {
    const { repo, state } = fakeDb();
    await repo.activate(DRAFT, { code: 'BKS-02', operatingHours: {}, holidays: [], owners: [], serviceArea: [[{ lat: 1, lng: 2 }]] } as unknown as CreateDepotData, HQ, AT);
    expect(state.depots[0]).not.toHaveProperty('owners');
    expect(state.depots[0]).toHaveProperty('serviceArea');
  });
});

describe('DepotDraftPrismaRepository list and reject', () => {
  it('one status: DRAFT oldest first, a decided one newest first, paged, with the count', async () => {
    const findMany = jest.fn().mockResolvedValue([draft()]);
    const count = jest.fn().mockResolvedValue(1);
    const repo = new DepotDraftPrismaRepository({
      $transaction: async (qs: Promise<unknown>[]) => Promise.all(qs),
      depotDraft: { findMany, count },
    } as unknown as PrismaService);
    await expect(repo.list({ page: 3, limit: 10, status: 'REJECTED' })).resolves.toMatchObject({ total: 1 });
    expect(findMany).toHaveBeenCalledWith({ where: { status: 'REJECTED' }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: 20, take: 10 });
    await repo.list({ page: 1, limit: 5, status: 'DRAFT' });
    expect(findMany.mock.calls[1][0].orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('everything: the open drafts oldest first, then the decided ones newest first, the page cut across both', async () => {
    const open = ['o1', 'o2', 'o3'];
    const decided = ['d1', 'd2', 'd3', 'd4'];
    const findMany = jest.fn(async ({ where, skip, take }: { where: { status: unknown }; skip: number; take: number }) =>
      (where.status === 'DRAFT' ? open : decided).slice(skip, skip + take).map((id) => draft({ id })),
    );
    const count = jest.fn(async ({ where }: { where: { status: unknown } }) => (where.status === 'DRAFT' ? open.length : decided.length));
    const repo = new DepotDraftPrismaRepository({
      $transaction: async (qs: Promise<unknown>[]) => Promise.all(qs),
      depotDraft: { findMany, count },
    } as unknown as PrismaService);
    const ids = async (page: number, limit: number) => (await repo.list({ page, limit })).items.map((i) => i.id);
    expect(await ids(1, 2)).toEqual(['o1', 'o2']);
    expect(await ids(2, 2)).toEqual(['o3', 'd1']);
    expect(await ids(3, 2)).toEqual(['d2', 'd3']);
    expect(await ids(4, 2)).toEqual(['d4']);
    expect(await ids(9, 2)).toEqual([]);
    await expect(repo.list({ page: 1, limit: 2 })).resolves.toMatchObject({ total: 7 });
  });

  it('rejects only a DRAFT row and clears the owner fields; null when it is not', async () => {
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const findUnique = jest.fn().mockResolvedValue(draft({ status: 'REJECTED' }));
    const repo = new DepotDraftPrismaRepository({ depotDraft: { updateMany, findUnique } } as unknown as PrismaService);
    await expect(repo.reject(DRAFT, 'n', HQ, AT)).resolves.toMatchObject({ status: 'REJECTED' });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: DRAFT, status: 'DRAFT' },
      data: { status: 'REJECTED', decisionNote: 'n', decidedBy: HQ, decidedAt: AT, ownerFullName: null, ownerPhoneE164: null, requestHash: null },
    });
    await expect(repo.reject(DRAFT, 'n', HQ, AT)).resolves.toBeNull();
    await expect(repo.findById(DRAFT)).resolves.toMatchObject({ id: DRAFT });
    findUnique.mockResolvedValueOnce(null);
    await expect(repo.findById(DRAFT)).resolves.toBeNull();
  });
});

describe('audit of the legacy export and of a refused activation', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const sent: Record<string, unknown>[] = [];
  const config = { authServiceUrl: 'http://auth.test', internalServiceKey: 'k'.repeat(32) };
  beforeEach(() => {
    sent.length = 0;
    global.fetch = jest.fn(async (_u: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 201 } as never;
    }) as never;
  });

  it('records one event per export call with the count and the truncated flag, and nothing personal', async () => {
    const { AiCrmController } = await import('../../src/modules/ai-draft.controller');
    const applications = {
      openForCrm: jest.fn(async () => ({
        applications: [{ id: 'a', applicantName: 'Calon Contoh Satu', applicantPhoneE164: '+6281200000001' }],
        truncated: true,
      })),
    };
    const controller = new AiCrmController({} as never, applications as never, config as never);
    await expect(controller.legacyApplications({ sub: HQ } as never)).resolves.toMatchObject({ truncated: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      action: 'ai.crm.legacy-applications.read',
      actorId: HQ,
      metadata: { via: 'ai', count: 1, truncated: true },
    });
    expect(JSON.stringify(sent[0])).not.toMatch(/Calon Contoh|\+62812/);
  });

  it('records a refused activation (4xx) with its code only, then rethrows; a 5xx is not recorded', async () => {
    const { DepotDraftController } = await import('../../src/modules/depot-draft.controller');
    const { DepotDraftNotOpenError } = await import('../../src/domain/errors');
    const { BadRequestException } = await import('@nestjs/common');
    const activate = jest
      .fn()
      .mockRejectedValueOnce(new DepotDraftNotOpenError())
      .mockRejectedValueOnce(new BadRequestException('bad'))
      .mockRejectedValueOnce(new Error('boom'));
    const controller = new DepotDraftController({ activate } as never, config as never);
    const dto = { code: 'X-1', name: 'n', ownershipType: 'WARALABA', address: 'Jl. Rahasia 1', deliveryFee: 1, lat: 1, lng: 2 };
    await expect(controller.activate(DRAFT, dto as never, { sub: HQ } as never)).rejects.toMatchObject({ code: 'DEPOT_DRAFT_NOT_OPEN' });
    await expect(controller.activate(DRAFT, dto as never, { sub: HQ } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.activate(DRAFT, dto as never, { sub: HQ } as never)).rejects.toThrow('boom');
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ action: 'depot.draft.activate.refused', metadata: { draftId: DRAFT, code: 'DEPOT_DRAFT_NOT_OPEN' } });
    expect(sent[1]).toMatchObject({ metadata: { draftId: DRAFT, code: 'HTTP_400' } });
    expect(JSON.stringify(sent)).not.toMatch(/Rahasia/);
  });
});

describe('DepotDraftController audit of an activation', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('writes only the draft id, the depot id and the depot code, never the depot body', async () => {
    const sent: Record<string, unknown>[] = [];
    global.fetch = jest.fn(async (_u: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return { ok: true, status: 201 } as never;
    }) as never;
    const { DepotDraftController } = await import('../../src/modules/depot-draft.controller');
    const drafts = { activate: jest.fn(async () => ({ id: DEPOT, code: 'BKS-01' })) };
    const config = { authServiceUrl: 'http://auth.test', internalServiceKey: 'k'.repeat(32) };
    const controller = new DepotDraftController(drafts as never, config as never);
    const dto = {
      code: 'BKS-01',
      name: 'Depot',
      ownershipType: 'WARALABA',
      address: 'Jl. Rahasia 1',
      contactPhone: '+6281200000009',
      paymentBankAccountNumber: '1234567890',
      deliveryFee: 1,
      lat: 1,
      lng: 2,
    };
    await controller.activate(DRAFT, dto as never, { sub: HQ } as never);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain('depot.draft.activated');
    expect(JSON.stringify(sent[0])).not.toMatch(/Rahasia|\+62812|1234567890/);
    expect(sent[0]).toMatchObject({ metadata: { draftId: DRAFT, depotId: DEPOT, depotCode: 'BKS-01' } });
  });
});
