import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CAPABILITY_KEY, Role } from '@hydromart/platform';

import { VisitService } from '../../src/application/services/visit.service';
import { DepotConfigService } from '../../src/config/depot-config.service';
import {
  DepotNotFoundError,
  InvalidFindingError,
  VisitAlreadyOpenError,
  VisitClosedError,
  VisitDepotClosedError,
  VisitIncompleteError,
  VisitItemNotFoundError,
  VisitNotFoundError,
  VisitNotYoursError,
  VisitOutsideAreaError,
  VisitPhotoUnavailableError,
  VisitTemplateNotFoundError,
} from '../../src/domain/errors';
import {
  FollowUpStatus,
  VisitItemResult,
  VisitStatus,
  allAnswered,
  dateOfDayKey,
  dayKeyOfDate,
  dueDayInWindow,
  followUpOverdue,
  photoKeyPattern,
} from '../../src/domain/visit';
import { VisitController } from '../../src/modules/visit.controller';
import { VisitInternalController } from '../../src/modules/visit-internal.controller';
import {
  AnswerVisitItemDto,
  CloseFollowUpDto,
  ListFindingsQueryDto,
  ListVisitsQueryDto,
  StartVisitDto,
} from '../../src/modules/dto/visit.dto';

const V = '00000000-0000-4000-8000-0000000000b1';
const V2 = '00000000-0000-4000-8000-0000000000b2';
const DEPOT = '00000000-0000-4000-8000-0000000000d1';
const DEPOT2 = '00000000-0000-4000-8000-0000000000d2';
const TPL = '00000000-0000-4000-8000-0000000000c1';
const SOP1 = '00000000-0000-4000-8000-0000000000a1';
const ITEM1 = '00000000-0000-4000-8000-0000000000e1';
const ITEM2 = '00000000-0000-4000-8000-0000000000e2';
const ME = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const PHOTO = `visits/${V}/00000000-0000-4000-8000-0000000000f1.jpg`;

// 2026-11-27 10:00 UTC = 17:00 WIB; and 17:30 UTC = 00:30 WIB on the NEXT day.
const NOON = new Date('2026-11-27T10:00:00.000Z');
const AFTER_MIDNIGHT = new Date('2026-11-27T17:30:00.000Z');

const supervisor = (depotIds: string[] = [DEPOT], sub: string = ME) =>
  ({ sub, role: Role.SUPERVISOR, depotId: null, depotIds }) as never;

describe('visit domain rules', () => {
  it('only accepts a photo key from this visit, a uuid file and an image extension', () => {
    const re = photoKeyPattern(V);
    expect(re.test(PHOTO)).toBe(true);
    expect(re.test(`visits/${V2}/00000000-0000-4000-8000-0000000000f1.jpg`)).toBe(false);
    expect(re.test(`visits/${V}/00000000-0000-4000-8000-0000000000f1.pdf`)).toBe(false);
    expect(re.test(`visits/${V}/../x.jpg`)).toBe(false);
  });

  it('keeps a deadline between today and +90 days, in WIB days', () => {
    expect(dueDayInWindow('2026-11-27', NOON)).toBe(true);
    expect(dueDayInWindow('2026-11-26', NOON)).toBe(false);
    expect(dueDayInWindow('2027-02-25', NOON)).toBe(true); // +90
    expect(dueDayInWindow('2027-02-26', NOON)).toBe(false); // +91
    // 00:30 WIB on the 28th: "today" has already moved on although UTC is still the 27th.
    expect(dueDayInWindow('2026-11-27', AFTER_MIDNIGHT)).toBe(false);
    expect(dueDayInWindow('2026-11-28', AFTER_MIDNIGHT)).toBe(true);
  });

  it('is overdue only after its deadline day', () => {
    expect(followUpOverdue('2026-11-27', NOON)).toBe(false); // due today is still on time
    expect(followUpOverdue('2026-11-26', NOON)).toBe(true);
    expect(followUpOverdue('2026-11-27', AFTER_MIDNIGHT)).toBe(true); // WIB midnight passed
  });

  it('is complete when nothing is PENDING, and round-trips a @db.Date', () => {
    expect(allAnswered([{ result: VisitItemResult.PASS }, { result: VisitItemResult.FINDING }])).toBe(true);
    expect(allAnswered([{ result: VisitItemResult.PASS }, { result: VisitItemResult.PENDING }])).toBe(false);
    expect(allAnswered([])).toBe(true);
    expect(dayKeyOfDate(dateOfDayKey('2026-12-05'))).toBe('2026-12-05');
  });
});

const item = (over: Record<string, unknown> = {}) => ({
  id: ITEM1,
  visitId: V,
  depotId: DEPOT,
  position: 0,
  text: 'Lantai bersih',
  sopId: null,
  sopVersionId: null,
  sopVersionNo: null,
  sopTitle: null,
  result: VisitItemResult.PENDING,
  findingNote: null,
  photoKey: null,
  followUpDueOn: null,
  followUpStatus: null,
  followUpDoneAt: null,
  followUpDoneBy: null,
  followUpNote: null,
  lastOverdueNoticeAt: null,
  ...over,
});

const visit = (over: Record<string, unknown> = {}) => ({
  id: V,
  depotId: DEPOT,
  templateId: TPL,
  templateName: 'Rutin',
  visitorId: ME,
  status: VisitStatus.IN_PROGRESS,
  checkInAt: NOON,
  checkInLat: -6.2,
  checkInLng: 106.8,
  checkInAccuracyM: 10,
  checkInDistanceM: 5,
  approximateFix: false,
  fenceChecked: true,
  completedAt: null,
  items: [item(), item({ id: ITEM2, position: 1, text: 'Filter diganti' })],
  ...over,
});

describe('VisitService', () => {
  const repo = {
    create: jest.fn(),
    findOpenOf: jest.fn(),
    findById: jest.fn(),
    findItem: jest.fn(),
    answerItem: jest.fn(),
    complete: jest.fn(),
    list: jest.fn(),
    findings: jest.fn(),
    overview: jest.fn(),
    closeFollowUp: jest.fn(),
    overdueCounts: jest.fn(),
  };
  const depots = { findById: jest.fn(), findManyByIds: jest.fn(), search: jest.fn() };
  const templates = { findById: jest.fn() };
  const sops = { inForce: jest.fn() };
  const photos = { put: jest.fn(), signedUrl: jest.fn(), remove: jest.fn() };
  const config = { visitCheckInRadiusM: jest.fn() };
  const svc = new VisitService(
    repo as never,
    depots as never,
    templates as never,
    sops as never,
    photos as never,
    config as unknown as DepotConfigService,
  );

  const depot = (over: Record<string, unknown> = {}) => ({
    id: DEPOT,
    name: 'Depot A',
    lat: -6.2,
    lng: 106.8,
    active: true,
    ...over,
  });
  const template = (over: Record<string, unknown> = {}) => ({
    id: TPL,
    name: 'Rutin',
    active: true,
    items: [
      { id: 'ti-1', position: 0, text: 'Lantai bersih', sopId: null },
      { id: 'ti-2', position: 1, text: 'Filter diganti', sopId: SOP1 },
    ],
    ...over,
  });
  const start = { depotId: DEPOT, templateId: TPL, lat: -6.2, lng: 106.8, accuracyM: 12 };

  beforeEach(() => {
    jest.resetAllMocks();
    depots.findById.mockResolvedValue(depot());
    templates.findById.mockResolvedValue(template());
    repo.findOpenOf.mockResolvedValue([]);
    repo.create.mockImplementation(async (d: object) => ({ id: V, ...d }));
    config.visitCheckInRadiusM.mockReturnValue(200);
    sops.inForce.mockResolvedValue([
      { sopId: SOP1, versionId: 'ver-1', versionNo: 4, title: 'SOP filter', effectiveFrom: '2026-11-01' },
    ]);
    photos.signedUrl.mockImplementation(async (key: string) => `https://signed/${key}`);
  });

  describe('start', () => {
    it('opens a visit inside the radius and COPIES the checklist with the SOP version in force', async () => {
      await svc.start(start, supervisor());

      expect(config.visitCheckInRadiusM).toHaveBeenCalledWith(DEPOT);
      expect(sops.inForce).toHaveBeenCalledWith(DEPOT, [SOP1]);
      const data = repo.create.mock.calls[0][0];
      expect(data).toMatchObject({
        depotId: DEPOT,
        templateId: TPL,
        templateName: 'Rutin',
        visitorId: ME,
        accuracyM: 12,
        distanceM: 0,
        approximateFix: false,
        fenceChecked: true,
      });
      // By value: the lines carry text and SOP columns, never a template item id.
      expect(data.items).toEqual([
        { position: 0, text: 'Lantai bersih', sopId: null, sopVersionId: null, sopVersionNo: null, sopTitle: null },
        { position: 1, text: 'Filter diganti', sopId: SOP1, sopVersionId: 'ver-1', sopVersionNo: 4, sopTitle: 'SOP filter' },
      ]);
      expect(JSON.stringify(data)).not.toContain('ti-1');
    });

    it('still opens when hr cannot be asked: the line keeps its sopId, with no version', async () => {
      sops.inForce.mockResolvedValue(null);
      await svc.start(start, supervisor());
      expect(repo.create.mock.calls[0][0].items[1]).toMatchObject({ sopId: SOP1, sopVersionId: null, sopVersionNo: null });
    });

    it('does not ask hr when no line names a SOP, and leaves a SOP with no version in force unset', async () => {
      templates.findById.mockResolvedValue(template({ items: [{ id: 'x', position: 0, text: 'Satu', sopId: null }] }));
      await svc.start(start, supervisor());
      expect(sops.inForce).not.toHaveBeenCalled();

      sops.inForce.mockResolvedValue([]);
      templates.findById.mockResolvedValue(template());
      await svc.start(start, supervisor());
      expect(repo.create.mock.calls[1][0].items[1].sopVersionNo).toBeNull();
    });

    it('refuses outside the radius, telling how far, and keeps the coordinates out of the answer', async () => {
      const err = await svc.start({ ...start, lat: -6.205, accuracyM: 8 }, supervisor()).catch((e) => e);
      expect(err).toBeInstanceOf(VisitOutsideAreaError);
      expect(err.message).toMatch(/Di luar area depot \(\d+ m dari titik, batas 200 m\)/);
      expect(err.message).not.toContain('-6.205');
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('blames "Perkiraan" when the refused fix was approximate, by accuracy or by the grid', async () => {
      const byAccuracy = await svc.start({ ...start, lat: -6.205, accuracyM: 1500 }, supervisor()).catch((e) => e);
      expect(byAccuracy).toBeInstanceOf(VisitOutsideAreaError);
      expect(byAccuracy.message).toContain('Perkiraan');
      // a point on Android's 2 km grid, far from the depot, with no accuracy sent
      const byGrid = await svc.start({ ...start, lat: -6.27027027027027, lng: 106.9642098165971, accuracyM: undefined }, supervisor()).catch((e) => e);
      expect(byGrid.message).toContain('Perkiraan');
    });

    it('lets an approximate fix that lands inside through, and records that it was approximate', async () => {
      await svc.start({ ...start, accuracyM: 1200 }, supervisor());
      expect(repo.create.mock.calls[0][0]).toMatchObject({ approximateFix: true, fenceChecked: true });
    });

    it('records but does not fence when the radius is 0 or the depot has no centre', async () => {
      config.visitCheckInRadiusM.mockReturnValue(0);
      await svc.start({ ...start, lat: -7.5, accuracyM: undefined }, supervisor());
      expect(repo.create.mock.calls[0][0]).toMatchObject({ fenceChecked: false, distanceM: null, accuracyM: null });

      config.visitCheckInRadiusM.mockReturnValue(200);
      depots.findById.mockResolvedValue(depot({ lat: 0, lng: 0 }));
      await svc.start({ ...start, lat: -7.5 }, supervisor());
      expect(repo.create.mock.calls[1][0].fenceChecked).toBe(false);
    });

    it('refuses a missing or closed depot, a missing or retired template, and a depot outside the scope', async () => {
      depots.findById.mockResolvedValueOnce(null);
      await expect(svc.start(start, supervisor())).rejects.toBeInstanceOf(DepotNotFoundError);
      depots.findById.mockResolvedValueOnce(depot({ active: false }));
      await expect(svc.start(start, supervisor())).rejects.toBeInstanceOf(VisitDepotClosedError);
      templates.findById.mockResolvedValueOnce(null);
      await expect(svc.start(start, supervisor())).rejects.toBeInstanceOf(VisitTemplateNotFoundError);
      templates.findById.mockResolvedValueOnce(template({ active: false }));
      await expect(svc.start(start, supervisor())).rejects.toBeInstanceOf(VisitTemplateNotFoundError);
      await expect(svc.start(start, supervisor([DEPOT2]))).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('answers 409 with the open visit id when this supervisor already has one here, but not for another depot', async () => {
      repo.findOpenOf.mockResolvedValue([visit({ depotId: DEPOT2, id: V2 }), visit()]);
      const err = await svc.start(start, supervisor()).catch((e) => e);
      expect(err).toBeInstanceOf(VisitAlreadyOpenError);
      expect(err.message).toContain(V);

      repo.findOpenOf.mockResolvedValue([visit({ depotId: DEPOT2, id: V2 })]);
      await expect(svc.start(start, supervisor())).resolves.toBeDefined();
    });
  });

  describe('own visit: photo, answer, complete', () => {
    beforeEach(() => repo.findById.mockResolvedValue(visit()));

    it('stores a photo for the visitor on an open visit', async () => {
      photos.put.mockResolvedValue({ key: PHOTO });
      const file = { body: Buffer.from('x'), contentType: 'image/jpeg', ext: 'jpg' };
      await expect(svc.uploadPhoto(V, supervisor(), file)).resolves.toEqual({ key: PHOTO });
      expect(photos.put).toHaveBeenCalledWith({ visitId: V, ...file });
    });

    it('says the storage is unavailable when the put fails', async () => {
      photos.put.mockRejectedValue(new Error('s3 down'));
      await expect(
        svc.uploadPhoto(V, supervisor(), { body: Buffer.from('x'), contentType: 'image/png', ext: 'png' }),
      ).rejects.toBeInstanceOf(VisitPhotoUnavailableError);
    });

    it('refuses another supervisor, a finished visit and an unknown one', async () => {
      const file = { body: Buffer.from('x'), contentType: 'image/png', ext: 'png' };
      await expect(svc.uploadPhoto(V, supervisor([DEPOT], OTHER), file)).rejects.toBeInstanceOf(VisitNotYoursError);
      repo.findById.mockResolvedValue(visit({ status: VisitStatus.COMPLETED }));
      await expect(svc.uploadPhoto(V, supervisor(), file)).rejects.toBeInstanceOf(VisitClosedError);
      repo.findById.mockResolvedValue(null);
      await expect(svc.uploadPhoto(V, supervisor(), file)).rejects.toBeInstanceOf(VisitNotFoundError);
      expect(photos.put).not.toHaveBeenCalled();
    });

    it('stops a supervisor who no longer oversees the depot from continuing its visit', async () => {
      const gone = supervisor([DEPOT2]);
      await expect(svc.uploadPhoto(V, gone, { body: Buffer.from('x'), contentType: 'image/png', ext: 'png' })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.answer(V, ITEM1, { result: VisitItemResult.PASS }, gone, NOON)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.complete(V, gone, NOON)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('records a PASS, clearing anything an earlier answer left', async () => {
      repo.answerItem.mockResolvedValue(item({ result: VisitItemResult.PASS }));
      const out = await svc.answer(V, ITEM1, { result: VisitItemResult.PASS }, supervisor(), NOON);
      expect(repo.answerItem).toHaveBeenCalledWith(V, ITEM1, {
        result: VisitItemResult.PASS,
        findingNote: null,
        photoKey: null,
        followUpDueOn: null,
        followUpStatus: null,
      });
      expect(out.photoUrl).toBeNull();
    });

    it('records a FINDING with its note, this visit photo and a deadline, and hands back a signed link', async () => {
      repo.answerItem.mockImplementation(async (_v: string, _i: string, a: object) => item({ ...a, result: VisitItemResult.FINDING }));
      const out = await svc.answer(
        V,
        ITEM1,
        { result: VisitItemResult.FINDING, findingNote: '  Lantai licin  ', photoKey: PHOTO, followUpDueOn: '2026-12-05' },
        supervisor(),
        NOON,
      );
      expect(repo.answerItem).toHaveBeenCalledWith(V, ITEM1, {
        result: VisitItemResult.FINDING,
        findingNote: 'Lantai licin',
        photoKey: PHOTO,
        followUpDueOn: '2026-12-05',
        followUpStatus: FollowUpStatus.OPEN,
      });
      expect(out.photoUrl).toBe(`https://signed/${PHOTO}`);
    });

    it.each([
      ['no note', { findingNote: undefined, photoKey: PHOTO, followUpDueOn: '2026-12-05' }],
      ['a blank note', { findingNote: '   ', photoKey: PHOTO, followUpDueOn: '2026-12-05' }],
      ['no photo', { findingNote: 'Licin', photoKey: undefined, followUpDueOn: '2026-12-05' }],
      ['another visit photo', { findingNote: 'Licin', photoKey: `visits/${V2}/00000000-0000-4000-8000-0000000000f1.jpg`, followUpDueOn: '2026-12-05' }],
      ['no deadline', { findingNote: 'Licin', photoKey: PHOTO, followUpDueOn: undefined }],
      ['a deadline in the past', { findingNote: 'Licin', photoKey: PHOTO, followUpDueOn: '2026-11-26' }],
      ['a deadline past 90 days', { findingNote: 'Licin', photoKey: PHOTO, followUpDueOn: '2027-02-26' }],
    ])('refuses a FINDING with %s', async (_n, body) => {
      await expect(
        svc.answer(V, ITEM1, { result: VisitItemResult.FINDING, ...body }, supervisor(), NOON),
      ).rejects.toBeInstanceOf(InvalidFindingError);
      expect(repo.answerItem).not.toHaveBeenCalled();
    });

    it('measures the deadline against the WIB day, not the UTC one', async () => {
      repo.answerItem.mockResolvedValue(item());
      const finding = { result: VisitItemResult.FINDING as const, findingNote: 'Licin', photoKey: PHOTO };
      // 00:30 WIB on the 28th: "today" is the 28th, so the 27th is already past.
      await expect(
        svc.answer(V, ITEM1, { ...finding, followUpDueOn: '2026-11-27' }, supervisor(), AFTER_MIDNIGHT),
      ).rejects.toBeInstanceOf(InvalidFindingError);
      await expect(
        svc.answer(V, ITEM1, { ...finding, followUpDueOn: '2026-11-28' }, supervisor(), AFTER_MIDNIGHT),
      ).resolves.toBeDefined();
    });

    it('refuses a line of another visit, a visit that closed under it, and the wrong person', async () => {
      await expect(svc.answer(V, V2, { result: VisitItemResult.PASS }, supervisor(), NOON)).rejects.toBeInstanceOf(VisitItemNotFoundError);
      repo.answerItem.mockResolvedValue(null);
      await expect(svc.answer(V, ITEM1, { result: VisitItemResult.PASS }, supervisor(), NOON)).rejects.toBeInstanceOf(VisitClosedError);
      await expect(
        svc.answer(V, ITEM1, { result: VisitItemResult.FINDING, findingNote: 'Licin', photoKey: PHOTO, followUpDueOn: '2026-12-05' }, supervisor(), NOON),
      ).rejects.toBeInstanceOf(VisitClosedError);
      await expect(svc.answer(V, ITEM1, { result: VisitItemResult.PASS }, supervisor([DEPOT], OTHER), NOON)).rejects.toBeInstanceOf(VisitNotYoursError);
    });

    it('refuses to complete with lines still PENDING, naming how many', async () => {
      const err = await svc.complete(V, supervisor(), NOON).catch((e) => e);
      expect(err).toBeInstanceOf(VisitIncompleteError);
      expect(err.message).toContain('2 butir');
      expect(repo.complete).not.toHaveBeenCalled();
    });

    it('completes once every line is answered, and refuses when the visit closed meanwhile', async () => {
      const answered = visit({ items: [item({ result: VisitItemResult.PASS }), item({ id: ITEM2, result: VisitItemResult.FINDING, photoKey: PHOTO })] });
      repo.findById.mockResolvedValue(answered);
      repo.complete.mockResolvedValue({ ...answered, status: VisitStatus.COMPLETED });
      const out = await svc.complete(V, supervisor(), NOON);
      expect(repo.complete).toHaveBeenCalledWith(V, NOON);
      expect(out.status).toBe(VisitStatus.COMPLETED);
      expect(out.items[1].photoUrl).toBe(`https://signed/${PHOTO}`);

      repo.complete.mockResolvedValue(null);
      await expect(svc.complete(V, supervisor(), NOON)).rejects.toBeInstanceOf(VisitClosedError);
    });

    it('lists the caller own open visits', async () => {
      repo.findOpenOf.mockResolvedValue([visit()]);
      await expect(svc.openOf(ME)).resolves.toHaveLength(1);
      expect(repo.findOpenOf).toHaveBeenCalledWith(ME);
    });
  });

  describe('reading', () => {
    it('shows a visit only inside the caller scope, with photo links', async () => {
      repo.findById.mockResolvedValue(visit({ items: [item({ photoKey: PHOTO })] }));
      const out = await svc.get(V, supervisor());
      expect(out.items[0].photoUrl).toBe(`https://signed/${PHOTO}`);
      await expect(svc.get(V, supervisor([DEPOT2]))).rejects.toBeInstanceOf(ForbiddenException);
      repo.findById.mockResolvedValue(null);
      await expect(svc.get(V, supervisor())).rejects.toBeInstanceOf(VisitNotFoundError);
    });

    it('lists visits across the scope, clamps the page size, and refuses a depot outside it', async () => {
      repo.list.mockResolvedValue({ items: [], total: 0 });
      await svc.list(supervisor([DEPOT, DEPOT2]), { page: 2, pageSize: 500 });
      expect(repo.list).toHaveBeenCalledWith({ depotIds: [DEPOT, DEPOT2], status: undefined, page: 2, pageSize: 100 });
      await svc.list(supervisor([DEPOT, DEPOT2]), { depotId: DEPOT2, status: VisitStatus.COMPLETED, page: 1, pageSize: 20 });
      expect(repo.list).toHaveBeenLastCalledWith({ depotIds: [DEPOT2], status: VisitStatus.COMPLETED, page: 1, pageSize: 20 });
      await expect(svc.list(supervisor([DEPOT]), { depotId: DEPOT2, page: 1, pageSize: 20 })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lists findings by state with the WIB day and signed photo links', async () => {
      repo.findings.mockResolvedValue({ items: [item({ photoKey: PHOTO })], total: 1 });
      const out = await svc.findings(supervisor(), { state: 'overdue', page: 1, pageSize: 20 }, AFTER_MIDNIGHT);
      expect(repo.findings).toHaveBeenCalledWith({ depotIds: [DEPOT], state: 'overdue', todayKey: '2026-11-28', page: 1, pageSize: 20 });
      expect(out.items[0].photoUrl).toBe(`https://signed/${PHOTO}`);
      expect(out.total).toBe(1);
    });

    it('builds the per-depot overview for a scope, quiet depots included, overdue first', async () => {
      depots.findManyByIds.mockResolvedValue([depot({ id: DEPOT, name: 'B depot' }), depot({ id: DEPOT2, name: 'A depot' })]);
      repo.overview.mockResolvedValue([
        { depotId: DEPOT, lastVisitAt: NOON, visitsLast30d: 3, openFindings: 2, overdueFollowUps: 1 },
      ]);
      const out = await svc.overview(supervisor([DEPOT, DEPOT2]), NOON);
      expect(repo.overview).toHaveBeenCalledWith([DEPOT, DEPOT2], new Date('2026-10-27T17:00:00.000Z'), '2026-11-27');
      expect(out.map((o) => [o.depotName, o.overdueFollowUps])).toEqual([['B depot', 1], ['A depot', 0]]);
      expect(out[1]).toMatchObject({ lastVisitAt: null, visitsLast30d: 0, openFindings: 0 });
    });

    it('lists every active depot for head office, up to 200', async () => {
      depots.search.mockResolvedValue({ items: [depot()], total: 1 });
      repo.overview.mockResolvedValue([]);
      await svc.overview({ sub: ME, role: Role.HEAD_OFFICE, depotId: null } as never, NOON);
      expect(depots.search).toHaveBeenCalledWith({ page: 1, limit: 200, activeOnly: true });
      expect(repo.overview).toHaveBeenCalledWith([DEPOT], expect.any(Date), '2026-11-27');
    });
  });

  describe('follow-up and sweep', () => {
    it('closes a finding with a trimmed note, inside the scope only', async () => {
      const finding = item({ result: VisitItemResult.FINDING, photoKey: PHOTO });
      repo.findItem.mockResolvedValue(finding);
      repo.closeFollowUp.mockResolvedValue({ ...finding, followUpStatus: FollowUpStatus.DONE });
      const out = await svc.closeFollowUp(ITEM1, '  sudah diganti ', supervisor(), NOON);
      expect(repo.closeFollowUp).toHaveBeenCalledWith(ITEM1, ME, 'sudah diganti', NOON);
      expect(out.followUpStatus).toBe(FollowUpStatus.DONE);
      expect(out.photoUrl).toBe(`https://signed/${PHOTO}`);

      await svc.closeFollowUp(ITEM1, undefined, supervisor(), NOON);
      expect(repo.closeFollowUp).toHaveBeenLastCalledWith(ITEM1, ME, null, NOON);

      await expect(svc.closeFollowUp(ITEM1, 'x', supervisor([DEPOT2]), NOON)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('answers 404 for a line that is not a finding or has gone', async () => {
      repo.findItem.mockResolvedValue(null);
      await expect(svc.closeFollowUp(ITEM1, 'x', supervisor())).rejects.toBeInstanceOf(VisitItemNotFoundError);
      repo.findItem.mockResolvedValue(item({ result: VisitItemResult.PASS }));
      await expect(svc.closeFollowUp(ITEM1, 'x', supervisor())).rejects.toBeInstanceOf(VisitItemNotFoundError);
      repo.findItem.mockResolvedValue(item({ result: VisitItemResult.FINDING }));
      repo.closeFollowUp.mockResolvedValue(null);
      await expect(svc.closeFollowUp(ITEM1, 'x', supervisor())).rejects.toBeInstanceOf(VisitItemNotFoundError);
    });

    it('counts overdue follow-ups against the WIB day', async () => {
      repo.overdueCounts.mockResolvedValue({ depots: 2, items: 5 });
      await expect(svc.overdueSweep(AFTER_MIDNIGHT)).resolves.toEqual({ depots: 2, items: 5 });
      expect(repo.overdueCounts).toHaveBeenCalledWith('2026-11-28');
    });
  });
});

describe('VisitController', () => {
  const svc = {
    start: jest.fn(),
    openOf: jest.fn(),
    overview: jest.fn(),
    findings: jest.fn(),
    closeFollowUp: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    uploadPhoto: jest.fn(),
    answer: jest.fn(),
    complete: jest.fn(),
    overdueSweep: jest.fn(),
  };
  const controller = new VisitController(svc as never);
  const user = { sub: ME } as never;
  const proto = VisitController.prototype;
  const route = (name: keyof VisitController) => [
    Reflect.getMetadata('method', proto[name]),
    Reflect.getMetadata('path', proto[name]),
    Reflect.getMetadata(CAPABILITY_KEY, proto[name]),
  ];

  it('puts each route behind its own capability, method and path', () => {
    // RequestMethod: GET 0, POST 1, PATCH 4
    expect(route('start')).toEqual([1, '/', 'visitConduct']);
    expect(route('mineOpen')).toEqual([0, 'mine/open', 'visitConduct']);
    expect(route('overview')).toEqual([0, 'overview', 'visitRead']);
    expect(route('findings')).toEqual([0, 'findings', 'visitRead']);
    expect(route('closeFollowUp')).toEqual([4, 'findings/:itemId/follow-up', 'visitFollowUp']);
    expect(route('list')).toEqual([0, '/', 'visitRead']);
    expect(route('get')).toEqual([0, ':id', 'visitRead']);
    expect(route('upload')).toEqual([1, ':id/uploads', 'visitConduct']);
    expect(route('answer')).toEqual([4, ':id/items/:itemId', 'visitConduct']);
    expect(route('complete')).toEqual([1, ':id/complete', 'visitConduct']);
  });

  it('declares every static GET before the :id read', () => {
    const names = Object.getOwnPropertyNames(proto);
    for (const s of ['mineOpen', 'overview', 'findings', 'list']) {
      expect(names.indexOf(s)).toBeLessThan(names.indexOf('get'));
    }
  });

  it('delegates each route to the service with the caller', async () => {
    const dto = { depotId: DEPOT } as never;
    await controller.start(dto, user);
    expect(svc.start).toHaveBeenCalledWith(dto, user);
    await controller.mineOpen(user);
    expect(svc.openOf).toHaveBeenCalledWith(ME);
    await controller.overview(user);
    expect(svc.overview).toHaveBeenCalledWith(user);
    await controller.findings({ page: 1, pageSize: 20 } as never, user);
    expect(svc.findings).toHaveBeenCalledWith(user, { page: 1, pageSize: 20 });
    await controller.closeFollowUp(ITEM1, { note: 'ok' }, user);
    expect(svc.closeFollowUp).toHaveBeenCalledWith(ITEM1, 'ok', user);
    await controller.list({ page: 1, pageSize: 20 } as never, user);
    expect(svc.list).toHaveBeenCalledWith(user, { page: 1, pageSize: 20 });
    await controller.get(V, user);
    expect(svc.get).toHaveBeenCalledWith(V, user);
    await controller.answer(V, ITEM1, { result: VisitItemResult.PASS } as never, user);
    expect(svc.answer).toHaveBeenCalledWith(V, ITEM1, { result: VisitItemResult.PASS }, user);
    await controller.complete(V, user);
    expect(svc.complete).toHaveBeenCalledWith(V, user);
  });

  describe('photo upload', () => {
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
    const file = (buffer: Buffer, size = buffer.length) => ({ buffer, size, mimetype: 'image/jpeg' }) as never;

    it('stores a real image and tells the storage its sniffed type', async () => {
      svc.uploadPhoto.mockResolvedValue({ key: PHOTO });
      await expect(controller.upload(V, user, file(JPEG))).resolves.toEqual({ key: PHOTO });
      expect(svc.uploadPhoto).toHaveBeenCalledWith(V, user, { body: JPEG, contentType: 'image/jpeg', ext: 'jpg' });
    });

    it('refuses no file, a PDF, and HTML wearing an image label', async () => {
      svc.uploadPhoto.mockClear();
      await expect(controller.upload(V, user, undefined)).rejects.toThrow('file is required');
      await expect(controller.upload(V, user, file(Buffer.from('%PDF-1.4 fake pdf body')))).rejects.toThrow('unsupported file type');
      await expect(controller.upload(V, user, file(Buffer.from('<html><script>alert(1)</script></html>')))).rejects.toThrow('unsupported file type');
      expect(svc.uploadPhoto).not.toHaveBeenCalled();
    });

    it('refuses a file over 5 MB with 413', async () => {
      await expect(controller.upload(V, user, file(JPEG, 5 * 1024 * 1024 + 1))).rejects.toThrow('file exceeds 5MB');
    });
  });
});

describe('VisitInternalController', () => {
  it('counts the sweep and is open to the internal key only', async () => {
    const svc = { overdueSweep: jest.fn().mockResolvedValue({ depots: 1, items: 2 }) };
    const controller = new VisitInternalController(svc as never);
    await expect(controller.overdueSweep()).resolves.toEqual({ depots: 1, items: 2 });
    const handler = VisitInternalController.prototype.overdueSweep;
    expect(Reflect.getMetadata('method', handler)).toBe(1); // POST
    expect(Reflect.getMetadata('path', handler)).toBe('overdue-sweep');
    expect(Reflect.getMetadata('__guards__', handler).map((g: { name: string }) => g.name)).toEqual(['InternalAuthGuard']);
    expect(Reflect.getMetadata(CAPABILITY_KEY, handler)).toBeUndefined();
  });
});

describe('visit DTOs', () => {
  const props = <T extends object>(cls: new () => T, body: object) =>
    validateSync(plainToInstance(cls, body), { whitelist: true }).map((e) => e.property);
  const base = { depotId: DEPOT, templateId: TPL, lat: -6.2, lng: 106.8 };

  it('bounds the check-in', () => {
    expect(props(StartVisitDto, base)).toEqual([]);
    expect(props(StartVisitDto, { ...base, accuracyM: 12 })).toEqual([]);
    expect(props(StartVisitDto, { ...base, lat: 91 })).toContain('lat');
    expect(props(StartVisitDto, { ...base, lng: -181 })).toContain('lng');
    expect(props(StartVisitDto, { ...base, accuracyM: -1 })).toContain('accuracyM');
    expect(props(StartVisitDto, { ...base, accuracyM: 2_147_483_648 })).toContain('accuracyM');
    expect(props(StartVisitDto, { ...base, depotId: 'x' })).toContain('depotId');
    expect(props(StartVisitDto, { ...base, templateId: undefined })).toContain('templateId');
  });

  it('takes PASS or FINDING with bounded text, a real calendar day and trimmed note', () => {
    expect(props(AnswerVisitItemDto, { result: 'PASS' })).toEqual([]);
    expect(props(AnswerVisitItemDto, { result: 'PENDING' })).toContain('result');
    const finding = { result: 'FINDING', findingNote: 'Licin', photoKey: PHOTO, followUpDueOn: '2026-12-05' };
    expect(props(AnswerVisitItemDto, finding)).toEqual([]);
    expect(props(AnswerVisitItemDto, { ...finding, findingNote: '   ' })).toContain('findingNote');
    expect(props(AnswerVisitItemDto, { ...finding, findingNote: 'a'.repeat(1001) })).toContain('findingNote');
    expect(props(AnswerVisitItemDto, { ...finding, photoKey: 'k'.repeat(201) })).toContain('photoKey');
    expect(props(AnswerVisitItemDto, { ...finding, followUpDueOn: '2026-02-31' })).toContain('followUpDueOn');
    expect(props(AnswerVisitItemDto, { ...finding, followUpDueOn: '5-12-2026' })).toContain('followUpDueOn');
    expect(plainToInstance(AnswerVisitItemDto, { ...finding, findingNote: '  Licin  ' }).findingNote).toBe('Licin');
    expect(plainToInstance(AnswerVisitItemDto, { result: 'PASS', findingNote: 5 }).findingNote).toBe(5);
  });

  it('bounds the follow-up note and the list queries', () => {
    expect(props(CloseFollowUpDto, {})).toEqual([]);
    expect(props(CloseFollowUpDto, { note: 'n'.repeat(1001) })).toContain('note');
    expect(plainToInstance(CloseFollowUpDto, { note: ' ok ' }).note).toBe('ok');

    expect(plainToInstance(ListVisitsQueryDto, {})).toMatchObject({ page: 1, pageSize: 20 });
    expect(props(ListVisitsQueryDto, { page: '2', pageSize: '100', status: 'COMPLETED', depotId: DEPOT })).toEqual([]);
    expect(props(ListVisitsQueryDto, { pageSize: '101' })).toContain('pageSize');
    expect(props(ListVisitsQueryDto, { page: '0' })).toContain('page');
    expect(props(ListVisitsQueryDto, { status: 'NOPE' })).toContain('status');
    expect(props(ListFindingsQueryDto, { state: 'overdue' })).toEqual([]);
    expect(props(ListFindingsQueryDto, { state: 'late' })).toContain('state');
  });
});

// keep the unused-import linter honest about the role enum used for scope fixtures
void Role;

describe('VisitService clock default', () => {
  // Every method that takes "now" falls back to the real clock; pin it so the WIB day is known.
  it('reads today from the system clock when none is passed', async () => {
    jest.useFakeTimers().setSystemTime(NOON);
    try {
      const repo = {
        findById: jest.fn(),
        answerItem: jest.fn().mockResolvedValue(item()),
        complete: jest.fn(),
        findings: jest.fn().mockResolvedValue({ items: [], total: 0 }),
        overview: jest.fn().mockResolvedValue([]),
        findItem: jest.fn().mockResolvedValue(item({ result: VisitItemResult.FINDING })),
        closeFollowUp: jest.fn().mockResolvedValue(item({ result: VisitItemResult.FINDING })),
        overdueCounts: jest.fn().mockResolvedValue({ depots: 0, items: 0 }),
      };
      const depots = { findManyByIds: jest.fn().mockResolvedValue([]), search: jest.fn() };
      const photos = { signedUrl: jest.fn() };
      const s = new VisitService(repo as never, depots as never, {} as never, {} as never, photos as never, {} as never);
      const answered = visit({ items: [item({ result: VisitItemResult.PASS })] });
      repo.findById.mockResolvedValue(answered);
      repo.complete.mockResolvedValue(answered);

      await s.answer(V, ITEM1, { result: VisitItemResult.FINDING, findingNote: 'Licin', photoKey: PHOTO, followUpDueOn: '2026-11-27' }, supervisor());
      await s.complete(V, supervisor());
      expect(repo.complete).toHaveBeenCalledWith(V, NOON);
      await s.findings(supervisor(), { page: 1, pageSize: 20 });
      expect(repo.findings.mock.calls[0][0].todayKey).toBe('2026-11-27');
      await s.overview(supervisor());
      expect(repo.overview.mock.calls[0][2]).toBe('2026-11-27');
      await s.closeFollowUp(ITEM1, undefined, supervisor());
      expect(repo.closeFollowUp).toHaveBeenCalledWith(ITEM1, ME, null, NOON);
      await s.overdueSweep();
      expect(repo.overdueCounts).toHaveBeenCalledWith('2026-11-27');
    } finally {
      jest.useRealTimers();
    }
  });
});
