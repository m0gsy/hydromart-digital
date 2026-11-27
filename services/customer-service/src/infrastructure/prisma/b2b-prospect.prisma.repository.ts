import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import {
  AutoOwned,
  B2bProspectRepository,
  CoverageRaw,
  CreateOutcome,
  DncKeys,
  ExportQuery,
  ExportVisit,
  NewVisit,
  ProspectListQuery,
  ProspectPatch,
  VisitRecord,
} from '../../application/ports/b2b-prospect.repository';
import { B2bProspectStatus, DuplicateProbe, NewProspect, ProspectRecord } from '../../domain/b2b-prospect';
import { matchDuplicate } from '../../domain/b2b-prospect-keys';
import { PrismaService } from './prisma.service';

type Db = Prisma.TransactionClient;

/** Half-side of the box searched for a same-name neighbour, degrees (~220 m, over the 150 m rule). */
const BOX_DEG = 0.002;

/** Interactive transactions wait for the global write lock behind other writers: say how long, not the 5 s default. */
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/** What a do-not-contact row keeps in place of the business name. */
export const DNC_NAME_PLACEHOLDER = '(dihapus: jangan hubungi)';

/** Rows deleted or anonymised per statement: a long purge must not hold one huge lock. */
const PURGE_BATCH = 1000;

const VISIT_SELECT = {
  id: true,
  visitorId: true,
  latitude: true,
  longitude: true,
  accuracyM: true,
  distanceM: true,
  outcome: true,
  note: true,
  visitedAt: true,
} as const;

/** What a retention anonymise leaves of a converted prospect: nothing that names or places the business. */
const ANONYMISED = {
  name: DNC_NAME_PLACEHOLDER,
  nameKey: '',
  latitude: 0,
  longitude: 0,
  sourceId: null,
  sourceDataset: null,
  phoneE164: null,
  contactName: null,
  address: null,
  note: null,
  lostReason: null,
  licence: null,
  customerId: null,
  assignedToId: null,
  assignedAt: null,
} as const;

const PROBE_SELECT = {
  source: true,
  sourceId: true,
  phoneE164: true,
  nameKey: true,
  latitude: true,
  longitude: true,
} as const;

async function candidatesIn(db: Db, probe: DuplicateProbe): Promise<DuplicateProbe[]> {
  const dLng = BOX_DEG / Math.max(0.1, Math.cos((probe.latitude * Math.PI) / 180));
  return db.b2bProspect.findMany({
    where: {
      OR: [
        ...(probe.sourceId ? [{ source: probe.source, sourceId: probe.sourceId }] : []),
        ...(probe.phoneE164 ? [{ phoneE164: probe.phoneE164 }] : []),
        {
          nameKey: probe.nameKey,
          latitude: { gte: probe.latitude - BOX_DEG, lte: probe.latitude + BOX_DEG },
          longitude: { gte: probe.longitude - dLng, lte: probe.longitude + dLng },
        },
      ],
    },
    select: PROBE_SELECT,
    take: 50,
  });
}

async function dncIn(db: Db, keys: DncKeys): Promise<boolean> {
  const or: Prisma.B2bDoNotContactWhereInput[] = [];
  if (keys.phoneHash) or.push({ kind: 'PHONE', keyHash: keys.phoneHash });
  if (keys.placeHashes.length) or.push({ kind: 'PLACE', keyHash: { in: [...keys.placeHashes] } });
  return or.length > 0 && (await db.b2bDoNotContact.count({ where: { OR: or } })) > 0;
}

@Injectable()
export class B2bProspectPrismaRepository implements B2bProspectRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<ProspectRecord | null> {
    return this.prisma.b2bProspect.findUnique({ where: { id } });
  }

  async list(q: ProspectListQuery): Promise<{ items: ProspectRecord[]; nextCursor: string | null }> {
    const where: Prisma.B2bProspectWhereInput = {
      ownerDepotId: q.scope === 'map' ? null : q.depotIds ? { in: [...q.depotIds] } : { not: null },
      ...(q.status && { status: q.status }),
      ...(q.category && { category: q.category }),
      ...(q.kecamatanCode && { kecamatanCode: q.kecamatanCode }),
      ...(q.kelurahanCode && { kelurahanCode: q.kelurahanCode }),
      ...(q.assignedToId && { assignedToId: q.assignedToId }),
      ...(q.unassigned && { assignedToId: null }),
      ...(q.q && { name: { contains: q.q, mode: 'insensitive' as const } }),
    };
    const rows = await this.prisma.b2bProspect.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      // The extra row is the first one of the next page: its id is the cursor, and it is included.
      ...(q.cursor && { cursor: { id: q.cursor } }),
    });
    return { items: rows.slice(0, q.limit), nextCursor: rows[q.limit]?.id ?? null };
  }

  visits(prospectId: string, take: number): Promise<VisitRecord[]> {
    return this.prisma.b2bProspectVisit.findMany({
      where: { prospectId },
      orderBy: { visitedAt: 'desc' },
      take,
      select: VISIT_SELECT,
    });
  }

  findDuplicateCandidates(probe: DuplicateProbe): Promise<DuplicateProbe[]> {
    return candidatesIn(this.prisma, probe);
  }

  dncPresent(keys: DncKeys): Promise<boolean> {
    return dncIn(this.prisma, keys);
  }

  async createGuarded(data: NewProspect, dnc: DncKeys): Promise<CreateOutcome> {
    const probe: DuplicateProbe = {
      source: data.source,
      sourceId: data.sourceId,
      phoneE164: data.phoneE164,
      nameKey: data.nameKey,
      latitude: data.latitude,
      longitude: data.longitude,
    };
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('b2b_prospect_write'))`;
        if (await dncIn(tx, dnc)) return { ok: false, reason: 'DO_NOT_CONTACT' } as const;
        if (matchDuplicate(await candidatesIn(tx, probe), probe)) {
          return { ok: false, reason: 'DUPLICATE' } as const;
        }
        const prospect = await tx.b2bProspect.create({ data: { ...data, lastActivityAt: new Date() } });
        return { ok: true, prospect } as const;
      }, TX_OPTIONS);
    } catch (error) {
      // The unique indexes are the backstop of the lock: losing that race is a duplicate, not a 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { ok: false, reason: 'DUPLICATE' };
      }
      throw error;
    }
  }

  async update(id: string, patch: ProspectPatch, seenUpdatedAt?: Date): Promise<ProspectRecord | null> {
    const { count } = await this.prisma.b2bProspect.updateMany({
      where: { id, ...(seenUpdatedAt && { updatedAt: seenUpdatedAt }) },
      data: patch,
    });
    return count === 0 ? null : this.findById(id);
  }

  async addDnc(
    entries: { kind: 'PHONE' | 'PLACE'; keyHash: string }[],
    reason: Prisma.B2bDoNotContactCreateManyInput['reason'],
    addedById: string,
  ): Promise<void> {
    await this.prisma.b2bDoNotContact.createMany({
      data: entries.map((e) => ({ ...e, reason, addedById })),
      skipDuplicates: true,
    });
  }

  suppress(
    match: { id?: string; phoneE164?: string | null; nameKey?: string; cells?: readonly string[] },
    entries: { kind: 'PHONE' | 'PLACE'; keyHash: string }[],
    reason: Prisma.B2bDoNotContactCreateManyInput['reason'],
    addedById: string,
  ): Promise<{ id: string; ownerDepotId: string | null }[]> {
    const or: Prisma.B2bProspectWhereInput[] = [];
    if (match.id) or.push({ id: match.id });
    if (match.phoneE164) or.push({ phoneE164: match.phoneE164 });
    if (match.nameKey && match.cells?.length) {
      or.push({ nameKey: match.nameKey, gridCell: { in: [...match.cells] } });
    }
    return this.prisma.$transaction(async (tx) => {
      // The same lock a create takes: a create that passed its do-not-contact check cannot land
      // between the entry and the wipe.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('b2b_prospect_write'))`;
      await tx.b2bDoNotContact.createMany({
        data: entries.map((e) => ({ ...e, reason, addedById })),
        skipDuplicates: true,
      });
      if (or.length === 0) return [];
      const rows = await tx.b2bProspect.findMany({
        where: { OR: or, status: { notIn: ['CONVERTED', 'DO_NOT_CONTACT'] } },
        select: { id: true, ownerDepotId: true },
      });
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.id);
      // Not lastActivityAt: suppressing is not activity (the retention clock keeps running).
      await tx.b2bProspect.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'DO_NOT_CONTACT',
          name: DNC_NAME_PLACEHOLDER,
          nameKey: '',
          latitude: 0,
          longitude: 0,
          sourceId: null,
          sourceDataset: null,
          phoneE164: null,
          contactName: null,
          note: null,
          address: null,
          lostReason: null,
          assignedToId: null,
          assignedAt: null,
          suppressedAt: new Date(),
        },
      });
      await tx.b2bProspectVisit.updateMany({
        where: { prospectId: { in: ids } },
        data: { latitude: 0, longitude: 0, note: null },
      });
      return rows;
    }, TX_OPTIONS);
  }

  async recordVisit(
    id: string,
    from: B2bProspectStatus,
    to: B2bProspectStatus,
    visit: NewVisit,
    now: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // The row first: if the purge took it, or somebody moved it, nothing is written (no orphan visit).
      const { count } = await tx.b2bProspect.updateMany({
        where: { id, status: from },
        data: { status: to, lastActivityAt: now },
      });
      if (count === 0) return null;
      const made = await tx.b2bProspectVisit.create({ data: { prospectId: id, ...visit }, select: VISIT_SELECT });
      const prospect = await tx.b2bProspect.findUniqueOrThrow({ where: { id } });
      return { prospect, visit: made };
    });
  }

  exportRows(q: ExportQuery): Promise<ProspectRecord[]> {
    return this.prisma.b2bProspect.findMany({
      where: {
        // A do-not-contact or anonymised row has nothing left to export; a depot role never sees the map.
        status: q.status ? q.status : { not: 'DO_NOT_CONTACT' },
        nameKey: { not: '' },
        ownerDepotId: q.depotIds ? { in: [...q.depotIds] } : undefined,
        ...(q.category && { category: q.category }),
        ...(q.kecamatanCode && { kecamatanCode: q.kecamatanCode }),
        ...(q.assignedToId && { assignedToId: q.assignedToId }),
        ...(q.unassigned && { assignedToId: null }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: q.take,
    });
  }

  exportVisits(prospectIds: readonly string[], take: number): Promise<ExportVisit[]> {
    return this.prisma.b2bProspectVisit.findMany({
      where: { prospectId: { in: [...prospectIds] } },
      orderBy: [{ visitedAt: 'desc' }, { id: 'asc' }],
      take,
      select: { prospectId: true, visitorId: true, visitedAt: true, outcome: true, distanceM: true },
    });
  }

  autoOwnedAfter(afterId: string | null, take: number): Promise<AutoOwned[]> {
    return this.prisma.b2bProspect.findMany({
      where: {
        ownerSource: 'AUTO',
        status: { notIn: ['CONVERTED', 'DO_NOT_CONTACT'] },
        ...(afterId && { id: { gt: afterId } }),
      },
      orderBy: { id: 'asc' },
      take,
      select: { id: true, latitude: true, longitude: true, ownerDepotId: true },
    });
  }

  async moveOwner(id: string, from: string | null, to: string | null): Promise<boolean> {
    // Guarded on the owner it was read with and on AUTO, so an HQ decision made meanwhile is never overwritten.
    const { count } = await this.prisma.b2bProspect.updateMany({
      where: { id, ownerSource: 'AUTO', ownerDepotId: from, status: { notIn: ['CONVERTED', 'DO_NOT_CONTACT'] } },
      data: { ownerDepotId: to, assignedToId: null, assignedAt: null },
    });
    return count > 0;
  }

  async purge(cutoff: Date): Promise<{ deleted: number; anonymised: number }> {
    // Every statement re-checks the cutoff on the rows it touches: a visit that lands between the id
    // read and the write moves lastActivityAt past the cutoff and the row survives, whole.
    const stale: Prisma.B2bProspectWhereInput = {
      OR: [
        { status: { notIn: ['CONVERTED', 'DO_NOT_CONTACT'] }, lastActivityAt: { lt: cutoff } },
        {
          status: 'DO_NOT_CONTACT',
          OR: [{ suppressedAt: { lt: cutoff } }, { suppressedAt: null, lastActivityAt: { lt: cutoff } }],
        },
      ],
    };
    let deleted = 0;
    for (;;) {
      const ids = (
        await this.prisma.b2bProspect.findMany({ where: stale, select: { id: true }, take: PURGE_BATCH })
      ).map((r) => r.id);
      const { count } = await this.prisma.b2bProspect.deleteMany({ where: { id: { in: ids }, ...stale } });
      deleted += count;
      if (ids.length < PURGE_BATCH || count === 0) break;
    }

    // A converted business is a customer-to-be-counted: it keeps category, area codes, 1 km cell, source,
    // status, converted date and owner depot, and loses everything that names or places it.
    const converted: Prisma.B2bProspectWhereInput = {
      status: 'CONVERTED',
      nameKey: { not: '' },
      lastActivityAt: { lt: cutoff },
    };
    let anonymised = 0;
    for (;;) {
      const ids = (
        await this.prisma.b2bProspect.findMany({ where: converted, select: { id: true }, take: PURGE_BATCH })
      ).map((r) => r.id);
      const count = await this.prisma.$transaction(async (tx) => {
        const done = await tx.b2bProspect.updateMany({ where: { id: { in: ids }, ...converted }, data: ANONYMISED });
        if (done.count > 0) {
          await tx.b2bProspectVisit.updateMany({
            // Only the rows that really were anonymised (one that got a visit meanwhile kept its clock and its visits).
            where: { prospectId: { in: ids }, prospect: { nameKey: '' } },
            data: { latitude: 0, longitude: 0, note: null },
          });
        }
        return done.count;
      }, TX_OPTIONS);
      anonymised += count;
      if (ids.length < PURGE_BATCH || count === 0) break;
    }
    return { deleted, anonymised };
  }

  async createBatch(data: Parameters<B2bProspectRepository['createBatch']>[0]): Promise<void> {
    await this.prisma.b2bImportBatch.create({ data });
  }

  async coverage(scope: { depotIds?: readonly string[]; includeCost: boolean }): Promise<CoverageRaw> {
    const where: Prisma.B2bProspectWhereInput = scope.depotIds
      ? { ownerDepotId: { in: [...scope.depotIds] } }
      : {};
    const depotSql = scope.depotIds
      ? Prisma.sql`WHERE "ownerDepotId" = ANY(${[...scope.depotIds]}::uuid[])`
      : Prisma.empty;
    const [total, onMap, byCategory, withPhone, byStatus, bySource, age, cost] = await Promise.all([
      this.prisma.b2bProspect.count({ where }),
      scope.depotIds ? 0 : this.prisma.b2bProspect.count({ where: { ownerDepotId: null } }),
      this.prisma.b2bProspect.groupBy({ by: ['category'], where, _count: { _all: true }, orderBy: { category: 'asc' } }),
      this.prisma.b2bProspect.groupBy({
        by: ['category'],
        where: { ...where, phoneE164: { not: null } },
        _count: { _all: true },
        orderBy: { category: 'asc' },
      }),
      this.prisma.b2bProspect.groupBy({ by: ['status'], where, _count: { _all: true }, orderBy: { status: 'asc' } }),
      this.prisma.b2bProspect.groupBy({ by: ['source'], where, _count: { _all: true }, orderBy: { source: 'asc' } }),
      this.prisma.$queryRaw<{ newest: Date | null; oldest: Date | null; median: number | null }[]>`
        SELECT max(ts) AS newest, min(ts) AS oldest,
               (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ts)) * 1000)::float8 AS median
        FROM (SELECT coalesce("sourceDate", "createdAt") AS ts FROM "b2b_prospects" ${depotSql}) t`,
      scope.includeCost
        ? this.prisma.b2bImportBatch.aggregate({ _sum: { costIdr: true } })
        : Promise.resolve(null),
    ]);
    const phones = new Map(withPhone.map((r) => [r.category, r._count._all]));
    const a = age[0];
    return {
      total,
      onMap,
      byCategory: byCategory.map((r) => ({
        category: r.category,
        total: r._count._all,
        withPhone: phones.get(r.category) ?? 0,
      })),
      byStatus: byStatus.map((r) => ({ status: r.status, total: r._count._all })),
      bySource: bySource.map((r) => ({ source: r.source, total: r._count._all })),
      age: a?.newest && a.oldest && a.median != null
        ? { newest: a.newest.getTime(), median: a.median, oldest: a.oldest.getTime() }
        : null,
      thirdPartyCostIdr: cost ? (cost._sum.costIdr ?? 0) : null,
    };
  }
}
