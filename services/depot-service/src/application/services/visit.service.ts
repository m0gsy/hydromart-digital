import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AuthenticatedUser,
  addLocalDays,
  assertDepotAccess,
  depotScopeIds,
  geofenceEnabled,
  isApproximateFix,
  localDayKey,
  withinGeofence,
} from '@hydromart/platform';

import { DepotConfigService } from '../../config/depot-config.service';
import {
  DepotNotFoundError,
  InvalidFindingError,
  VisitAccuracyMissingError,
  VisitAlreadyOpenError,
  VisitClosedError,
  VisitDepotClosedError,
  VisitIncompleteError,
  VisitItemNotFoundError,
  VisitNotFoundError,
  VisitNoLocationError,
  VisitNotYoursError,
  VisitOutsideAreaError,
  VisitPhotoNotConfiguredError,
  VisitPhotoUnavailableError,
  VisitTemplateNotFoundError,
  VisitUploadLimitError,
} from '../../domain/errors';
import {
  FollowUpStatus,
  MAX_UPLOADS_PER_ITEM,
  Visit,
  VisitItem,
  VisitItemResult,
  VisitStatus,
  dueDayInWindow,
  photoKeyPattern,
} from '../../domain/visit';
import { SopInForce } from '../../domain/visit-template';
import { DepotRepository } from '../ports/depot.repository';
import { VisitNotifierPort } from '../ports/visit-notifier.port';
import { SopLookupPort } from '../ports/sop-lookup.port';
import { VisitPhotoStoragePort } from '../ports/visit-photo-storage.port';
import {
  DepotVisitStat,
  FindingState,
  VisitRepository,
  VisitSummary,
} from '../ports/visit.repository';
import { VisitTemplateRepository } from '../ports/visit-template.repository';
import { DEPOT_TOKENS } from '../tokens';

/** The depot name a notice carries: crm refuses an empty one or one over 120 characters, so clamp and fall back to the id. */
function noticeName(name: string | null | undefined, depotId: string): string {
  return (name?.trim() || depotId).slice(0, 120);
}

/** One checklist line as a notice names it: the line, then what was found (200 characters at most). */
function lineOf(text: string, note: string | null): string {
  return (note ? `${text}: ${note}` : text).slice(0, 200);
}

/** How long a signed photo link lives. Minted per response, never stored. */
export const PHOTO_LINK_TTL_SECONDS = 300;
const PAGE_MAX = 100;
const OVERVIEW_MAX_DEPOTS = 200;
/** Lines in one notice (crm's cap), and overdue follow-ups read per sweep (the rest wait for tomorrow). */
const NOTICE_LINES = 30;
const SWEEP_READ_MAX = 500; // depots per sweep
/**
 * A depot is reminded again every 3 days. An hour short of 72, so the daily 07:30 run is never a
 * day late because last time's stamp landed a few seconds after today's threshold.
 */
const REMIND_AFTER_MS = (3 * 24 - 1) * 3_600_000;

export interface StartVisitInput {
  depotId: string;
  templateId: string;
  lat: number;
  lng: number;
  /** Required: a check-in that omits it would skip the accuracy / "Perkiraan" rule. */
  accuracyM: number;
}

export interface AnswerInput {
  result: VisitItemResult.PASS | VisitItemResult.FINDING;
  findingNote?: string;
  photoKey?: string;
  followUpDueOn?: string;
}

export interface VisitItemView extends VisitItem {
  /** A link that expires in a few minutes, or null when the line has no photo. */
  photoUrl: string | null;
}

export type VisitView = Omit<Visit, 'items'> & { items: VisitItemView[] };

export interface DepotOverview extends DepotVisitStat {
  depotName: string;
}

/** `truncated`: more depots are in scope than the 200 listed. */
export interface VisitOverview {
  depots: DepotOverview[];
  truncated: boolean;
}

const REFUSAL_APPROXIMATE =
  'Lokasi HP masih "Perkiraan" (bisa meleset sampai ±2 km), jadi kunjungan tidak bisa dimulai. ' +
  'Buka Setelan HP → Aplikasi → Hydromart → Izin → Lokasi, nyalakan "Gunakan lokasi akurat" (Tepat), ' +
  'nyalakan GPS, lalu coba lagi.';

/**
 * HD-15B PR-4: a supervisor's visit to a depot. Check-in must be inside the depot's visit radius
 * (refused outside, online only: a visit has no payroll value to hold for review). The checklist is
 * copied from the template at check-in, text and SOP version by value, and never points back at it.
 */
@Injectable()
export class VisitService {
  private readonly logger = new Logger(VisitService.name);

  constructor(
    @Inject(DEPOT_TOKENS.VisitRepository) private readonly visits: VisitRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
    @Inject(DEPOT_TOKENS.VisitTemplateRepository)
    private readonly templates: VisitTemplateRepository,
    @Inject(DEPOT_TOKENS.SopLookup) private readonly sops: SopLookupPort,
    @Inject(DEPOT_TOKENS.VisitPhotoStorage) private readonly photos: VisitPhotoStoragePort,
    private readonly config: DepotConfigService,
    @Inject(DEPOT_TOKENS.VisitNotifier) private readonly notifier: VisitNotifierPort,
  ) {}

  /** The caller's own unfinished visits, so the app can resume one after a refusal or a restart. */
  openOf(visitorId: string): Promise<Visit[]> {
    return this.visits.findOpenOf(visitorId);
  }

  async start(input: StartVisitInput, user: AuthenticatedUser): Promise<Visit> {
    assertDepotAccess(user, input.depotId);
    const depot = await this.depots.findById(input.depotId, false);
    if (!depot) throw new DepotNotFoundError();
    if (!depot.active) throw new VisitDepotClosedError();
    const template = await this.templates.findById(input.templateId);
    if (!template || !template.active) throw new VisitTemplateNotFoundError();

    if (!Number.isFinite(input.accuracyM) || input.accuracyM < 0) throw new VisitAccuracyMissingError();
    const open = (await this.visits.findOpenOf(user.sub)).find((v) => v.depotId === depot.id);
    if (open) throw new VisitAlreadyOpenError(open.id);

    // A depot still on the 0,0 placeholder has no centre: a visit from anywhere would look valid, so
    // it is refused. (Radius 0 is the explicit, per-depot "off" and is flagged on the visit instead.)
    const hasCentre =
      Number.isFinite(depot.lat) && Number.isFinite(depot.lng) && !(depot.lat === 0 && depot.lng === 0);
    if (!hasCentre) throw new VisitNoLocationError();
    const fence = { lat: depot.lat, lng: depot.lng, radiusM: this.config.visitCheckInRadiusM(depot.id) };
    const fenceChecked = geofenceEnabled(fence);
    const { ok, distanceM } = withinGeofence(fence, input.lat, input.lng);
    const approximate = isApproximateFix(input.lat, input.lng, input.accuracyM);
    // With the fence on, a fix that cannot prove presence is refused even when it lands inside: an
    // approximate one (about 2 km off) or one whose own accuracy is wider than the radius.
    const tooLoose =
      fenceChecked && (approximate || input.accuracyM > fence.radiusM);
    if (tooLoose || !ok) {
      // What is asked about afterwards; never the coordinates themselves.
      this.logger.warn(
        `Visit refused: visitor ${user.sub}, depot ${depot.id}, ${distanceM} m, radius ${fence.radiusM} m, ` +
          `accuracy ${input.accuracyM} m, approximate ${approximate}, outside ${!ok}`,
      );
      throw new VisitOutsideAreaError(
        tooLoose
          ? REFUSAL_APPROXIMATE
          : `Di luar area depot (${distanceM} m dari titik, batas ${fence.radiusM} m). ` +
              'Kunjungan harus dimulai di lokasi. Kalau sudah di sana, lokasi HP belum akurat: ' +
              'di izin lokasi aplikasi pilih "Tepat" (bukan "Perkiraan"), nyalakan GPS, tunggu sebentar, lalu coba lagi.',
      );
    }

    const inForce = await this.sopsInForce(depot.id, template.items.map((i) => i.sopId));
    return this.visits.create({
      depotId: depot.id,
      templateId: template.id,
      templateName: template.name,
      visitorId: user.sub,
      lat: input.lat,
      lng: input.lng,
      accuracyM: input.accuracyM,
      distanceM,
      approximateFix: approximate,
      fenceChecked,
      items: template.items.map((i) => {
        const sop = i.sopId ? inForce.get(i.sopId) : undefined;
        return {
          position: i.position,
          text: i.text,
          sopId: i.sopId,
          sopVersionId: sop?.versionId ?? null,
          sopVersionNo: sop?.versionNo ?? null,
          sopTitle: sop?.title ?? null,
        };
      }),
    });
  }

  /** hr down or unconfigured never blocks a visit: the lines just carry no SOP version. */
  private async sopsInForce(
    depotId: string,
    sopIds: readonly (string | null)[],
  ): Promise<Map<string, SopInForce>> {
    const ids = [...new Set(sopIds.filter((s): s is string => s !== null))];
    if (ids.length === 0) return new Map();
    const found = await this.sops.inForce(depotId, ids);
    if (found === null) this.logger.warn('SOP versions not snapshotted: hr-service unavailable');
    return new Map((found ?? []).map((f) => [f.sopId, f]));
  }

  /**
   * The caller's own, still-open visit: photos, answers and completion are the visitor's alone.
   * Callers also assert the depot, so a supervisor moved off a depot cannot finish a visit there.
   */
  private async openOwn(visitId: string, userId: string): Promise<Visit> {
    const visit = await this.visits.findById(visitId);
    if (!visit) throw new VisitNotFoundError();
    if (visit.visitorId !== userId) throw new VisitNotYoursError();
    if (visit.status !== VisitStatus.IN_PROGRESS) throw new VisitClosedError();
    return visit;
  }

  async uploadPhoto(
    visitId: string,
    user: AuthenticatedUser,
    file: { body: Buffer; contentType: string; ext: string },
  ): Promise<{ key: string }> {
    const visit = await this.openOwn(visitId, user.sub);
    assertDepotAccess(user, visit.depotId);
    // Counted before the put, so a stuck client retrying forever hits the cap, not the bucket.
    if (!(await this.visits.reserveUpload(visitId, visit.items.length * MAX_UPLOADS_PER_ITEM))) {
      throw new VisitUploadLimitError();
    }
    try {
      return await this.photos.put({ visitId, ...file });
    } catch (error) {
      await this.visits.releaseUpload(visitId).catch(() => undefined);
      if (error instanceof VisitPhotoNotConfiguredError) throw error;
      this.logger.error(`Visit photo upload failed: ${(error as Error).message}`);
      throw new VisitPhotoUnavailableError();
    }
  }

  async answer(
    visitId: string,
    itemId: string,
    input: AnswerInput,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<VisitItemView> {
    const visit = await this.openOwn(visitId, user.sub);
    assertDepotAccess(user, visit.depotId);
    if (!visit.items.some((i) => i.id === itemId)) throw new VisitItemNotFoundError();

    let saved: VisitItem | null;
    if (input.result === VisitItemResult.PASS) {
      // A pass clears whatever a earlier answer left behind.
      saved = await this.visits.answerItem(visitId, itemId, {
        result: VisitItemResult.PASS,
        findingNote: null,
        photoKey: null,
        followUpDueOn: null,
        followUpStatus: null,
      });
    } else {
      const note = input.findingNote?.trim() ?? '';
      if (note.length < 3) throw new InvalidFindingError('Catatan temuan wajib diisi.');
      if (!input.photoKey || !photoKeyPattern(visitId).test(input.photoKey)) {
        throw new InvalidFindingError('Foto temuan wajib, dan harus diunggah lewat kunjungan ini.');
      }
      const key = input.photoKey;
      if (visit.items.some((i) => i.id !== itemId && i.photoKey === key)) {
        throw new InvalidFindingError('Foto ini sudah dipakai butir lain. Ambil foto untuk butir ini.');
      }
      if (!input.followUpDueOn || !dueDayInWindow(input.followUpDueOn, now)) {
        throw new InvalidFindingError(
          'Tenggat tindak lanjut wajib, paling cepat hari ini dan paling lambat 90 hari lagi.',
        );
      }
      await this.assertPhotoThere(key);
      saved = await this.visits.answerItem(visitId, itemId, {
        result: VisitItemResult.FINDING,
        findingNote: note,
        photoKey: input.photoKey,
        followUpDueOn: input.followUpDueOn,
        followUpStatus: FollowUpStatus.OPEN,
      });
    }
    if (!saved) throw new VisitClosedError();
    await this.dropReplacedPhoto(visit.items.find((i) => i.id === itemId)?.photoKey, saved.photoKey);
    return this.withPhoto(saved);
  }

  /** A key that was never uploaded (or was lost) must not be saved as a finding's proof. */
  private async assertPhotoThere(key: string): Promise<void> {
    let there: boolean;
    try {
      there = await this.photos.exists(key);
    } catch (error) {
      if (error instanceof VisitPhotoNotConfiguredError) throw error;
      this.logger.error(`Visit photo check failed: ${(error as Error).message}`);
      throw new VisitPhotoUnavailableError();
    }
    if (!there) throw new InvalidFindingError('Foto belum terunggah. Unggah fotonya dulu, lalu simpan temuan.');
  }

  /** A retake or a switch to PASS leaves the old photo orphaned: delete it, and only log if that fails. */
  private async dropReplacedPhoto(before: string | null | undefined, after: string | null): Promise<void> {
    if (!before || before === after) return;
    try {
      await this.photos.remove(before);
    } catch (error) {
      this.logger.warn(`Replaced visit photo not deleted: ${(error as Error).message}`);
    }
  }

  async complete(visitId: string, user: AuthenticatedUser, now: Date = new Date()): Promise<VisitView> {
    const visit = await this.openOwn(visitId, user.sub);
    assertDepotAccess(user, visit.depotId);
    const pending = visit.items.filter((i) => i.result === VisitItemResult.PENDING).length;
    if (pending > 0) throw new VisitIncompleteError(pending);
    const done = await this.visits.complete(visitId, now);
    if (!done) throw new VisitClosedError();
    this.noticeFindings(done);
    return this.withPhotos(done);
  }

  /**
   * HD-15B PR-6: a completed visit with findings tells the depot's Kepala, the supervisors over it and
   * HQ (crm). Fire-and-forget after the commit and fail-open: a notice never fails the visit.
   * Off unless VISIT_NOTIFY_ENABLED.
   */
  private noticeFindings(visit: Visit): void {
    if (!this.config.visitNotifyEnabled) return;
    const items = visit.items
      .filter((i) => i.result === VisitItemResult.FINDING)
      .map((i) => lineOf(i.text, i.findingNote));
    if (items.length === 0) return;
    void this.depots
      .findById(visit.depotId, false)
      .then((depot) =>
        this.notifier.notify({
          kind: 'FINDING',
          depotId: visit.depotId,
          depotName: noticeName(depot?.name, visit.depotId),
          visitId: visit.id,
          dateKey: localDayKey(visit.completedAt ?? new Date()),
          items: items.slice(0, NOTICE_LINES),
        }),
      )
      .catch((e: Error) => this.logger.warn(`Visit ${visit.id} finding notice not sent: ${e.message}`));
  }

  async get(visitId: string, user: AuthenticatedUser): Promise<VisitView> {
    const visit = await this.visits.findById(visitId);
    if (!visit) throw new VisitNotFoundError();
    assertDepotAccess(user, visit.depotId);
    return this.withPhotos(visit);
  }

  async list(
    user: AuthenticatedUser,
    q: { depotId?: string; status?: VisitStatus; page: number; pageSize: number },
  ): Promise<{ items: VisitSummary[]; total: number; page: number; pageSize: number }> {
    const pageSize = Math.min(q.pageSize, PAGE_MAX);
    const { items, total } = await this.visits.list({
      depotIds: depotScopeIds(user, q.depotId),
      status: q.status,
      page: q.page,
      pageSize,
    });
    return { items, total, page: q.page, pageSize };
  }

  async findings(
    user: AuthenticatedUser,
    q: { depotId?: string; state?: FindingState; page: number; pageSize: number },
    now: Date = new Date(),
  ): Promise<{ items: VisitItemView[]; total: number; page: number; pageSize: number }> {
    const pageSize = Math.min(q.pageSize, PAGE_MAX);
    const { items, total } = await this.visits.findings({
      depotIds: depotScopeIds(user, q.depotId),
      state: q.state,
      todayKey: localDayKey(now),
      page: q.page,
      pageSize,
    });
    return { items: await Promise.all(items.map((i) => this.withPhoto(i))), total, page: q.page, pageSize };
  }

  /** Every depot in the caller's scope with its visit numbers, overdue first. */
  async overview(user: AuthenticatedUser, now: Date = new Date()): Promise<VisitOverview> {
    const scope = depotScopeIds(user);
    let records;
    let truncated: boolean;
    if (scope) {
      truncated = scope.length > OVERVIEW_MAX_DEPOTS;
      records = await this.depots.findManyByIds([...scope].slice(0, OVERVIEW_MAX_DEPOTS), true);
    } else {
      const found = await this.depots.search({ page: 1, limit: OVERVIEW_MAX_DEPOTS, activeOnly: true });
      truncated = found.total > OVERVIEW_MAX_DEPOTS;
      records = found.items;
    }
    const stats = new Map(
      (
        await this.visits.overview(
          records.map((d) => d.id),
          addLocalDays(now, -30),
          localDayKey(now),
        )
      ).map((s) => [s.depotId, s]),
    );
    const depots = records
      .map((d) => ({
        depotId: d.id,
        depotName: d.name,
        lastVisitAt: null,
        visitsLast30d: 0,
        unfencedVisitsLast30d: 0,
        openFindings: 0,
        overdueFollowUps: 0,
        ...stats.get(d.id),
      }))
      .sort((a, b) => b.overdueFollowUps - a.overdueFollowUps || a.depotName.localeCompare(b.depotName));
    return { depots, truncated };
  }

  /** Marks a finding's follow-up done, with a note. Idempotent: a second call changes nothing. */
  async closeFollowUp(
    itemId: string,
    note: string | undefined,
    user: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<VisitItemView> {
    const item = await this.visits.findItem(itemId);
    if (!item || item.result !== VisitItemResult.FINDING) throw new VisitItemNotFoundError();
    assertDepotAccess(user, item.depotId);
    const closed = await this.visits.closeFollowUp(itemId, user.sub, note?.trim() || null, now);
    if (!closed) throw new VisitItemNotFoundError();
    return this.withPhoto(closed);
  }

  /**
   * The overdue follow-ups, counted; and, when VISIT_NOTIFY_ENABLED, one notice per depot for the ones
   * nobody was reminded of in the last 3 days. A follow-up is stamped only once crm took the notice, so
   * a failed call is retried by tomorrow's run. At most NOTICE_LINES per depot per run (the rest go
   * out the next day) and SWEEP_READ_MAX depots per run. One depot failing never stops the next.
   */
  async overdueSweep(now: Date = new Date()): Promise<{ depots: number; items: number; notified: number }> {
    const todayKey = localDayKey(now);
    const counts = await this.visits.overdueCounts(todayKey);
    if (!this.config.visitNotifyEnabled || counts.items === 0) return { ...counts, notified: 0 };
    const due = await this.visits.overdueToRemind(
      todayKey,
      new Date(now.getTime() - REMIND_AFTER_MS),
      NOTICE_LINES,
      SWEEP_READ_MAX,
    );
    const byDepot = new Map<string, typeof due>();
    for (const f of due) byDepot.set(f.depotId, [...(byDepot.get(f.depotId) ?? []), f]);
    let notified = 0;
    for (const [depotId, found] of byDepot) {
      const sent = found.slice(0, NOTICE_LINES);
      try {
        const ok = await this.notifier.notify({
          kind: 'OVERDUE',
          depotId,
          depotName: noticeName(sent[0].depotName, depotId),
          dateKey: todayKey,
          items: sent.map((f) => lineOf(f.text, f.findingNote)),
        });
        if (!ok) continue;
        await this.visits.stampOverdueNotice(sent.map((f) => f.id), now);
        notified += 1;
      } catch (e) {
        this.logger.warn(`Overdue notice for depot ${depotId} failed: ${(e as Error).message}`);
      }
    }
    return { ...counts, notified };
  }

  private async withPhoto(item: VisitItem): Promise<VisitItemView> {
    let photoUrl: string | null = null;
    if (item.photoKey) {
      try {
        photoUrl = await this.photos.signedUrl(item.photoKey, PHOTO_LINK_TTL_SECONDS);
      } catch (error) {
        // A link that cannot be made hides the picture, not the visit.
        this.logger.warn(`Visit photo link not made: ${(error as Error).message}`);
      }
    }
    return { ...item, photoUrl };
  }

  private async withPhotos(visit: Visit): Promise<VisitView> {
    return { ...visit, items: await Promise.all(visit.items.map((i) => this.withPhoto(i))) };
  }
}
