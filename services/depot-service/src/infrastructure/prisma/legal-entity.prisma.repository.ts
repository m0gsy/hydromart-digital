import { Injectable } from '@nestjs/common';

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

  async update(id: string, data: UpdateLegalEntityData): Promise<LegalEntity> {
    try {
      return this.toEntity(await this.prisma.legalEntity.update({ where: { id }, data }));
    } catch (error) {
      if (isCode(error, 'P2002')) throw new DuplicateLegalEntityNameError();
      throw error;
    }
  }

  async setAiGrants(changes: AiGrantChange[], grantedBy: string | null): Promise<void> {
    const grants = changes.filter((c) => c.granted);
    const revokes = changes.filter((c) => !c.granted);
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
    return this.prisma.$transaction(async (tx) => {
      // Read for the audit line only (which entity a corrected day held before); the write
      // below decides on its own and does not trust this read.
      const before = await tx.depotLegalEntity.findMany({
        where: { depotId: { in: data.depotIds }, effectiveFrom: data.effectiveFrom },
        select: { depotId: true, legalEntityId: true },
        take: data.depotIds.length,
      });
      const had = new Map(before.map((b) => [b.depotId, b.legalEntityId]));
      // One statement, so two people setting the same depot and day at once end with one row
      // instead of a unique-index 500. The WHERE skips a day that already holds this entity:
      // nothing is rewritten, and the depot is left out of the result (and of the audit line).
      const written = await tx.$queryRaw<{ depotId: string }[]>(Prisma.sql`
        INSERT INTO "depot_legal_entities"
          ("id", "depotId", "legalEntityId", "effectiveFrom", "recordedBy", "recordedAt")
        SELECT gen_random_uuid(), d."depotId", ${data.legalEntityId}::uuid, ${day}::date,
               ${data.recordedBy}::uuid, CURRENT_TIMESTAMP
        FROM (VALUES ${Prisma.join(data.depotIds.map((id) => Prisma.sql`(${id}::uuid)`))}) AS d("depotId")
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

  async removeDepotPoint(id: string): Promise<DepotLegalEntityPoint | null> {
    try {
      return this.toPoint(await this.prisma.depotLegalEntity.delete({ where: { id } }));
    } catch (error) {
      // Gone already (a second click, or somebody else): the caller answers 404.
      if (isCode(error, 'P2025')) return null;
      throw error;
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
