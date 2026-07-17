import { Injectable } from '@nestjs/common';

import { ExpenseCategory, ExpenseClaimStatus } from '../../domain/expense-claim';
import {
  CreateExpenseClaimData,
  ExpenseClaimRecord,
  ExpenseClaimRepository,
  ReviewExpenseClaimData,
} from '../../application/ports/expense-claim.repository';
import { PrismaService } from './prisma.service';

interface ClaimRow {
  id: string;
  courierId: string;
  depotId: string | null;
  category: string;
  amount: unknown; // Prisma Decimal
  description: string;
  receiptUrl: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  ledgerEntryId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ExpenseClaimPrismaRepository implements ExpenseClaimRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toClaim(row: ClaimRow): ExpenseClaimRecord {
    return {
      id: row.id,
      courierId: row.courierId,
      depotId: row.depotId,
      category: row.category as ExpenseCategory,
      amount: Number(row.amount),
      description: row.description,
      receiptUrl: row.receiptUrl,
      status: row.status as ExpenseClaimStatus,
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      reviewNote: row.reviewNote,
      ledgerEntryId: row.ledgerEntryId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(data: CreateExpenseClaimData): Promise<ExpenseClaimRecord> {
    const row = await this.prisma.expenseClaim.create({ data });
    return this.toClaim(row as unknown as ClaimRow);
  }

  async findById(id: string): Promise<ExpenseClaimRecord | null> {
    const row = await this.prisma.expenseClaim.findUnique({ where: { id } });
    return row ? this.toClaim(row as unknown as ClaimRow) : null;
  }

  async markReviewed(id: string, data: ReviewExpenseClaimData): Promise<ExpenseClaimRecord> {
    const row = await this.prisma.expenseClaim.update({
      where: { id },
      data: {
        status: data.status,
        reviewedBy: data.reviewedBy,
        reviewNote: data.reviewNote,
        ledgerEntryId: data.ledgerEntryId ?? null,
        reviewedAt: new Date(),
      },
    });
    return this.toClaim(row as unknown as ClaimRow);
  }

  async listForCourier(
    courierId: string,
    page: number,
    limit: number,
  ): Promise<{ items: ExpenseClaimRecord[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.expenseClaim.findMany({
        where: { courierId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseClaim.count({ where: { courierId } }),
    ]);
    return { items: rows.map((r) => this.toClaim(r as unknown as ClaimRow)), total };
  }

  async searchForDepot(
    depotId: string | null,
    status: ExpenseClaimStatus | null,
    page: number,
    limit: number,
  ): Promise<{ items: ExpenseClaimRecord[]; total: number }> {
    const where = {
      ...(depotId ? { depotId } : {}),
      ...(status ? { status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.expenseClaim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.expenseClaim.count({ where }),
    ]);
    return { items: rows.map((r) => this.toClaim(r as unknown as ClaimRow)), total };
  }
}
