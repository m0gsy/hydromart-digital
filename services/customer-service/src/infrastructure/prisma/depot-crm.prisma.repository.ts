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

  /**
   * Everyone this depot has a relationship with — §I.
   *
   * Membership used to be `customer_profiles.favoriteDepotId` alone, and that column is
   * written by exactly two things: the depot's Excel import, and a `PATCH /profile` the
   * console never calls. So the "customer directory" was "customers a depot typed into a
   * spreadsheet". A customer who registered themselves and ordered ten times was absent,
   * and so was every agen.
   *
   * Three sources, unioned:
   *  - the profile's favourite depot (the import, and now first checkout);
   *  - a reseller whose home depot is this one — invisible here until now;
   *  - anyone who has actually ORDERED from this depot, which is the strongest claim of
   *    the three and the one that was missing.
   *
   * The name and phone still come from the primary address when there is one; the caller
   * overrides both with the account's own identity where it can.
   */
  async listDepotCustomers(depotId: string): Promise<DepotCustomerRow[]> {
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      WITH members AS (
        SELECT "customerId" FROM "customer_profiles" WHERE "favoriteDepotId" = ${depotId}::uuid
        UNION
        SELECT "customerId" FROM "reseller_profiles" WHERE "homeDepotId" = ${depotId}::uuid
      )
      SELECT m."customerId" AS "customerId",
             a."recipientName" AS "fullName",
             a."phone" AS "phone",
             COALESCE(p."membershipTier"::text, 'BASIC') AS "membershipTier"
      FROM members m
      LEFT JOIN "customer_profiles" p ON p."customerId" = m."customerId"
      LEFT JOIN "addresses" a
        ON a."customerId" = m."customerId" AND a."isPrimary" = true
      ORDER BY a."recipientName" ASC NULLS LAST
    `;
    return rows.map((r) => ({ ...r, membershipTier: r.membershipTier as MembershipTier }));
  }

  async findIdsByDepot(depotId: string): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ customerId: string }[]>`
      SELECT "customerId" FROM "customer_profiles" WHERE "favoriteDepotId" = ${depotId}::uuid
      UNION
      SELECT "customerId" FROM "reseller_profiles" WHERE "homeDepotId" = ${depotId}::uuid
    `;
    return rows.map((r) => r.customerId);
  }
}
