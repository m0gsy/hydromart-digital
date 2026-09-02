import { Injectable } from '@nestjs/common';

import { CommissionSchemeRecord } from '../../domain/commission';
import {
  CommissionSchemeRepository,
  CreateCommissionSchemeData,
} from '../../application/ports/commission-scheme.repository';
import { PrismaService } from './prisma.service';

interface SchemeRow {
  id: string;
  depotId: string;
  ownerName: string | null;
  pct: unknown; // Prisma Decimal
  effectiveDate: Date;
  createdAt: Date;
}

@Injectable()
export class CommissionSchemePrismaRepository implements CommissionSchemeRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: SchemeRow): CommissionSchemeRecord {
    return { ...row, pct: Number(row.pct) };
  }

  /*
   * `effectiveDate <= asOf` on both reads, and its absence was a live money bug — the same
   * one `courier-ledger.prisma.repository.ts:currentRule` was fixed for in #413, on the
   * table beside this one.
   *
   * Both queries ordered by effective date descending and took the first row, with no
   * filter on the date at all, so a scheme dated in the FUTURE was the one billing a
   * franchise today: `payout.service.ts:183` reads `currentForDepot(depotId)?.pct` on
   * EVERY completed order, and `/hq/reconciliation` reads `listCurrent()` as the rate a
   * franchise owner is told they are being charged. "Terapkan skema baru" offers an
   * effective date, and the field named "effective date" was a sort key, not a gate.
   *
   * A typo in the year therefore did not schedule a rate change, it made one instantly and
   * silently — and the ledger balanced either way, so nothing looked broken.
   *
   * Rows already billed under a not-yet-effective scheme cannot be healed from here; they
   * are a section of `scripts/report-damaged-rows.sh` (read-only, counts first).
   */
  async listCurrent(asOf: Date = new Date()): Promise<CommissionSchemeRecord[]> {
    // Real DISTINCT ON, in Postgres. Prisma's `distinct` option dedupes the rows the
    // query returned, so a page bound over the scheme HISTORY would drop whole depots
    // from this list — and a depot with no current pct is a franchise commission that
    // silently stops being paid.
    const rows = await this.prisma.$queryRaw<SchemeRow[]>`
      SELECT DISTINCT ON ("depotId") *
      FROM "commission_schemes"
      WHERE "effectiveDate" <= ${asOf}
      ORDER BY "depotId" ASC, "effectiveDate" DESC
    `;
    return rows.map((r) => this.toRecord(r));
  }

  async currentForDepot(
    depotId: string,
    asOf: Date = new Date(),
  ): Promise<CommissionSchemeRecord | null> {
    const row = await this.prisma.commissionScheme.findFirst({
      where: { depotId, effectiveDate: { lte: asOf } },
      orderBy: { effectiveDate: 'desc' },
    });
    return row ? this.toRecord(row as unknown as SchemeRow) : null;
  }

  async createMany(rows: CreateCommissionSchemeData[]): Promise<CommissionSchemeRecord[]> {
    // One create per row inside a transaction so we can return the persisted records.
    const created = await this.prisma.$transaction(
      rows.map((r) => this.prisma.commissionScheme.create({ data: r })),
    );
    return created.map((r) => this.toRecord(r as unknown as SchemeRow));
  }
}
