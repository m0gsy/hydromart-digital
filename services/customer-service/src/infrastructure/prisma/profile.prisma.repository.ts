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
}
