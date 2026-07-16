import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import { Checklist, FranchiseAppStage } from '../../domain/franchise-application';
import {
  CreateFranchiseApplicationData,
  FranchiseApplicationRecord,
  FranchiseApplicationRepository,
  ListApplicationsFilter,
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

  async create(data: CreateFranchiseApplicationData): Promise<FranchiseApplicationRecord> {
    const row = await this.prisma.franchiseApplication.create({
      data: { ...data, checklist: data.checklist as unknown as Prisma.InputJsonValue },
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

  async update(id: string, patch: UpdateFranchiseApplicationData): Promise<FranchiseApplicationRecord> {
    const row = await this.prisma.franchiseApplication.update({
      where: { id },
      data: {
        ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
        ...(patch.checklist !== undefined
          ? { checklist: patch.checklist as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
    return this.toRecord(row as unknown as ApplicationRow);
  }
}
