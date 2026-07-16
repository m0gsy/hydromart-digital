import { Injectable } from '@nestjs/common';

import { PricingAdjustType } from '../../domain/pricing-rule';
import {
  PriceOverrideProposalRecord,
  PriceOverrideStatus,
} from '../../domain/price-override-proposal';
import {
  CreatePriceOverrideProposalData,
  ListProposalsFilter,
  PriceOverrideProposalRepository,
  UpdatePriceOverrideProposalData,
} from '../../application/ports/price-override-proposal.repository';
import { PrismaService } from './prisma.service';

interface ProposalRow {
  id: string;
  depotId: string;
  depotName: string;
  productId: string;
  productName: string;
  currentPrice: unknown; // Prisma Decimal
  adjustType: string;
  value: unknown; // Prisma Decimal
  note: string | null;
  status: string;
  proposedBy: string;
  decidedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PriceOverrideProposalPrismaRepository implements PriceOverrideProposalRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ProposalRow): PriceOverrideProposalRecord {
    return {
      id: row.id,
      depotId: row.depotId,
      depotName: row.depotName,
      productId: row.productId,
      productName: row.productName,
      currentPrice: Number(row.currentPrice),
      adjustType: row.adjustType as PricingAdjustType,
      value: Number(row.value),
      note: row.note,
      status: row.status as PriceOverrideStatus,
      proposedBy: row.proposedBy,
      decidedBy: row.decidedBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(data: CreatePriceOverrideProposalData): Promise<PriceOverrideProposalRecord> {
    const row = await this.prisma.priceOverrideProposal.create({ data });
    return this.toRecord(row as unknown as ProposalRow);
  }

  async list(
    filter: ListProposalsFilter,
  ): Promise<{ items: PriceOverrideProposalRecord[]; total: number }> {
    const where = filter.status ? { status: filter.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.priceOverrideProposal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.priceOverrideProposal.count({ where }),
    ]);
    return { items: rows.map((r) => this.toRecord(r as unknown as ProposalRow)), total };
  }

  async countByProduct(
    status?: PriceOverrideStatus,
  ): Promise<{ productId: string; count: number }[]> {
    const grouped = await this.prisma.priceOverrideProposal.groupBy({
      by: ['productId'],
      where: status ? { status } : {},
      _count: { _all: true },
    });
    return grouped.map((g) => ({ productId: g.productId, count: g._count._all }));
  }

  async findById(id: string): Promise<PriceOverrideProposalRecord | null> {
    const row = await this.prisma.priceOverrideProposal.findUnique({ where: { id } });
    return row ? this.toRecord(row as unknown as ProposalRow) : null;
  }

  async update(
    id: string,
    patch: UpdatePriceOverrideProposalData,
  ): Promise<PriceOverrideProposalRecord> {
    const row = await this.prisma.priceOverrideProposal.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.decidedBy !== undefined ? { decidedBy: patch.decidedBy } : {}),
      },
    });
    return this.toRecord(row as unknown as ProposalRow);
  }
}
