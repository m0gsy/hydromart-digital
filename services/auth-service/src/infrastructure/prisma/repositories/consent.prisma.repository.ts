import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { nextCursor } from '@hydromart/platform';

import { ConsentPurpose, ConsentRecord } from '../../../domain/data-subject/consent';
import {
  ConsentLagPage,
  ConsentLagQuery,
  ConsentLagReader,
  ConsentLagTotals,
  ConsentRepository,
  RecordConsentData,
} from '../../../application/ports/consent.repository';
import { PrismaService } from '../prisma.service';

type Row = {
  id: string;
  customerId: string;
  purpose: string;
  granted: boolean;
  documentVersion: string;
  source: string;
  recordedAt: Date;
};

/** What the page query returns per account: the raw purpose sets, before naming the gap. */
type LagRow = {
  id: string;
  /** Every mandatory purpose that has ANY row — granted or not. The gap is its complement. */
  present: string[];
  refused: string[];
  outdated: string[];
};

@Injectable()
export class ConsentPrismaRepository implements ConsentRepository, ConsentLagReader {
  constructor(private readonly prisma: PrismaService) {}

  async record(data: RecordConsentData): Promise<ConsentRecord> {
    return this.toRecord(await this.prisma.consentRecord.create({ data }));
  }

  async recordMany(entries: RecordConsentData[]): Promise<ConsentRecord[]> {
    if (entries.length === 0) return [];
    // One transaction: a registration that recorded TERMS but crashed before PRIVACY
    // would leave an account whose consent evidence is half-missing.
    const rows = await this.prisma.$transaction(
      entries.map((data) => this.prisma.consentRecord.create({ data })),
    );
    return rows.map((r) => this.toRecord(r));
  }

  async listForCustomer(customerId: string): Promise<ConsentRecord[]> {
    const rows = await this.prisma.consentRecord.findMany({
      where: { customerId },
      orderBy: { recordedAt: 'asc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  /**
   * Fleet lag (W10): who is behind the document version in force, and how many.
   *
   * Raw SQL because the question is "the NEWEST row per (customer, purpose), and the
   * customers with no row at all" — a window over one table LEFT JOINed onto another.
   * Prisma has no `DISTINCT ON`, and the alternatives are a query per customer or paging
   * the whole customer table and filtering in Node, which is the unbounded list this repo
   * has already had to fix once.
   *
   * Two statements, sharing `base` so the two halves cannot drift into counting different
   * populations. Deliberately NOT one statement: the totals are per-fleet and the page is
   * a slice, and a page that comes back empty (everyone is current) still has to carry a
   * total, which a single row-producing query cannot do.
   *
   * ponytail: the totals re-run per page — a seq scan of the ledger each time. It is an
   * HQ report read by a handful of people; materialize it if that stops being true.
   */
  async mandatoryLag(query: ConsentLagQuery): Promise<ConsentLagPage> {
    const owed = query.purposes.length;
    const base = Prisma.sql`
      WITH pop AS (
        -- Data subjects only. Staff accounts live in this same table and were caught by
        -- the '1.0' backfill (migration 20260729080000), so counting them would inflate
        -- every number here with people nobody will ever show the customer Terms to.
        -- DELETED is excluded for the same reason the backfill excluded it: an anonymised
        -- account cannot be asked anything.
        SELECT c."id" FROM "customers" c
        WHERE c."role" = 'CUSTOMER' AND c."status" <> 'DELETED'
      ),
      latest AS (
        -- The ledger is append-only, so "current answer" is the newest row per pair.
        -- id breaks a tie between two rows written in the same millisecond.
        SELECT DISTINCT ON (r."customerId", r."purpose")
               r."customerId", r."purpose", r."granted", r."documentVersion"
        FROM "consent_records" r
        JOIN pop ON pop."id" = r."customerId"
        WHERE r."purpose" IN (${Prisma.join([...query.purposes])})
        ORDER BY r."customerId", r."purpose", r."recordedAt" DESC, r."id" DESC
      ),
      per AS (
        -- LEFT JOIN, not JOIN: an account with no consent row at all is the whole reason
        -- this report exists, and an inner join would silently drop it.
        SELECT pop."id",
               coalesce(
                 array_agg(l."purpose") FILTER (WHERE l."purpose" IS NOT NULL),
                 ARRAY[]::text[]
               ) AS present,
               coalesce(
                 array_agg(l."purpose") FILTER (WHERE NOT l."granted"),
                 ARRAY[]::text[]
               ) AS refused,
               coalesce(
                 array_agg(l."purpose") FILTER (
                   WHERE l."granted" AND l."documentVersion" <> ${query.version}
                 ),
                 ARRAY[]::text[]
               ) AS outdated
        FROM pop LEFT JOIN latest l ON l."customerId" = pop."id"
        GROUP BY pop."id"
      )`;
    // Only accounts that owe something reach the page; the totals still count everyone,
    // which is what makes "N of M" answerable from one response.
    const behind = Prisma.sql`
      cardinality(present) < ${owed}
      OR cardinality(refused) > 0
      OR cardinality(outdated) > 0`;
    const after = query.cursor ? Prisma.sql`AND per."id" > ${query.cursor}::uuid` : Prisma.empty;

    const [totals, rows] = await Promise.all([
      // ::int on every count: Prisma hands back bigint otherwise, and a bigint cannot be
      // JSON-serialised — the route would 500 on its own success.
      this.prisma.$queryRaw<ConsentLagTotals[]>`
        ${base}
        SELECT (count(*))::int AS "population",
               (count(*) FILTER (
                 WHERE cardinality(present) = ${owed}
                   AND cardinality(refused) = 0
                   AND cardinality(outdated) = 0
               ))::int AS "current",
               (count(*) FILTER (WHERE cardinality(present) < ${owed}))::int AS "neverAsked",
               (count(*) FILTER (WHERE cardinality(refused) > 0))::int AS "refused",
               (count(*) FILTER (WHERE cardinality(outdated) > 0))::int AS "outdated"
        FROM per`,
      this.prisma.$queryRaw<LagRow[]>`
        ${base}
        SELECT per."id", per."present", per."refused", per."outdated"
        FROM per
        WHERE (${behind}) ${after}
        ORDER BY per."id"
        LIMIT ${query.limit}`,
    ]);

    return {
      totals: totals[0],
      items: rows.map((row) => ({
        id: row.id,
        // The gap is the complement of what the ledger holds — computed here rather than
        // in SQL so it can never be confused with `refused`, which is a row that says no.
        neverAsked: query.purposes.filter((p) => !row.present.includes(p)),
        refused: row.refused as ConsentPurpose[],
        outdated: row.outdated as ConsentPurpose[],
      })),
      nextCursor: nextCursor(rows, query.limit),
    };
  }

  private toRecord(row: Row): ConsentRecord {
    return { ...row, purpose: row.purpose as ConsentPurpose };
  }
}
