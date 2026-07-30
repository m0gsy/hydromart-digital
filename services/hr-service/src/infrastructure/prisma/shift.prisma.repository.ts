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

  list(depotIds?: readonly string[]): Promise<Shift[]> {
    return this.prisma.shift.findMany({
      where: depotIds ? { depotId: depotWhere(depotIds) } : {},
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
