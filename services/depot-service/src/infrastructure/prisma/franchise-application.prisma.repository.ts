import { randomUUID } from 'node:crypto';

import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import {
  Checklist,
  FranchiseAppStage,
  OPEN_STAGES,
  franchiseApplicationSubmitted,
  franchiseApplicationSubmittedEventId,
} from '../../domain/franchise-application';
import {
  ApplicationSummary,
  CreateFranchiseApplicationData,
  FranchiseApplicationRecord,
  FranchiseApplicationRepository,
  ListApplicationsFilter,
  MAX_SUMMARY_APPLICATIONS,
  UpdateFranchiseApplicationData,
} from '../../application/ports/franchise-application.repository';
import { PrismaService } from './prisma.service';

interface ApplicationRow {
  id: string;
  applicantName: string;
  applicantPhone: string;
  proposedCode: string;
  proposedName: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  investmentAmount: unknown; // Prisma Decimal
  projectedMonthlyRevenue: unknown; // Prisma Decimal
  checklist: unknown; // Prisma Json
  stage: string;
  decisionReason: string | null;
  firstSource: string | null;
  lastSource: string | null;
  privacyConsentVersion: string | null;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** How long past the retention cutoff a rejected application may wait for its event to be delivered before it is purged anyway. */
export const PURGE_GRACE_DAYS = 30;

@Injectable()
export class FranchiseApplicationPrismaRepository implements FranchiseApplicationRepository {
  private readonly logger = new Logger(FranchiseApplicationPrismaRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ApplicationRow): FranchiseApplicationRecord {
    return {
      ...row,
      investmentAmount: Number(row.investmentAmount),
      projectedMonthlyRevenue: Number(row.projectedMonthlyRevenue),
      checklist: (row.checklist ?? {}) as Checklist,
      stage: row.stage as FranchiseAppStage,
    };
  }

  /**
   * HD-7: the application and the event announcing it commit together. Written apart, a crash
   * between the two left either an application nobody was told about or an event about an
   * application that does not exist. The event is only recorded here; EventRelayService sends it.
   */
  async create(data: CreateFranchiseApplicationData): Promise<FranchiseApplicationRecord> {
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.franchiseApplication.create({
        data: { ...data, checklist: data.checklist as unknown as Prisma.InputJsonValue },
      });
      const event = franchiseApplicationSubmitted(created);
      await tx.webhookEventOutbox.create({
        data: { ...event, payload: event.payload as Prisma.InputJsonValue },
      });
      // HD-6 H5: the stage history starts with the stage it was submitted in, at the submit time.
      await tx.franchiseApplicationStageEvent.create({
        data: { applicationId: created.id, stage: created.stage, at: created.submittedAt },
      });
      return created;
    });
    return this.toRecord(row as unknown as ApplicationRow);
  }

  async list(
    filter: ListApplicationsFilter,
  ): Promise<{ items: FranchiseApplicationRecord[]; total: number }> {
    const where = filter.stage ? { stage: filter.stage } : {};
    const [rows, total] = await Promise.all([
      this.prisma.franchiseApplication.findMany({
        where,
        // Oldest submitted first = highest SLA age surfaces at the top of the queue.
        orderBy: { submittedAt: 'asc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.franchiseApplication.count({ where }),
    ]);
    return { items: rows.map((r) => this.toRecord(r as unknown as ApplicationRow)), total };
  }

  async findById(id: string): Promise<FranchiseApplicationRecord | null> {
    const row = await this.prisma.franchiseApplication.findUnique({ where: { id } });
    return row ? this.toRecord(row as unknown as ApplicationRow) : null;
  }

  async updateIfOpen(
    id: string,
    patch: UpdateFranchiseApplicationData,
    seenUpdatedAt?: Date,
  ): Promise<FranchiseApplicationRecord | null> {
    // HD-6 H5: the stage change and its history row are one commit, and only when the write landed.
    const count = await this.prisma.$transaction(async (tx) => {
      const { count: written } = await tx.franchiseApplication.updateMany({
        where: {
          id,
          stage: { notIn: [FranchiseAppStage.APPROVED, FranchiseAppStage.REJECTED] },
          ...(seenUpdatedAt ? { updatedAt: seenUpdatedAt } : {}),
        },
        data: {
          ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
          ...(patch.decisionReason !== undefined ? { decisionReason: patch.decisionReason } : {}),
          ...(patch.checklist !== undefined
            ? { checklist: patch.checklist as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      if (written > 0 && patch.stage !== undefined) {
        await tx.franchiseApplicationStageEvent.create({ data: { applicationId: id, stage: patch.stage } });
      }
      return written;
    });
    if (count === 0) return null;
    const row = await this.prisma.franchiseApplication.findUnique({ where: { id } });
    return row ? this.toRecord(row as unknown as ApplicationRow) : null;
  }

  async purgeRejectedBefore(cutoff: Date): Promise<number> {
    // The stage history outlives the application (it keeps the counts), but it must not keep a link
    // to the person: in the same transaction its rows are re-keyed to a fresh random id per
    // application, so counts and the "one application" grouping still work and the link is gone. The
    // "application submitted" event row (its payload names the application and its city) goes with it.
    //
    // An old rejection whose event is not DONE yet waits for delivery, but only for a grace period: this
    // outbox only retries (PENDING/DONE), so with no webhook configured, the AI web down or a poison row
    // the event may never be delivered, and the applicant's name, phone and pin must not outlive the
    // retention window because of it. Past the ceiling (the cutoff + PURGE_GRACE_DAYS) the application is
    // purged anyway and its PENDING row is deleted with it: THAT EVENT IS THEN NEVER DELIVERED. The count
    // of such forced purges is logged (a count only, no id) so it is seen.
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.franchiseApplication.findMany({
        where: { stage: FranchiseAppStage.REJECTED, updatedAt: { lt: cutoff } },
        select: { id: true, updatedAt: true },
      });
      const keyOf = (id: string): string => franchiseApplicationSubmittedEventId(id);
      const undelivered = new Set(
        (
          await tx.webhookEventOutbox.findMany({
            where: { eventId: { in: old.map((o) => keyOf(o.id)) }, status: { not: 'DONE' } },
            select: { eventId: true },
          })
        ).map((e) => e.eventId),
      );
      const ceiling = new Date(cutoff.getTime() - PURGE_GRACE_DAYS * 86_400_000);
      const waiting = (o: { id: string; updatedAt: Date }): boolean => undelivered.has(keyOf(o.id)) && o.updatedAt >= ceiling;
      const doomed = old.filter((o) => !waiting(o));
      const forced = doomed.filter((o) => undelivered.has(keyOf(o.id))).length;
      for (const { id } of doomed) {
        await tx.franchiseApplicationStageEvent.updateMany({
          where: { applicationId: id },
          data: { applicationId: randomUUID() },
        });
      }
      await tx.webhookEventOutbox.deleteMany({ where: { eventId: { in: doomed.map((d) => keyOf(d.id)) } } });
      const { count } = await tx.franchiseApplication.deleteMany({ where: { id: { in: doomed.map((d) => d.id) } } });
      if (forced > 0) {
        this.logger.warn(
          `${forced} rejected franchise application(s) purged with an undelivered "application submitted" event (past the ${PURGE_GRACE_DAYS}-day grace): that event will never be delivered`,
        );
      }
      return count;
    });
  }

  async listOpen(limit: number): Promise<FranchiseApplicationRecord[]> {
    const rows = await this.prisma.franchiseApplication.findMany({
      where: { stage: { in: [...OPEN_STAGES] } },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((r) => this.toRecord(r));
  }

  async summary(from: Date, to: Date): Promise<ApplicationSummary> {
    const byStage = Object.fromEntries(Object.values(FranchiseAppStage).map((s) => [s, 0])) as Record<
      FranchiseAppStage,
      number
    >;
    // One snapshot: a purge landing between the three reads must not count one application twice.
    const { live, entered, kept } = await this.prisma.$transaction(
      async (tx) => {
        const [live, entered] = await Promise.all([
          tx.franchiseApplication.groupBy({
            by: ['stage'],
            where: { submittedAt: { gte: from, lt: to } },
            _count: { _all: true },
          }),
          // The first PENDING row of an application is its submission; a later move back to PENDING is not.
          tx.franchiseApplicationStageEvent.groupBy({
            by: ['applicationId'],
            where: { stage: FranchiseAppStage.PENDING },
            _min: { at: true },
            having: { at: { _min: { gte: from, lt: to } } },
            orderBy: { applicationId: 'asc' },
            take: MAX_SUMMARY_APPLICATIONS + 1,
          }),
        ]);
        if (entered.length > MAX_SUMMARY_APPLICATIONS) {
          throw new UnprocessableEntityException(
            `Lebih dari ${MAX_SUMMARY_APPLICATIONS} pengajuan pada rentang ini; persempit rentangnya.`,
          );
        }
        // In the history but no longer in the table: deleted, so it was rejected.
        let kept = 0;
        for (let i = 0; i < entered.length; i += 5000) {
          kept += await tx.franchiseApplication.count({
            where: { id: { in: entered.slice(i, i + 5000).map((e) => e.applicationId) } },
          });
        }
        return { live, entered, kept };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    for (const g of live) byStage[g.stage as FranchiseAppStage] += g._count._all;
    byStage[FranchiseAppStage.REJECTED] += entered.length - kept;
    return { total: Object.values(byStage).reduce((a, b) => a + b, 0), byStage };
  }
}
