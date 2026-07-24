import { Injectable } from '@nestjs/common';
import { Payroll, PayrollStatus } from '../../../prisma/generated/client';

import {
  PayrollRepository,
  PayrollWithItems,
  PayrollWrite,
} from '../../application/ports/payroll.repository';
import { PrismaService } from './prisma.service';

const withItems = { include: { items: true } } as const;

@Injectable()
export class PayrollPrismaRepository implements PayrollRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmployeeAndPeriod(employeeId: string, periodMonth: string): Promise<PayrollWithItems | null> {
    return this.prisma.payroll.findUnique({
      where: { employeeId_periodMonth: { employeeId, periodMonth } },
      ...withItems,
    });
  }

  findById(id: string): Promise<PayrollWithItems | null> {
    return this.prisma.payroll.findUnique({ where: { id }, ...withItems });
  }

  create(data: PayrollWrite): Promise<PayrollWithItems> {
    const { items, ...fields } = data;
    return this.prisma.payroll.create({
      data: { ...fields, items: { create: items } },
      ...withItems,
    });
  }

  regenerate(id: string, data: PayrollWrite): Promise<PayrollWithItems> {
    // Recompute only the money/day totals + lines; identity (employee/period/createdBy) is fixed.
    return this.prisma.$transaction(async (tx) => {
      await tx.payrollItem.deleteMany({ where: { payrollId: id } });
      return tx.payroll.update({
        where: { id },
        data: {
          gross: data.gross,
          totalBonus: data.totalBonus,
          totalDeduction: data.totalDeduction,
          net: data.net,
          presentDays: data.presentDays,
          items: { create: data.items },
        },
        ...withItems,
      });
    });
  }

  setStatus(
    id: string,
    status: PayrollStatus,
    stamp: { approvedBy?: string; approvedAt?: Date; paidAt?: Date },
  ): Promise<PayrollWithItems> {
    return this.prisma.payroll.update({ where: { id }, data: { status, ...stamp }, ...withItems });
  }

  async list(filter: {
    periodMonth?: string;
    employeeId?: string;
    status?: PayrollStatus;
    skip: number;
    take: number;
  }): Promise<{ rows: Payroll[]; total: number }> {
    const where = {
      ...(filter.periodMonth ? { periodMonth: filter.periodMonth } : {}),
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.payroll.findMany({ where, orderBy: { createdAt: 'desc' }, skip: filter.skip, take: filter.take }),
      this.prisma.payroll.count({ where }),
    ]);
    return { rows, total };
  }
}
