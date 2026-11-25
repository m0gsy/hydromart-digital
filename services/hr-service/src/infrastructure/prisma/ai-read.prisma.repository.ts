import { Injectable, UnprocessableEntityException } from '@nestjs/common';

import { Prisma } from '../../../prisma/generated/client';
import {
  ATTENDANCE_CELLS,
  AiReadRepository,
  AttendanceCell,
  AttendanceDepotRow,
  AttendanceHeads,
  KasbonDepotRow,
  PayrollGateRow,
  MAX_AI_READ_GROUPS,
  PayrollDepotRow,
} from '../../application/ports/ai-read.repository';
import { DAILY_GALLON_BONUS_LABEL } from '../../domain/daily-sales-bonus';
import { loanRemainingAfter } from '../../domain/loan';
import { PrismaService } from './prisma.service';

const TOO_MANY = 'Terlalu banyak data untuk satu jawaban; persempit rentang atau cakupan depot.';
// The writer's own label (payroll.service), then ` (n hari)`; `%`/`_` in it would be wildcards, so it has none.
export const GALLON_BONUS_LIKE = `${DAILY_GALLON_BONUS_LABEL} (%`;
const FINAL = ['APPROVED', 'PAID'] as const;
const CHUNK = 5000;

@Injectable()
export class AiReadPrismaRepository implements AiReadRepository {
  constructor(private readonly prisma: PrismaService) {}

  async attendance(
    depotIds: readonly string[],
    from: string,
    to: string,
  ): Promise<{ rows: AttendanceDepotRow[]; heads: AttendanceHeads; rolledUp: boolean }> {
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
    const rows = new Map<string, AttendanceDepotRow>(
      ids.map((depotId) => [depotId, { depotId, present: 0, late: 0, absentRecorded: 0, leave: 0, pending: 0 }]),
    );
    const heads: Record<AttendanceCell, Set<string>> = {
      present: new Set(),
      late: new Set(),
      absentRecorded: new Set(),
      leave: new Set(),
      pending: new Set(),
    };
    const field = { PRESENT: 'present', LATE: 'late', ABSENT: 'absentRecorded', LEAVE: 'leave', PENDING: 'pending' } as const;
    for (const g of groups) {
      const row = g.depotId ? rows.get(g.depotId) : undefined;
      const cell = field[g.status as keyof typeof field];
      if (!row || !cell) continue;
      row[cell] += g._count._all;
      heads[cell].add(g.employeeId);
    }
    return {
      rows: ids.map((d) => rows.get(d)!),
      heads: Object.fromEntries(ATTENDANCE_CELLS.map((c) => [c, [...heads[c]]])) as AttendanceHeads,
      rolledUp: rollups > 0,
    };
  }

  async payrollGate(depotIds: readonly string[], month: string): Promise<PayrollGateRow[]> {
    const ids = [...depotIds];
    const [y, m] = month.split('-').map(Number);
    const monthStart = new Date(Date.UTC(y, m - 1, 1));
    const monthEnd = new Date(Date.UTC(y, m, 0));
    const list = Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
    const [expected, slips] = await Promise.all([
      this.prisma.$queryRaw<{ depotId: string; n: bigint }[]>`
        SELECT COALESCE(e."homeDepotId", e."depotId") AS "depotId", COUNT(*) AS "n"
        FROM "employees" e
        WHERE COALESCE(e."homeDepotId", e."depotId") IN (${list})
          AND e."joinDate" <= ${monthEnd}
          AND (e."status" = 'ACTIVE' OR e."exitDate" >= ${monthStart})
        GROUP BY COALESCE(e."homeDepotId", e."depotId")
      `,
      this.prisma.$queryRaw<{ depotId: string; draft: bigint; final: bigint }[]>`
        SELECT COALESCE(e."homeDepotId", e."depotId") AS "depotId",
               COUNT(*) FILTER (WHERE p."status" = 'DRAFT') AS "draft",
               COUNT(DISTINCT p."employeeId") FILTER (WHERE p."status" IN ('APPROVED', 'PAID')) AS "final"
        FROM "payrolls" p
        JOIN "employees" e ON e."id" = p."employeeId"
        WHERE p."periodMonth" = ${month}
          AND COALESCE(e."homeDepotId", e."depotId") IN (${list})
        GROUP BY COALESCE(e."homeDepotId", e."depotId")
      `,
    ]);
    const exp = new Map(expected.map((r) => [r.depotId, Number(r.n)]));
    const sl = new Map(slips.map((r) => [r.depotId, r]));
    return ids.map((depotId) => ({
      depotId,
      expected: exp.get(depotId) ?? 0,
      draft: Number(sl.get(depotId)?.draft ?? 0),
      final: Number(sl.get(depotId)?.final ?? 0),
    }));
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
      SELECT COALESCE(e."homeDepotId", e."depotId") AS "depotId", COUNT(*) AS "slips", SUM(p."gross") AS "gross",
             SUM(p."totalBonus") AS "bonus", SUM(p."totalDeduction") AS "deduction", SUM(p."net") AS "net",
             SUM(COALESCE(g."amount", 0)) AS "gallon",
             COUNT(*) FILTER (WHERE g."amount" > 0) AS "gallonPeople"
      FROM "payrolls" p
      JOIN "employees" e ON e."id" = p."employeeId"
      LEFT JOIN (
        SELECT "payrollId", SUM("amount") AS "amount" FROM "payroll_items"
        WHERE "kind" = 'BONUS' AND "label" LIKE ${GALLON_BONUS_LIKE}
        GROUP BY "payrollId"
      ) g ON g."payrollId" = p."id"
      WHERE p."periodMonth" = ${month}
        AND p."status" IN ('APPROVED', 'PAID')
        AND COALESCE(e."homeDepotId", e."depotId") IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY COALESCE(e."homeDepotId", e."depotId")
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
      where: {
        active: true,
        startPeriod: { lte: month },
        // The employee's home depot: `homeDepotId`, else the live depot (as the payroll rules read it).
        employee: { OR: [{ homeDepotId: { in: ids } }, { homeDepotId: null, depotId: { in: ids } }] },
      },
      select: {
        id: true,
        employeeId: true,
        principal: true,
        installmentAmount: true,
        startPeriod: true,
        employee: { select: { depotId: true, homeDepotId: true } },
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
      const home = l.employee.homeDepotId ?? l.employee.depotId;
      const cell = home ? cells.get(home) : undefined;
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
