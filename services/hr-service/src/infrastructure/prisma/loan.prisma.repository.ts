import { Injectable } from '@nestjs/common';

import { Loan, Prisma } from '../../../prisma/generated/client';
import {
  LoanListFilter,
  LoanListRow,
  LoanRepository,
  LoanWrite,
} from '../../application/ports/loan.repository';
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

  /*
   * CA-1-34. The depot lives on the EMPLOYEE, not on the loan, so the scope is a filter on
   * the relation this row already has — the same relation that carries the name and the
   * staff code the list needs.
   */
  async listAll(filter: LoanListFilter): Promise<{ rows: LoanListRow[]; total: number }> {
    const where: Prisma.LoanWhereInput = {
      ...(filter.activeOnly ? { active: true } : {}),
      ...(filter.depotIds ? { employee: { depotId: { in: [...filter.depotIds] } } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.loan.findMany({
        where,
        include: { employee: { select: { fullName: true, employeeCode: true } } },
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.loan.count({ where }),
    ]);
    return {
      rows: rows.map(({ employee, ...loan }) => ({
        ...loan,
        employeeName: employee?.fullName ?? null,
        employeeCode: employee?.employeeCode ?? null,
      })),
      total,
    };
  }
}
