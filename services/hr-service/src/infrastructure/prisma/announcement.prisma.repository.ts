import { Injectable } from '@nestjs/common';

import { Announcement, AnnouncementRead, Prisma } from '../../../prisma/generated/client';
import {
  AnnouncementListFilter,
  AnnouncementRepository,
  AnnouncementTargetWrite,
  AnnouncementWithTargets,
  AnnouncementWrite,
  FeedAudience,
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
    /*
     * CA-1-29. Two narrowings, both of which used to be missing entirely.
     *
     * `publishedOnly` keeps drafts away from a reader who cannot write one — an unsent
     * notice is HQ thinking out loud, and it was visible to every `hrView` role including
     * a supervisor at a single depot.
     *
     * `depotIds` keeps another depot's notices away from them. A COMPANY-targeted row has
     * no depot value at all and reaches everyone, so it must survive the filter — matching
     * `targetCovers` in domain/announcement.ts, which is the same rule the employee feed
     * applies.
     */
    const where: Prisma.AnnouncementWhereInput = {
      ...(filter.publishedOnly ? { publishedAt: { not: null } } : {}),
      ...(filter.depotIds
        ? {
            OR: [
              { targets: { some: { dimension: 'COMPANY' } } },
              { targets: { some: { dimension: 'DEPOT', value: { in: [...filter.depotIds] } } } },
            ],
          }
        : {}),
    };
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

  listFeedFor(audience: FeedAudience, limit: number): Promise<AnnouncementWithTargets[]> {
    // Mirrors domain/announcement.ts targetCovers: COMPANY reaches everyone, the rest
    // match one field, and a target with a null value reaches nobody. The service still
    // runs audienceMatches over the result — the domain rule stays the authority, this
    // just stops the query from returning (and the limit from consuming) other people's
    // notices. POSITION is free text typed by HR, hence the case-insensitive compare.
    const position = audience.position.trim();
    return this.prisma.announcement.findMany({
      where: {
        publishedAt: { not: null },
        targets: {
          some: {
            OR: [
              { dimension: 'COMPANY' },
              { dimension: 'EMPLOYEE', value: audience.employeeId },
              ...(audience.depotId ? [{ dimension: 'DEPOT' as const, value: audience.depotId }] : []),
              ...(audience.departmentId
                ? [{ dimension: 'DEPARTMENT' as const, value: audience.departmentId }]
                : []),
              ...(position
                ? [
                    {
                      dimension: 'POSITION' as const,
                      value: { equals: position, mode: 'insensitive' as const },
                    },
                  ]
                : []),
            ],
          },
        },
      },
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
