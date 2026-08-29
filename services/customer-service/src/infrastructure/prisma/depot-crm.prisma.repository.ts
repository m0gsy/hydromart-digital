import { Injectable } from '@nestjs/common';
import { DEFAULT_MAX_ROWS } from '@hydromart/platform';

import { Prisma } from '../../../prisma/generated/client';
import { MembershipTier } from '../../domain/membership-tier.enum';
import {
  DepotCrmRepository,
  DepotCustomerQuery,
  DepotCustomerRow,
} from '../../application/ports/depot-crm.repository';
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
   * One page of everyone this depot has a relationship with — §I.
   *
   * Membership used to be `customer_profiles.favoriteDepotId` alone, and that column is
   * written by exactly two things: the depot's Excel import, and a `PATCH /profile` the
   * console never calls. So the "customer directory" was "customers a depot typed into a
   * spreadsheet". A customer who registered themselves and ordered ten times was absent,
   * and so was every agen.
   *
   * Three sources, unioned:
   *  - the profile's favourite depot (the import, and now first checkout);
   *  - a reseller whose home depot is this one;
   *  - anyone who has actually ORDERED from this depot, which is the strongest claim of the
   *    three. That one lives in order-service's database, so it arrives here as ids rather
   *    than as a table to join — but it still belongs in the CTE. Merged in AFTER the LIMIT
   *    instead, a customer past the page boundary gets listed on two pages at once.
   *
   * The name and phone still come from the primary address when there is one; the caller
   * overrides both with the account's own identity where it can.
   */
  async listDepotCustomers(
    depotId: string,
    query: DepotCustomerQuery = {},
  ): Promise<DepotCustomerRow[]> {
    const { q, orderedIds = [], qMatchedIds = [], limit = DEFAULT_MAX_ROWS, offset = 0 } = query;
    // `FROM unnest(...) AS t(...)` rather than a set-returning function in the select list:
    // the same rows, and unambiguously legal as a UNION branch on every Postgres version.
    const ordered = orderedIds.length
      ? Prisma.sql`UNION SELECT t."customerId" FROM unnest(${orderedIds}::uuid[]) AS t("customerId")`
      : Prisma.empty;
    // W9. Every value below is BOUND, never interpolated: a needle carrying a quote is a
    // search for a quote, not a second statement. `qMatchedIds` carries the rows whose only
    // searchable name is order-service's snapshot — nothing in this database can match those.
    const like = `%${q}%`;
    const alsoMatched = qMatchedIds.length
      ? Prisma.sql`OR m."customerId" = ANY(${qMatchedIds}::uuid[])`
      : Prisma.empty;
    const search = q
      ? Prisma.sql`WHERE a."recipientName" ILIKE ${like} OR a."phone" ILIKE ${like} ${alsoMatched}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<RawRow[]>(Prisma.sql`
      WITH members AS (
        SELECT "customerId" FROM "customer_profiles" WHERE "favoriteDepotId" = ${depotId}::uuid
        UNION
        SELECT "customerId" FROM "reseller_profiles" WHERE "homeDepotId" = ${depotId}::uuid
        ${ordered}
      )
      SELECT m."customerId" AS "customerId",
             a."recipientName" AS "fullName",
             a."phone" AS "phone",
             COALESCE(p."membershipTier"::text, 'BASIC') AS "membershipTier"
      FROM members m
      LEFT JOIN "customer_profiles" p ON p."customerId" = m."customerId"
      LEFT JOIN "addresses" a
        ON a."customerId" = m."customerId" AND a."isPrimary" = true
      ${search}
      ORDER BY a."recipientName" ASC NULLS LAST, m."customerId" ASC
      LIMIT ${limit} OFFSET ${offset}
    `);
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
