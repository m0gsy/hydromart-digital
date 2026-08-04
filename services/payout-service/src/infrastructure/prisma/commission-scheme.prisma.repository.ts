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

  async listCurrent(): Promise<CommissionSchemeRecord[]> {
    // Real DISTINCT ON, in Postgres. Prisma's `distinct` option dedupes the rows the
    // query returned, so a page bound over the scheme HISTORY would drop whole depots
    // from this list — and a depot with no current pct is a franchise commission that
    // silently stops being paid.
    const rows = await this.prisma.$queryRaw<SchemeRow[]>`
      SELECT DISTINCT ON ("depotId") *
      FROM "commission_schemes"
      ORDER BY "depotId" ASC, "effectiveDate" DESC
    `;
    return rows.map((r) => this.toRecord(r));
  }

  async createMany(rows: CreateCommissionSchemeData[]): Promise<CommissionSchemeRecord[]> {
    // One create per row inside a transaction so we can return the persisted records.
    const created = await this.prisma.$transaction(
      rows.map((r) => this.prisma.commissionScheme.create({ data: r })),
    );
    return created.map((r) => this.toRecord(r as unknown as SchemeRow));
  }
}
