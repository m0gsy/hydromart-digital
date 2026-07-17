import { Injectable } from '@nestjs/common';

import {
  PushSubscriptionRepository,
  SaveSubscriptionData,
  WebPushSubscriptionRecord,
} from '../../application/ports/push.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class PushSubscriptionPrismaRepository implements PushSubscriptionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: SaveSubscriptionData): Promise<WebPushSubscriptionRecord> {
    const row = await this.prisma.webPushSubscription.upsert({
      where: { endpoint: data.endpoint },
      create: data,
      update: { customerId: data.customerId, p256dh: data.p256dh, auth: data.auth },
    });
    return toRecord(row);
  }

  async listForCustomer(customerId: string): Promise<WebPushSubscriptionRecord[]> {
    const rows = await this.prisma.webPushSubscription.findMany({ where: { customerId } });
    return rows.map(toRecord);
  }

  async deleteByEndpoint(endpoint: string): Promise<void> {
    await this.prisma.webPushSubscription.deleteMany({ where: { endpoint } });
  }
}

function toRecord(row: {
  id: string;
  customerId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}): WebPushSubscriptionRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
  };
}
