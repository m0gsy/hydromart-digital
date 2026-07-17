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

  async listByCustomer(customerId: string): Promise<SubscriptionRecord[]> {
    const rows = await this.prisma.subscription.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
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

  async advance(id: string, nextDeliveryAt: Date): Promise<SubscriptionRecord> {
    const row = await this.prisma.subscription.update({ where: { id }, data: { nextDeliveryAt } });
    return this.toRecord(row);
  }

  async networkSummary(): Promise<SubscriptionNetworkSummary> {
    const [grouped, distinctCustomers] = await Promise.all([
      this.prisma.subscription.groupBy({
        by: ['productName', 'frequency'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
      this.prisma.subscription.findMany({
        where: { status: 'ACTIVE' },
        distinct: ['customerId'],
        select: { customerId: true },
      }),
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
      activeSubscribers: distinctCustomers.length,
      plans,
    };
  }
}
