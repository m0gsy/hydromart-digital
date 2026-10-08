import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  CreatePromoRuleData,
  PromoRuleRecord,
  PromoRuleRepository,
  PromoRuleUsage,
  UpdatePromoRuleData,
} from '../../application/ports/promo-rule.repository';
import { PromoRuleInUseError } from '../../domain/errors';
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
    try {
      await this.prisma.promoRule.delete({ where: { id } });
    } catch (error) {
      // PromoApplication.promoRule is onDelete: Restrict (DB-10: an audit row must survive
      // its rule), so deleting a rule that has fired at least once throws Postgres FK
      // violation P2003. Surface it as a clean 409, not a raw 500.
      if ((error as { code?: string })?.code === 'P2003') throw new PromoRuleInUseError();
      throw error;
    }
  }

  async findAll(depotIds?: readonly string[]): Promise<PromoRuleRecord[]> {
    return this.prisma.promoRule.findMany({
      where: depotVisibleWhere(depotIds),
      orderBy: ORDER_BY,
    });
  }

  async usageByRule(depotIds?: readonly string[]): Promise<PromoRuleUsage[]> {
    const visible = await this.prisma.promoRule.findMany({
      where: depotVisibleWhere(depotIds),
      select: { id: true },
    });
    if (visible.length === 0) return [];
    // Raw, because Prisma's groupBy counts ROWS and one order can write several audit rows for
    // the same rule (one per product). bigint so a busy rule's rupiah sum cannot overflow int4.
    const rows = await this.prisma.$queryRaw<
      { promoRuleId: string; orders: bigint; discount: bigint; lastAppliedAt: Date | null }[]
    >(Prisma.sql`
      SELECT a."promoRuleId",
             COUNT(DISTINCT a."orderId") AS "orders",
             COALESCE(SUM(a."discountValue"), 0) AS "discount",
             MAX(a."createdAt") AS "lastAppliedAt"
      FROM "promo_applications" a
      WHERE a."promoRuleId" IN (${Prisma.join(visible.map((v) => v.id))})
      GROUP BY a."promoRuleId"`);
    return rows.map((r) => ({
      promoRuleId: r.promoRuleId,
      orders: Number(r.orders),
      totalDiscount: Number(r.discount),
      lastAppliedAt: r.lastAppliedAt,
    }));
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

  async recordApplications(
    orderId: string,
    rows: { promoRuleId: string; productId: string | null; discountValue: number }[],
  ): Promise<void> {
    await this.prisma
      .$transaction(async (tx) => {
        await tx.promoApplication.createMany({
          data: rows.map((r) => ({ orderId, ...r })),
        });
      })
      .catch(async (error: unknown) => {
        // Same discipline as VoucherRepository.redeemAtomic: read back before deciding what a
        // P2002 means, never swallow it blind. A P2002 whose cause is a concurrent/retried
        // apply() call for this SAME order means those rows already exist — safe to treat as
        // success. A P2002 with nothing for this order to show (a different order's row
        // colliding some other way, or an in-batch duplicate the service's merge missed) is a
        // real failure; rethrow the original error rather than silently writing zero rows.
        if ((error as { code?: string })?.code !== 'P2002') throw error;
        const count = await this.prisma.promoApplication.count({ where: { orderId } });
        if (count === 0) throw error;
      });
  }

  async hasApplicationFor(orderId: string): Promise<boolean> {
    const count = await this.prisma.promoApplication.count({ where: { orderId } });
    return count > 0;
  }
}
