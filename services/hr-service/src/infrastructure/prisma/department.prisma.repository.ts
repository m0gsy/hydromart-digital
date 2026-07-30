import { Injectable } from '@nestjs/common';
import { depotWhere } from '@hydromart/platform';

import { Department } from '../../../prisma/generated/client';
import {
  DepartmentRepository,
  DepartmentWrite,
} from '../../application/ports/department.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class DepartmentPrismaRepository implements DepartmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: DepartmentWrite): Promise<Department> {
    return this.prisma.department.create({ data });
  }

  update(id: string, data: Partial<DepartmentWrite>): Promise<Department> {
    return this.prisma.department.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.department.delete({ where: { id } });
  }

  findById(id: string): Promise<Department | null> {
    return this.prisma.department.findUnique({ where: { id } });
  }

  list(depotIds?: readonly string[]): Promise<Department[]> {
    return this.prisma.department.findMany({
      where: depotIds ? { OR: [{ depotId: depotWhere(depotIds) }, { depotId: null }] } : {},
      orderBy: [{ depotId: 'asc' }, { code: 'asc' }],
    });
  }
}
