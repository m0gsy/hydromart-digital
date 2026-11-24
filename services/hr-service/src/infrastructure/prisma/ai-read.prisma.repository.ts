import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import {
  AiReadRepository,
  AttendanceDepotRow,
  KasbonDepotRow,
  MAX_AI_READ_GROUPS,
  PayrollDepotRow,
} from '../../application/ports/ai-read.repository';
import { loanRemainingAfter } from '../../domain/loan';
import { PrismaService } from './prisma.service';

const TOO_MANY = 'Terlalu banyak data untuk satu jawaban; persempit rentang atau cakupan depot.';
const GALLON_BONUS_LABEL = 'Bonus target harian%';
const FINAL = ['APPROVED', 'PAID'] as const;
const CHUNK = 5000;

@Injectable()
export class AiReadPrismaRepository implements AiReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async attendance(
    depotIds: readonly string[],
    from: string,
    to: string,
  ): Promise<{ rows: AttendanceDepotRow[]; rolledUp: boolean }> {
    const ids = [...depotIds];
    // `workDate` is a @db.Date: the calendar day itself, so the day strings go in as dates.
    const [groups, rollups] = await Promise.all([
      this.prisma.attendance.groupBy({
        by: ['depotId', 'employeeId', 'status'],
        where: {
          depotId: { in: ids },
          workDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
        },
        _count: { _all: true },
        orderBy: [{ depotId: 'asc' }, { employeeId: 'asc' }, { status: 'asc' }],
        take: MAX_AI_READ_GROUPS + 1,
      }),
      // Leavers' old days are folded into monthly counts after their retention window.
      this.prisma.attendanceMonthRollup.count({
        where: { depotId: { in: ids }, month: { gte: from.slice(0, 7), lte: to.slice(0, 7) } },
      }),
    ]);
    if (groups.length > MAX_AI_READ_GROUPS) throw new UnprocessableEntityException(TOO_MANY);
    const cells = new Map<string, { row: AttendanceDepotRow; seen: Set<string> }>(
      ids.map((depotId) => [
        depotId,
        { row: { depotId, present: 0, late: 0, absent: 0, leave: 0, pending: 0, people: 0 }, seen: new Set() },
      ]),
    );
    const key = { PRESENT: 'present', LATE: 'late', ABSENT: 'absent', LEAVE: 'leave', PENDING: 'pending' } as const;
    for (const g of groups) {
      const cell = g.depotId ? cells.get(g.depotId) : undefined;
      if (!cell) continue;
      const field = key[g.status as keyof typeof key];
      if (field) cell.row[field] += g._count._all;
      cell.seen.add(g.employeeId);
      cell.row.people = cell.seen.size;
    }
    return { rows: ids.map((d) => cells.get(d)!.row), rolledUp: rollups > 0 };
  }

  async payroll(depotIds: readonly string[], month: string): Promise<PayrollDepotRow[]> {
    const ids = [...depotIds];
    const rows = await this.prisma.$queryRaw<
      {
        depotId: string;
        slips: bigint;
        gross: Prisma.Decimal | null;
        bonus: Prisma.Decimal | null;
        deduction: Prisma.Decimal | null;
        net: Prisma.Decimal | null;
        gallon: Prisma.Decimal | null;
        gallonPeople: bigint | null;
      }[]
    >`
      SELECT e."depotId" AS "depotId", COUNT(*) AS "slips", SUM(p."gross") AS "gross",
             SUM(p."totalBonus") AS "bonus", SUM(p."totalDeduction") AS "deduction", SUM(p."net") AS "net",
             SUM(COALESCE(g."amount", 0)) AS "gallon",
             COUNT(*) FILTER (WHERE g."amount" > 0) AS "gallonPeople"
      FROM "payrolls" p
      JOIN "employees" e ON e."id" = p."employeeId"
      LEFT JOIN (
        SELECT "payrollId", SUM("amount") AS "amount" FROM "payroll_items"
        WHERE "kind" = 'BONUS' AND "label" LIKE ${GALLON_BONUS_LABEL}
        GROUP BY "payrollId"
      ) g ON g."payrollId" = p."id"
      WHERE p."periodMonth" = ${month}
        AND p."status" IN ('APPROVED', 'PAID')
        AND e."depotId" IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY e."depotId"
    `;
    const by = new Map(rows.map((r) => [r.depotId, r]));
    return ids.map((depotId) => {
      const r = by.get(depotId);
      return {
        depotId,
        slips: Number(r?.slips ?? 0),
        grossIdr: Number(r?.gross ?? 0),
        bonusIdr: Number(r?.bonus ?? 0),
        deductionIdr: Number(r?.deduction ?? 0),
        netIdr: Number(r?.net ?? 0),
        gallonBonusIdr: Number(r?.gallon ?? 0),
        gallonPeople: Number(r?.gallonPeople ?? 0),
      };
    });
  }

  async kasbon(depotIds: readonly string[], month: string): Promise<KasbonDepotRow[]> {
    const ids = [...depotIds];
    const loans = await this.prisma.loan.findMany({
      where: { active: true, startPeriod: { lte: month }, employee: { depotId: { in: ids } } },
      select: {
        id: true,
        employeeId: true,
        principal: true,
        installmentAmount: true,
        startPeriod: true,
        employee: { select: { depotId: true } },
      },
      orderBy: { id: 'asc' },
      take: MAX_AI_READ_GROUPS + 1,
    });
    if (loans.length > MAX_AI_READ_GROUPS) throw new UnprocessableEntityException(TOO_MANY);
    // What payslips ACTUALLY took, and only the slips that count (APPROVED/PAID).
    const paid = new Map<string, number>();
    for (let i = 0; i < loans.length; i += CHUNK) {
      const groups = await this.prisma.payrollItem.groupBy({
        by: ['sourceRef'],
        where: {
          kind: 'DEDUCTION',
          sourceRef: { in: loans.slice(i, i + CHUNK).map((l) => l.id) },
          payroll: { periodMonth: { lte: month }, status: { in: [...FINAL] } },
        },
        _sum: { amount: true },
      });
      for (const g of groups) paid.set(g.sourceRef as string, Number(g._sum.amount ?? 0));
    }
    const cells = new Map<string, { remaining: number; owing: Set<string> }>(
      ids.map((d) => [d, { remaining: 0, owing: new Set<string>() }]),
    );
    for (const l of loans) {
      const cell = l.employee.depotId ? cells.get(l.employee.depotId) : undefined;
      if (!cell) continue;
      const left = loanRemainingAfter(
        { principal: Number(l.principal), installmentAmount: Number(l.installmentAmount), startPeriod: l.startPeriod },
        month,
        paid.get(l.id) ?? 0,
      );
      if (left > 0) {
        cell.remaining += left;
        cell.owing.add(l.employeeId);
      }
    }
    return ids.map((depotId) => ({
      depotId,
      people: cells.get(depotId)!.owing.size,
      remainingIdr: cells.get(depotId)!.remaining,
    }));
  }
}
