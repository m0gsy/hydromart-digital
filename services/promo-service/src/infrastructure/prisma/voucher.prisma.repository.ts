import { Injectable } from '@nestjs/common';

import { VoucherNotFoundError } from '../../domain/errors';
import { DiscountType } from '../../domain/voucher';
import {
  CreateVoucherData,
  RedemptionAnalytics,
  UpdateVoucherData,
  VoucherRecord,
  VoucherRedemptionRecord,
  VoucherRepository,
} from '../../application/ports/voucher.repository';
import { DiscountType as PrismaDiscountType, Prisma } from '../../../prisma/generated/client';
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
      this.prisma.voucherRedemption.findMany({
        where: { customerId },
        select: { voucherId: true },
      }),
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

  async redemptionAnalytics(
    voucherId: string,
    from: Date,
    to: Date,
    topCustomers: number,
    timeZone: string,
  ): Promise<RedemptionAnalytics> {
    // Four statements that each return a handful of rows, instead of the whole redemption
    // history and five passes over it in Node (audit S-14).
    const [totals, window, daily, top, orders] = await Promise.all([
      this.prisma.voucherRedemption.aggregate({
        where: { voucherId },
        _count: { _all: true },
        _sum: { discountApplied: true },
      }),
      this.prisma.voucherRedemption.count({
        where: { voucherId, createdAt: { gte: from, lt: to } },
      }),
      this.prisma.$queryRaw<{ day: string; uses: bigint }[]>(Prisma.sql`
        -- C2: two hops, not one. The column is a naive timestamp holding UTC, so a single
        -- AT TIME ZONE reads it as though it were ALREADY local and converts it the wrong
        -- way — the same seven hours, in the opposite direction from the bug H-16 fixed.
        -- Label it UTC first, then read it in the business zone.
        SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
               COUNT(*)::bigint AS uses
        FROM "voucher_redemptions"
        WHERE "voucherId" = ${voucherId}::uuid AND "createdAt" >= ${from} AND "createdAt" < ${to}
        GROUP BY 1
        ORDER BY 1`),
      this.prisma.voucherRedemption.groupBy({
        by: ['customerId'],
        where: { voucherId },
        _count: { _all: true },
        _sum: { discountApplied: true },
        // Most uses first, then biggest savings — the console's long-standing order.
        orderBy: [{ _count: { customerId: 'desc' } }, { _sum: { discountApplied: 'desc' } }],
        take: topCustomers,
      }),
      // GROUP BY, not Prisma's `distinct` — that one dedupes rows already fetched, so it
      // would read the whole history back into memory, which is the defect being fixed.
      // Ordered by first use, which is the order the console has always shown.
      this.prisma.$queryRaw<{ orderId: string }[]>(Prisma.sql`
        SELECT "orderId"
        FROM "voucher_redemptions"
        WHERE "voucherId" = ${voucherId}::uuid
        GROUP BY "orderId"
        ORDER BY MIN("createdAt") ASC`),
    ]);
    return {
      totalUses: totals._count._all,
      totalSavingsIdr: Number(totals._sum.discountApplied ?? 0),
      usesInWindow: window,
      dailyUses: daily.map((row) => ({ day: row.day, uses: Number(row.uses) })),
      topCustomers: top.map((row) => ({
        customerId: row.customerId,
        uses: row._count._all,
        savingsIdr: Number(row._sum.discountApplied ?? 0),
      })),
      orderIds: orders.map((row) => row.orderId),
    };
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
    return this.prisma
      .$transaction(async (tx) => {
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
      })
      .catch(async (error: unknown) => {
        /*
         * The lock serializes redemptions of one VOUCHER. It says nothing about one ORDER.
         *
         * `redeem` checks `findRedemptionByOrder` first, and that check is not the guard: a
         * retried checkout — a slow connection, a tapped button, an at-least-once caller —
         * has both attempts read "not redeemed", both queue on the voucher lock, and the
         * second one meet `@@unique([orderId])`. The transaction rolls back, so nothing is
         * double-burned; that part was already right.
         *
         * What was wrong is the answer. A raw P2002 is a 500 on a checkout that succeeded,
         * and the service already knows what to say instead — it says it one line earlier,
         * for the same case found one moment sooner:
         *
         *     if (existing) return { orderId: existing.orderId, discountApplied: ... }
         */
        if ((error as { code?: string })?.code !== 'P2002') throw error;
        const won = await this.prisma.voucherRedemption.findUnique({
          where: { orderId: input.orderId },
        });
        // A P2002 with nothing to read back is a different unique index, not this race.
        if (!won) throw error;
        return this.toRedemption(won);
      });
  }

  async releaseAtomic(orderId: string): Promise<VoucherRedemptionRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      // Locked the same way `redeemAtomic` locks, and for the same reason: the counter and
      // the row must move together or a concurrent redemption reads a count that disagrees
      // with the rows behind it.
      const redemption = await tx.voucherRedemption.findUnique({ where: { orderId } });
      if (!redemption) return null;

      await tx.$queryRaw`SELECT "usedCount" FROM "vouchers" WHERE "id" = ${redemption.voucherId}::uuid FOR UPDATE`;
      await tx.voucherRedemption.delete({ where: { orderId } });
      await tx.voucher.update({
        where: { id: redemption.voucherId },
        // Floored at zero: a counter that has already been corrected by hand must not be
        // driven negative by a replayed void.
        data: { usedCount: { decrement: 1 } },
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
