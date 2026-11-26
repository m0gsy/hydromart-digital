import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import {
  DepotVisitStat,
  FindingQuery,
  ItemAnswer,
  NewVisit,
  OverdueFollowUp,
  VisitListQuery,
  VisitRepository,
  VisitSummary,
} from '../../application/ports/visit.repository';
import { VisitAlreadyOpenError } from '../../domain/errors';
import {
  FollowUpStatus,
  Visit,
  VisitItem,
  VisitItemResult,
  VisitStatus,
  dateOfDayKey,
  dayKeyOfDate,
} from '../../domain/visit';
import { PrismaService } from './prisma.service';

type ItemRow = Omit<VisitItem, 'followUpDueOn'> & { followUpDueOn: Date | null };
type VisitRow = Omit<Visit, 'items'> & { items: ItemRow[] };

const WITH_ITEMS = { items: { orderBy: { position: 'asc' as const } } };

const toItem = (row: ItemRow): VisitItem => ({
  ...row,
  followUpDueOn: row.followUpDueOn ? dayKeyOfDate(row.followUpDueOn) : null,
});
const toVisit = (row: VisitRow): Visit => ({ ...row, items: row.items.map(toItem) });

const inScope = (depotIds?: readonly string[]) =>
  depotIds ? { depotId: { in: [...depotIds] } } : {};

/** An open follow-up: a finding whose deadline is still ahead of, or on, the day asked about. */
const OPEN_FINDING = {
  result: VisitItemResult.FINDING,
  followUpStatus: FollowUpStatus.OPEN,
  // A finding exists for the Kepala and the counts once its visit is COMPLETED, not while it is a draft.
  visit: { status: VisitStatus.COMPLETED },
} as const;

@Injectable()
export class VisitPrismaRepository implements VisitRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: NewVisit): Promise<Visit> {
    try {
      const row = await this.prisma.visit.create({
        data: {
          depotId: data.depotId,
          templateId: data.templateId,
          templateName: data.templateName,
          visitorId: data.visitorId,
          checkInLat: data.lat,
          checkInLng: data.lng,
          checkInAccuracyM: data.accuracyM,
          checkInDistanceM: data.distanceM,
          approximateFix: data.approximateFix,
          fenceChecked: data.fenceChecked,
          // A visit COPIES the checklist: text and the SOP version, by value. Nothing here
          // points back at a template item, whose row is replaced on every template edit.
          items: { create: data.items.map((i) => ({ ...i, depotId: data.depotId })) },
        },
        include: WITH_ITEMS,
      });
      return toVisit(row as unknown as VisitRow);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        // The partial unique index on (visitorId, depotId) WHERE IN_PROGRESS: lost the race.
        const open = await this.prisma.visit.findFirst({
          where: {
            visitorId: data.visitorId,
            depotId: data.depotId,
            status: VisitStatus.IN_PROGRESS,
          },
          select: { id: true },
        });
        if (open) throw new VisitAlreadyOpenError(open.id);
      }
      throw error;
    }
  }

  async findOpenOf(visitorId: string): Promise<Visit[]> {
    const rows = await this.prisma.visit.findMany({
      where: { visitorId, status: VisitStatus.IN_PROGRESS },
      orderBy: { checkInAt: 'desc' },
      include: WITH_ITEMS,
    });
    return rows.map((r) => toVisit(r as unknown as VisitRow));
  }

  async reserveUpload(visitId: string, max: number): Promise<boolean> {
    const { count } = await this.prisma.visit.updateMany({
      where: { id: visitId, status: VisitStatus.IN_PROGRESS, photoUploads: { lt: max } },
      data: { photoUploads: { increment: 1 } },
    });
    return count > 0;
  }

  async releaseUpload(visitId: string): Promise<void> {
    await this.prisma.visit.updateMany({
      where: { id: visitId, photoUploads: { gt: 0 } },
      data: { photoUploads: { decrement: 1 } },
    });
  }

  async findById(id: string): Promise<Visit | null> {
    const row = await this.prisma.visit.findUnique({ where: { id }, include: WITH_ITEMS });
    return row ? toVisit(row as unknown as VisitRow) : null;
  }

  async findItem(itemId: string): Promise<VisitItem | null> {
    const row = await this.prisma.visitItem.findUnique({ where: { id: itemId } });
    return row ? toItem(row as unknown as ItemRow) : null;
  }

  async answerItem(visitId: string, itemId: string, a: ItemAnswer): Promise<VisitItem | null> {
    // The visit's status is part of the WHERE, so an answer cannot land on a completed visit.
    const { count } = await this.prisma.visitItem.updateMany({
      where: { id: itemId, visitId, visit: { status: VisitStatus.IN_PROGRESS } },
      data: {
        result: a.result,
        findingNote: a.findingNote,
        photoKey: a.photoKey,
        followUpDueOn: a.followUpDueOn ? dateOfDayKey(a.followUpDueOn) : null,
        followUpStatus: a.followUpStatus,
        // Answering again starts the follow-up over.
        followUpDoneAt: null,
        followUpDoneBy: null,
        followUpNote: null,
      },
    });
    return count === 0 ? null : this.findItem(itemId);
  }

  async complete(id: string, now: Date): Promise<Visit | null> {
    const { count } = await this.prisma.visit.updateMany({
      where: {
        id,
        status: VisitStatus.IN_PROGRESS,
        items: { none: { result: VisitItemResult.PENDING } },
      },
      data: { status: VisitStatus.COMPLETED, completedAt: now },
    });
    return count === 0 ? null : this.findById(id);
  }

  async list(q: VisitListQuery): Promise<{ items: VisitSummary[]; total: number }> {
    const where: Prisma.VisitWhereInput = { ...inScope(q.depotIds), ...(q.status ? { status: q.status } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.visit.count({ where }),
      this.prisma.visit.findMany({
        where,
        orderBy: [{ checkInAt: 'desc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: {
          _count: {
            select: {
              items: true,
            },
          },
          items: { where: { result: VisitItemResult.FINDING }, select: { id: true } },
        },
      }),
    ]);
    return {
      total,
      items: rows.map(({ items, _count, ...visit }) => ({
        ...(visit as unknown as Omit<Visit, 'items'>),
        itemCount: _count.items,
        findingCount: items.length,
      })),
    };
  }

  async findings(q: FindingQuery): Promise<{ items: VisitItem[]; total: number }> {
    const today = dateOfDayKey(q.todayKey);
    const where: Prisma.VisitItemWhereInput = {
      ...inScope(q.depotIds),
      result: VisitItemResult.FINDING,
      visit: { status: VisitStatus.COMPLETED },
      ...(q.state === 'done' ? { followUpStatus: FollowUpStatus.DONE } : {}),
      ...(q.state === 'open' ? { followUpStatus: FollowUpStatus.OPEN } : {}),
      ...(q.state === 'overdue'
        ? { followUpStatus: FollowUpStatus.OPEN, followUpDueOn: { lt: today } }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.visitItem.count({ where }),
      this.prisma.visitItem.findMany({
        where,
        orderBy: [{ followUpDueOn: 'asc' }, { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    return { total, items: rows.map((r) => toItem(r as unknown as ItemRow)) };
  }

  async overview(
    depotIds: readonly string[] | undefined,
    since: Date,
    todayKey: string,
  ): Promise<DepotVisitStat[]> {
    const scope = inScope(depotIds);
    const [last, recent, unfenced, open, overdue] = await Promise.all([
      this.prisma.visit.groupBy({ by: ['depotId'], where: scope, _max: { checkInAt: true } }),
      this.prisma.visit.groupBy({
        by: ['depotId'],
        where: { ...scope, checkInAt: { gte: since } },
        _count: { _all: true },
      }),
      this.prisma.visit.groupBy({
        by: ['depotId'],
        where: { ...scope, checkInAt: { gte: since }, fenceChecked: false },
        _count: { _all: true },
      }),
      this.prisma.visitItem.groupBy({ by: ['depotId'], where: { ...scope, ...OPEN_FINDING }, _count: { _all: true } }),
      this.prisma.visitItem.groupBy({
        by: ['depotId'],
        where: { ...scope, ...OPEN_FINDING, followUpDueOn: { lt: dateOfDayKey(todayKey) } },
        _count: { _all: true },
      }),
    ]);
    const stats = new Map<string, DepotVisitStat>();
    const at = (depotId: string) => {
      let s = stats.get(depotId);
      if (!s) {
        s = {
          depotId,
          lastVisitAt: null,
          visitsLast30d: 0,
          unfencedVisitsLast30d: 0,
          openFindings: 0,
          overdueFollowUps: 0,
        };
        stats.set(depotId, s);
      }
      return s;
    };
    for (const r of last) at(r.depotId).lastVisitAt = r._max.checkInAt;
    for (const r of recent) at(r.depotId).visitsLast30d = r._count._all;
    for (const r of unfenced) at(r.depotId).unfencedVisitsLast30d = r._count._all;
    for (const r of open) at(r.depotId).openFindings = r._count._all;
    for (const r of overdue) at(r.depotId).overdueFollowUps = r._count._all;
    return [...stats.values()];
  }

  async closeFollowUp(
    itemId: string,
    by: string,
    note: string | null,
    now: Date,
  ): Promise<VisitItem | null> {
    // Only a finding of a COMPLETED visit can be closed: a draft visit's answers may still change.
    const row = await this.prisma.visitItem.findFirst({
      where: { id: itemId, result: VisitItemResult.FINDING, visit: { status: VisitStatus.COMPLETED } },
    });
    if (!row) return null;
    const item = toItem(row as unknown as ItemRow);
    if (item.followUpStatus === FollowUpStatus.DONE) return item;
    await this.prisma.visitItem.updateMany({
      where: { id: itemId, followUpStatus: FollowUpStatus.OPEN },
      data: {
        followUpStatus: FollowUpStatus.DONE,
        followUpDoneAt: now,
        followUpDoneBy: by,
        followUpNote: note,
      },
    });
    return this.findItem(itemId);
  }

  async overdueToRemind(todayKey: string, remindedBefore: Date, limit: number): Promise<OverdueFollowUp[]> {
    const rows = await this.prisma.visitItem.findMany({
      where: {
        ...OPEN_FINDING,
        followUpDueOn: { lt: dateOfDayKey(todayKey) },
        OR: [{ lastOverdueNoticeAt: null }, { lastOverdueNoticeAt: { lt: remindedBefore } }],
      },
      orderBy: [{ followUpDueOn: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        depotId: true,
        text: true,
        findingNote: true,
        visit: { select: { depot: { select: { name: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      depotId: r.depotId,
      depotName: r.visit.depot.name,
      text: r.text,
      findingNote: r.findingNote,
    }));
  }

  async stampOverdueNotice(ids: string[], now: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.visitItem.updateMany({ where: { id: { in: ids } }, data: { lastOverdueNoticeAt: now } });
  }

  async overdueCounts(todayKey: string): Promise<{ depots: number; items: number }> {
    const rows = await this.prisma.visitItem.groupBy({
      by: ['depotId'],
      where: { ...OPEN_FINDING, followUpDueOn: { lt: dateOfDayKey(todayKey) } },
      _count: { _all: true },
    });
    return { depots: rows.length, items: rows.reduce((n, r) => n + r._count._all, 0) };
  }
}
