import { Injectable } from '@nestjs/common';

import { Shift } from '../../../prisma/generated/client';
import { ShiftRepository, ShiftWrite } from '../../application/ports/shift.repository';
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

  list(depotId?: string): Promise<Shift[]> {
    return this.prisma.shift.findMany({
      where: depotId ? { depotId } : {},
      orderBy: [{ depotId: 'asc' }, { startTime: 'asc' }],
    });
  }

  findActiveForDepot(depotId: string): Promise<Shift | null> {
    // Prefer the depot's own active shift; fall back to a network-wide (null-depot) one.
    return this.prisma.shift.findFirst({
      where: { active: true, OR: [{ depotId }, { depotId: null }] },
      orderBy: { depotId: 'desc' }, // non-null depotId sorts before null → depot's own wins
    });
  }
}
