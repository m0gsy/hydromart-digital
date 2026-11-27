import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, Optional, ServiceUnavailableException } from '@nestjs/common';

import {
  AuthenticatedUser,
  ImportRowResult,
  depotScopeIds,
  ImportSummary,
  gridCell1km,
  normalizeIdPhone,
  runImport,
  servingDepot,
} from '@hydromart/platform';

import { CustomerConfigService } from '../../config/customer-config.service';
import {
  B2B_CATEGORIES,
  B2bCategory,
  B2bSource,
  DuplicateProbe,
  IMPORT_SOURCES,
  NewProspect,
  ProspectRecord,
  RefusalReason,
  REFUSAL_REASONS,
  licenceAccepted,
} from '../../domain/b2b-prospect';
import { dncHash, matchDuplicate, normaliseName, placeKeys, DuplicateKind } from '../../domain/b2b-prospect-keys';
import { NO_REGION } from '../../domain/region-codes';
import { ProspectInvalidError, ProspectNotFoundError, ProspectRefusedError } from '../../domain/errors';
import { reachOf } from '../../domain/prospect-reach';
import { RegionLookup } from '../../infrastructure/geo/region-lookup';
import { B2bProspectRepository, DncKeys } from '../ports/b2b-prospect.repository';
import { auditProspect } from './b2b-prospect-audit';
import { ActiveDepot, DepotProfilePort } from '../ports/depot-profile.port';
import { IdentityPort } from '../ports/identity.port';
import { CUSTOMER_TOKENS } from '../tokens';

/** One business as the intake rules read it. `lat`/`lng` and `license` are the AREA-T column names. */
export interface IntakeRow {
  name: string;
  category: string;
  lat: number;
  lng: number;
  phone?: string;
  address?: string;
  contactName?: string;
  note?: string;
  /** `overture|osm|foursquare_os|internal` from a file; `field` only from POST /b2b-prospects. */
  source: string;
  license?: string;
  sourceId?: string;
  sourceDataset?: string;
  sourceUpdated?: string;
}

export type Decision =
  | { kind: 'accept'; data: NewProspect; dnc: DncKeys; probe: DuplicateProbe }
  | { kind: 'refuse'; reason: RefusalReason; message: string; dup?: DuplicateKind }
  | { kind: 'fail'; message: string };

interface IntakeContext {
  /** Read once per file: every row of one import is judged against the same depot list. */
  depots?: Promise<ActiveDepot[] | null>;
  /** Dry run only: the rows this file would create, so an in-file duplicate is seen. */
  seen?: DuplicateProbe[];
  batchId: string | null;
  createdById: string;
  allowField: boolean;
}

export interface B2bImportRowResult extends ImportRowResult {
  reason?: RefusalReason;
}

export interface B2bImportSummary extends ImportSummary {
  dryRun: boolean;
  reasons: Record<RefusalReason, number>;
  results: B2bImportRowResult[];
}

const REFUSAL_TEXT: Record<DuplicateKind, string> = {
  SOURCE_ID: 'Baris dataset ini sudah pernah masuk',
  PHONE: 'Nomor ini sudah dipakai prospek lain',
  NAME_NEAR: 'Usaha dengan nama yang sama sudah ada dalam radius 150 m',
};
const DNC_TEXT = 'Nomor atau usaha ini ada di daftar jangan dihubungi';
const CUSTOMER_TEXT = 'Nomor ini sudah punya akun pelanggan';

/** A row that cannot be judged, with a message that is safe to show (never an upstream error text). */
class RowFailure extends Error {}

/** What a caller without network reach is told for a number it may not learn anything about. */
const GENERIC_REFUSAL = 'Nomor ini tidak bisa dipakai untuk prospek baru.';
const RACE_TEXT = 'Usaha ini baru saja ditambahkan oleh orang lain';

const clean = (s: string | null | undefined): string | null => s?.trim() || null;

/**
 * The one place that decides whether a business becomes a prospect. Import (dry run and commit)
 * and the field find both call `decide`, so the two cannot drift: the same row gets the same
 * verdict. Order, first hit wins: shape, licence, do-not-contact, already a customer, duplicate.
 * Out of every depot's area is NOT a refusal: the row is kept with no owner depot (the map).
 */
@Injectable()
export class B2bProspectIntakeService {
  private readonly logger = new Logger(B2bProspectIntakeService.name);

  constructor(
    @Inject(CUSTOMER_TOKENS.B2bProspectRepository) private readonly repo: B2bProspectRepository,
    @Inject(CUSTOMER_TOKENS.IdentityPort) private readonly identity: IdentityPort,
    @Inject(CUSTOMER_TOKENS.DepotProfilePort) private readonly depotProfile: DepotProfilePort,
    private readonly config: CustomerConfigService,
    @Optional() private readonly regions?: RegionLookup,
  ) {}

  async decide(row: IntakeRow, ctx: IntakeContext): Promise<Decision> {
    const fail = (message: string): Decision => ({ kind: 'fail', message });

    // 0. Shape: no pin, no owner-depot decision.
    const name = row.name?.trim();
    const nameKey = name ? normaliseName(name) : '';
    if (!nameKey) return fail('Nama usaha wajib diisi');
    const category = String(row.category ?? '').trim().toUpperCase() as B2bCategory;
    if (!B2B_CATEGORIES.includes(category)) return fail(`Kategori "${row.category}" tidak dikenal`);
    const { lat, lng } = row;
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180 ||
      (lat === 0 && lng === 0)
    ) {
      return fail('Pin lokasi wajib diisi (lat dan lng, bukan 0,0)');
    }
    const phone = clean(row.phone) ? normalizeIdPhone(row.phone) : null;
    if (clean(row.phone) && !phone) return fail('Nomor telepon tidak valid');

    // 1. Licence: only open datasets with a licence we accept, plus our own data.
    const sourceKey = String(row.source ?? '').trim().toLowerCase();
    const source: B2bSource | undefined =
      ctx.allowField && sourceKey === 'field' ? 'FIELD' : IMPORT_SOURCES[sourceKey];
    if (!source) {
      return { kind: 'refuse', reason: 'LICENCE', message: `Sumber "${row.source}" tidak diterima` };
    }
    if (!licenceAccepted(source, row.license)) {
      return {
        kind: 'refuse',
        reason: 'LICENCE',
        message: `Lisensi "${clean(row.license) ?? 'kosong'}" tidak diterima untuk sumber ${sourceKey}`,
      };
    }

    // 2. Do-not-contact: before customer and duplicate, so a suppressed business is reported as that.
    const gridCell = gridCell1km(lat, lng);
    const secret = this.config.prospectDncHmacKey;
    const dnc: DncKeys = {
      phoneHash: phone ? dncHash(secret, 'PHONE', phone.e164) : null,
      placeHashes: placeKeys(nameKey, gridCell).map((k) => dncHash(secret, 'PLACE', k)),
    };
    if (await this.repo.dncPresent(dnc)) return { kind: 'refuse', reason: 'DO_NOT_CONTACT', message: DNC_TEXT };

    // 3. Already a customer (auth-service owns accounts). Down = the row fails, never "not a customer".
    if (phone?.mobile && (await this.identity.customerIdByPhone(phone.e164))) {
      return { kind: 'refuse', reason: 'ALREADY_CUSTOMER', message: CUSTOMER_TEXT };
    }

    // 4. Duplicate of a prospect in any status, or of an earlier row of this same file.
    const probe: DuplicateProbe = {
      source,
      sourceId: clean(row.sourceId),
      phoneE164: phone?.e164 ?? null,
      nameKey,
      latitude: lat,
      longitude: lng,
    };
    const known = matchDuplicate([...(await this.repo.findDuplicateCandidates(probe)), ...(ctx.seen ?? [])], probe);
    if (known) return { kind: 'refuse', reason: 'DUPLICATE', message: REFUSAL_TEXT[known], dup: known };

    // 5. Owner depot: the nearest depot that serves the pin, else the opportunity map.
    const depots = await (ctx.depots ??= this.depotProfile.listActive());
    if (!depots) {
      throw new ServiceUnavailableException('depot-service tidak menjawab: depot pemilik tidak bisa ditentukan');
    }
    const region = this.regions?.codesFor(lat, lng, 'MANUAL', null) ?? NO_REGION;
    const sourceUpdated = clean(row.sourceUpdated);
    const sourceDate = sourceUpdated && /^\d{4}-\d{2}-\d{2}/.test(sourceUpdated)
      ? new Date(`${sourceUpdated.slice(0, 10)}T00:00:00.000Z`)
      : null;

    return {
      kind: 'accept',
      probe,
      dnc,
      data: {
        name: name as string,
        nameKey,
        category,
        phoneE164: phone?.e164 ?? null,
        contactName: clean(row.contactName),
        address: clean(row.address),
        latitude: lat,
        longitude: lng,
        gridCell,
        kecamatanCode: region.kecamatanCode,
        kelurahanCode: region.kelurahanCode,
        ownerDepotId: servingDepot({ lat, lng }, depots)?.id ?? null,
        source,
        licence: clean(row.license),
        sourceId: probe.sourceId,
        sourceDataset: clean(row.sourceDataset),
        sourceDate: sourceDate && Number.isFinite(sourceDate.getTime()) ? sourceDate : null,
        batchId: ctx.batchId,
        note: clean(row.note),
        createdById: ctx.createdById,
      },
    };
  }

  /**
   * POST /b2b-prospects: one business a person found in the field. The source is forced to FIELD
   * here, never read from the client. The owner depot is whatever the rule says (possibly another
   * depot, possibly none): a prospect is never forced onto the creator's depot.
   */
  async createField(user: AuthenticatedUser, row: Omit<IntakeRow, 'source' | 'license' | 'sourceId' | 'sourceDataset' | 'sourceUpdated'>): Promise<ProspectRecord> {
    const decision = await this.decide(
      // The server owns FIELD: whatever source or licence the caller sent is dropped.
      { ...row, source: 'field', license: undefined, sourceId: undefined, sourceDataset: undefined, sourceUpdated: undefined },
      { batchId: null, createdById: user.sub, allowField: true },
    );
    if (decision.kind === 'fail') throw new ProspectInvalidError(decision.message);
    // A depot-scoped caller must not learn, from the wording, that a number is a customer, on the
    // do-not-contact list or in another depot's prospects: one generic refusal. Network-wide callers keep the reason.
    const network = depotScopeIds(user) === undefined;
    const hidden = (reason: RefusalReason, dup?: DuplicateKind) =>
      !network && (reason !== 'DUPLICATE' || dup === undefined || dup === 'PHONE');
    if (decision.kind === 'refuse') {
      if (hidden(decision.reason, decision.dup) && decision.reason !== 'LICENCE') {
        throw new ProspectRefusedError('DUPLICATE', GENERIC_REFUSAL);
      }
      throw new ProspectRefusedError(decision.reason, decision.message);
    }
    // A caller that works prospects but does not manage them (Sales Depot) may only add a row that
    // lands in its own depot, and gets it assigned: it shows up in "Milik saya". Same 404 as a row out of reach.
    const workOnly = reachOf(user).assignedOnly;
    if (workOnly && (!decision.data.ownerDepotId || !depotScopeIds(user)?.includes(decision.data.ownerDepotId))) {
      throw new ProspectNotFoundError();
    }
    const data = workOnly ? { ...decision.data, assignedToId: user.sub, assignedAt: new Date() } : decision.data;
    const made = await this.repo.createGuarded(data, decision.dnc);
    if (!made.ok) {
      if (!network) throw new ProspectRefusedError('DUPLICATE', GENERIC_REFUSAL);
      throw new ProspectRefusedError(made.reason, made.reason === 'DUPLICATE' ? RACE_TEXT : DNC_TEXT);
    }
    await auditProspect(this.config, this.logger, {
      action: 'b2b.prospect.create',
      actorId: user.sub,
      target: `b2b-prospect:${made.prospect.id}`,
      metadata: {
        prospectId: made.prospect.id,
        ownerDepotId: made.prospect.ownerDepotId,
        category: made.prospect.category,
        source: 'FIELD',
      },
    });
    return made.prospect;
  }

  /**
   * POST /b2b-prospects/import. A dry run writes nothing and returns the verdicts a commit would
   * (same `decide`; an in-memory seen-set stands in for the rows a commit would already have written).
   */
  async importFile(
    user: AuthenticatedUser,
    input: { dryRun: boolean; costIdr: number; rows: readonly IntakeRow[] },
  ): Promise<B2bImportSummary> {
    const ctx: IntakeContext = {
      seen: input.dryRun ? [] : undefined,
      batchId: input.dryRun ? null : randomUUID(),
      createdById: user.sub,
      allowField: false,
    };
    const reasons = Object.fromEntries(REFUSAL_REASONS.map((r) => [r, 0])) as Record<RefusalReason, number>;
    const reasonOf = new Map<number, RefusalReason>();
    const refuse = (index: number, reason: RefusalReason, message: string) => {
      reasons[reason] += 1;
      reasonOf.set(index, reason);
      return { status: 'skipped' as const, message };
    };

    const summary = await runImport(input.rows, async (row, index) => {
      const decision = await this.decide(row, ctx).catch((error) => {
        // A row fails with a fixed message unless it is one of ours: an unknown error text could carry
        // a host or a driver detail. The log names the row index only.
        if (error instanceof ServiceUnavailableException) throw error;
        this.logger.warn(`import row ${index + 1} could not be judged (${(error as Error).name})`);
        throw new Error('Gagal memproses baris');
      });
      if (decision.kind === 'fail') throw new RowFailure(decision.message);
      if (decision.kind === 'refuse') return refuse(index, decision.reason, decision.message);
      if (input.dryRun) {
        ctx.seen!.push(decision.probe);
        return { status: 'created' as const };
      }
      const made = await this.repo.createGuarded(decision.data, decision.dnc).catch((error) => {
        this.logger.warn(`import row ${index + 1} could not be written (${(error as Error).name})`);
        throw new Error('Gagal memproses baris');
      });
      if (!made.ok) {
        return made.reason === 'DUPLICATE'
          ? refuse(index, 'DUPLICATE', REFUSAL_TEXT.NAME_NEAR)
          : refuse(index, 'DO_NOT_CONTACT', DNC_TEXT);
      }
      return { status: 'created' as const, id: made.prospect.id };
    });

    if (!input.dryRun) {
      const distinct = (values: string[]) => [...new Set(values)].join(',').slice(0, 1000);
      await this.repo.createBatch({
        id: ctx.batchId as string,
        sources: distinct(input.rows.map((r) => String(r.source ?? '').trim().toLowerCase())),
        licences: distinct(input.rows.flatMap((r) => String(r.license ?? '').split(';').map((t) => t.trim()).filter(Boolean))),
        rows: input.rows.length,
        created: summary.created,
        refused: summary.skipped,
        failed: summary.failed,
        costIdr: input.costIdr,
        importedById: user.sub,
      });
      await auditProspect(this.config, this.logger, {
        action: 'b2b.prospect.import',
        actorId: user.sub,
        target: `b2b-import:${ctx.batchId}`,
        metadata: {
          batchId: ctx.batchId,
          rows: input.rows.length,
          created: summary.created,
          refused: summary.skipped,
          failed: summary.failed,
          reasons,
        },
      });
    }
    return {
      ...summary,
      dryRun: input.dryRun,
      reasons,
      results: summary.results.map((r) => ({ ...r, reason: reasonOf.get(r.row - 1) })),
    };
  }
}
