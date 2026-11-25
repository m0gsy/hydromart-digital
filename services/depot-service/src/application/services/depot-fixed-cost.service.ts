import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AuthenticatedUser,
  ImportRowOutcome,
  ImportSummary,
  INT4_MAX,
  localMonthKey,
  recordAuditEvent,
  runImport,
} from '@hydromart/platform';

import { DepotFixedCost } from '../../domain/depot-fixed-cost';
import { ImportDepotFixedCostRowDto } from '../../modules/dto/depot-fixed-cost.dto';
import { DepotRepository } from '../ports/depot.repository';
import { DepotFixedCostRepository } from '../ports/depot-fixed-cost.repository';
import { DEPOT_TOKENS } from '../tokens';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const FIRST_YEAR = 2020;

/** A typo net: a month before the network existed, or more than a year ahead, is a mistyped year. */
export function monthInRange(month: string, now: Date = new Date()): boolean {
  if (!MONTH.test(month)) return false;
  const year = Number(month.slice(0, 4));
  return year >= FIRST_YEAR && year <= Number(localMonthKey(now).slice(0, 4)) + 1;
}
const CATEGORY_MAX = 40;
const NOTE_MAX = 200;

export interface DepotFixedCostMonth {
  month: string;
  totalIdr: number;
  byDepot: { depotId: string; depotCode: string; depotName: string; totalIdr: number }[];
  rows: DepotFixedCost[];
}

/**
 * HD-16 (D22): the fixed costs HQ enters per depot, month and category. Read by /hq/depot-costs;
 * the depot P&L join comes later. HQ overhead is not allocated to depots, so only depot rows exist.
 */
@Injectable()
export class DepotFixedCostService {
  private static readonly logger = new Logger(DepotFixedCostService.name);

  constructor(
    @Inject(DEPOT_TOKENS.DepotFixedCostRepository) private readonly costs: DepotFixedCostRepository,
    @Inject(DEPOT_TOKENS.DepotRepository) private readonly depots: DepotRepository,
  ) {}

  async list(month: string, depotId?: string): Promise<DepotFixedCostMonth> {
    const rows = await this.costs.listForMonth(month, depotId);
    const byDepot = new Map<string, DepotFixedCostMonth['byDepot'][number]>();
    for (const r of rows) {
      const line = byDepot.get(r.depotId) ?? {
        depotId: r.depotId,
        depotCode: r.depotCode,
        depotName: r.depotName,
        totalIdr: 0,
      };
      line.totalIdr += r.amountIdr;
      byDepot.set(r.depotId, line);
    }
    return {
      month,
      totalIdr: rows.reduce((sum, r) => sum + r.amountIdr, 0),
      byDepot: [...byDepot.values()],
      rows,
    };
  }

  async import(
    rows: readonly ImportDepotFixedCostRowDto[],
    user: AuthenticatedUser,
  ): Promise<ImportSummary> {
    const codes = [...new Set(rows.map((r) => r.depotCode.trim()).filter(Boolean))];
    const depotByCode = new Map((await this.depots.findManyByCodes(codes)).map((d) => [d.code, d.id]));
    // The same depot, month and category twice in one file is one cost typed twice: refuse the
    // second instead of letting the later row silently win.
    const firstSeen = new Map<string, number>();

    const months = new Set<string>();
    const summary = await runImport(rows, async (row, i): Promise<ImportRowOutcome> => {
      const code = row.depotCode.trim();
      if (!code) throw new Error('Kode depot kosong');
      const depotId = depotByCode.get(code);
      if (!depotId) throw new Error(`Depot ${code} tidak ditemukan`);
      const month = row.month.trim();
      if (!monthInRange(month)) {
        throw new Error(`Bulan "${row.month}" harus berformat YYYY-MM, tahun ${FIRST_YEAR} sampai tahun depan`);
      }
      const category = row.category.trim().replace(/\s+/g, ' ').toLowerCase();
      if (!category) throw new Error('Kategori kosong');
      if (category.length > CATEGORY_MAX) throw new Error(`Kategori maksimal ${CATEGORY_MAX} karakter`);
      if (!Number.isInteger(row.amountIdr) || row.amountIdr < 0 || row.amountIdr > INT4_MAX) {
        throw new Error('Jumlah harus bilangan bulat rupiah, 0 atau lebih');
      }
      const note = row.note?.trim() || null;
      if (note && note.length > NOTE_MAX) throw new Error(`Catatan maksimal ${NOTE_MAX} karakter`);

      const key = `${depotId}|${month}|${category}`;
      months.add(month);
      const first = firstSeen.get(key);
      if (first !== undefined) {
        throw new Error(`${code} ${month} "${category}" muncul lebih dari sekali di file (baris ${first + 1})`);
      }
      firstSeen.set(key, i);

      const current = await this.costs.find(depotId, month, category);
      if (current && current.amountIdr === row.amountIdr && current.note === note) {
        return { status: 'skipped', id: current.id, message: 'Sama dengan yang sudah tersimpan' };
      }
      const data = { depotId, month, category, amountIdr: row.amountIdr, note, updatedBy: user.sub };
      try {
        await this.costs.upsert(data);
      } catch (err) {
        // Another import created the same key between our read and write: it exists now, so overwrite it.
        if ((err as { code?: string })?.code !== 'P2002') throw err;
        await this.costs.upsert(data);
        return { status: 'updated', id: (await this.costs.find(depotId, month, category))?.id };
      }
      return { status: current ? 'updated' : 'created', id: current?.id };
    });

    await recordAuditEvent(
      {
        authServiceUrl: process.env.AUTH_SERVICE_URL ?? '',
        internalServiceKey: process.env.INTERNAL_SERVICE_KEY ?? '',
      },
      {
        action: 'depot.fixedcost.import',
        actorId: user.sub,
        target: `${rows.length} baris`,
        metadata: {
          months: [...months].sort(),
          depots: depotByCode.size,
          created: summary.created,
          updated: summary.updated,
          skipped: summary.skipped,
          failed: summary.failed,
        },
      },
      DepotFixedCostService.logger,
    );
    return summary;
  }
}
