import { ConflictException, Injectable } from '@nestjs/common';
import { Payroll, PayrollStatus } from '../../../prisma/generated/client';

import {
  PayrollRepository,
  PayrollWithItems,
  PayrollWrite,
} from '../../application/ports/payroll.repository';
import { PrismaService } from './prisma.service';

const withItems = { include: { items: true } } as const;

/**
 * Turns the payroll status guard's "no row matched" into the caller's answer (H-6).
 *
 * On these writes P2025 only ever means `status` was not what the caller read — somebody
 * approved, paid or regenerated first. A 409 tells them; a raw P2025 would be a 500.
 */
function rejectStalePayroll(error: unknown): never {
  if ((error as { code?: string })?.code === 'P2025') {
    throw new ConflictException(
      'Payroll ini sudah diubah orang lain. Muat ulang lalu coba lagi.',
    );
  }
  throw error;
}

@Injectable()
export class PayrollPrismaRepository implements PayrollRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmployeeAndPeriod(
    employeeId: string,
    periodMonth: string,
  ): Promise<PayrollWithItems | null> {
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
    return this.prisma
      .$transaction(async (tx) => {
        await tx.payrollItem.deleteMany({ where: { payrollId: id } });
        return tx.payroll.update({
          where: { id, status: 'DRAFT' },
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
      })
      .catch(rejectStalePayroll);
  }

  setStatus(
    id: string,
    from: PayrollStatus,
    status: PayrollStatus,
    stamp: { approvedBy?: string; approvedAt?: Date; paidAt?: Date },
  ): Promise<PayrollWithItems> {
    return this.prisma.payroll
      .update({ where: { id, status: from }, data: { status, ...stamp }, ...withItems })
      .catch(rejectStalePayroll);
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
      this.prisma.payroll.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.payroll.count({ where }),
    ]);
    return { rows, total };
  }
}
