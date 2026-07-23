import { Injectable } from '@nestjs/common';

import { NotificationStatus } from '../../domain/notification-status';
import {
  NotificationRecord,
  NotificationRepository,
  OpsNotificationRecord,
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

  async listOpsFeedFor(events: string[], staffId: string, limit: number): Promise<OpsNotificationRecord[]> {
    // One query: the feed window plus *this* staff member's receipts (the relation filter
    // keeps other staff's reads out, so `opsReads` holds at most one row per notification).
    const rows = await this.prisma.notification.findMany({
      where: { event: { in: events } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { opsReads: { where: { staffId }, select: { readAt: true } } },
    });
    return rows.map(({ opsReads, ...row }) => ({
      ...this.toRecord(row),
      readAt: opsReads[0]?.readAt ?? null,
    }));
  }

  async markOpsRead(notificationId: string, events: string[], staffId: string): Promise<Date | null> {
    // Scoped to the ops event set so a staff member cannot mark a customer's inbox row.
    const found = await this.prisma.notification.findFirst({
      where: { id: notificationId, event: { in: events } },
      select: { id: true },
    });
    if (!found) return null;
    const read = await this.prisma.opsNotificationRead.upsert({
      where: { notificationId_staffId: { notificationId, staffId } },
      create: { notificationId, staffId },
      update: {}, // idempotent: a repeat read keeps the original timestamp
    });
    return read.readAt;
  }

  async markAllOpsRead(events: string[], staffId: string, limit: number): Promise<number> {
    const rows = await this.prisma.notification.findMany({
      where: { event: { in: events } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true },
    });
    if (rows.length === 0) return 0;
    const { count } = await this.prisma.opsNotificationRead.createMany({
      data: rows.map((row) => ({ notificationId: row.id, staffId })),
      skipDuplicates: true,
    });
    return count;
  }
}
