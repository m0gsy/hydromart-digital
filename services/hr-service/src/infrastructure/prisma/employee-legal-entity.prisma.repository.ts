import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import {
  AssignEmployeesData,
  AssignedEmployee,
  EmployeeLegalEntityRepository,
} from '../../application/ports/employee-legal-entity.repository';
import {
  EmployeeLegalEntityHistory,
  EmployeeLegalEntityPoint,
  formatCalendarDay,
} from '../../domain/legal-entity';
import { PrismaService } from './prisma.service';

// ponytail: one read for the whole admin screen. 100+ depots at a handful of people each is well
// under this; past it the list is cut and the screen would need paging.
const LIST_CAP = 5000;

interface PointRow {
  id: string;
  employeeId: string;
  legalEntityId: string;
  effectiveFrom: Date;
  recordedBy: string | null;
  recordedAt: Date;
}

@Injectable()
export class EmployeeLegalEntityPrismaRepository implements EmployeeLegalEntityRepository {
  constructor(private readonly prisma: PrismaService) {}

  async histories(): Promise<EmployeeLegalEntityHistory[]> {
    const rows = await this.prisma.employee.findMany({
      orderBy: [{ employeeCode: 'asc' }],
      take: LIST_CAP,
      select: {
        id: true,
        employeeCode: true,
        fullName: true,
        position: true,
        depotId: true,
        status: true,
        // A person changes employer a handful of times; no cap of its own needed.
        legalEntities: { orderBy: { effectiveFrom: 'desc' } },
      },
    });
    return rows.map((e) => ({
      employeeId: e.id,
      employeeCode: e.employeeCode,
      fullName: e.fullName,
      position: e.position,
      depotId: e.depotId,
      status: e.status,
      points: e.legalEntities.map((p) => this.toPoint(p)),
    }));
  }

  async existingEmployeeIds(ids: string[]): Promise<string[]> {
    const rows = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: { id: true },
      take: ids.length,
    });
    return rows.map((r) => r.id);
  }

  async assign(data: AssignEmployeesData): Promise<AssignedEmployee[]> {
    const day = formatCalendarDay(data.effectiveFrom);
    return this.prisma.$transaction(async (tx) => {
      // Read for the audit trail only (which entity a corrected day held before).
      const before = await tx.employeeLegalEntity.findMany({
        where: { employeeId: { in: data.employeeIds }, effectiveFrom: data.effectiveFrom },
        select: { employeeId: true, legalEntityId: true },
        take: data.employeeIds.length,
      });
      const had = new Map(before.map((b) => [b.employeeId, b.legalEntityId]));
      // One statement, so two people dating the same employee and day at once end with one row
      // instead of a unique-index 500. A day that already holds this entity is left alone.
      const written = await tx.$queryRaw<{ employeeId: string }[]>(Prisma.sql`
        INSERT INTO "employee_legal_entities"
          ("id", "employeeId", "legalEntityId", "effectiveFrom", "recordedBy", "recordedAt")
        SELECT gen_random_uuid(), e."employeeId", ${data.legalEntityId}::uuid, ${day}::date,
               ${data.recordedBy}::uuid, CURRENT_TIMESTAMP
        FROM (VALUES ${Prisma.join(data.employeeIds.map((id) => Prisma.sql`(${id}::uuid)`))}) AS e("employeeId")
        ON CONFLICT ("employeeId", "effectiveFrom") DO UPDATE
          SET "legalEntityId" = EXCLUDED."legalEntityId",
              "recordedBy" = EXCLUDED."recordedBy",
              "recordedAt" = EXCLUDED."recordedAt"
          WHERE "employee_legal_entities"."legalEntityId" IS DISTINCT FROM EXCLUDED."legalEntityId"
        RETURNING "employeeId"
      `);
      return written.map((w) => ({ employeeId: w.employeeId, replaced: had.get(w.employeeId) ?? null }));
    });
  }

  async remove(id: string): Promise<EmployeeLegalEntityPoint | null> {
    try {
      return this.toPoint(await this.prisma.employeeLegalEntity.delete({ where: { id } }));
    } catch (error) {
      // Gone already (a second click, or somebody else): the caller answers 404.
      if ((error as { code?: string })?.code === 'P2025') return null;
      throw error;
    }
  }

  private toPoint(row: PointRow): EmployeeLegalEntityPoint {
    return {
      id: row.id,
      employeeId: row.employeeId,
      legalEntityId: row.legalEntityId,
      effectiveFrom: formatCalendarDay(row.effectiveFrom),
      recordedBy: row.recordedBy,
      recordedAt: row.recordedAt,
    };
  }
}
