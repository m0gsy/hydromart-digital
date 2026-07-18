import { Injectable } from '@nestjs/common';

import { ReferralStatus } from '../../domain/referral-status';
import {
  CreateReferralData,
  ReferralCodeRecord,
  ReferralRecord,
  ReferralRepository,
  TopReferrer,
} from '../../application/ports/referral.repository';
import { ReferralStatus as PrismaReferralStatus } from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

// Prisma generates an enum structurally distinct from the domain enum, so rows are typed
// with a `string` `status` field and cast back to the domain enum here (infra only).
// Writes use the generated enum object for input typing.
interface ReferralRow {
  id: string;
  referrerCustomerId: string;
  refereeCustomerId: string;
  code: string;
  status: string;
  qualifyingOrderId: string | null;
  referrerPoints: number;
  refereePoints: number;
  qualifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ReferralPrismaRepository implements ReferralRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toReferral(row: ReferralRow): ReferralRecord {
    return { ...row, status: row.status as ReferralStatus };
  }

  async findCodeByCustomer(customerId: string): Promise<ReferralCodeRecord | null> {
    return this.prisma.referralCode.findUnique({ where: { customerId } });
  }

  async createCode(customerId: string, code: string): Promise<ReferralCodeRecord> {
    return this.prisma.referralCode.create({ data: { customerId, code } });
  }

  async findCodeByCode(code: string): Promise<ReferralCodeRecord | null> {
    return this.prisma.referralCode.findUnique({ where: { code } });
  }

  async findReferralByReferee(refereeCustomerId: string): Promise<ReferralRecord | null> {
    const row = await this.prisma.referral.findUnique({ where: { refereeCustomerId } });
    return row ? this.toReferral(row) : null;
  }

  async createReferral(data: CreateReferralData): Promise<ReferralRecord> {
    const row = await this.prisma.referral.create({ data });
    return this.toReferral(row);
  }

  async listReferralsByReferrer(
    referrerCustomerId: string,
    page: number,
    limit: number,
  ): Promise<{ items: ReferralRecord[]; total: number }> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.referral.findMany({
        where: { referrerCustomerId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.referral.count({ where: { referrerCustomerId } }),
    ]);
    return { items: rows.map((r) => this.toReferral(r)), total };
  }

  async summarizeReferrer(
    referrerCustomerId: string,
  ): Promise<{ referredCount: number; qualifiedCount: number; pointsEarned: number }> {
    const [referredCount, qualifiedCount, aggregate] = await this.prisma.$transaction([
      this.prisma.referral.count({ where: { referrerCustomerId } }),
      this.prisma.referral.count({
        where: { referrerCustomerId, status: PrismaReferralStatus.QUALIFIED },
      }),
      this.prisma.referral.aggregate({
        where: { referrerCustomerId, status: PrismaReferralStatus.QUALIFIED },
        _sum: { referrerPoints: true },
      }),
    ]);
    return { referredCount, qualifiedCount, pointsEarned: aggregate._sum.referrerPoints ?? 0 };
  }

  async countReferrals(referrerIds: string[]): Promise<number> {
    if (referrerIds.length === 0) return 0;
    return this.prisma.referral.count({ where: { referrerCustomerId: { in: referrerIds } } });
  }

  async countQualified(referrerIds: string[]): Promise<number> {
    if (referrerIds.length === 0) return 0;
    return this.prisma.referral.count({
      where: { referrerCustomerId: { in: referrerIds }, status: PrismaReferralStatus.QUALIFIED },
    });
  }

  async sumReferrerPoints(referrerIds: string[]): Promise<number> {
    if (referrerIds.length === 0) return 0;
    const aggregate = await this.prisma.referral.aggregate({
      where: { referrerCustomerId: { in: referrerIds }, status: PrismaReferralStatus.QUALIFIED },
      _sum: { referrerPoints: true },
    });
    return aggregate._sum.referrerPoints ?? 0;
  }

  async topReferrers(referrerIds: string[], limit = 5): Promise<TopReferrer[]> {
    if (referrerIds.length === 0) return [];
    const rows = await this.prisma.referral.groupBy({
      by: ['referrerCustomerId'],
      where: { referrerCustomerId: { in: referrerIds }, status: PrismaReferralStatus.QUALIFIED },
      _count: { referrerCustomerId: true },
      _sum: { referrerPoints: true },
      orderBy: { _count: { referrerCustomerId: 'desc' } },
      take: limit,
    });
    return rows.map((r) => ({
      customerId: r.referrerCustomerId,
      referralCount: r._count.referrerCustomerId,
      pointsEarned: r._sum.referrerPoints ?? 0,
    }));
  }

  async qualifyReferral(
    referralId: string,
    qualifyingOrderId: string,
    referrerPoints: number,
    refereePoints: number,
  ): Promise<ReferralRecord | null> {
    return this.prisma.$transaction(async (tx) => {
      // Guard the transition on the current PENDING state so a lost race is a no-op.
      const { count } = await tx.referral.updateMany({
        where: { id: referralId, status: PrismaReferralStatus.PENDING },
        data: {
          status: PrismaReferralStatus.QUALIFIED,
          qualifyingOrderId,
          referrerPoints,
          refereePoints,
          qualifiedAt: new Date(),
        },
      });
      if (count === 0) return null;
      const row = await tx.referral.findUnique({ where: { id: referralId } });
      return row ? this.toReferral(row) : null;
    });
  }
}
