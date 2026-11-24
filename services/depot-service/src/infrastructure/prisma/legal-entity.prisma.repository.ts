import { Injectable } from '@nestjs/common';
import { StaleWriteError } from '@hydromart/platform';

import { Prisma } from '../../../prisma/generated/client';
import {
  AiGrantChange,
  AssignDepotsData,
  AssignedDepot,
  CreateLegalEntityData,
  LegalEntityRepository,
  UpdateLegalEntityData,
} from '../../application/ports/legal-entity.repository';
import { DuplicateLegalEntityNameError } from '../../domain/errors';
import { OwnershipType } from '../../domain/inventory';
import {
  DepotLegalEntityHistory,
  DepotLegalEntityPoint,
  LegalEntity,
  LegalEntityKind,
  LegalEntityRecord,
  DepotEntitySpan,
  entitySpans,
  formatCalendarDay,
} from '../../domain/legal-entity';
import { PrismaService } from './prisma.service';

// ponytail: one read for the whole admin screen. A network of 100+ depots has a few hundred
// entities at most; past this the list is cut and the screen would need paging.
const LIST_CAP = 1000;

interface EntityRow {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PointRow {
  id: string;
  depotId: string;
  legalEntityId: string;
  effectiveFrom: Date;
  recordedBy: string | null;
  recordedAt: Date;
}

const isCode = (error: unknown, code: string): boolean => (error as { code?: string })?.code === code;

@Injectable()
export class LegalEntityPrismaRepository implements LegalEntityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<LegalEntityRecord[]> {
    const rows = await this.prisma.legalEntity.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: LIST_CAP,
      // Bounded by the number of roles, so the nested read needs no cap of its own.
      include: { aiGrants: { select: { roleKey: true }, orderBy: { roleKey: 'asc' } } },
    });
    return rows.map(({ aiGrants, ...row }) => ({
      ...this.toEntity(row),
      aiReadRoles: aiGrants.map((g) => g.roleKey),
    }));
  }

  async entityTimeline(depotIds: string[], from: Date, to: Date): Promise<DepotEntitySpan[]> {
    // ponytail: every point up to `to` of at most 100 depots is read and shaped in memory (a depot
    // changes hands a handful of times); the `take` is a ceiling, past it a depot's history is cut.
    const rows = await this.prisma.depotLegalEntity.findMany({
      where: { depotId: { in: depotIds }, effectiveFrom: { lte: to } },
      orderBy: [{ depotId: 'asc' }, { effectiveFrom: 'asc' }],
      take: LIST_CAP * 10,
    });
    return entitySpans(
      depotIds,
      rows.map((r) => ({ depotId: r.depotId, legalEntityId: r.legalEntityId, effectiveFrom: formatCalendarDay(r.effectiveFrom) })),
      formatCalendarDay(from),
      formatCalendarDay(to),
    );
  }

  async grantedEntityIds(roleKey: string): Promise<string[]> {
    const rows = await this.prisma.legalEntityAiGrant.findMany({
      where: { roleKey },
      select: { legalEntityId: true },
      take: LIST_CAP,
    });
    return rows.map((r) => r.legalEntityId);
  }

  async findById(id: string): Promise<LegalEntity | null> {
    const row = await this.prisma.legalEntity.findUnique({ where: { id } });
    return row ? this.toEntity(row) : null;
  }

  async existingIds(ids: string[]): Promise<string[]> {
    const rows = await this.prisma.legalEntity.findMany({
      where: { id: { in: ids } },
      select: { id: true },
      take: ids.length,
    });
    return rows.map((r) => r.id);
  }

  async create(data: CreateLegalEntityData): Promise<LegalEntity> {
    try {
      return this.toEntity(await this.prisma.legalEntity.create({ data }));
    } catch (error) {
      // The unique index on lower(name) is the real guard: two people adding the same company
      // at once both pass the service's look-up, and only one of them gets a row.
      if (isCode(error, 'P2002')) throw new DuplicateLegalEntityNameError();
      throw error;
    }
  }

  async update(id: string, data: UpdateLegalEntityData, expectedUpdatedAt: Date | null): Promise<LegalEntity> {
    let count: number;
    try {
      // Compare-and-set: two saves that both passed the service's freshness check on the same
      // version cannot both land; the second finds the version moved and is refused.
      ({ count } = await this.prisma.legalEntity.updateMany({
        where: { id, ...(expectedUpdatedAt ? { updatedAt: expectedUpdatedAt } : {}) },
        data,
      }));
    } catch (error) {
      if (isCode(error, 'P2002')) throw new DuplicateLegalEntityNameError();
      throw error;
    }
    if (count === 0) throw new StaleWriteError();
    return this.toEntity(await this.prisma.legalEntity.findUniqueOrThrow({ where: { id } }));
  }

  async setAiGrants(changes: AiGrantChange[], grantedBy: string | null): Promise<void> {
    // One order for every writer (entity, then role), so two overlapping saves lock the same
    // rows in the same order and cannot deadlock each other.
    const sorted = [...changes].sort(
      (a, b) => a.legalEntityId.localeCompare(b.legalEntityId) || a.roleKey.localeCompare(b.roleKey),
    );
    const grants = sorted.filter((c) => c.granted);
    const revokes = sorted.filter((c) => !c.granted);
    // Insert-or-ignore and delete-what-matches: both are absolute, so two editors saving
    // different cells of the matrix at once cannot undo each other.
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    if (grants.length) {
      writes.push(
        this.prisma.legalEntityAiGrant.createMany({
          data: grants.map((g) => ({ legalEntityId: g.legalEntityId, roleKey: g.roleKey, grantedBy })),
          skipDuplicates: true,
        }),
      );
    }
    if (revokes.length) {
      writes.push(
        this.prisma.legalEntityAiGrant.deleteMany({
          where: { OR: revokes.map((r) => ({ legalEntityId: r.legalEntityId, roleKey: r.roleKey })) },
        }),
      );
    }
    if (writes.length) await this.prisma.$transaction(writes);
  }

  async depotHistories(): Promise<DepotLegalEntityHistory[]> {
    const depots = await this.prisma.depot.findMany({
      orderBy: [{ code: 'asc' }],
      take: LIST_CAP,
      select: {
        id: true,
        code: true,
        name: true,
        ownershipType: true,
        active: true,
        // A depot changes hands a handful of times in its life; no cap of its own needed.
        legalEntities: { orderBy: { effectiveFrom: 'desc' } },
      },
    });
    return depots.map((d) => ({
      depotId: d.id,
      code: d.code,
      name: d.name,
      ownershipType: d.ownershipType as OwnershipType,
      active: d.active,
      points: d.legalEntities.map((p) => this.toPoint(p)),
    }));
  }

  async assignDepots(data: AssignDepotsData): Promise<AssignedDepot[]> {
    const day = formatCalendarDay(data.effectiveFrom);
    // Sorted: overlapping saves take their locks, and write their rows, in one order.
    const depotIds = [...data.depotIds].sort();
    return this.prisma.$transaction(async (tx) => {
      // One lock per (depot, day), held to commit. The check below and the write after it are
      // then one step for that day: nobody can change it in between, even where no row exists.
      const keys = depotIds.map((id) => Prisma.sql`(${`depot-legal-entity:${id}:${day}`})`);
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(k, 0)) FROM (VALUES ${Prisma.join(keys)}) AS v(k)`,
      );
      const current = await tx.depotLegalEntity.findMany({
        where: { depotId: { in: depotIds }, effectiveFrom: data.effectiveFrom },
        select: { depotId: true, legalEntityId: true },
        take: depotIds.length,
      });
      const had = new Map(current.map((c) => [c.depotId, c.legalEntityId]));
      // A day that changed since the screen read it is somebody else's write, not ours to erase.
      // A day that already holds the target is no conflict (a retry, or two people agreeing): the
      // write below leaves it alone.
      const stale = (id: string): boolean => {
        const stored = had.get(id) ?? null;
        return stored !== (data.seen.get(id) ?? null) && stored !== data.legalEntityId;
      };
      if (depotIds.some(stale)) throw new StaleWriteError();
      // The WHERE skips a day that already holds this entity: nothing is rewritten, and the depot
      // is left out of the result (and of the audit line).
      const written = await tx.$queryRaw<{ depotId: string }[]>(Prisma.sql`
        INSERT INTO "depot_legal_entities"
          ("id", "depotId", "legalEntityId", "effectiveFrom", "recordedBy", "recordedAt")
        SELECT gen_random_uuid(), d."depotId", ${data.legalEntityId}::uuid, ${day}::date,
               ${data.recordedBy}::uuid, CURRENT_TIMESTAMP
        FROM (VALUES ${Prisma.join(depotIds.map((id) => Prisma.sql`(${id}::uuid)`))}) AS d("depotId")
        ON CONFLICT ("depotId", "effectiveFrom") DO UPDATE
          SET "legalEntityId" = EXCLUDED."legalEntityId",
              "recordedBy" = EXCLUDED."recordedBy",
              "recordedAt" = EXCLUDED."recordedAt"
          WHERE "depot_legal_entities"."legalEntityId" IS DISTINCT FROM EXCLUDED."legalEntityId"
        RETURNING "depotId"
      `);
      return written.map((w) => ({ depotId: w.depotId, replaced: had.get(w.depotId) ?? null }));
    });
  }

  async removeDepotPoint(id: string, seenLegalEntityId: string): Promise<DepotLegalEntityPoint | null> {
    try {
      // Deleted only while it still holds what the screen showed: one statement, no window.
      return this.toPoint(
        await this.prisma.depotLegalEntity.delete({ where: { id, legalEntityId: seenLegalEntityId } }),
      );
    } catch (error) {
      if (!isCode(error, 'P2025')) throw error;
      // Not deleted: gone already (a second click, or somebody else) is a 404; still there means
      // it was corrected to another entity since the screen was read.
      if (await this.prisma.depotLegalEntity.findUnique({ where: { id }, select: { id: true } })) {
        throw new StaleWriteError();
      }
      return null;
    }
  }

  private toEntity(row: EntityRow): LegalEntity {
    return { ...row, kind: row.kind as LegalEntityKind };
  }

  private toPoint(row: PointRow): DepotLegalEntityPoint {
    return {
      id: row.id,
      depotId: row.depotId,
      legalEntityId: row.legalEntityId,
      effectiveFrom: formatCalendarDay(row.effectiveFrom),
      recordedBy: row.recordedBy,
      recordedAt: row.recordedAt,
    };
  }
}
