import { Injectable } from '@nestjs/common';

import { GallonReminderRepository } from '../../application/ports/gallon-reminder.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class GallonReminderPrismaRepository implements GallonReminderRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lastRemindedAt(
    depotId: string,
    customerIds: readonly string[],
  ): Promise<Map<string, Date>> {
    // Not asked at all for an empty set: `in: []` matches nothing, but it is still a round trip.
    if (customerIds.length === 0) return new Map();
    const rows = await this.prisma.gallonReminder.findMany({
      where: { depotId, customerId: { in: [...customerIds] } },
      select: { customerId: true, remindedAt: true },
    });
    return new Map(rows.map((r) => [r.customerId, r.remindedAt]));
  }

  async markReminded(depotId: string, customerId: string, at: Date): Promise<void> {
    await this.prisma.gallonReminder.upsert({
      where: { depotId_customerId: { depotId, customerId } },
      create: { depotId, customerId, remindedAt: at },
      update: { remindedAt: at },
    });
  }
}
