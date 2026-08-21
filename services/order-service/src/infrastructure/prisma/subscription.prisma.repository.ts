import { Injectable } from '@nestjs/common';

import {
  CreateSubscriptionData,
  SubscriptionFrequency,
  SubscriptionNetworkSummary,
  SubscriptionRecord,
  SubscriptionRepository,
  SubscriptionStatus,
} from '../../application/ports/subscription.repository';
import { PrismaService } from './prisma.service';

interface SubscriptionRow {
  id: string;
  customerId: string;
  productId: string;
  productName: string;
  unit: string;
  quantity: number;
  frequency: string;
  status: string;
  nextDeliveryAt: Date;
  recipientName: string;
  phone: string;
  addressLine: string;
  city: string;
  province: string;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * D4: how many cancelled plans the customer list carries back. Not a setting — nobody
 * tunes "how much of my own history do I want"; it is a bound on an unbounded read.
 */
const CANCELLED_HISTORY = 5;

@Injectable()
export class SubscriptionPrismaRepository implements SubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: SubscriptionRow): SubscriptionRecord {
    return {
      id: row.id,
      customerId: row.customerId,
      productId: row.productId,
      productName: row.productName,
      unit: row.unit,
      quantity: row.quantity,
      frequency: row.frequency as SubscriptionFrequency,
      status: row.status as SubscriptionStatus,
      nextDeliveryAt: row.nextDeliveryAt,
      recipientName: row.recipientName,
      phone: row.phone,
      addressLine: row.addressLine,
      city: row.city,
      province: row.province,
      postalCode: row.postalCode,
      latitude: row.latitude,
      longitude: row.longitude,
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(data: CreateSubscriptionData): Promise<SubscriptionRecord> {
    const row = await this.prisma.subscription.create({ data });
    return this.toRecord(row);
  }

  async findById(id: string): Promise<SubscriptionRecord | null> {
    const row = await this.prisma.subscription.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  /**
   * D4: cancel is terminal, so cancelled plans used to accumulate in this list forever —
   * an unbounded read that grows for the life of the account and buries the two or three
   * plans the customer actually has.
   *
   * Live plans are always all returned: there is no such thing as "too many" of those, and
   * hiding one would hide a standing charge. Cancelled ones are kept, but bounded — the
   * recent few, which is what "what did I cancel?" ever means.
   */
  async listByCustomer(customerId: string): Promise<SubscriptionRecord[]> {
    const [live, cancelled] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { customerId, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.subscription.findMany({
        where: { customerId, status: 'CANCELLED' },
        orderBy: { createdAt: 'desc' },
        take: CANCELLED_HISTORY,
      }),
    ]);
    return [...live, ...cancelled].map((r) => this.toRecord(r));
  }

  async findDue(now: Date): Promise<SubscriptionRecord[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', nextDeliveryAt: { lte: now } },
      orderBy: { nextDeliveryAt: 'asc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async setStatus(id: string, status: SubscriptionStatus): Promise<SubscriptionRecord> {
    const row = await this.prisma.subscription.update({ where: { id }, data: { status } });
    return this.toRecord(row);
  }

  /** D4: status and schedule in one write — see the port for why not two. */
  async resume(id: string, nextDeliveryAt: Date): Promise<SubscriptionRecord> {
    const row = await this.prisma.subscription.update({
      where: { id },
      data: { status: 'ACTIVE', nextDeliveryAt },
    });
    return this.toRecord(row);
  }

  async advance(id: string, from: Date, to: Date): Promise<boolean> {
    // updateMany, not update: the schedule predicate is not part of any unique key, and a
    // miss has to come back as a count rather than as an exception.
    const { count } = await this.prisma.subscription.updateMany({
      where: { id, status: 'ACTIVE', nextDeliveryAt: from },
      data: { nextDeliveryAt: to },
    });
    return count === 1;
  }

  async networkSummary(): Promise<SubscriptionNetworkSummary> {
    const [grouped, distinctCustomers] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['productName', 'frequency'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
      // COUNT(DISTINCT) in Postgres rather than fetching a row per subscriber and
      // deduping in the client: Prisma's `distinct` runs over the rows the query
      // returned, so any page bound turns "active subscribers" into "active subscribers
      // we happened to read" — a headline number that is quietly too low.
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT "customerId")::bigint AS count
        FROM "subscriptions"
        WHERE "status" = 'ACTIVE'::"SubscriptionStatus"
      `,
    ]);
    const plans = grouped
      .map((g) => ({
        productName: g.productName,
        frequency: g.frequency as SubscriptionFrequency,
        subscribers: g._count._all,
      }))
      .sort((a, b) => b.subscribers - a.subscribers);
    return {
      activeSubscriptions: plans.reduce((n, p) => n + p.subscribers, 0),
      activeSubscribers: Number(distinctCustomers[0]?.count ?? 0),
      plans,
    };
  }
}
