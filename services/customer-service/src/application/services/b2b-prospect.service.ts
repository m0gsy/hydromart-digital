import { ForbiddenException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import {
  AuthenticatedUser,
  assertDepotAccess,
  depotScopeIds,
  gridCell1km,
  localDayKey,
  normalizeIdPhone,
  recordAuditEvent,
} from '@hydromart/platform';

import { CustomerConfigService } from '../../config/customer-config.service';
import {
  B2bCategory,
  B2bDncReason,
  B2bProspectStatus,
  B2bSource,
  ProspectRecord,
} from '../../domain/b2b-prospect';
import { dncHash, neighbourCells, normaliseName } from '../../domain/b2b-prospect-keys';
import { canSetByHand, isTerminal } from '../../domain/b2b-prospect-status';
import {
  ProspectInvalidError,
  ProspectNotFoundError,
  ProspectRefusedError,
  ProspectStaleError,
  ProspectTransitionError,
} from '../../domain/errors';
import { Reach, inReach, reachOf } from '../../domain/prospect-reach';
import { B2bProspectRepository, VisitRecord } from '../ports/b2b-prospect.repository';
import { auditProspect } from './b2b-prospect-audit';
import { DepotProfilePort } from '../ports/depot-profile.port';
import { IdentityPort } from '../ports/identity.port';
import { StaffRosterPort } from '../ports/staff-roster.port';
import { CUSTOMER_TOKENS } from '../tokens';
import { CustomerImportService } from './customer-import.service';

/** A list row: the business, never a person. No phone, contact name or note (Read-only roles see this). */
export type ProspectListRow = Pick<
  ProspectRecord,
  | 'id'
  | 'name'
  | 'category'
  | 'address'
  | 'latitude'
  | 'longitude'
  | 'kecamatanCode'
  | 'kelurahanCode'
  | 'ownerDepotId'
  | 'ownerSource'
  | 'status'
  | 'assignedToId'
  | 'source'
  | 'sourceDate'
  | 'createdAt'
  | 'updatedAt'
> & { hasPhone: boolean };

/** One prospect opened by a Work holder: the list row plus the person-level fields. */
export type ProspectDetail = ProspectListRow &
  Pick<
    ProspectRecord,
    | 'phoneE164'
    | 'contactName'
    | 'note'
    | 'licence'
    | 'sourceId'
    | 'sourceDataset'
    | 'customerId'
    | 'convertedAt'
    | 'lostReason'
    | 'assignedAt'
    | 'lastActivityAt'
  >;

export interface ProspectListFilters {
  status?: B2bProspectStatus;
  category?: B2bCategory;
  kecamatanCode?: string;
  kelurahanCode?: string;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface CoverageReport {
  total: number;
  onMap: number;
  byCategory: { category: B2bCategory; total: number; withPhone: number; withPhonePct: number }[];
  byStatus: { status: B2bProspectStatus; total: number }[];
  bySource: { source: B2bSource; total: number }[];
  dataAge: { newestDays: number; medianDays: number; oldestDays: number } | null;
  thirdPartyCostIdr: number | null;
}

const DEFAULT_LIMIT = 50;
const day = (key: string): number => Date.parse(`${key}T00:00:00Z`) / 86_400_000;
const clean = (s: string | null | undefined): string | null => s?.trim() || null;

function toListRow(r: ProspectRecord): ProspectListRow {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    address: r.address,
    latitude: r.latitude,
    longitude: r.longitude,
    kecamatanCode: r.kecamatanCode,
    kelurahanCode: r.kelurahanCode,
    ownerDepotId: r.ownerDepotId,
    ownerSource: r.ownerSource,
    status: r.status,
    assignedToId: r.assignedToId,
    source: r.source,
    sourceDate: r.sourceDate,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    hasPhone: r.phoneE164 !== null,
  };
}

export function toDetail(r: ProspectRecord): ProspectDetail {
  return {
    ...toListRow(r),
    phoneE164: r.phoneE164,
    contactName: r.contactName,
    note: r.note,
    licence: r.licence,
    sourceId: r.sourceId,
    sourceDataset: r.sourceDataset,
    customerId: r.customerId,
    convertedAt: r.convertedAt,
    lostReason: r.lostReason,
    assignedAt: r.assignedAt,
    lastActivityAt: r.lastActivityAt,
  };
}

/**
 * B2B prospects: list, open, work, assign, hand to HQ arbitration, do-not-contact, coverage.
 * Every single-row operation goes through `loadReachable` (the reach rule, 404 when out of it);
 * every list goes through `depotScopeIds` (which also checks a named depot) so a depot role can never widen to the network.
 */
@Injectable()
export class B2bProspectService {
  private readonly logger = new Logger(B2bProspectService.name);

  constructor(
    @Inject(CUSTOMER_TOKENS.B2bProspectRepository) private readonly repo: B2bProspectRepository,
    @Inject(CUSTOMER_TOKENS.IdentityPort) private readonly identity: IdentityPort,
    @Inject(CUSTOMER_TOKENS.DepotProfilePort) private readonly depotProfile: DepotProfilePort,
    @Inject(CUSTOMER_TOKENS.StaffRoster) private readonly roster: StaffRosterPort,
    private readonly config: CustomerConfigService,
    private readonly importer: CustomerImportService,
  ) {}

  private audit(
    action: string,
    user: AuthenticatedUser,
    target: string,
    metadata: Parameters<typeof auditProspect>[2]['metadata'],
  ): Promise<void> {
    return auditProspect(this.config, this.logger, { action, actorId: user.sub, target: `b2b-prospect:${target}`, metadata });
  }

  /**
   * The row, or a 404 that does not say whether it exists: outside the depot reach, assigned to
   * somebody else (for a role that works but does not manage), or on the opportunity map.
   */
  async loadReachable(
    user: AuthenticatedUser,
    id: string,
    opts: { mapIsUnprocessable?: boolean } = {},
  ): Promise<{ row: ProspectRecord; reach: Reach }> {
    const depotIds = depotScopeIds(user);
    const reach = reachOf(user, depotIds);
    const row = await this.repo.findById(id);
    if (row && row.ownerDepotId === null && depotIds === undefined && opts.mapIsUnprocessable) {
      throw new ProspectInvalidError('Prospek di luar area semua depot tidak bisa ditugaskan');
    }
    if (!row || !inReach(reach, user, row)) throw new ProspectNotFoundError();
    return { row, reach };
  }

  async list(
    user: AuthenticatedUser,
    query: ProspectListFilters & { scope?: 'work' | 'map'; depotId?: string; assigned?: string },
  ): Promise<{ items: ProspectListRow[]; nextCursor: string | null }> {
    const scoped = depotScopeIds(user);
    if (query.scope === 'map' && scoped !== undefined) {
      throw new ForbiddenException('Peta peluang hanya bisa dilihat peran tingkat jaringan');
    }
    const assigned = query.assigned;
    const page = await this.repo.list({
      scope: query.scope === 'map' ? 'map' : 'work',
      // Validates a named depot against the caller's own, and defaults an unnamed one to theirs (never the network).
      depotIds: depotScopeIds(user, query.depotId),
      status: query.status,
      category: query.category,
      kecamatanCode: query.kecamatanCode,
      kelurahanCode: query.kelurahanCode,
      assignedToId: assigned === 'me' ? user.sub : assigned && assigned !== 'none' ? assigned : undefined,
      unassigned: assigned === 'none',
      q: clean(query.q) ?? undefined,
      cursor: query.cursor,
      limit: query.limit ?? DEFAULT_LIMIT,
    });
    return { items: page.items.map(toListRow), nextCursor: page.nextCursor };
  }

  /** The caller's own work list: prospects assigned to them, inside their depot reach, with phone. */
  async mine(
    user: AuthenticatedUser,
    query: ProspectListFilters,
  ): Promise<{ items: ProspectDetail[]; nextCursor: string | null }> {
    const page = await this.repo.list({
      scope: 'work',
      depotIds: depotScopeIds(user),
      assignedToId: user.sub,
      status: query.status,
      category: query.category,
      kecamatanCode: query.kecamatanCode,
      kelurahanCode: query.kelurahanCode,
      q: clean(query.q) ?? undefined,
      cursor: query.cursor,
      limit: query.limit ?? DEFAULT_LIMIT,
    });
    return { items: page.items.map(toDetail), nextCursor: page.nextCursor };
  }

  async get(user: AuthenticatedUser, id: string): Promise<ProspectDetail & { visits: VisitRecord[] }> {
    const { row } = await this.loadReachable(user, id);
    return { ...toDetail(row), visits: await this.repo.visits(id, 20) };
  }

  async setStatus(
    user: AuthenticatedUser,
    id: string,
    input: { status: B2bProspectStatus; lostReason?: string; seenUpdatedAt: string },
  ): Promise<ProspectDetail> {
    const { row, reach } = await this.loadReachable(user, id);
    const to = input.status;
    if (to === 'CONVERTED' || to === 'DO_NOT_CONTACT') {
      throw new ProspectTransitionError('Status ini punya jalur sendiri (konversi atau jangan dihubungi)');
    }
    // Reopening a LOST prospect is a manager's call, not the salesperson's who lost it.
    if (row.status === 'LOST' && to === 'NEW' && reach.assignedOnly) {
      throw new ForbiddenException('Hanya pengelola yang boleh membuka kembali prospek yang sudah ditolak');
    }
    if (!canSetByHand(row.status, to)) throw new ProspectTransitionError();
    const reason = clean(input.lostReason);
    if (to === 'LOST' && (!reason || reason.length < 3 || reason.length > 200)) {
      throw new ProspectInvalidError('Alasan ditolak wajib diisi (3 sampai 200 karakter)');
    }
    // A number imported before the person signed up: catch it before anyone calls them as a prospect.
    const mobile = to === 'CONTACTED' && row.phoneE164 ? normalizeIdPhone(row.phoneE164)?.mobile : false;
    if (mobile && (await this.identity.customerIdByPhone(row.phoneE164 as string))) {
      throw new ProspectRefusedError('ALREADY_CUSTOMER', 'Nomor ini sudah punya akun pelanggan');
    }
    const updated = await this.repo.update(
      id,
      { status: to, lostReason: to === 'LOST' ? reason : null, lastActivityAt: new Date() },
      new Date(input.seenUpdatedAt),
    );
    if (!updated) throw new ProspectStaleError();
    await this.audit('b2b.prospect.status', user, id, { prospectId: id, from: row.status, to });
    return toDetail(updated);
  }

  /** The staff of one depot, name only (never a phone): the assign picker and the list's assignee column. */
  async assignees(user: AuthenticatedUser, depotId: string): Promise<{ id: string; name: string }[]> {
    assertDepotAccess(user, depotId);
    const ids = await this.roster.staffIdsForDepot(depotId);
    const names = ids.length ? await this.identity.getCustomerNames(ids) : new Map<string, { fullName: string | null }>();
    return ids.map((id) => ({ id, name: clean(names.get(id)?.fullName) ?? `Staf ${id.slice(-4)}` }));
  }

  async assign(
    user: AuthenticatedUser,
    id: string,
    assigneeId: string | null,
    seenUpdatedAt?: string,
  ): Promise<ProspectDetail> {
    const { row } = await this.loadReachable(user, id, { mapIsUnprocessable: true });
    if (isTerminal(row.status)) {
      throw new ProspectTransitionError('Prospek yang sudah selesai tidak bisa ditugaskan');
    }
    if (assigneeId) {
      const staff = await this.roster.staffIdsForDepot(row.ownerDepotId as string);
      if (!staff.includes(assigneeId)) {
        throw new ProspectInvalidError('Penerima tugas bukan staf aktif di depot pemilik prospek');
      }
    }
    const updated = await this.repo.update(
      id,
      { assignedToId: assigneeId, assignedAt: assigneeId ? new Date() : null },
      seenUpdatedAt ? new Date(seenUpdatedAt) : undefined,
    );
    if (!updated) throw seenUpdatedAt ? new ProspectStaleError() : new ProspectNotFoundError();
    await this.audit('b2b.prospect.assign', user, id, { prospectId: id, assigneeId });
    return toDetail(updated);
  }

  /**
   * HQ arbitration of which depot owns a prospect (or none: back to the map). A network power
   * with no depot fence on the route, so the row is loaded without the reach filter.
   */
  async setOwnerDepot(
    user: AuthenticatedUser,
    id: string,
    input: { depotId: string | null; reason: string; seenUpdatedAt?: string },
  ): Promise<ProspectDetail> {
    const row = await this.repo.findById(id);
    if (!row) throw new ProspectNotFoundError();
    // Network roles pass; a depot-scoped role granted this by mistake fails closed.
    assertDepotAccess(user, row.ownerDepotId);
    if (input.depotId) {
      const depots = await this.depotProfile.listActive();
      if (!depots) throw new ServiceUnavailableException('depot-service tidak menjawab');
      if (!depots.some((d) => d.id === input.depotId)) {
        throw new ProspectInvalidError('Depot tujuan tidak ditemukan atau tidak aktif');
      }
    }
    const changed = row.ownerDepotId !== input.depotId;
    const updated = await this.repo.update(
      id,
      {
        ownerDepotId: input.depotId,
        ownerSource: 'HQ',
        // An assignee belongs to the old depot's roster.
        ...(changed && { assignedToId: null, assignedAt: null }),
      },
      input.seenUpdatedAt ? new Date(input.seenUpdatedAt) : undefined,
    );
    if (!updated) throw input.seenUpdatedAt ? new ProspectStaleError() : new ProspectNotFoundError();
    await recordAuditEvent(
      { authServiceUrl: this.config.authServiceUrl, internalServiceKey: this.config.internalServiceKey },
      {
        action: 'b2b.prospect.owner.set',
        actorId: user.sub,
        target: `b2b-prospect:${id}`,
        metadata: { before: row.ownerDepotId, after: input.depotId, reason: input.reason.trim() },
      },
      this.logger,
    );
    return toDetail(updated);
  }

  /**
   * Put a number, or a business name at a pin, on the permanent do-not-contact list and mark any
   * live prospect that matches. Only keyed hashes are stored; idempotent.
   */
  async suppress(
    user: AuthenticatedUser,
    input: { phone?: string; name?: string; latitude?: number; longitude?: number; reason: B2bDncReason },
  ): Promise<{ entries: number; prospects: number }> {
    const phone = clean(input.phone) ? normalizeIdPhone(input.phone) : null;
    if (clean(input.phone) && !phone) throw new ProspectInvalidError('Nomor telepon tidak valid');
    const nameKey = normaliseName(input.name ?? '');
    const pinned = Number.isFinite(input.latitude) && Number.isFinite(input.longitude);
    if (!phone && !(nameKey && pinned)) {
      throw new ProspectInvalidError('Isi nomor telepon, atau nama usaha beserta pin lokasinya');
    }
    const secret = this.config.prospectDncHmacKey;
    const cell = pinned ? gridCell1km(input.latitude as number, input.longitude as number) : null;
    const entries = [
      ...(phone ? [{ kind: 'PHONE' as const, keyHash: dncHash(secret, 'PHONE', phone.e164) }] : []),
      ...(nameKey && cell
        ? [{ kind: 'PLACE' as const, keyHash: dncHash(secret, 'PLACE', `${nameKey}|${cell}`) }]
        : []),
    ];
    // The objection is a person's, so it applies to every depot and every matching row is wiped; the
    // caller is only told how many of them were inside its own reach.
    const wiped = await this.repo.suppress(
      { phoneE164: phone?.e164, nameKey: cell ? nameKey : undefined, cells: cell ? neighbourCells(cell) : undefined },
      entries,
      input.reason,
      user.sub,
    );
    await this.audit('b2b.prospect.suppress', user, 'free-form', {
      reason: input.reason,
      entries: entries.length,
      prospects: wiped.length,
      byPhone: phone !== null,
      byPlace: cell !== null && nameKey !== '',
    });
    const reach = depotScopeIds(user);
    const mine = reach ? wiped.filter((r) => r.ownerDepotId !== null && reach.includes(r.ownerDepotId)) : wiped;
    return { entries: entries.length, prospects: mine.length };
  }

  /** One prospect refused or asked to be left alone: terminal, and nothing that could reach them is kept. */
  async suppressProspect(user: AuthenticatedUser, id: string, reason: B2bDncReason): Promise<ProspectDetail> {
    const { row } = await this.loadReachable(user, id);
    if (isTerminal(row.status)) throw new ProspectTransitionError('Prospek ini sudah selesai');
    const secret = this.config.prospectDncHmacKey;
    await this.repo.suppress(
      { id: row.id, phoneE164: row.phoneE164 },
      [
        ...(row.phoneE164 ? [{ kind: 'PHONE' as const, keyHash: dncHash(secret, 'PHONE', row.phoneE164) }] : []),
        { kind: 'PLACE' as const, keyHash: dncHash(secret, 'PLACE', `${row.nameKey}|${row.gridCell}`) },
      ],
      reason,
      user.sub,
    );
    await this.audit('b2b.prospect.suppress.prospect', user, id, { prospectId: id, reason });
    return toDetail((await this.repo.findById(id)) as ProspectRecord);
  }

  /**
   * The prospect became a customer: INTERESTED or VISITED only. The account is the one the caller names,
   * else the one behind the prospect's mobile number, else a PENDING account the owner claims by OTP
   * (the same staff-made-customer path the bulk import uses). Converting a converted row returns it.
   */
  async convert(user: AuthenticatedUser, id: string, customerId?: string): Promise<ProspectDetail> {
    const { row } = await this.loadReachable(user, id);
    if (row.status === 'CONVERTED') return toDetail(row);
    if (row.status !== 'INTERESTED' && row.status !== 'VISITED') {
      throw new ProspectTransitionError('Hanya prospek yang berminat atau sudah dikunjungi yang bisa dikonversi');
    }
    const account = await this.resolveAccount(row, customerId);
    const now = new Date();
    const updated = await this.repo.update(
      id,
      { status: 'CONVERTED', customerId: account, convertedAt: now, lastActivityAt: now },
      row.updatedAt,
    );
    if (!updated) {
      // Two converts at once: the loser gets the winner's result, anything else is a stale write.
      const again = await this.repo.findById(id);
      if (again?.status === 'CONVERTED') return toDetail(again);
      throw new ProspectStaleError();
    }
    await this.audit('b2b.prospect.converted', user, id, { prospectId: id, customerId: account });
    return toDetail(updated);
  }

  private async resolveAccount(row: ProspectRecord, customerId?: string): Promise<string> {
    if (customerId) {
      const account = (await this.identity.getAccountOwners([customerId])).get(customerId);
      if (!account) throw new ProspectInvalidError('Akun pelanggan tidak ditemukan');
      // A mobile prospect may only be linked to the account holding that same number. Fail closed: an
      // upstream answer with no phone cannot prove the match, so it is refused. A landline or empty
      // prospect phone could never belong to a customer account: existence is all that is checked.
      const own = row.phoneE164 ? normalizeIdPhone(row.phoneE164) : null;
      if (own?.mobile && normalizeIdPhone(account.phone)?.e164 !== own.e164) {
        throw new ProspectInvalidError('Nomor HP akun pelanggan tidak sama dengan nomor prospek');
      }
      return customerId;
    }
    const phone = row.phoneE164 ? normalizeIdPhone(row.phoneE164) : null;
    if (!phone?.mobile) {
      throw new ProspectInvalidError('Prospek ini tidak punya nomor HP: pilih akun pelanggan yang sudah ada');
    }
    const existing = await this.identity.customerIdByPhone(phone.e164);
    if (existing) return existing;
    const made = await this.importer.resolveByPhone(phone.e164, row.contactName ?? row.name, row.ownerDepotId as string);
    return made.customerId;
  }

  /** Counts only: no name, phone or address field exists on this response. */
  async coverage(user: AuthenticatedUser, depotId?: string): Promise<CoverageReport> {
    const depotIds = depotScopeIds(user, depotId);
    const raw = await this.repo.coverage({ depotIds, includeCost: depotIds === undefined });
    const today = day(localDayKey(new Date()));
    const age = (ms: number) => today - day(localDayKey(new Date(ms)));
    return {
      total: raw.total,
      onMap: raw.onMap,
      byCategory: raw.byCategory.map((c) => ({
        ...c,
        withPhonePct: c.total > 0 ? Math.round((c.withPhone / c.total) * 1000) / 10 : 0,
      })),
      byStatus: raw.byStatus,
      bySource: raw.bySource,
      dataAge: raw.age
        ? { newestDays: age(raw.age.newest), medianDays: age(raw.age.median), oldestDays: age(raw.age.oldest) }
        : null,
      thirdPartyCostIdr: raw.thirdPartyCostIdr,
    };
  }
}
