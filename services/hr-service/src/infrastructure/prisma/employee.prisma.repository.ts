import { Injectable } from '@nestjs/common';
import { Employee, EmploymentHistory, Prisma } from '../../../prisma/generated/client';

import { EmployeeListFilter, EmployeeRepository } from '../../application/ports/employee.repository';
import { PrismaService } from './prisma.service';

@Injectable()
export class EmployeePrismaRepository implements EmployeeRepository {
  constructor(private readonly prisma: PrismaService) {}

  count(): Promise<number> {
    return this.prisma.employee.count();
  }

  async list(filter: EmployeeListFilter): Promise<{ rows: Employee[]; total: number }> {
    const where: Prisma.EmployeeWhereInput = {
      ...(filter.depotId ? { depotId: filter.depotId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? {
            OR: [
              { fullName: { contains: filter.search, mode: 'insensitive' } },
              { employeeCode: { contains: filter.search, mode: 'insensitive' } },
              { phone: { contains: filter.search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.employee.count({ where }),
    ]);
    return { rows, total };
  }

  findById(id: string): Promise<Employee | null> {
    return this.prisma.employee.findUnique({ where: { id } });
  }

  findByAuthSubjectId(authSubjectId: string): Promise<Employee | null> {
    return this.prisma.employee.findUnique({ where: { authSubjectId } });
  }

  listHistory(employeeId: string): Promise<EmploymentHistory[]> {
    return this.prisma.employmentHistory.findMany({
      where: { employeeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(
    data: Prisma.EmployeeCreateInput,
    history?: Prisma.EmploymentHistoryCreateWithoutEmployeeInput,
  ): Promise<Employee> {
    return this.prisma.employee.create({
      data: history ? { ...data, history: { create: history } } : data,
    });
  }

  update(
    id: string,
    data: Prisma.EmployeeUpdateInput,
    history: Prisma.EmploymentHistoryCreateWithoutEmployeeInput[],
  ): Promise<Employee> {
    return this.prisma.employee.update({
      where: { id },
      data: history.length ? { ...data, history: { create: history } } : data,
    });
  }
}
