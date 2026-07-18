import { Injectable } from '@nestjs/common';

import { ShiftAssignment, ShiftKind } from '../../domain/shift';
import { RosterRepository, UpsertShiftData } from '../../application/ports/roster.repository';
import { PrismaService } from './prisma.service';

interface ShiftRow {
  id: string;
  depotId: string;
  staffId: string;
  staffName: string;
  weekStart: string;
  day: number;
  shift: string;
}

@Injectable()
export class RosterPrismaRepository implements RosterRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ShiftRow): ShiftAssignment {
    return {
      id: row.id,
      depotId: row.depotId,
      staffId: row.staffId,
      staffName: row.staffName,
      weekStart: row.weekStart,
      day: row.day,
      shift: row.shift as ShiftKind,
    };
  }

  async listForWeek(depotId: string, weekStart: string): Promise<ShiftAssignment[]> {
    const rows = await this.prisma.shiftAssignment.findMany({ where: { depotId, weekStart } });
    return rows.map((r) => this.toRecord(r));
  }

  async upsertCell(a: UpsertShiftData): Promise<ShiftAssignment> {
    const row = await this.prisma.shiftAssignment.upsert({
      where: {
        depotId_weekStart_staffId_day: {
          depotId: a.depotId,
          weekStart: a.weekStart,
          staffId: a.staffId,
          day: a.day,
        },
      },
      create: a,
      update: { shift: a.shift, staffName: a.staffName },
    });
    return this.toRecord(row);
  }

  async bulkUpsert(assignments: UpsertShiftData[]): Promise<ShiftAssignment[]> {
    const rows = await this.prisma.$transaction(
      assignments.map((a) =>
        this.prisma.shiftAssignment.upsert({
          where: {
            depotId_weekStart_staffId_day: {
              depotId: a.depotId,
              weekStart: a.weekStart,
              staffId: a.staffId,
              day: a.day,
            },
          },
          create: a,
          update: { shift: a.shift, staffName: a.staffName },
        }),
      ),
    );
    return (rows as ShiftRow[]).map((r) => this.toRecord(r));
  }
}
