import { Injectable } from '@nestjs/common';

import { OrderStatus as DbOrderStatus } from '../../../prisma/generated/client';
import {
  CustomerOutreachRepository,
  DueSubscriptionRow,
  StatusOrderRow,
  UnpaidCandidateRow,
} from '../../application/ports/customer-outreach.repository';
import { abandonSweepEligible } from '../../domain/abandon-sweep';
import { ANONYMOUS_CUSTOMER_ID } from '../../domain/anonymous';
import { PrismaService } from './prisma.service';

const RUNNING = [
  DbOrderStatus.CREATED,
  DbOrderStatus.CONFIRMED,
  DbOrderStatus.PREPARING,
  DbOrderStatus.DRIVER_ASSIGNED,
  DbOrderStatus.PICKED_UP,
  DbOrderStatus.ON_DELIVERY,
];
const RUNNING_CAP = 20;

/**
 * Named columns only: the address, the recipient, the phone and the courier are never selected,
 * so the answer to n8n cannot carry them whatever a mapper later forgets to drop.
 */
const STATUS_SELECT = {
  id: true,
  orderNumber: true,
  createdAt: true,
  status: true,
  total: true,
  depotId: true,
  deliveryWindow: true,
  scheduledFor: true,
  items: { select: { productName: true, quantity: true } },
} as const;

/** HD-18: plain Prisma reads for the n8n routes. All instants are real instants, no zone conversion here. */
@Injectable()
export class CustomerOutreachPrismaRepository implements CustomerOutreachRepository {
  constructor(private readonly prisma: PrismaService) {}

  async statusOrders(customerId: string, finished: number) {
    const [running, recent] = await Promise.all([
      this.prisma.order.findMany({
        where: { customerId, status: { in: RUNNING } },
        orderBy: { createdAt: 'desc' },
        take: RUNNING_CAP,
        select: STATUS_SELECT,
      }),
      this.prisma.order.findMany({
        where: { customerId, status: { notIn: RUNNING } },
        orderBy: { createdAt: 'desc' },
        take: finished,
        select: STATUS_SELECT,
      }),
    ]);
    const map = (r: (typeof running)[number]): StatusOrderRow => ({ ...r, total: r.total.toNumber() });
    return { running: running.map(map), recent: recent.map(map) };
  }

  async subscriptionsDueBetween(from: Date, to: Date, limit: number): Promise<DueSubscriptionRow[]> {
    return this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', nextDeliveryAt: { gte: from, lt: to } },
      orderBy: { nextDeliveryAt: 'asc' },
      take: limit,
      select: { id: true, customerId: true, productName: true, quantity: true, nextDeliveryAt: true, latitude: true, longitude: true },
    });
  }

  async createdOrdersBetween(after: Date, upTo: Date, limit: number): Promise<UnpaidCandidateRow[]> {
    const rows = await this.prisma.order.findMany({
      where: {
        status: DbOrderStatus.CREATED,
        isWalkIn: false,
        // The sweep's own exemptions (subscription deliveries, orders booked for a later slot),
        // judged at the window's lower edge `after`: every order in the window is younger, so it
        // is cancelled at its window's end for certain, and "cancelled automatically" is true.
        ...abandonSweepEligible(after),
        customerId: { not: ANONYMOUS_CUSTOMER_ID },
        statusChangedAt: { gt: after, lte: upTo },
      },
      orderBy: { statusChangedAt: 'asc' },
      take: limit,
      select: { id: true, customerId: true, orderNumber: true, total: true, depotId: true },
    });
    return rows.map((r) => ({ ...r, total: r.total.toNumber() }));
  }
}
