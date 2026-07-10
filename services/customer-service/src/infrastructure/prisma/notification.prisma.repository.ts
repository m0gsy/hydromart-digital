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
    return row ? { customerId: row.customerId, push: row.push, email: row.email, whatsapp: row.whatsapp } : null;
  }

  async upsert(record: NotificationPreferenceRecord): Promise<NotificationPreferenceRecord> {
    const row = await this.prisma.notificationPreference.upsert({
      where: { customerId: record.customerId },
      create: record,
      update: { push: record.push, email: record.email, whatsapp: record.whatsapp },
    });
    return { customerId: row.customerId, push: row.push, email: row.email, whatsapp: row.whatsapp };
  }
}
