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

  async listDepotCustomers(depotId: string, q?: string): Promise<DepotCustomerRow[]> {
    // Associated == profile.favoriteDepotId is this depot. LEFT JOIN the primary address so a
    // customer with no address still lists (null name/phone). `like` short-circuits when absent.
    const like = q && q.trim() !== '' ? `%${q.trim()}%` : null;
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT p."customerId" AS "customerId",
             a."recipientName" AS "fullName",
             a."phone" AS "phone",
             p."membershipTier"::text AS "membershipTier"
      FROM "customer_profiles" p
      LEFT JOIN "addresses" a
        ON a."customerId" = p."customerId" AND a."isPrimary" = true
      WHERE p."favoriteDepotId" = ${depotId}::uuid
        AND (${like}::text IS NULL OR a."recipientName" ILIKE ${like} OR a."phone" ILIKE ${like})
      ORDER BY a."recipientName" ASC NULLS LAST
    `;
    return rows.map((r) => ({ ...r, membershipTier: r.membershipTier as MembershipTier }));
  }
}
