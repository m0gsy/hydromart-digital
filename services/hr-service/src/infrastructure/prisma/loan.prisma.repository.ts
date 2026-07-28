import { Injectable } from '@nestjs/common';

import { Loan } from '../../../prisma/generated/client';
import { LoanRepository, LoanWrite } from '../../application/ports/loan.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class LoanPrismaRepository implements LoanRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: LoanWrite): Promise<Loan> {
    return this.prisma.loan.create({ data });
  }

  update(id: string, data: Partial<Pick<LoanWrite, 'active' | 'note'>>): Promise<Loan> {
    return this.prisma.loan.update({ where: { id }, data });
  }

  findById(id: string): Promise<Loan | null> {
    return this.prisma.loan.findUnique({ where: { id } });
  }

  listByEmployee(employeeId: string): Promise<Loan[]> {
    return this.prisma.loan.findMany({ where: { employeeId }, orderBy: { createdAt: 'desc' } });
  }

  listActiveByEmployee(employeeId: string): Promise<Loan[]> {
    return this.prisma.loan.findMany({
      where: { employeeId, active: true },
      orderBy: { createdAt: 'asc' },
    });
  }
}
