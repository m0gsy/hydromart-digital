import { Injectable } from '@nestjs/common';

import { Holiday, Prisma } from '../../../prisma/generated/client';
import { HolidayRepository } from '../../application/ports/holiday.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class HolidayPrismaRepository implements HolidayRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { date: Date; name: string; depotId: string | null }): Promise<Holiday> {
    return this.prisma.holiday.create({ data });
  }

  list(filter: { depotId?: string; from?: Date; to?: Date }): Promise<Holiday[]> {
    const where: Prisma.HolidayWhereInput = {
      ...(filter.depotId ? { depotId: filter.depotId } : {}),
      ...(filter.from || filter.to
        ? { date: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
        : {}),
    };
    return this.prisma.holiday.findMany({ where, orderBy: { date: 'asc' } });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.holiday.delete({ where: { id } });
  }

  findById(id: string): Promise<Holiday | null> {
    return this.prisma.holiday.findUnique({ where: { id } });
  }

  async listDates(depotId: string, from: Date, to: Date): Promise<string[]> {
    // National (depotId null) holidays apply everywhere; depot-specific ones add to them.
    const rows = await this.prisma.holiday.findMany({
      where: { date: { gte: from, lte: to }, OR: [{ depotId: null }, { depotId }] },
      select: { date: true },
    });
    return rows.map((r) => r.date.toISOString().slice(0, 10));
  }
}
