import { ConflictException, Injectable } from '@nestjs/common';
import { depotWhere } from '@hydromart/platform';
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

/**
 * Turns the unique index's "this period already has a payroll" into the caller's answer (D9).
 *
 * `generate` reads whether the period exists and then writes, outside a transaction. Two
 * calls at once both read null and both create; `@@unique([employeeId, periodMonth])` stops
 * the duplicate — so no money is doubled — but the loser used to get a raw P2002, which
 * leaves the operator with a 500 and no idea their colleague already generated the slip.
 */
function rejectDuplicatePayroll(error: unknown): never {
  if ((error as { code?: string })?.code === 'P2002') {
    throw new ConflictException(
      'Payroll periode ini baru saja dibuat orang lain. Muat ulang lalu coba lagi.',
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
    return this.prisma.payroll
      .create({
        data: { ...fields, items: { create: items } },
        ...withItems,
      })
      .catch(rejectDuplicatePayroll);
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

  async deductedBySourceRefBefore(
    employeeId: string,
    beforePeriodMonth: string,
    sourceRefs: readonly string[],
  ): Promise<Map<string, number>> {
    if (sourceRefs.length === 0) return new Map();
    // "YYYY-MM" sorts as it dates, so a string `lt` IS "every earlier period".
    const rows = await this.prisma.payrollItem.groupBy({
      by: ['sourceRef'],
      where: {
        kind: 'DEDUCTION',
        sourceRef: { in: [...sourceRefs] },
        payroll: { employeeId, periodMonth: { lt: beforePeriodMonth } },
      },
      _sum: { amount: true },
    });
    return new Map(rows.map((r) => [r.sourceRef as string, Number(r._sum.amount ?? 0)]));
  }

  async list(filter: {
    periodMonth?: string;
    employeeId?: string;
    status?: PayrollStatus;
    depotIds?: readonly string[];
    skip: number;
    take: number;
  }): Promise<{ rows: Payroll[]; total: number }> {
    const where = {
      ...(filter.periodMonth ? { periodMonth: filter.periodMonth } : {}),
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      // D1: a payroll row carries no depot of its own — the scope lives on the employee it
      // belongs to. A null-depot employee never matches an `IN`, so head-office staff stay
      // correctly invisible to depot roles.
      ...(filter.depotIds ? { employee: { depotId: depotWhere(filter.depotIds) } } : {}),
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
