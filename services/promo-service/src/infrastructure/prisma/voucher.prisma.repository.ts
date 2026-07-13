import { Injectable } from '@nestjs/common';

import { DiscountType } from '../../domain/voucher';
import {
  CreateVoucherData,
  RedemptionMutation,
  UpdateVoucherData,
  VoucherRecord,
  VoucherRedemptionRecord,
  VoucherRepository,
} from '../../application/ports/voucher.repository';
import { DiscountType as PrismaDiscountType } from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

// Prisma generates an enum structurally distinct from the domain enum, so rows are
// typed with a `string` field and cast back to the domain enum here (infra only).
// Writes use the generated enum object for input typing.
interface VoucherRow {
  id: string;
  code: string;
  description: string | null;
  discountType: string;
  value: number;
  minSpend: number;
  maxDiscount: number | null;
  validFrom: Date | null;
  validUntil: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number;
  usedCount: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class VoucherPrismaRepository implements VoucherRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toVoucher(row: VoucherRow): VoucherRecord {
    return { ...row, discountType: row.discountType as DiscountType };
  }

  private toRedemption(row: VoucherRedemptionRecord): VoucherRedemptionRecord {
    return { ...row };
  }

  async findById(id: string): Promise<VoucherRecord | null> {
    const row = await this.prisma.voucher.findUnique({ where: { id } });
    return row ? this.toVoucher(row) : null;
  }

  async findByCode(code: string): Promise<VoucherRecord | null> {
    const row = await this.prisma.voucher.findUnique({ where: { code } });
    return row ? this.toVoucher(row) : null;
  }

  async create(data: CreateVoucherData): Promise<VoucherRecord> {
    const row = await this.prisma.voucher.create({
      data: { ...data, discountType: data.discountType as PrismaDiscountType },
    });
    return this.toVoucher(row);
  }

  async update(id: string, data: UpdateVoucherData): Promise<VoucherRecord> {
    const row = await this.prisma.voucher.update({
      where: { id },
      data: {
        ...data,
        discountType: data.discountType as PrismaDiscountType | undefined,
      },
    });
    return this.toVoucher(row);
  }

  async search(
    page: number,
    limit: number,
    activeOnly: boolean,
  ): Promise<{ items: VoucherRecord[]; total: number }> {
    const where = activeOnly ? { active: true } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.voucher.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.voucher.count({ where }),
    ]);
    return { items: rows.map((r) => this.toVoucher(r)), total };
  }

  async countRedemptions(voucherId: string, customerId?: string): Promise<number> {
    return this.prisma.voucherRedemption.count({
      where: { voucherId, ...(customerId ? { customerId } : {}) },
    });
  }

  async listForCustomer(
    customerId: string,
  ): Promise<{ voucher: VoucherRecord; customerRedemptions: number }[]> {
    const [rows, redemptions] = await this.prisma.$transaction([
      this.prisma.voucher.findMany({ where: { active: true }, orderBy: { validUntil: 'asc' } }),
      // A customer has few redemptions (perCustomerLimit is small), so tallying in
      // memory is cheaper and simpler than a typed groupBy.
      this.prisma.voucherRedemption.findMany({ where: { customerId }, select: { voucherId: true } }),
    ]);
    const byVoucher = new Map<string, number>();
    for (const r of redemptions) {
      byVoucher.set(r.voucherId, (byVoucher.get(r.voucherId) ?? 0) + 1);
    }
    return rows.map((r) => ({
      voucher: this.toVoucher(r),
      customerRedemptions: byVoucher.get(r.id) ?? 0,
    }));
  }

  async findRedemptionByOrder(orderId: string): Promise<VoucherRedemptionRecord | null> {
    const row = await this.prisma.voucherRedemption.findUnique({ where: { orderId } });
    return row ? this.toRedemption(row) : null;
  }

  async recordRedemption(m: RedemptionMutation): Promise<VoucherRedemptionRecord> {
    const [redemption] = await this.prisma.$transaction([
      this.prisma.voucherRedemption.create({
        data: {
          voucherId: m.voucherId,
          voucherCode: m.voucherCode,
          customerId: m.customerId,
          orderId: m.orderId,
          discountApplied: m.discountApplied,
        },
      }),
      this.prisma.voucher.update({
        where: { id: m.voucherId },
        data: { usedCount: { increment: 1 } },
      }),
    ]);
    return this.toRedemption(redemption);
  }

  async grantVoucher(voucherId: string, customerId: string): Promise<boolean> {
    const existing = await this.prisma.voucherGrant.findUnique({
      where: { voucherId_customerId: { voucherId, customerId } },
    });
    if (existing) return false;
    await this.prisma.voucherGrant.create({ data: { voucherId, customerId } });
    return true;
  }
}
