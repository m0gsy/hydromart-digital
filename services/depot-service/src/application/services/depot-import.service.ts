import { Inject, Injectable, Logger } from '@nestjs/common';
import { can } from '@hydromart/access';
import {
  AuthenticatedUser,
  ImportRowOutcome,
  ImportSummary,
  recordAuditEvent,
  runImport,
} from '@hydromart/platform';

import { SETTING_DEF_BY_KEY } from '../../config/setting-defs';
import { DuplicateDepotCodeError } from '../../domain/errors';
import { parseHolidays, parseOperatingHours } from '../../domain/depot-schedule';
import { parseServiceArea } from '../../domain/service-area';
import { ImportDepotRowDto } from '../../modules/dto/depot.dto';
import {
  CreateDepotData,
  DepotRecord,
  DepotRepository,
  UpdateDepotData,
} from '../ports/depot.repository';
import { DEPOT_TOKENS } from '../tokens';
import { DepotService } from './depot.service';
import { SettingsService } from './settings.service';

export type DepotImportMode = 'create' | 'upsert';

// Indonesia's bounding box. Not a validity rule for the product, a typo net: a swapped
// lat/lng pair is a perfectly valid coordinate (somewhere in the Indian Ocean) and would
// otherwise create a depot nobody can ever be routed to.
const LAT_RANGE = [-11, 6] as const;
const LNG_RANGE = [95, 141] as const;

const REQUIRED_ON_CREATE = [
  ['name', 'nama'],
  ['ownershipType', 'tipe kepemilikan'],
  ['address', 'alamat'],
  ['city', 'kota'],
  ['province', 'provinsi'],
  ['lat', 'lat'],
  ['lng', 'lng'],
  ['deliveryFee', 'ongkir'],
] as const;

const blank = (v: unknown): boolean => v === undefined || v === null || v === '';

interface Prepared {
  /** Only keys the row actually filled in; nothing is `undefined`. */
  fields: UpdateDepotData;
  settings: [key: string, value: string][];
}

/**
 * Bulk create / update of depots from the HQ spreadsheet.
 *
 * Each row is validated in full — fields, hours, holidays, service area, settings and the
 * caller's right to write each setting — BEFORE anything is written, so the one failure that
 * cannot be undone (a depot saved, its settings not) is reduced to a database error mid-row.
 * No cross-row transaction, like every import here (see `runImport`): a file that failed
 * halfway is corrected and re-uploaded, and what already exists is reported `skipped`.
 */
@Injectable()
export class DepotImportService {
  private static readonly logger = new Logger(DepotImportService.name);

  constructor(
    private readonly depots: DepotService,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly repo: DepotRepository,
    private readonly settings: SettingsService,
  ) {}

  async import(
    mode: DepotImportMode,
    rows: readonly ImportDepotRowDto[],
    user: AuthenticatedUser,
  ): Promise<ImportSummary> {
    const codes = rows.map((r) => r.code.trim());
    // Case-insensitive on purpose: the database would accept JKT-01 and jkt-01 as two
    // depots, and in a spreadsheet that is always one typed twice.
    const firstSeen = new Map<string, number>();
    const repeated = new Set<number>();
    codes.forEach((code, i) => {
      const key = code.toLowerCase();
      if (code && firstSeen.has(key)) repeated.add(i);
      else firstSeen.set(key, i);
    });
    const existing = new Map(
      (await this.repo.findManyByCodes(codes.filter(Boolean))).map((d) => [d.code, d]),
    );

    const summary = await runImport(
      rows,
      async (row, i) => {
        const code = codes[i];
        if (!code) throw new Error('Kode depot kosong');
        if (repeated.has(i)) {
          throw new Error(
            `Kode ${code} muncul lebih dari sekali di file (baris ${firstSeen.get(code.toLowerCase())! + 1})`,
          );
        }
        const current = existing.get(code);
        if (current && mode === 'create') {
          return { status: 'skipped', id: current.id, message: `Kode ${code} sudah ada` };
        }
        const prepared = this.prepare(row, !current, user);
        return current
          ? this.updateOne(current, prepared, user)
          : this.createOne(code, prepared, user);
      },
      (err) => err instanceof DuplicateDepotCodeError,
    );

    await recordAuditEvent(
      {
        authServiceUrl: process.env.AUTH_SERVICE_URL ?? '',
        internalServiceKey: process.env.INTERNAL_SERVICE_KEY ?? '',
      },
      {
        action: 'depot.import',
        actorId: user.sub,
        target: `${rows.length} baris`,
        metadata: {
          mode,
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          failed: summary.failed,
        },
      },
      DepotImportService.logger,
    );
    return summary;
  }

  /** Throws, with a message naming the cell, on the first thing wrong with the row. */
  private prepare(row: ImportDepotRowDto, creating: boolean, user: AuthenticatedUser): Prepared {
    const fields: UpdateDepotData = {};
    const keep = <K extends keyof CreateDepotData>(
      key: K,
      value: CreateDepotData[K] | undefined,
    ) => {
      if (value !== undefined) fields[key] = value;
    };

    keep('name', row.name?.trim() || undefined);
    keep('ownershipType', row.ownershipType);
    keep('address', row.address?.trim() || undefined);
    keep('city', row.city?.trim() || undefined);
    keep('province', row.province?.trim() || undefined);
    keep('lat', row.lat);
    keep('lng', row.lng);
    keep('serviceRadiusKm', row.serviceRadiusKm);
    keep('deliveryFee', row.deliveryFee);
    keep('minOrderAmount', row.minOrderAmount);
    keep('ownerId', row.ownerId);
    keep('contactPhone', row.contactPhone);
    keep('paymentBankName', row.paymentBankName);
    keep('paymentBankAccountNumber', row.paymentBankAccountNumber);
    keep('paymentBankAccountHolder', row.paymentBankAccountHolder);
    keep('paymentQrisImageUrl', row.paymentQrisImageUrl);

    if (creating) {
      const missing = REQUIRED_ON_CREATE.filter(([key]) => fields[key] === undefined).map(
        ([, label]) => label,
      );
      if (missing.length > 0)
        throw new Error(`Kolom wajib untuk depot baru belum diisi: ${missing.join(', ')}`);
    }
    if (fields.lat !== undefined && (fields.lat < LAT_RANGE[0] || fields.lat > LAT_RANGE[1])) {
      throw new Error(
        `lat ${fields.lat} di luar Indonesia (${LAT_RANGE[0]} sampai ${LAT_RANGE[1]}); lat dan lng tertukar?`,
      );
    }
    if (fields.lng !== undefined && (fields.lng < LNG_RANGE[0] || fields.lng > LNG_RANGE[1])) {
      throw new Error(
        `lng ${fields.lng} di luar Indonesia (${LNG_RANGE[0]} sampai ${LNG_RANGE[1]}); lat dan lng tertukar?`,
      );
    }

    if (row.operatingHours !== undefined) {
      const hours = parseOperatingHours(row.operatingHours);
      if (!hours.ok) throw new Error(`Jam operasional: ${hours.error}`);
      fields.operatingHours = hours.value;
    }
    if (row.holidays !== undefined) {
      const holidays = parseHolidays(row.holidays);
      if (!holidays.ok) throw new Error(`Hari libur: ${holidays.error}`);
      fields.holidays = holidays.value;
    }
    if (row.serviceArea !== undefined) {
      const area = parseServiceArea(row.serviceArea);
      if (!area.ok) throw new Error(`Area layanan: ${area.error}`);
      fields.serviceArea = area.value;
    }

    const settings: [string, string][] = [];
    for (const [key, raw] of Object.entries(row.settings ?? {})) {
      if (blank(raw) || (typeof raw === 'string' && raw.trim() === '')) continue;
      const value = String(raw).trim();
      // `depotId` only has to be present for the check; the depot may not exist yet.
      this.settings.validate({ scope: 'DEPOT', depotId: 'pending', key, value });
      const requires = SETTING_DEF_BY_KEY[key]?.requires;
      if (requires && !can(requires, user.role)) {
        throw new Error(`Setting ${key} butuh hak akses yang Anda tidak miliki`);
      }
      settings.push([key, value]);
    }
    return { fields, settings };
  }

  private async createOne(
    code: string,
    { fields, settings }: Prepared,
    user: AuthenticatedUser,
  ): Promise<ImportRowOutcome> {
    const data: CreateDepotData = {
      code,
      name: fields.name!,
      ownershipType: fields.ownershipType!,
      address: fields.address!,
      city: fields.city!,
      province: fields.province!,
      lat: fields.lat!,
      lng: fields.lng!,
      serviceRadiusKm: fields.serviceRadiusKm ?? 5,
      deliveryFee: fields.deliveryFee!,
      minOrderAmount: fields.minOrderAmount ?? null,
      ownerId: fields.ownerId ?? null,
      contactPhone: fields.contactPhone ?? null,
      paymentBankName: fields.paymentBankName ?? null,
      paymentBankAccountNumber: fields.paymentBankAccountNumber ?? null,
      paymentBankAccountHolder: fields.paymentBankAccountHolder ?? null,
      paymentQrisImageUrl: fields.paymentQrisImageUrl ?? null,
      operatingHours: fields.operatingHours ?? {},
      holidays: fields.holidays ?? [],
      serviceArea: fields.serviceArea ?? null,
    };
    const created = await this.depots.create(data);
    await this.writeSettings(created, settings, code, user);
    return { status: 'created', id: created.id };
  }

  private async updateOne(
    current: DepotRecord,
    { fields, settings }: Prepared,
    user: AuthenticatedUser,
  ): Promise<ImportRowOutcome> {
    if (Object.keys(fields).length === 0 && settings.length === 0) {
      return {
        status: 'skipped',
        id: current.id,
        message: 'Tidak ada kolom yang diisi untuk diperbarui',
      };
    }
    let depot = current;
    if (Object.keys(fields).length > 0) {
      // The stamp of the row read at the start of this import: if someone edited the depot
      // in the meantime the write is refused (stale) instead of silently overwriting them.
      depot = await this.depots.update(current.id, fields, current.updatedAt.toISOString());
    }
    await this.writeSettings(depot, settings, current.code, user);
    return { status: 'updated', id: depot.id };
  }

  private async writeSettings(
    depot: DepotRecord,
    settings: [string, string][],
    code: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    for (const [key, value] of settings) {
      try {
        await this.settings.put({
          scope: 'DEPOT',
          depotId: depot.id,
          key,
          value,
          updatedBy: user.sub,
        });
      } catch (err) {
        const why = err instanceof Error ? err.message : 'gagal';
        throw new Error(`Depot ${code} tersimpan, tetapi setting ${key} gagal: ${why}`);
      }
    }
  }
}
