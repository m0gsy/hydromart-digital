import { Injectable } from '@nestjs/common';

import { Allowance } from '../../../prisma/generated/client';
import { AllowanceRepository, AllowanceWrite } from '../../application/ports/allowance.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class AllowancePrismaRepository implements AllowanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: AllowanceWrite): Promise<Allowance> {
    return this.prisma.allowance.create({ data });
  }

  update(id: string, data: Partial<Omit<AllowanceWrite, 'employeeId'>>): Promise<Allowance> {
    return this.prisma.allowance.update({ where: { id }, data });
  }

  findById(id: string): Promise<Allowance | null> {
    return this.prisma.allowance.findUnique({ where: { id } });
  }

  listByEmployee(employeeId: string): Promise<Allowance[]> {
    return this.prisma.allowance.findMany({
      where: { employeeId },
      orderBy: [{ active: 'desc' }, { effectiveFrom: 'desc' }],
    });
  }

  listActiveForPeriod(employeeId: string, from: Date, to: Date): Promise<Allowance[]> {
    return this.prisma.allowance.findMany({
      where: {
        employeeId,
        active: true,
        effectiveFrom: { lte: to },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
      },
      orderBy: { effectiveFrom: 'asc' },
    });
  }
}
