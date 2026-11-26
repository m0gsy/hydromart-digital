import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DepotDraftService, requestHashOf } from '../../src/application/services/depot-draft.service';
import { LegalEntityService } from '../../src/application/services/legal-entity.service';
import { NewDepotDraft } from '../../src/application/ports/depot-draft.repository';
import { addDays, checkDraft, DepotChecklist, DepotDraftContent, DepotDraftRecord } from '../../src/domain/depot-draft';
import { DepotDraftPrismaRepository } from '../../src/infrastructure/prisma/depot-draft.prisma.repository';
import type { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import { CrmDepotDraftDto } from '../../src/modules/dto/ai-crm.dto';

const ALL_OK: DepotChecklist = {
  ktpNpwp: 'VERIFIED',
  locationProof: 'VERIFIED',
  capitalDeposit: 'VERIFIED',
  fieldSurvey: 'VERIFIED',
};
const TODAY = '2026-11-26';
const dates = (handed: string, signed: string) => ({
  checklist: ALL_OK,
  prospectusHandedOn: handed,
  agreementSignedOn: signed,
});

describe('checkDraft (D1 re-check)', () => {
  it('passes at exactly 14 days and refuses at 13', () => {
    expect(checkDraft(dates('2026-11-01', '2026-11-15'), TODAY)).toEqual({ ok: true });
    expect(checkDraft(dates('2026-11-01', '2026-11-14'), TODAY)).toEqual({
      ok: false,
      reason: 'COOLING_OFF_NOT_MET',
      earliestOn: '2026-11-15',
    });
  });

  it.each([
    ['month boundary', '2026-10-25', '2026-11-08', '2026-11-07'],
    ['year boundary', '2025-12-25', '2026-01-08', '2026-01-07'],
    ['leap day (2028)', '2028-02-20', '2028-03-05', '2028-03-04'],
    ['non-leap February (2026)', '2026-02-20', '2026-03-06', '2026-03-05'],
  ])('counts calendar days across a %s', (_n, handed, ok, tooEarly) => {
    expect(checkDraft(dates(handed, ok), '2030-01-01')).toEqual({ ok: true });
    expect(checkDraft(dates(handed, tooEarly), '2030-01-01')).toMatchObject({
      reason: 'COOLING_OFF_NOT_MET',
      earliestOn: ok,
    });
  });

  it('adds days with the platform WIB arithmetic', () => {
    expect(addDays('2028-02-15', 14)).toBe('2028-02-29');
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
  });

  it('refuses a future agreement and a prospectus after the agreement (dates), before anything else', () => {
    const bad = { ...dates('2026-11-01', '2026-11-27'), checklist: { ...ALL_OK, ktpNpwp: 'SUBMITTED' as const } };
    expect(checkDraft(bad, TODAY)).toMatchObject({ ok: false, reason: 'BAD_DATES' });
    expect(checkDraft(dates('2026-11-20', '2026-11-10'), TODAY)).toMatchObject({ reason: 'BAD_DATES' });
    expect(checkDraft(dates('2026-02-30', '2026-11-10'), TODAY)).toMatchObject({ reason: 'BAD_DATES' });
    expect(checkDraft(dates('2026-11-01', 'soon'), TODAY)).toMatchObject({ reason: 'BAD_DATES' });
  });

  it('allows an agreement signed today (WIB day) when 14 days have passed', () => {
    expect(checkDraft(dates('2026-11-12', TODAY), TODAY)).toEqual({ ok: true });
  });

  it('lists every checklist item that is not VERIFIED', () => {
    const input = {
      ...dates('2026-10-01', '2026-11-01'),
      checklist: { ...ALL_OK, ktpNpwp: 'NOT_STARTED' as const, fieldSurvey: 'REJECTED' as const },
    };
    expect(checkDraft(input, TODAY)).toEqual({
      ok: false,
      reason: 'CHECKLIST_INCOMPLETE',
      items: ['ktpNpwp', 'fieldSurvey'],
    });
  });
});

const PROSPECT = '00000000-0000-4000-8000-0000000000a1';
const content = (over: Partial<DepotDraftContent> = {}): DepotDraftContent => ({
  legacyApplicationId: null,
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
  checklist: ALL_OK,
  ...over,
});

class FakeDrafts {
  rows: DepotDraftRecord[] = [];
  raceOnCreate = false;
  reopenLoses = false;
  async findByProspectId(id: string) {
    return this.rows.find((r) => r.prospectId === id) ?? null;
  }
  async create(data: NewDepotDraft) {
    if (this.raceOnCreate) {
      this.raceOnCreate = false;
      this.rows.push(this.make(data));
      throw Object.assign(new Error('unique'), { code: 'P2002' });
    }
    const row = this.make(data);
    this.rows.push(row);
    return row;
  }
  async reopen(id: string, data: NewDepotDraft) {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.status !== 'REJECTED' || this.reopenLoses) return null;
    Object.assign(row, data, { status: 'DRAFT', decisionNote: null });
    return row;
  }
  make(data: NewDepotDraft): DepotDraftRecord {
    return {
      ...data,
      id: `00000000-0000-4000-8000-00000000d${String(this.rows.length).padStart(3, '0')}`,
      status: 'DRAFT',
      decisionNote: null,
      decidedBy: null,
      decidedAt: null,
      depotId: null,
      createdAt: new Date('2026-11-26T01:00:00Z'),
      updatedAt: new Date('2026-11-26T01:00:00Z'),
    };
  }
}

describe('DepotDraftService.draftFromCrm', () => {
  let drafts: FakeDrafts;
  let service: DepotDraftService;
  const depots = { findById: jest.fn(async () => ({ code: 'BKS-01' })) };
  const ai = { suggestionId: PROSPECT, createdBy: '00000000-0000-4000-8000-0000000000b1' };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-26T05:00:00Z'));
    drafts = new FakeDrafts();
    service = new DepotDraftService(drafts as never, depots as never);
  });
  afterEach(() => jest.useRealTimers());

  it('creates one row (201) and replays the same body (200) without a second row', async () => {
    const first = await service.draftFromCrm(PROSPECT, content(), ai);
    expect(first.replayed).toBe(false);
    expect(first.draft.status).toBe('DRAFT');
    const again = await service.draftFromCrm(PROSPECT, content(), ai);
    expect(again).toMatchObject({ replayed: true });
    expect(again.draft.id).toBe(first.draft.id);
    expect(drafts.rows).toHaveLength(1);
  });

  it('refuses a different body for a pending draft (DRAFT_CONFLICT)', async () => {
    await service.draftFromCrm(PROSPECT, content(), ai);
    await expect(service.draftFromCrm(PROSPECT, content({ city: 'Depok' }), ai)).rejects.toMatchObject({
      code: 'DRAFT_CONFLICT',
      status: 409,
    });
  });

  it('reopens a REJECTED draft as DRAFT with the new content (a fresh 201)', async () => {
    const first = await service.draftFromCrm(PROSPECT, content(), ai);
    drafts.rows[0]!.status = 'REJECTED';
    drafts.rows[0]!.decisionNote = 'kurang dokumen';
    const reopened = await service.draftFromCrm(PROSPECT, content({ city: 'Depok' }), ai);
    expect(reopened.replayed).toBe(false);
    expect(reopened.draft).toMatchObject({ id: first.draft.id, status: 'DRAFT', city: 'Depok', decisionNote: null });
  });

  it('answers what is there when a reopen loses its race, or conflicts when nothing changed', async () => {
    await service.draftFromCrm(PROSPECT, content(), ai);
    drafts.rows[0]!.status = 'REJECTED';
    drafts.reopenLoses = true;
    await expect(service.draftFromCrm(PROSPECT, content(), ai)).rejects.toMatchObject({ code: 'DRAFT_CONFLICT' });
    // The other reopener already made it a DRAFT with this very content: that is a replay.
    const hash = requestHashOf(PROSPECT, content());
    const reopen = jest.spyOn(drafts, 'reopen').mockImplementation(async () => {
      Object.assign(drafts.rows[0]!, { status: 'DRAFT', requestHash: hash });
      return null;
    });
    await expect(service.draftFromCrm(PROSPECT, content(), ai)).resolves.toMatchObject({ replayed: true });
    reopen.mockRestore();
  });

  it('answers ALREADY_ONBOARDED with the depot id and code for an ACTIVATED draft', async () => {
    await service.draftFromCrm(PROSPECT, content(), ai);
    Object.assign(drafts.rows[0]!, { status: 'ACTIVATED', depotId: '00000000-0000-4000-8000-0000000000c1' });
    const err = await service.draftFromCrm(PROSPECT, content(), ai).catch((e) => e);
    expect(err).toMatchObject({
      code: 'ALREADY_ONBOARDED',
      status: 409,
      details: { depotId: '00000000-0000-4000-8000-0000000000c1', depotCode: 'BKS-01' },
    });
  });

  it('turns the D1 verdicts into 422 (with items / earliestOn) and 400', async () => {
    await expect(
      service.draftFromCrm(PROSPECT, content({ checklist: { ...ALL_OK, locationProof: 'SUBMITTED' } }), ai),
    ).rejects.toMatchObject({ code: 'CHECKLIST_INCOMPLETE', status: 422, details: { items: ['locationProof'] } });
    await expect(
      service.draftFromCrm(PROSPECT, content({ prospectusHandedOn: '2026-10-25', agreementSignedOn: '2026-11-01' }), ai),
    ).rejects.toMatchObject({ code: 'COOLING_OFF_NOT_MET', status: 422, details: { earliestOn: '2026-11-08' } });
    await expect(
      service.draftFromCrm(PROSPECT, content({ agreementSignedOn: '2026-11-27' }), ai),
    ).rejects.toMatchObject({ code: 'INVALID_DRAFT_DATES', status: 400 });
    expect(drafts.rows).toHaveLength(0);
  });

  it('uses the WIB day: 20:00 UTC on the 26th is already the 27th in Jakarta', async () => {
    jest.setSystemTime(new Date('2026-11-26T20:00:00Z'));
    await expect(
      service.draftFromCrm(PROSPECT, content({ agreementSignedOn: '2026-11-27' }), ai),
    ).resolves.toMatchObject({ replayed: false });
  });

  it('on a create race (P2002) answers the row that won, and rethrows any other error', async () => {
    drafts.raceOnCreate = true;
    await expect(service.draftFromCrm(PROSPECT, content(), ai)).resolves.toMatchObject({ replayed: true });
    // P2002 with nothing to read back is another unique index: not ours to swallow.
    drafts.rows.length = 0;
    jest.spyOn(drafts, 'create').mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'P2002' }));
    await expect(service.draftFromCrm(PROSPECT, content(), ai)).rejects.toThrow('x');
    jest.spyOn(drafts, 'create').mockRejectedValueOnce(new Error('db down'));
    await expect(service.draftFromCrm(PROSPECT, content(), ai)).rejects.toThrow('db down');
  });

  it('reads the status: 404 without a draft, the depot code once activated', async () => {
    await expect(service.statusOf(PROSPECT)).rejects.toMatchObject({ code: 'DEPOT_DRAFT_NOT_FOUND', status: 404 });
    await service.draftFromCrm(PROSPECT, content(), ai);
    await expect(service.statusOf(PROSPECT)).resolves.toMatchObject({ status: 'DRAFT', depotId: null, depotCode: null });
    Object.assign(drafts.rows[0]!, { status: 'ACTIVATED', depotId: '00000000-0000-4000-8000-0000000000c1' });
    await expect(service.statusOf(PROSPECT)).resolves.toMatchObject({ status: 'ACTIVATED', depotCode: 'BKS-01' });
    depots.findById.mockResolvedValueOnce(null as never);
    await expect(service.statusOf(PROSPECT)).resolves.toMatchObject({ depotCode: null });
  });

  it('hashes the content', () => {
    expect(requestHashOf(PROSPECT, content())).toBe(requestHashOf(PROSPECT, { ...content() }));
    expect(requestHashOf(PROSPECT, content())).not.toBe(requestHashOf(PROSPECT, content({ proposedName: 'Lain' })));
  });
});

describe('DepotDraftPrismaRepository', () => {
  const data: NewDepotDraft = {
    ...content(),
    prospectId: PROSPECT,
    requestHash: 'h',
    suggestionId: PROSPECT,
    createdBy: PROSPECT,
  };
  const row = new FakeDrafts().make(data);
  const model = {
    findUnique: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
    findUniqueOrThrow: jest.fn(),
  };
  const repo = new DepotDraftPrismaRepository({ depotDraft: model } as unknown as PrismaService);

  it('finds, creates and reopens only while REJECTED', async () => {
    model.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    await expect(repo.findByProspectId(PROSPECT)).resolves.toMatchObject({ prospectId: PROSPECT });
    await expect(repo.findByProspectId(PROSPECT)).resolves.toBeNull();
    model.create.mockResolvedValueOnce(row);
    await expect(repo.create(data)).resolves.toMatchObject({ id: row.id });
    model.updateMany.mockResolvedValueOnce({ count: 1 });
    model.findUniqueOrThrow.mockResolvedValueOnce(row);
    await expect(repo.reopen(row.id, data)).resolves.toMatchObject({ id: row.id });
    expect(model.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: row.id, status: 'REJECTED' },
        data: expect.objectContaining({ status: 'DRAFT', decisionNote: null, decidedBy: null, decidedAt: null }),
      }),
    );
    model.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repo.reopen(row.id, data)).resolves.toBeNull();
  });
});

describe('CrmDepotDraftDto', () => {
  const body = () => ({
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
    checklist: ALL_OK,
  });
  const errors = async (b: object) =>
    validate(plainToInstance(CrmDepotDraftDto, b), { whitelist: true, forbidNonWhitelisted: true });

  it('accepts the contract body, with or without a legacy application id', async () => {
    expect(await errors(body())).toEqual([]);
    expect(await errors({ ...body(), legacyApplicationId: '00000000-0000-4000-8000-0000000000e1' })).toEqual([]);
    const without: Record<string, unknown> = body();
    delete without.legacyApplicationId;
    expect(await errors(without)).toEqual([]);
  });

  it.each([
    ['short name', { proposedName: 'ab' }],
    ['long name', { proposedName: 'x'.repeat(81) }],
    ['bad day', { prospectusHandedOn: '1 Oktober' }],
    ['sha in capitals', { prospectusSha256: 'A'.repeat(64) }],
    ['short sha', { prospectusSha256: 'a'.repeat(63) }],
    ['bad prospect id', { prospectId: 'nope' }],
    ['empty label', { prospectusVersionLabel: '' }],
    ['long receipt', { prospectusReceipt: 'x'.repeat(201) }],
    ['owner phone without +62', { owner: { fullName: 'Budi', phoneE164: '081234567890' } }],
    ['owner name too short', { owner: { fullName: 'B', phoneE164: '+6281234567890' } }],
    ['unknown checklist state', { checklist: { ...ALL_OK, ktpNpwp: 'DONE' } }],
    ['missing checklist item', { checklist: { ktpNpwp: 'VERIFIED' } }],
  ])('refuses %s', async (_n, patch) => {
    expect((await errors({ ...body(), ...patch })).length).toBeGreaterThan(0);
  });
});

describe('LegalEntityService.accessibleTo', () => {
  const A = '00000000-0000-4000-8000-0000000000f1';
  const B = '00000000-0000-4000-8000-0000000000f2';
  const C = '00000000-0000-4000-8000-0000000000f3';
  const entities = {
    list: async () => [
      { id: A, name: 'PT A', active: true },
      { id: B, name: 'PT B', active: true },
      { id: C, name: 'PT C', active: false },
    ],
    grantedEntityIds: jest.fn(async (role: string) => (role === 'SALES' ? [A.toUpperCase(), C] : [])),
  };
  const service = new LegalEntityService(entities as never, {} as never);

  it('gives SUPER_ADMIN every active entity, a granted role only its granted active ones, no grant none', async () => {
    await expect(service.accessibleTo('SUPER_ADMIN')).resolves.toEqual([
      { id: A, name: 'PT A' },
      { id: B, name: 'PT B' },
    ]);
    await expect(service.accessibleTo('SALES')).resolves.toEqual([{ id: A, name: 'PT A' }]);
    await expect(service.accessibleTo('MARKETING')).resolves.toEqual([]);
  });
});
