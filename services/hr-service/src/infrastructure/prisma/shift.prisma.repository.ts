import { Injectable } from '@nestjs/common';
import { depotWhere } from '@hydromart/platform';

import { Shift, ShiftAssignment, ShiftRotation } from '../../../prisma/generated/client';
import {
  AssignmentWrite,
  RotationWrite,
  ShiftRepository,
  ShiftWrite,
} from '../../application/ports/shift.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class ShiftPrismaRepository implements ShiftRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: ShiftWrite): Promise<Shift> {
    return this.prisma.shift.create({ data });
  }

  update(id: string, data: Partial<ShiftWrite>): Promise<Shift> {
    return this.prisma.shift.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.shift.delete({ where: { id } });
  }

  findById(id: string): Promise<Shift | null> {
    return this.prisma.shift.findUnique({ where: { id } });
  }

  async countReferences(shiftId: string): Promise<number> {
    // `pattern` is JSON, so the rotations are matched in SQL rather than loaded: a rotation
    // names shifts as VALUES of a `{weekday: shiftId}` object, which no Prisma filter can
    // express. `jsonb_each_text` unrolls it; the cast is needed because the column is `Json`.
    const [assignments, employees, rotations] = await Promise.all([
      this.prisma.shiftAssignment.count({ where: { shiftId } }),
      this.prisma.employee.count({ where: { shiftId } }),
      this.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT COUNT(*)::bigint AS n
        FROM "shift_rotations" r
        WHERE EXISTS (
          SELECT 1 FROM jsonb_each_text(r."pattern"::jsonb) AS kv(day, "shiftId")
          WHERE kv."shiftId" = ${shiftId}
        )
      `,
    ]);
    return assignments + employees + Number(rotations[0]?.n ?? 0);
  }

  /**
   * B4: a depot sees its own shifts PLUS the network-wide ones — the same rule
   * `listRotations` below and `findActiveForDepot` above already follow.
   *
   * This one excluded `depotId: null`, so the three methods disagreed about the same rows.
   * A depot-scoped HR user got rotations pointing at shifts their own list did not contain:
   * `/hr/shift` printed "shift terhapus" for a shift that exists and is in daily use, and
   * `/hr/calendar` hid the very shift that decides that depot's clock-in time.
   */
  list(depotIds?: readonly string[]): Promise<Shift[]> {
    return this.prisma.shift.findMany({
      where: depotIds ? { OR: [{ depotId: depotWhere(depotIds) }, { depotId: null }] } : {},
      orderBy: [{ depotId: 'asc' }, { startTime: 'asc' }],
    });
  }

  findActiveForDepot(depotId: string | null): Promise<Shift | null> {
    // Prefer the depot's own active shift; fall back to a network-wide (null-depot) one.
    return this.prisma.shift.findFirst({
      where: { active: true, OR: [{ depotId }, { depotId: null }] },
      orderBy: { depotId: 'desc' }, // non-null depotId sorts before null → depot's own wins
    });
  }

  createRotation(data: RotationWrite): Promise<ShiftRotation> {
    return this.prisma.shiftRotation.create({ data });
  }

  updateRotation(id: string, data: Partial<RotationWrite>): Promise<ShiftRotation> {
    return this.prisma.shiftRotation.update({ where: { id }, data });
  }

  findRotationById(id: string): Promise<ShiftRotation | null> {
    return this.prisma.shiftRotation.findUnique({ where: { id } });
  }

  listRotations(depotIds?: readonly string[]): Promise<ShiftRotation[]> {
    // Like departments, a depot sees its own PLUS the network-wide ones.
    return this.prisma.shiftRotation.findMany({
      where: depotIds ? { OR: [{ depotId: depotWhere(depotIds) }, { depotId: null }] } : {},
      orderBy: [{ depotId: 'asc' }, { name: 'asc' }],
    });
  }

  assign(data: AssignmentWrite): Promise<ShiftAssignment> {
    return this.prisma.shiftAssignment.create({ data });
  }

  listAssignmentsUpTo(employeeId: string, onDate: Date): Promise<ShiftAssignment[]> {
    return this.prisma.shiftAssignment.findMany({
      where: { employeeId, effectiveFrom: { lte: onDate } },
      orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
    });
  }

  listAssignments(employeeId: string): Promise<ShiftAssignment[]> {
    return this.prisma.shiftAssignment.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
}
