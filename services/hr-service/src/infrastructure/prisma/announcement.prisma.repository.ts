import { Injectable } from '@nestjs/common';

import { Announcement, AnnouncementRead } from '../../../prisma/generated/client';
import {
  AnnouncementListFilter,
  AnnouncementRepository,
  AnnouncementTargetWrite,
  AnnouncementWithTargets,
  AnnouncementWrite,
} from '../../application/ports/announcement.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class AnnouncementPrismaRepository implements AnnouncementRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: AnnouncementWrite,
    targets: AnnouncementTargetWrite[],
  ): Promise<AnnouncementWithTargets> {
    return this.prisma.announcement.create({
      data: { ...data, targets: { create: targets } },
      include: { targets: true },
    });
  }

  findById(id: string): Promise<AnnouncementWithTargets | null> {
    return this.prisma.announcement.findUnique({ where: { id }, include: { targets: true } });
  }

  async list(
    filter: AnnouncementListFilter,
  ): Promise<{ rows: AnnouncementWithTargets[]; total: number }> {
    const where = filter.publishedOnly ? { publishedAt: { not: null } } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.announcement.findMany({
        where,
        include: { targets: true },
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.announcement.count({ where }),
    ]);
    return { rows, total };
  }

  listPublished(limit: number): Promise<AnnouncementWithTargets[]> {
    return this.prisma.announcement.findMany({
      where: { publishedAt: { not: null } },
      include: { targets: true },
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });
  }

  listDue(now: Date): Promise<AnnouncementWithTargets[]> {
    return this.prisma.announcement.findMany({
      where: { publishedAt: null, scheduledAt: { not: null, lte: now } },
      include: { targets: true },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  markPublished(id: string, publishedAt: Date, audienceSize: number): Promise<Announcement> {
    return this.prisma.announcement.update({ where: { id }, data: { publishedAt, audienceSize } });
  }

  markRead(announcementId: string, employeeId: string): Promise<AnnouncementRead> {
    // upsert with an empty update: the FIRST readAt is the one that means anything.
    return this.prisma.announcementRead.upsert({
      where: { announcementId_employeeId: { announcementId, employeeId } },
      create: { announcementId, employeeId },
      update: {},
    });
  }

  countReads(announcementId: string): Promise<number> {
    return this.prisma.announcementRead.count({ where: { announcementId } });
  }

  async listReadIdsFor(employeeId: string, announcementIds: string[]): Promise<string[]> {
    const rows = await this.prisma.announcementRead.findMany({
      where: { employeeId, announcementId: { in: announcementIds } },
      select: { announcementId: true },
    });
    return rows.map((r) => r.announcementId);
  }
}
