import { Injectable } from '@nestjs/common';

import {
  AdminNotificationPrefRecord,
  AdminNotificationPrefRepository,
  NotificationChannelPref,
} from '../../application/ports/admin-notification-pref.repository';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class AdminNotificationPrefPrismaRepository implements AdminNotificationPrefRepository {
  constructor(private readonly prisma: PrismaService) {}

  async get(accountId: string): Promise<AdminNotificationPrefRecord | null> {
    const row = await this.prisma.adminNotificationPref.findUnique({ where: { accountId } });
    if (!row) return null;
    return {
      accountId: row.accountId,
      channels: row.channels as unknown as NotificationChannelPref[],
      updatedAt: row.updatedAt,
    };
  }

  async getMany(accountIds: readonly string[]): Promise<AdminNotificationPrefRecord[]> {
    if (accountIds.length === 0) return [];
    const rows = await this.prisma.adminNotificationPref.findMany({
      where: { accountId: { in: [...accountIds] } },
    });
    return rows.map((row) => ({
      accountId: row.accountId,
      channels: row.channels as unknown as NotificationChannelPref[],
      updatedAt: row.updatedAt,
    }));
  }

  async save(
    accountId: string,
    channels: NotificationChannelPref[],
  ): Promise<AdminNotificationPrefRecord> {
    const json = channels as unknown as Prisma.InputJsonValue;
    const row = await this.prisma.adminNotificationPref.upsert({
      where: { accountId },
      update: { channels: json },
      create: { accountId, channels: json },
    });
    return {
      accountId: row.accountId,
      channels: row.channels as unknown as NotificationChannelPref[],
      updatedAt: row.updatedAt,
    };
  }
}
