import { Injectable } from '@nestjs/common';

import { BUSINESS_TIME_ZONE } from '@hydromart/platform';

import { Prisma } from '../../../prisma/generated/client';
import {
  B2bProspectAggregateRepository,
  ProspectAggCell,
  ProspectAggLevel,
  ProspectAggQuery,
} from '../../application/ports/b2b-prospect-aggregate.repository';
import { PrismaService } from './prisma.service';

/** Where a cell is named: its stored column, NEVER recomputed from latitude/longitude (zeroed once anonymised). */
const KEY: Record<ProspectAggLevel, { key: Prisma.Sql; parent: Prisma.Sql }> = {
  depot: { key: Prisma.sql`p."ownerDepotId"::text`, parent: Prisma.sql`NULL::text` },
  kecamatan: { key: Prisma.sql`p."kecamatanCode"`, parent: Prisma.sql`NULL::text` },
  kelurahan: { key: Prisma.sql`p."kelurahanCode"`, parent: Prisma.sql`p."kecamatanCode"` },
  grid: { key: Prisma.sql`p."gridCell"`, parent: Prisma.sql`NULL::text` },
};

interface Row {
  key: string | null;
  parent: string | null;
  d1: string | null;
  d2: string | null;
  n: number;
  phone: number;
}
interface Extra {
  key: string | null;
  parent: string | null;
  v: number;
}

const bump = (r: Record<string, number> | undefined, k: string | null, n: number): Record<string, number> => {
  const out = r ?? {};
  if (k !== null) out[k] = (out[k] ?? 0) + n;
  return out;
};

@Injectable()
export class B2bProspectAggregatePrismaRepository implements B2bProspectAggregateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async aggregate(q: ProspectAggQuery): Promise<ProspectAggCell[]> {
    const { key, parent } = KEY[q.level];
    const owners = [q.depotIds ? Prisma.sql`p."ownerDepotId" = ANY(${[...q.depotIds]}::uuid[])` : Prisma.sql`p."ownerDepotId" IS NOT NULL`];
    if (q.opportunity) owners.push(Prisma.sql`p."ownerDepotId" IS NULL`);
    const owner = Prisma.sql`(${Prisma.join(owners, ' OR ')})`;
    const visits = q.kind === 'visits';
    const from = visits ? Prisma.sql`"b2b_prospects" p JOIN "b2b_prospect_visits" v ON v."prospectId" = p.id` : Prisma.sql`"b2b_prospects" p`;
    const when =
      q.kind === 'stock'
        ? Prisma.empty
        : visits
          ? Prisma.sql`AND v."visitedAt" >= ${q.from} AND v."visitedAt" < ${q.to}`
          : Prisma.sql`AND p."status" = 'CONVERTED' AND p."convertedAt" >= ${q.from} AND p."convertedAt" < ${q.to}`;
    const d1 = visits ? Prisma.sql`v."outcome"::text` : Prisma.sql`p."category"::text`;
    const d2 = q.kind === 'stock' ? Prisma.sql`p."status"::text` : Prisma.sql`NULL::text`;
    const rows = await this.prisma.$queryRaw<Row[]>`
      SELECT ${key} AS key, ${parent} AS parent, ${d1} AS d1, ${d2} AS d2,
             count(*)::int AS n, count(p."phoneE164")::int AS phone
      FROM ${from} WHERE ${owner} ${when} GROUP BY 1, 2, 3, 4`;
    const extra =
      q.kind === 'conversions'
        ? []
        : await this.prisma.$queryRaw<Extra[]>`
      SELECT ${key} AS key, ${parent} AS parent, ${
        visits
          ? Prisma.sql`count(DISTINCT v."prospectId")::int`
          : Prisma.sql`(percentile_cont(0.5) WITHIN GROUP (ORDER BY (${q.today}::date - (coalesce(p."sourceDate", p."createdAt") AT TIME ZONE 'UTC' AT TIME ZONE ${BUSINESS_TIME_ZONE})::date)::float8))::float8`
      } AS v
      FROM ${from} WHERE ${owner} ${when} GROUP BY 1, 2`;
    const cells = new Map<string, ProspectAggCell>();
    const id = (r: { key: string | null; parent: string | null }) => `${r.key ?? ''}|${r.parent ?? ''}`;
    for (const r of rows) {
      const c = cells.get(id(r)) ?? { key: r.key, parent: r.parent, total: 0 };
      c.total += r.n;
      if (visits) c.byOutcome = bump(c.byOutcome, r.d1, r.n);
      else c.byCategory = bump(c.byCategory, r.d1, r.n);
      if (q.kind === 'stock') {
        c.byStatus = bump(c.byStatus, r.d2, r.n);
        c.withPhone = (c.withPhone ?? 0) + r.phone;
      }
      cells.set(id(r), c);
    }
    for (const e of extra) {
      const c = cells.get(id(e));
      if (!c) continue;
      if (visits) c.prospectsVisited = e.v;
      else c.dataAgeDaysMedian = Math.round(e.v);
    }
    return [...cells.values()];
  }
}
