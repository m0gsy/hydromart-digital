import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthenticatedUser, SNIFFED_MIME, depotScopeIds, localDayKey, sniffFileType } from '@hydromart/platform';

import { can } from '@hydromart/access';
import { audienceMatches, resolveAudience } from '../../domain/announcement';
import { audienceTargets, currentVersion, dayKeyOf, inForce } from '../../domain/sop';
import { DEPOT_DIRECTORY_PORT, DepotDirectoryPort } from '../ports/depot-directory.port';
import { EMPLOYEE_REPOSITORY, EmployeeRepository } from '../ports/employee.repository';
import { NOTIFICATION_PORT, NotificationPort } from '../ports/notification.port';
import {
  SOP_REPOSITORY,
  SopRepository,
  SopVersionRow,
  SopVersionWithDepots,
  SopVersionWrite,
  SopWithVersions,
} from '../ports/sop.repository';
import { STORAGE_PORT, StoragePort } from '../ports/storage.port';

export const MAX_SOP_PDF_BYTES = 10 * 1024 * 1024;

/** Roster read size, and a bound on the loop so a misbehaving `total` cannot spin it forever. */
const ROSTER_PAGE = 1000;
const ROSTER_MAX_PAGES = 100;
const DEPOT_CHECK_CHUNK = 10;

/** A key this service minted: `hr/sop/<uuid>.pdf`. Anything else is another bucket folder. */
const SOP_FILE_KEY = new RegExp('^hr/sop/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]pdf$');

export interface UploadedSopFile {
  buffer: Buffer;
  size: number;
  originalname?: string;
}

export interface SopVersionInput {
  versionTitle?: string;
  body?: string;
  fileKey?: string;
  fileName?: string;
  sizeBytes?: number;
  effectiveFrom: string;
  allDepots: boolean;
  depotIds?: string[];
}

export interface SopVersionView {
  id: string;
  versionNo: number;
  title: string;
  effectiveFrom: string;
  allDepots: boolean;
  depotIds: string[];
  hasFile: boolean;
  fileName: string | null;
  sizeBytes: number | null;
  audienceSize: number;
  ackCount: number;
  /** audienceSize - ackCount, never below zero: the denominator is frozen at publish. */
  unread: number;
  createdAt: Date;
}

export interface SopVersionDetailView extends SopVersionView {
  body: string | null;
}

export interface SopSummaryView {
  id: string;
  title: string;
  createdAt: Date;
  versionCount: number;
  /** Newest version already in effect, if any. */
  current: SopVersionView | null;
  /** A version published for a later day. */
  upcoming: SopVersionView | null;
}

export interface SopDetailView {
  id: string;
  title: string;
  createdAt: Date;
  /** Newest first. */
  versions: SopVersionDetailView[];
}

export interface UnreadPage {
  versionId: string;
  versionNo: number;
  audienceSize: number;
  ackCount: number;
  unreadTotal: number;
  byDepot: { depotId: string | null; unread: number }[];
  page: number;
  pageSize: number;
  items: {
    employeeId: string;
    employeeCode: string;
    fullName: string;
    position: string;
    depotId: string | null;
  }[];
}

/** One SOP as an employee sees it: the version that binds them, and whether they have read it. */
export interface SopMineItem {
  sopId: string;
  sopTitle: string;
  versionId: string;
  versionNo: number;
  title: string;
  effectiveFrom: string;
  hasFile: boolean;
  fileName: string | null;
  acked: boolean;
  ackedAt: Date | null;
}

export interface SopMineDetail extends SopMineItem {
  body: string | null;
}

export interface InForceItem {
  sopId: string;
  versionId: string;
  versionNo: number;
  title: string;
  effectiveFrom: string;
}

/**
 * SOP documents (HD-16). A version is never edited: a correction is a new version, so what
 * staff acknowledged stays answerable. "In force" is a WIB calendar day comparison done in
 * domain/sop.ts, never a UTC cut, or a version dated today would flip at 07:00.
 */
@Injectable()
export class SopService {
  private readonly logger = new Logger(SopService.name);

  constructor(
    @Inject(SOP_REPOSITORY) private readonly repo: SopRepository,
    @Inject(EMPLOYEE_REPOSITORY) private readonly employees: EmployeeRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(DEPOT_DIRECTORY_PORT) private readonly directory: DepotDirectoryPort,
    @Optional() @Inject(NOTIFICATION_PORT) private readonly notifications?: NotificationPort,
  ) {}

  // -- writing ---------------------------------------------------------

  async upload(file: UploadedSopFile | undefined): Promise<{ fileKey: string; fileName: string; sizeBytes: number }> {
    if (!file) throw new BadRequestException('File SOP wajib diunggah');
    // The multipart Content-Type is whatever the caller typed; the bytes decide.
    if (sniffFileType(file.buffer) !== 'pdf') {
      throw new BadRequestException('File SOP harus berupa PDF');
    }
    if (file.size > MAX_SOP_PDF_BYTES) throw new PayloadTooLargeException('Ukuran file melebihi 10MB');
    let stored: { url: string; key: string };
    try {
      stored = await this.storage.put({
        body: file.buffer,
        contentType: SNIFFED_MIME.pdf,
        ext: 'pdf',
        keyPrefix: 'hr/sop',
      });
    } catch (error) {
      this.logger.error(`SOP upload failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Penyimpanan dokumen sedang tidak tersedia. Coba lagi sebentar lagi.');
    }
    if (!stored.url) throw new ServiceUnavailableException('Penyimpanan dokumen belum dikonfigurasi');
    return {
      fileKey: stored.key,
      fileName: (file.originalname ?? 'sop.pdf').slice(0, 200),
      sizeBytes: file.size,
    };
  }

  async create(user: AuthenticatedUser, title: string, input: SopVersionInput): Promise<SopDetailView> {
    const { write, audience } = await this.prepare(user, input.versionTitle?.trim() || title, input);
    const created = await this.repo.create(title, user.sub, write);
    await this.announce(audience, title, 1, input.effectiveFrom);
    return this.detail(created);
  }

  async addVersion(user: AuthenticatedUser, sopId: string, input: SopVersionInput): Promise<SopDetailView> {
    const sop = await this.get(sopId);
    const { write, audience } = await this.prepare(user, input.versionTitle?.trim() || sop.title, input);
    // Two writers racing for the same number: the unique (sopId, versionNo) lets one win; the
    // other re-reads the maximum and takes the next. A second collision is a 409, not a loop.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (!(await this.repo.addVersion(sopId, write))) throw new NotFoundException('SOP tidak ditemukan');
        const out = await this.detail(await this.get(sopId));
        await this.announce(audience, sop.title, out.versions[0]!.versionNo, input.effectiveFrom);
        return out;
      } catch (error) {
        if ((error as { code?: string })?.code !== 'P2002') throw error;
      }
    }
    throw new ConflictException('Versi SOP baru sedang dibuat oleh orang lain. Coba lagi.');
  }

  // -- reading ---------------------------------------------------------

  async list(): Promise<SopSummaryView[]> {
    const sops = await this.repo.list();
    const acks = await this.repo.countAcks(sops.flatMap((s) => s.versions.map((v) => v.id)));
    const today = localDayKey(new Date());
    return sops.map((sop) => {
      const shaped = sop.versions.map((v) => ({ v, ...SopService.shape(v) }));
      const current = currentVersion(shaped, today);
      const upcoming = shaped.filter((s) => s.effectiveFrom > today).sort((a, b) => b.versionNo - a.versionNo)[0];
      return {
        id: sop.id,
        title: sop.title,
        createdAt: sop.createdAt,
        versionCount: sop.versions.length,
        current: current ? SopService.view(current.v, acks.get(current.v.id) ?? 0) : null,
        upcoming: upcoming ? SopService.view(upcoming.v, acks.get(upcoming.v.id) ?? 0) : null,
      };
    });
  }

  async getById(id: string): Promise<SopDetailView> {
    return this.detail(await this.get(id));
  }

  /**
   * Employees who must read a version and have not, narrowed to the depots the reader may
   * see. The audience is resolved NOW from active staff (a leaver stops being chased), while
   * `audienceSize` stays the number frozen at publish.
   */
  async unread(
    user: AuthenticatedUser,
    versionId: string,
    opts: { depotId?: string; page?: number; pageSize?: number },
  ): Promise<UnreadPage> {
    const version = await this.repo.findVersion(versionId);
    if (!version) throw new NotFoundException('Versi SOP tidak ditemukan');
    const scope = depotScopeIds(user, opts.depotId);
    const rows = await this.activeRoster();
    const acked = new Set(await this.repo.listAckedEmployeeIds(versionId));
    // Only audience members the caller may see: acks of leavers or of other depots would not
    // reconcile with the unread list beside them.
    const inScope = resolveAudience(audienceTargets(SopService.shape(version)), rows).filter(
      (e) => !scope || (!!e.depotId && scope.includes(e.depotId)),
    );
    const unread = inScope.filter((e) => !acked.has(e.id));

    const perDepot = new Map<string | null, number>();
    for (const e of unread) perDepot.set(e.depotId, (perDepot.get(e.depotId) ?? 0) + 1);
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 50;
    return {
      versionId,
      versionNo: version.versionNo,
      audienceSize: version.audienceSize,
      ackCount: inScope.length - unread.length,
      unreadTotal: unread.length,
      byDepot: [...perDepot].map(([depotId, count]) => ({ depotId, unread: count })),
      page,
      pageSize,
      items: unread.slice((page - 1) * pageSize, page * pageSize).map((e) => ({
        employeeId: e.id,
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        position: e.position,
        depotId: e.depotId,
      })),
    };
  }

  /** depot-service's lookup: which version of each SOP binds this depot today. */
  async inForceFor(depotId: string, sopIds: readonly string[], now = new Date()): Promise<{ items: InForceItem[] }> {
    const today = localDayKey(now);
    const bySop = new Map<string, SopVersionWithDepots[]>();
    for (const v of await this.repo.listVersions(sopIds)) bySop.set(v.sopId, [...(bySop.get(v.sopId) ?? []), v]);
    const items: InForceItem[] = [];
    for (const [sopId, versions] of bySop) {
      const hit = inForce(
        versions.map((v) => ({ v, ...SopService.shape(v) })),
        depotId,
        today,
      );
      if (hit) {
        items.push({
          sopId,
          versionId: hit.v.id,
          versionNo: hit.versionNo,
          title: hit.v.title,
          effectiveFrom: hit.effectiveFrom,
        });
      }
    }
    return { items };
  }

  // -- the employee's own side -----------------------------------------

  /** The version of each SOP that binds this employee today (their depot and the one they are lent from). */
  async mine(user: AuthenticatedUser, now = new Date()): Promise<SopMineItem[]> {
    const employee = await this.self(user);
    const today = localDayKey(now);
    const depots = [employee.depotId, employee.homeDepotId].filter((d): d is string => !!d);
    // Above any depot: only a version for every depot reaches them ('' names no depot).
    const probes = depots.length > 0 ? depots : [''];
    const picked = new Map<string, { v: SopVersionRow; sopTitle: string }>();
    for (const sop of await this.repo.list()) {
      const shaped = sop.versions.map((v) => ({ v, ...SopService.shape(v) }));
      for (const depotId of probes) {
        const hit = inForce(shaped, depotId, today);
        if (hit) picked.set(hit.v.id, { v: hit.v, sopTitle: sop.title });
      }
    }
    const acks = await this.repo.ackedAt(employee.id, [...picked.keys()]);
    return [...picked.values()].map(({ v, sopTitle }) => SopService.mineItem(v, sopTitle, acks.get(v.id)));
  }

  async versionForSelf(user: AuthenticatedUser, versionId: string): Promise<SopMineDetail> {
    const { employee, version } = await this.readable(user, versionId);
    const acks = await this.repo.ackedAt(employee.id, [versionId]);
    return { ...SopService.mineItem(version, version.sop.title, acks.get(versionId)), body: version.body };
  }

  /** The PDF itself. Head office and HR (sopRead) may open any version; staff only their own. */
  async fileForSelf(user: AuthenticatedUser, versionId: string): Promise<{ body: Buffer; fileName: string }> {
    const version = can('sopRead', user.role)
      ? await this.repo.findVersion(versionId)
      : (await this.readable(user, versionId)).version;
    if (!version?.fileKey) throw new NotFoundException('File SOP tidak ditemukan');
    const object = await this.storage.getObject(version.fileKey);
    return { body: object.body, fileName: version.fileName ?? 'sop.pdf' };
  }

  /** "Sudah dibaca". Idempotent; a version that does not reach this employee is 404, not a receipt. */
  async ack(user: AuthenticatedUser, versionId: string): Promise<{ ackedAt: Date }> {
    const { employee } = await this.readable(user, versionId);
    return this.repo.ack(versionId, employee.id);
  }

  // -- internals -------------------------------------------------------

  private async self(user: AuthenticatedUser) {
    const employee = await this.employees.findByAuthSubjectId(user.sub);
    if (!employee) throw new NotFoundException('Akun ini belum tertaut ke data karyawan');
    return employee;
  }

  private async readable(user: AuthenticatedUser, versionId: string) {
    const employee = await this.self(user);
    const version = await this.repo.findVersion(versionId);
    if (!version || !audienceMatches(audienceTargets(SopService.shape(version)), employee)) {
      throw new NotFoundException('SOP tidak ditemukan');
    }
    return { employee, version };
  }

  private static mineItem(v: SopVersionRow, sopTitle: string, ackedAt: Date | undefined): SopMineItem {
    return {
      sopId: v.sopId,
      sopTitle,
      versionId: v.id,
      versionNo: v.versionNo,
      title: v.title,
      effectiveFrom: dayKeyOf(v.effectiveFrom),
      hasFile: !!v.fileKey,
      fileName: v.fileName,
      acked: !!ackedAt,
      ackedAt: ackedAt ?? null,
    };
  }

  /**
   * The publish notice rides the announcement path (HR_ANNOUNCEMENT), once per person with a login.
   * Fail-open: a notification outage must not undo a SOP that is already saved.
   */
  private async announce(
    people: readonly { phone: string; authSubjectId: string | null }[],
    title: string,
    versionNo: number,
    effectiveFrom: string,
  ): Promise<void> {
    if (!this.notifications) return;
    const vars = {
      title: `SOP baru: ${title} (versi ${versionNo})`,
      body: `Berlaku mulai ${effectiveFrom}. Buka menu SOP, baca, lalu tandai sudah dibaca.`,
      level: 'INFO',
    };
    for (const person of people) {
      if (!person.authSubjectId) continue;
      try {
        await this.notifications.notify('HR_ANNOUNCEMENT', person.phone, vars, person.authSubjectId);
      } catch (error) {
        this.logger.warn(`SOP notice not sent: ${(error as Error).message}`);
      }
    }
  }

  private async get(id: string): Promise<SopWithVersions> {
    const sop = await this.repo.findById(id);
    if (!sop) throw new NotFoundException('SOP tidak ditemukan');
    return sop;
  }

  private async detail(sop: SopWithVersions): Promise<SopDetailView> {
    const acks = await this.repo.countAcks(sop.versions.map((v) => v.id));
    return {
      id: sop.id,
      title: sop.title,
      createdAt: sop.createdAt,
      versions: sop.versions.map((v) => ({ ...SopService.view(v, acks.get(v.id) ?? 0), body: v.body })),
    };
  }

  private static shape(v: SopVersionRow) {
    return {
      versionNo: v.versionNo,
      effectiveFrom: dayKeyOf(v.effectiveFrom),
      allDepots: v.allDepots,
      depotIds: v.depots.map((d) => d.depotId),
    };
  }

  private static view(v: SopVersionRow, ackCount: number): SopVersionView {
    return {
      id: v.id,
      versionNo: v.versionNo,
      title: v.title,
      effectiveFrom: dayKeyOf(v.effectiveFrom),
      allDepots: v.allDepots,
      depotIds: v.depots.map((d) => d.depotId),
      hasFile: !!v.fileKey,
      fileName: v.fileName,
      sizeBytes: v.sizeBytes,
      audienceSize: v.audienceSize,
      ackCount,
      unread: Math.max(0, v.audienceSize - ackCount),
      createdAt: v.createdAt,
    };
  }

  /** Every active employee, page by page: an audience is never silently cut short. */
  private async activeRoster() {
    const all = [];
    for (let page = 0; page < ROSTER_MAX_PAGES; page += 1) {
      const { rows, total } = await this.employees.list({ status: 'ACTIVE', skip: all.length, take: ROSTER_PAGE });
      all.push(...rows);
      if (rows.length === 0 || all.length >= total) return all;
    }
    this.logger.warn(`roster not fully read after ${ROSTER_MAX_PAGES} pages`);
    return all;
  }

  /** A depot id typed wrong would cover nobody and say nothing. depot-service 404 = unknown. */
  private async assertDepotsExist(depotIds: readonly string[]): Promise<void> {
    // Chunks of 10: a 200-depot list must not open 200 sockets to depot-service at once.
    for (let i = 0; i < depotIds.length; i += DEPOT_CHECK_CHUNK) {
      const unknown = await Promise.all(
        depotIds.slice(i, i + DEPOT_CHECK_CHUNK).map((id) =>
          this.directory.isActive(id).then(
            () => false,
            (error: unknown) => {
              if (error instanceof NotFoundException) return true;
              throw error;
            },
          ),
        ),
      );
      if (unknown.some(Boolean)) throw new BadRequestException('Ada depot yang tidak dikenal');
    }
  }

  /** Validate one version's input and freeze its audience. */
  private async prepare(user: AuthenticatedUser, title: string, input: SopVersionInput,
  ): Promise<{ write: SopVersionWrite; audience: Awaited<ReturnType<SopService['activeRoster']>> }> {
    const depotIds = [...new Set(input.depotIds ?? [])];
    if (input.allDepots === depotIds.length > 0) {
      throw new BadRequestException('Pilih semua depot, atau sebutkan depotnya, tidak keduanya');
    }
    const effectiveFrom = new Date(`${input.effectiveFrom}T00:00:00.000Z`);
    if (Number.isNaN(effectiveFrom.getTime()) || dayKeyOf(effectiveFrom) !== input.effectiveFrom) {
      throw new BadRequestException('Tanggal berlaku bukan tanggal yang sah');
    }
    // Backdating would make a version "already in force" for people who never saw it.
    if (input.effectiveFrom < localDayKey(new Date())) {
      throw new BadRequestException('Tanggal berlaku tidak boleh sebelum hari ini');
    }
    const body = input.body?.trim() || null;
    if (!body && !input.fileKey) throw new BadRequestException('Isi SOP atau file PDF wajib diisi');
    if (input.fileKey && !SOP_FILE_KEY.test(input.fileKey)) {
      throw new BadRequestException('File SOP tidak dikenali. Unggah ulang PDF-nya');
    }

    await this.assertDepotsExist(depotIds);
    const rows = await this.activeRoster();
    const audience = resolveAudience(audienceTargets({ allDepots: input.allDepots, depotIds }), rows);
    const write: SopVersionWrite = {
      title,
      body,
      fileKey: input.fileKey ?? null,
      fileName: input.fileKey ? (input.fileName ?? 'sop.pdf') : null,
      sizeBytes: input.fileKey ? (input.sizeBytes ?? null) : null,
      effectiveFrom,
      allDepots: input.allDepots,
      depotIds,
      audienceSize: audience.length,
      publishedBy: user.sub,
    };
    return { write, audience };
  }
}
