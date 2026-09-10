import { Injectable } from '@nestjs/common';

import { LoanRequest, Prisma } from '../../../prisma/generated/client';
import {
  LoanRequestDecision,
  LoanRequestListFilter,
  LoanRequestListRow,
  LoanRequestRepository,
  LoanRequestWrite,
} from '../../application/ports/loan-request.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class LoanRequestPrismaRepository implements LoanRequestRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: LoanRequestWrite): Promise<LoanRequest> {
    return this.prisma.loanRequest.create({ data });
  }

  findById(id: string): Promise<LoanRequest | null> {
    return this.prisma.loanRequest.findUnique({ where: { id } });
  }

  listByEmployee(employeeId: string): Promise<LoanRequest[]> {
    return this.prisma.loanRequest.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /*
   * The depot is copied onto the REQUEST, not read off the employee, because the queue is
   * answered by whoever runs the depot the request was raised at — and an employee who
   * later moves depot must not drag an open request into a queue their new supervisor
   * never saw. `loans` scopes through the relation for the opposite reason: a loan follows
   * the person.
   */
  async listAll(
    filter: LoanRequestListFilter,
  ): Promise<{ rows: LoanRequestListRow[]; total: number }> {
    const where: Prisma.LoanRequestWhereInput = {
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.depotIds ? { depotId: { in: [...filter.depotIds] } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.loanRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        include: { employee: { select: { fullName: true, employeeCode: true } } },
      }),
      this.prisma.loanRequest.count({ where }),
    ]);
    return {
      rows: rows.map(({ employee, ...r }) => ({
        ...r,
        employeeName: employee?.fullName ?? null,
        employeeCode: employee?.employeeCode ?? null,
      })),
      total,
    };
  }

  decide(id: string, decision: LoanRequestDecision): Promise<LoanRequest> {
    return this.prisma.loanRequest.update({
      where: { id },
      data: { ...decision, decidedAt: new Date() },
    });
  }
}
