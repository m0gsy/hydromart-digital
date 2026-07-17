import { Injectable } from '@nestjs/common';

import {
  NotificationPreferenceRecord,
  NotificationPreferenceRepository,
} from '../../application/ports/notification.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class NotificationPrismaRepository implements NotificationPreferenceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByCustomerId(customerId: string): Promise<NotificationPreferenceRecord | null> {
    const row = await this.prisma.notificationPreference.findUnique({ where: { customerId } });
    return row ? toRecord(row) : null;
  }

  async upsert(record: NotificationPreferenceRecord): Promise<NotificationPreferenceRecord> {
    const { push, email, whatsapp, categories } = record;
    const row = await this.prisma.notificationPreference.upsert({
      where: { customerId: record.customerId },
      create: { customerId: record.customerId, push, email, whatsapp, categories },
      update: { push, email, whatsapp, categories },
    });
    return toRecord(row);
  }
}

function toRecord(row: {
  customerId: string;
  push: boolean;
  email: boolean;
  whatsapp: boolean;
  categories: unknown;
}): NotificationPreferenceRecord {
  return {
    customerId: row.customerId,
    push: row.push,
    email: row.email,
    whatsapp: row.whatsapp,
    categories:
      row.categories && typeof row.categories === 'object'
        ? (row.categories as Record<string, boolean>)
        : {},
  };
}
