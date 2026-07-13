import { Injectable } from '@nestjs/common';

import { NotificationStatus } from '../../domain/notification-status';
import {
  NotificationRecord,
  NotificationRepository,
  RecordNotificationData,
} from '../../application/ports/notification.repository';
import { NotificationStatus as PrismaNotificationStatus } from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

// Prisma enums are structurally distinct from the domain enums; rows are typed with a
// `string` status and cast back to the domain enum here (infra only).
interface NotificationRow {
  id: string;
  event: string;
  customerId: string | null;
  phone: string;
  message: string;
  status: string;
  error: string | null;
  createdAt: Date;
}

@Injectable()
export class NotificationPrismaRepository implements NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: NotificationRow): NotificationRecord {
    return { ...row, status: row.status as NotificationStatus };
  }

  async record(data: RecordNotificationData): Promise<NotificationRecord> {
    const row = await this.prisma.notification.create({
      data: {
        event: data.event,
        customerId: data.customerId,
        phone: data.phone,
        message: data.message,
        status: data.status as unknown as PrismaNotificationStatus,
        error: data.error,
      },
    });
    return this.toRecord(row);
  }

  async listForCustomer(customerId: string, limit: number): Promise<NotificationRecord[]> {
    const rows = await this.prisma.notification.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }

  async listByEvents(events: string[], limit: number): Promise<NotificationRecord[]> {
    const rows = await this.prisma.notification.findMany({
      where: { event: { in: events } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map((row) => this.toRecord(row));
  }
}
