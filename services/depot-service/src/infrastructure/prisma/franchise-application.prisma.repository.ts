import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import {
  Checklist,
  FranchiseAppStage,
  franchiseApplicationSubmitted,
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

@Injectable()
export class FranchiseApplicationPrismaRepository implements FranchiseApplicationRepository {
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
    const { count } = await this.prisma.franchiseApplication.deleteMany({
      where: { stage: FranchiseAppStage.REJECTED, updatedAt: { lt: cutoff } },
    });
    return count;
  }

  async summary(from: Date, to: Date): Promise<ApplicationSummary> {
    const byStage = Object.fromEntries(Object.values(FranchiseAppStage).map((s) => [s, 0])) as Record<
      FranchiseAppStage,
      number
    >;
    const [live, entered] = await Promise.all([
      this.prisma.franchiseApplication.groupBy({
        by: ['stage'],
        where: { submittedAt: { gte: from, lt: to } },
        _count: { _all: true },
      }),
      // The first PENDING row of an application is its submission; a later move back to PENDING is not.
      this.prisma.franchiseApplicationStageEvent.groupBy({
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
    for (const g of live) byStage[g.stage as FranchiseAppStage] += g._count._all;
    // In the history but no longer in the table: deleted, so it was rejected.
    const ids = entered.map((e) => e.applicationId);
    let kept = 0;
    for (let i = 0; i < ids.length; i += 5000) {
      kept += await this.prisma.franchiseApplication.count({ where: { id: { in: ids.slice(i, i + 5000) } } });
    }
    byStage[FranchiseAppStage.REJECTED] += ids.length - kept;
    return { total: Object.values(byStage).reduce((a, b) => a + b, 0), byStage };
  }
}
