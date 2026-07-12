import { Injectable } from '@nestjs/common';

import {
  CreatePromotionData,
  PromotionRecord,
  PromotionRepository,
  UpdatePromotionData,
} from '../../application/ports/promotion.repository';
import { PrismaService } from './prisma.service';

// Live at `now`: active AND started (startsAt null | <= now) AND not ended
// (endsAt null | >= now). Mirrors domain/isPromotionLiveAt as a Prisma filter.
const liveWhere = (now: Date) => ({
  active: true,
  AND: [
    { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
    { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
  ],
});

const ORDER_BY = [{ sortOrder: 'asc' as const }, { createdAt: 'desc' as const }];

@Injectable()
export class PromotionPrismaRepository implements PromotionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<PromotionRecord | null> {
    return this.prisma.promotion.findUnique({ where: { id } });
  }

  async create(data: CreatePromotionData): Promise<PromotionRecord> {
    return this.prisma.promotion.create({ data });
  }

  async update(id: string, data: UpdatePromotionData): Promise<PromotionRecord> {
    return this.prisma.promotion.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.promotion.delete({ where: { id } });
  }

  async findAll(): Promise<PromotionRecord[]> {
    return this.prisma.promotion.findMany({ orderBy: ORDER_BY });
  }

  async findActive(now: Date): Promise<PromotionRecord[]> {
    return this.prisma.promotion.findMany({ where: liveWhere(now), orderBy: ORDER_BY });
  }
}
