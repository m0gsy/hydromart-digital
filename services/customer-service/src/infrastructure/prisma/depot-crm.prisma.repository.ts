import { Injectable } from '@nestjs/common';

import { MembershipTier } from '../../domain/membership-tier.enum';
import { DepotCrmRepository, DepotCustomerRow } from '../../application/ports/depot-crm.repository';
import { PrismaService } from './prisma.service';

interface RawRow {
  customerId: string;
  fullName: string | null;
  phone: string | null;
  membershipTier: string;
}

@Injectable()
export class DepotCrmPrismaRepository implements DepotCrmRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listDepotCustomers(depotId: string): Promise<DepotCustomerRow[]> {
    // Associated == profile.favoriteDepotId is this depot. LEFT JOIN the primary address so a
    // customer with no address still lists (null name/phone).
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT p."customerId" AS "customerId",
             a."recipientName" AS "fullName",
             a."phone" AS "phone",
             p."membershipTier"::text AS "membershipTier"
      FROM "customer_profiles" p
      LEFT JOIN "addresses" a
        ON a."customerId" = p."customerId" AND a."isPrimary" = true
      WHERE p."favoriteDepotId" = ${depotId}::uuid
      ORDER BY a."recipientName" ASC NULLS LAST
    `;
    return rows.map((r) => ({ ...r, membershipTier: r.membershipTier as MembershipTier }));
  }

  async findIdsByDepot(depotId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ customerId: string }[]>`
      SELECT p."customerId" AS "customerId"
      FROM "customer_profiles" p
      WHERE p."favoriteDepotId" = ${depotId}::uuid
    `;
    return rows.map((r) => r.customerId);
  }
}
