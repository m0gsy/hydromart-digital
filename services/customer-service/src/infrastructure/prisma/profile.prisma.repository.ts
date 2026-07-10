import { Injectable } from '@nestjs/common';

import { MembershipTier } from '../../domain/membership-tier.enum';
import {
  CustomerProfileRecord,
  ProfileRepository,
} from '../../application/ports/profile.repository';
import { PrismaService } from './prisma.service';

interface ProfileRow {
  customerId: string;
  membershipTier: string;
  pointBalance: number;
  favoriteDepotId: string | null;
  birthdate: Date | null;
  lastBirthdayRewardYear: number | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ProfilePrismaRepository implements ProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ProfileRow): CustomerProfileRecord {
    return { ...row, membershipTier: row.membershipTier as MembershipTier };
  }

  async findByCustomerId(customerId: string): Promise<CustomerProfileRecord | null> {
    const row = await this.prisma.customerProfile.findUnique({ where: { customerId } });
    return row ? this.toRecord(row) : null;
  }

  async create(customerId: string): Promise<CustomerProfileRecord> {
    const row = await this.prisma.customerProfile.create({ data: { customerId } });
    return this.toRecord(row);
  }

  async updateFavoriteDepot(
    customerId: string,
    favoriteDepotId: string | null,
  ): Promise<CustomerProfileRecord> {
    const row = await this.prisma.customerProfile.update({
      where: { customerId },
      data: { favoriteDepotId },
    });
    return this.toRecord(row);
  }

  async updateBirthdate(customerId: string, birthdate: Date | null): Promise<CustomerProfileRecord> {
    const row = await this.prisma.customerProfile.update({
      where: { customerId },
      data: { birthdate },
    });
    return this.toRecord(row);
  }

  async findBirthdayCandidates(month: number, day: number, year: number): Promise<string[]> {
    // Match by month/day of the stored DOB (year-agnostic); skip anyone already
    // rewarded this year. EXTRACT runs on the DB so the whole set never loads.
    const rows = await this.prisma.$queryRaw<{ customerId: string }[]>`
      SELECT "customerId"
      FROM "customer_profiles"
      WHERE "birthdate" IS NOT NULL
        AND EXTRACT(MONTH FROM "birthdate") = ${month}
        AND EXTRACT(DAY FROM "birthdate") = ${day}
        AND ("lastBirthdayRewardYear" IS DISTINCT FROM ${year})
    `;
    return rows.map((r) => r.customerId);
  }

  async markBirthdayRewarded(customerId: string, year: number): Promise<void> {
    await this.prisma.customerProfile.update({
      where: { customerId },
      data: { lastBirthdayRewardYear: year },
    });
  }
}
