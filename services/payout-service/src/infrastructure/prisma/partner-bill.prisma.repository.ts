import { Injectable } from '@nestjs/common';

import {
  NewPartnerBill,
  PartnerBillRepository,
} from '../../application/ports/partner-bill.repository';
import {
  PartnerBillBank,
  PartnerBillBasis,
  PartnerBillLineRecord,
  PartnerBillRecord,
  PartnerBillStatus,
} from '../../domain/partner-bill';
import { PrismaService } from './prisma.service';

interface LineRow {
  id: string;
  depotId: string;
  label: string;
  amountIdr: unknown;
  basis: unknown;
}

interface BillRow {
  id: string;
  legalEntityId: string;
  legalEntityName: string;
  month: string;
  status: string;
  totalIdr: unknown;
  createdAt: Date;
  approvedBy: string | null;
  approvedAt: Date | null;
  sentAt: Date | null;
  voidReason: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountHolder: string | null;
  recipientIds: string[];
  lines?: LineRow[];
}

const UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class PartnerBillPrismaRepository implements PartnerBillRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: BillRow): PartnerBillRecord {
    const bank =
      row.bankName && row.bankAccountNumber && row.bankAccountHolder
        ? {
            bankName: row.bankName,
            bankAccountNumber: row.bankAccountNumber,
            bankAccountHolder: row.bankAccountHolder,
          }
        : null;
    return {
      id: row.id,
      legalEntityId: row.legalEntityId,
      legalEntityName: row.legalEntityName,
      month: row.month,
      status: row.status as PartnerBillStatus,
      totalIdr: Number(row.totalIdr),
      createdAt: row.createdAt,
      approvedBy: row.approvedBy,
      approvedAt: row.approvedAt,
      sentAt: row.sentAt,
      voidReason: row.voidReason,
      bank,
      recipientIds: row.recipientIds ?? [],
      ...(row.lines
        ? {
            lines: row.lines.map(
              (l): PartnerBillLineRecord => ({
                id: l.id,
                depotId: l.depotId,
                label: l.label,
                amountIdr: Number(l.amountIdr),
                basis: l.basis as PartnerBillBasis,
              }),
            ),
          }
        : {}),
    };
  }

  async findLive(legalEntityId: string, month: string): Promise<PartnerBillRecord | null> {
    const row = await this.prisma.partnerBill.findFirst({
      where: { legalEntityId, month, status: { not: 'VOID' } },
    });
    return row ? this.toRecord(row as unknown as BillRow) : null;
  }

  async create(data: NewPartnerBill): Promise<PartnerBillRecord | null> {
    try {
      const row = await this.prisma.partnerBill.create({
        data: {
          legalEntityId: data.legalEntityId,
          legalEntityName: data.legalEntityName,
          month: data.month,
          totalIdr: data.totalIdr,
          lines: { create: data.lines.map((l) => ({ ...l, basis: l.basis as object })) },
        },
        include: { lines: { orderBy: { label: 'asc' } } },
      });
      return this.toRecord(row as unknown as BillRow);
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) return null;
      throw error;
    }
  }

  async findById(id: string): Promise<PartnerBillRecord | null> {
    const row = await this.prisma.partnerBill.findUnique({
      where: { id },
      include: { lines: { orderBy: { label: 'asc' } } },
    });
    return row ? this.toRecord(row as unknown as BillRow) : null;
  }

  async list(
    filter: { month?: string; legalEntityId?: string; status?: PartnerBillStatus },
    limit: number,
  ): Promise<PartnerBillRecord[]> {
    const rows = await this.prisma.partnerBill.findMany({
      where: filter,
      orderBy: [{ month: 'desc' }, { legalEntityName: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map((r) => this.toRecord(r as unknown as BillRow));
  }

  async listForOwner(ownerId: string, limit: number): Promise<PartnerBillRecord[]> {
    const rows = await this.prisma.partnerBill.findMany({
      // Only a bill that was sent has recipients, so a voided draft never shows; a sent one voided later does.
      where: { status: { in: ['SENT', 'VOID'] }, recipientIds: { has: ownerId } },
      orderBy: [{ month: 'desc' }, { id: 'asc' }],
      take: limit,
      include: { lines: { orderBy: { label: 'asc' } } },
    });
    return rows.map((r) => this.toRecord(r as unknown as BillRow));
  }

  async beginSend(id: string): Promise<PartnerBillRecord | null> {
    // DRAFT -> SENDING, or SENDING -> SENDING when a send failed half way: both are one approve.
    const { count } = await this.prisma.partnerBill.updateMany({
      where: { id, status: { in: ['DRAFT', 'SENDING'] } },
      data: { status: 'SENDING' },
    });
    return count === 0 ? null : this.findById(id);
  }

  async markSent(
    id: string,
    data: { approvedBy: string; recipientIds: string[]; bank: PartnerBillBank },
  ): Promise<PartnerBillRecord | null> {
    const now = new Date();
    // The SENDING guard is in the WHERE clause: a void cannot slip in between, and two approvers
    // cannot both finish it.
    const { count } = await this.prisma.partnerBill.updateMany({
      where: { id, status: 'SENDING' },
      data: {
        status: 'SENT',
        approvedBy: data.approvedBy,
        approvedAt: now,
        sentAt: now,
        recipientIds: data.recipientIds,
        ...data.bank,
      },
    });
    return count === 0 ? null : this.findById(id);
  }

  async markVoid(id: string, reason: string): Promise<PartnerBillRecord | null> {
    const { count } = await this.prisma.partnerBill.updateMany({
      where: { id, status: { in: ['DRAFT', 'SENT'] } },
      data: { status: 'VOID', voidReason: reason },
    });
    return count === 0 ? null : this.findById(id);
  }
}
