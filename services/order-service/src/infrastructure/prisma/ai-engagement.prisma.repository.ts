import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import { OrderStatus as DbOrderStatus } from '../../../prisma/generated/client';
import {
  AiEngagementRepository,
  AiSpan,
  DiscountTotals,
  NewSubscriptions,
} from '../../application/ports/ai-engagement.repository';
import { PrismaService } from './prisma.service';

const VOID_LIKE = [DbOrderStatus.CANCELLED, DbOrderStatus.VOIDED];
/** Most distinct subscribers one answer will group. Past it the answer is refused (422), never a partial count. */
export const AI_SUBSCRIBER_CAP = 50_000;

/** HD-6 H4 part 2: plain Prisma reads. Dates are real instants Prisma stores as UTC, so no raw-SQL zone conversion is involved. */
@Injectable()
export class AiEngagementPrismaRepository implements AiEngagementRepository {
  constructor(private readonly prisma: PrismaService) {}

  async discounts(spans: readonly AiSpan[]): Promise<DiscountTotals> {
    if (spans.length === 0) return { orders: 0, discountedOrders: 0, discountIdr: 0 };
    // The same orders every sales report counts: not cancelled, not voided, dated by when they were made.
    const where = {
      status: { notIn: VOID_LIKE },
      OR: spans.map((s) => ({ depotId: s.depotId, createdAt: { gte: s.from, lt: s.to } })),
    };
    const [all, discounted] = await Promise.all([
      this.prisma.order.aggregate({ where, _count: { _all: true } }),
      this.prisma.order.aggregate({ where: { ...where, discount: { gt: 0 } }, _count: { _all: true }, _sum: { discount: true } }),
    ]);
    return {
      orders: all._count._all,
      discountedOrders: discounted._count._all,
      discountIdr: discounted._sum.discount ? discounted._sum.discount.toNumber() : 0,
    };
  }

  async newSubscriptions(from: Date, to: Date): Promise<NewSubscriptions> {
    const [subscriptions, perPerson] = await Promise.all([
      this.prisma.subscription.count({ where: { createdAt: { gte: from, lt: to } } }),
      this.prisma.subscription.groupBy({
        by: ['customerId'],
        where: { createdAt: { gte: from, lt: to } },
        orderBy: { customerId: 'asc' },
        take: AI_SUBSCRIBER_CAP + 1,
      }),
    ]);
    if (perPerson.length > AI_SUBSCRIBER_CAP) {
      throw new UnprocessableEntityException(`Lebih dari ${AI_SUBSCRIBER_CAP} pelanggan berlangganan; persempit periode.`);
    }
    return { subscriptions, subscribers: perPerson.length };
  }
}
