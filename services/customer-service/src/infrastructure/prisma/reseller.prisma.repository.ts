import { Injectable } from '@nestjs/common';

import {
  CreateResellerData,
  PricedField,
  RecordPriceChangeData,
  Reseller,
  ResellerPriceChange,
  ResellerRepository,
  UpdateResellerData,
} from '../../application/ports/reseller.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class ResellerPrismaRepository implements ResellerRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(filter: { homeDepotIds?: readonly string[]; active?: boolean }): Promise<Reseller[]> {
    return this.prisma.resellerProfile.findMany({
      where: {
        ...(filter.homeDepotIds ? { homeDepotId: { in: [...filter.homeDepotIds] } } : {}),
        ...(filter.active != null ? { active: filter.active } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(customerId: string): Promise<Reseller | null> {
    return this.prisma.resellerProfile.findUnique({ where: { customerId } });
  }

  create(data: CreateResellerData): Promise<Reseller> {
    return this.prisma.resellerProfile.create({
      data: {
        customerId: data.customerId,
        homeDepotId: data.homeDepotId,
        monthlyTargetQty: data.monthlyTargetQty,
        discountPct: data.discountPct ?? 0,
        flatGallonPriceIdr: data.flatGallonPriceIdr ?? 0,
        photoUrl: data.photoUrl ?? null,
        joinDate: data.joinDate,
        note: data.note ?? null,
      },
    });
  }

  update(customerId: string, patch: UpdateResellerData): Promise<Reseller> {
    return this.prisma.resellerProfile.update({ where: { customerId }, data: patch });
  }

  async recordPriceChange(data: RecordPriceChangeData): Promise<ResellerPriceChange> {
    const row = await this.prisma.resellerPriceChange.create({ data });
    return toChange(row);
  }

  async listPriceChanges(customerId: string, limit: number): Promise<ResellerPriceChange[]> {
    const rows = await this.prisma.resellerPriceChange.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toChange);
  }

  async findDuePriceChanges(now: Date, limit: number): Promise<ResellerPriceChange[]> {
    const rows = await this.prisma.resellerPriceChange.findMany({
      where: { appliedAt: null, effectiveAt: { lte: now } },
      // Oldest first: two scheduled changes to the same field must land in the order they
      // were scheduled, or the agen ends up on whichever one the page size happened to hit.
      orderBy: { effectiveAt: 'asc' },
      take: limit,
    });
    return rows.map(toChange);
  }

  async markPriceChangeApplied(id: string, at: Date): Promise<void> {
    await this.prisma.resellerPriceChange.update({ where: { id }, data: { appliedAt: at } });
  }
}

/** `field` is TEXT in the database (three values sharing one column pair, K4.2). */
function toChange(
  row: { field: string } & Omit<ResellerPriceChange, 'field'>,
): ResellerPriceChange {
  return { ...row, field: row.field as PricedField };
}
