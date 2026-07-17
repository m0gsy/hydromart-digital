import { Injectable } from '@nestjs/common';

import { DiscountType } from '../../domain/voucher';
import { VoucherRequestRecord, VoucherRequestStatus } from '../../domain/voucher-request';
import {
  CreateVoucherRequestData,
  ListVoucherRequestsFilter,
  UpdateVoucherRequestData,
  VoucherRequestRepository,
} from '../../application/ports/voucher-request.repository';
import { PrismaService } from './prisma.service';

interface RequestRow {
  id: string;
  depotId: string;
  depotName: string;
  code: string;
  description: string | null;
  discountType: string;
  value: number;
  minSpend: number;
  maxDiscount: number | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  note: string | null;
  status: string;
  requestedBy: string;
  decidedBy: string | null;
  createdVoucherId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class VoucherRequestPrismaRepository implements VoucherRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: RequestRow): VoucherRequestRecord {
    return {
      id: row.id,
      depotId: row.depotId,
      depotName: row.depotName,
      code: row.code,
      description: row.description,
      discountType: row.discountType as DiscountType,
      value: row.value,
      minSpend: row.minSpend,
      maxDiscount: row.maxDiscount,
      usageLimit: row.usageLimit,
      perCustomerLimit: row.perCustomerLimit,
      note: row.note,
      status: row.status as VoucherRequestStatus,
      requestedBy: row.requestedBy,
      decidedBy: row.decidedBy,
      createdVoucherId: row.createdVoucherId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async create(data: CreateVoucherRequestData): Promise<VoucherRequestRecord> {
    const row = await this.prisma.voucherRequest.create({ data });
    return this.toRecord(row as unknown as RequestRow);
  }

  async list(
    filter: ListVoucherRequestsFilter,
  ): Promise<{ items: VoucherRequestRecord[]; total: number }> {
    const where = filter.status ? { status: filter.status } : {};
    const [rows, total] = await Promise.all([
      this.prisma.voucherRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.voucherRequest.count({ where }),
    ]);
    return { items: rows.map((r) => this.toRecord(r as unknown as RequestRow)), total };
  }

  async findById(id: string): Promise<VoucherRequestRecord | null> {
    const row = await this.prisma.voucherRequest.findUnique({ where: { id } });
    return row ? this.toRecord(row as unknown as RequestRow) : null;
  }

  async update(id: string, patch: UpdateVoucherRequestData): Promise<VoucherRequestRecord> {
    const row = await this.prisma.voucherRequest.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.decidedBy !== undefined ? { decidedBy: patch.decidedBy } : {}),
        ...(patch.createdVoucherId !== undefined ? { createdVoucherId: patch.createdVoucherId } : {}),
      },
    });
    return this.toRecord(row as unknown as RequestRow);
  }
}
