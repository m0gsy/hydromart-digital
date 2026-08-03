import { Injectable } from '@nestjs/common';

import { VoucherNotFoundError } from '../../domain/errors';
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
  budgetCap: number | null;
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

  async sumRedemptionsFor(voucherId: string): Promise<number> {
    const agg = await this.prisma.voucherRedemption.aggregate({
      where: { voucherId },
      _sum: { discountApplied: true },
    });
    return agg._sum.discountApplied ?? 0;
  }

  async sumRedemptionsByVoucher(): Promise<{ voucherId: string; burned: number }[]> {
    const grouped = await this.prisma.voucherRedemption.groupBy({
      by: ['voucherId'],
      _sum: { discountApplied: true },
    });
    return grouped.map((g) => ({
      voucherId: g.voucherId,
      burned: g._sum.discountApplied ?? 0,
    }));
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

  async findRedemptionsFor(voucherId: string): Promise<VoucherRedemptionRecord[]> {
    const rows = await this.prisma.voucherRedemption.findMany({
      where: { voucherId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toRedemption(row));
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

  /**
   * H-1: serialize redemptions of one voucher so its caps cannot be beaten by sending the
   * requests at the same time.
   *
   * `FOR UPDATE` on the voucher row is the gate. A second redemption of the same code
   * blocks there until we commit, then re-reads counts that already include ours — so
   * usageLimit, the per-customer limit and the budget cap are all decided against
   * committed reality instead of a snapshot taken before the write.
   *
   * Same discipline as depot-service's reserveAtomic; only the lock target differs.
   */
  async redeemAtomic(
    input: { voucherId: string; voucherCode: string; customerId: string; orderId: string },
    decide: (counts: { usedCount: number; customerRedemptions: number; burned: number }) => number,
  ): Promise<VoucherRedemptionRecord> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ usedCount: number }[]>`
        SELECT "usedCount" FROM "vouchers" WHERE "id" = ${input.voucherId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new VoucherNotFoundError();

      const [customerRedemptions, burnedAgg] = await Promise.all([
        tx.voucherRedemption.count({
          where: { voucherId: input.voucherId, customerId: input.customerId },
        }),
        tx.voucherRedemption.aggregate({
          where: { voucherId: input.voucherId },
          _sum: { discountApplied: true },
        }),
      ]);

      // Throws on any cap violation — the transaction rolls back and nothing is burned.
      const discountApplied = decide({
        usedCount: Number(locked[0].usedCount),
        customerRedemptions,
        burned: Number(burnedAgg._sum.discountApplied ?? 0),
      });

      const redemption = await tx.voucherRedemption.create({
        data: {
          voucherId: input.voucherId,
          voucherCode: input.voucherCode,
          customerId: input.customerId,
          orderId: input.orderId,
          discountApplied,
        },
      });
      await tx.voucher.update({
        where: { id: input.voucherId },
        data: { usedCount: { increment: 1 } },
      });
      return this.toRedemption(redemption);
    });
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
