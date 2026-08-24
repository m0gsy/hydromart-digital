import { Injectable } from '@nestjs/common';

import { Subscription, SubscriptionCadence, SubscriptionStatus } from '../../domain/subscription';
import {
  CreateSubscriptionData,
  SubscriptionRepository,
  UpdateSubscriptionData,
} from '../../application/ports/subscription.repository';
import { PrismaService } from './prisma.service';

interface SubscriptionRow {
  id: string;
  depotId: string;
  customerId: string | null;
  customerName: string;
  productLabel: string;
  quantity: number;
  cadence: string;
  status: string;
  nextRunAt: Date | null;
  productId: string | null;
  orderSubscriptionId: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SubscriptionPrismaRepository implements SubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: SubscriptionRow): Subscription {
    return {
      ...row,
      cadence: row.cadence as SubscriptionCadence,
      status: row.status as SubscriptionStatus,
    };
  }

  async create(data: CreateSubscriptionData): Promise<Subscription> {
    const row = await this.prisma.subscription.create({ data });
    return this.toRecord(row);
  }

  async listForDepot(depotId: string, status?: SubscriptionStatus): Promise<Subscription[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { depotId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async activeCustomerIdsForDepot(depotId: string): Promise<string[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { depotId, status: SubscriptionStatus.ACTIVE, customerId: { not: null } },
      select: { customerId: true },
      distinct: ['customerId'],
    });
    return rows.map((r) => r.customerId as string);
  }

  async networkActiveCounts(): Promise<{
    activeSubscriptions: number;
    activeSubscribers: number;
  }> {
    // Two reads rather than one grouped query: `count` with `distinct` is not a thing in
    // Prisma, and the subscriber figure has to be DISTINCT or a person on two plans is
    // counted as two people. Both are bounded aggregates over one indexed status column.
    const [activeSubscriptions, subscribers] = await Promise.all([
      this.prisma.subscription.count({ where: { status: SubscriptionStatus.ACTIVE } }),
      this.prisma.subscription.findMany({
        where: { status: SubscriptionStatus.ACTIVE, customerId: { not: null } },
        select: { customerId: true },
        distinct: ['customerId'],
      }),
    ]);
    return { activeSubscriptions, activeSubscribers: subscribers.length };
  }

  async findById(id: string): Promise<Subscription | null> {
    const row = await this.prisma.subscription.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async update(id: string, data: UpdateSubscriptionData): Promise<Subscription> {
    const row = await this.prisma.subscription.update({ where: { id }, data });
    return this.toRecord(row);
  }
}
