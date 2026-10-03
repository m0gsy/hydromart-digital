import { Injectable } from '@nestjs/common';

import {
  CreatePromoRuleData,
  PromoRuleRecord,
  PromoRuleRepository,
  UpdatePromoRuleData,
} from '../../application/ports/promo-rule.repository';
import { PromoRuleCandidate } from '../../domain/promo-rule';
import { PrismaService } from './prisma.service';

// Visible to a depot-scoped caller: network-wide (depotId null) OR one of their own depots.
// `undefined` depotIds = no filter at all (network-wide caller sees every rule).
const depotVisibleWhere = (depotIds?: readonly string[]) =>
  depotIds ? { OR: [{ depotId: null }, { depotId: { in: [...depotIds] } }] } : {};

const ORDER_BY = [{ createdAt: 'desc' as const }];

@Injectable()
export class PromoRulePrismaRepository implements PromoRuleRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<PromoRuleRecord | null> {
    return this.prisma.promoRule.findUnique({ where: { id } });
  }

  async create(data: CreatePromoRuleData): Promise<PromoRuleRecord> {
    return this.prisma.promoRule.create({ data });
  }

  async update(id: string, data: UpdatePromoRuleData): Promise<PromoRuleRecord> {
    return this.prisma.promoRule.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.promoRule.delete({ where: { id } });
  }

  async findAll(depotIds?: readonly string[]): Promise<PromoRuleRecord[]> {
    return this.prisma.promoRule.findMany({
      where: depotVisibleWhere(depotIds),
      orderBy: ORDER_BY,
    });
  }

  async findActiveCandidates(
    depotIds: readonly string[] | undefined,
    now: Date,
  ): Promise<PromoRuleCandidate[]> {
    return this.prisma.promoRule.findMany({
      where: {
        active: true,
        ...depotVisibleWhere(depotIds),
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
        ],
      },
    });
  }

  async recordApplication(data: {
    orderId: string;
    promoRuleId: string;
    productId: string | null;
    discountValue: number;
  }): Promise<void> {
    await this.prisma.promoApplication.create({ data });
  }

  async hasApplicationFor(orderId: string): Promise<boolean> {
    const count = await this.prisma.promoApplication.count({ where: { orderId } });
    return count > 0;
  }
}
