import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

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
import { HrConfigService } from '../../config/hr-config.service';
import { DAILY_GALLON_BONUS_LABEL } from '../../domain/daily-sales-bonus';
import { loanRemainingAfter } from '../../domain/loan';
import { scheduleOf } from '../../domain/scheduled-days';
import { parseRotationPattern } from '../../domain/shift-rotation';
import { PrismaService } from './prisma.service';

const TOO_MANY = 'Terlalu banyak data untuk satu jawaban; persempit rentang atau cakupan depot.';
// The writer's own label (payroll.service), then ` (n hari)`; `%`/`_` in it would be wildcards, so it has none.
export const GALLON_BONUS_LIKE = `${DAILY_GALLON_BONUS_LABEL} (%`;
const FINAL = ['APPROVED', 'PAID'] as const;
const CHUNK = 5000;
/** The most attendance records one answer reads (a year of ~600 staff); past it the read is refused, never cut short. */
const MAX_AI_READ_RECORDS = 250_000;
// tz-ok: `workDate`, `joinDate`, `exitDate`, `effectiveFrom` and holiday `date` are @db.Date: calendar days.
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

@Injectable()
export class AiReadPrismaRepository implements AiReadRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(HrConfigService) private readonly config: Pick<HrConfigService, 'weeklyOffDays'>,
  ) {}

  /**
   * Counts by status as before (every record at a depot asked for), plus choice 35A's scheduled days:
   * each employee-day the shift data schedules (domain/scheduled-days.ts, payroll's rule) is placed at
   * the depot the person worked that day, else their own depot, so every day lands in exactly one depot.
   * Done in memory over the unique (employeeId, workDate) rows: no raw SQL, the existing
   * (depotId, workDate) and (employeeId, workDate) indexes serve every read.
   */
  async attendance(
    depotIds: readonly string[],
    from: string,
    to: string,
  ): Promise<{ rows: AttendanceDepotRow[]; heads: AttendanceHeads; rolledUp: boolean }> {
    const ids = [...depotIds];
    const asked = new Set(ids);
    // `workDate` is a @db.Date: the calendar day itself, so the day strings go in as dates.
    const first = new Date(`${from}T00:00:00Z`);
    const last = new Date(`${to}T00:00:00Z`);
    const inWindow = { gte: first, lte: last };
    const [seen, rollups, depotStaff] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { depotId: { in: ids }, workDate: inWindow },
        distinct: ['employeeId'],
        select: { employeeId: true },
        take: MAX_AI_READ_GROUPS + 1,
      }),
      // Leavers' old days are folded into monthly counts after their retention window.
      this.prisma.attendanceMonthRollup.count({
        where: { depotId: { in: ids }, month: { gte: from.slice(0, 7), lte: to.slice(0, 7) } },
      }),
      this.prisma.employee.findMany({
        where: { depotId: { in: ids }, joinDate: { lte: last }, OR: [{ exitDate: null }, { exitDate: { gte: first } }] },
        select: { id: true },
        take: MAX_AI_READ_GROUPS + 1,
      }),
    ]);
    if (seen.length > MAX_AI_READ_GROUPS || depotStaff.length > MAX_AI_READ_GROUPS) throw new UnprocessableEntityException(TOO_MANY);
    const people = [...new Set([...seen.map((r) => r.employeeId), ...depotStaff.map((e) => e.id)])];
    if (people.length > MAX_AI_READ_GROUPS) throw new UnprocessableEntityException(TOO_MANY);

    const staff: Array<{ id: string; depotId: string | null; joinDate: Date; exitDate: Date | null; shiftId: string | null }> = [];
    const records = new Map<string, { depotId: string | null; status: string }>();
    const assignments = new Map<string, Array<{ shiftId: string | null; rotationId: string | null; effectiveFrom: Date }>>();
    let recordCount = 0;
    for (let i = 0; i < people.length; i += CHUNK) {
      const part = people.slice(i, i + CHUNK);
      const [emps, recs, assigns] = await Promise.all([
        this.prisma.employee.findMany({
          where: { id: { in: part } },
          select: { id: true, depotId: true, joinDate: true, exitDate: true, shiftId: true },
        }),
        this.prisma.attendance.findMany({
          where: { employeeId: { in: part }, workDate: inWindow },
          select: { employeeId: true, workDate: true, depotId: true, status: true },
          take: MAX_AI_READ_RECORDS + 1 - recordCount,
        }),
        this.prisma.shiftAssignment.findMany({
          where: { employeeId: { in: part }, effectiveFrom: { lte: last } },
          orderBy: [{ effectiveFrom: 'asc' }, { createdAt: 'asc' }],
          select: { employeeId: true, shiftId: true, rotationId: true, effectiveFrom: true },
        }),
      ]);
      staff.push(...emps);
      recordCount += recs.length;
      if (recordCount > MAX_AI_READ_RECORDS) throw new UnprocessableEntityException(TOO_MANY);
      for (const r of recs) records.set(`${r.employeeId}|${dayOf(r.workDate)}`, { depotId: r.depotId, status: r.status });
      for (const a of assigns) {
        const list = assignments.get(a.employeeId) ?? [];
        list.push(a);
        assignments.set(a.employeeId, list);
      }
    }

    const rotationIds = [...new Set([...assignments.values()].flat().flatMap((a) => (a.rotationId ? [a.rotationId] : [])))];
    const [rotations, holidayRows] = await Promise.all([
      this.prisma.shiftRotation.findMany({ where: { id: { in: rotationIds } }, select: { id: true, pattern: true } }),
      this.prisma.holiday.findMany({ where: { date: inWindow }, select: { date: true, depotId: true } }),
    ]);
    const patterns = new Map(rotations.map((r) => [r.id, parseRotationPattern(r.pattern)]));
    const holidaysOf = new Map<string | null, Set<string>>();
    const holidaysFor = (depotId: string | null): Set<string> => {
      let set = holidaysOf.get(depotId);
      if (!set) {
        set = new Set(holidayRows.filter((h) => h.depotId === null || h.depotId === depotId).map((h) => dayOf(h.date)));
        holidaysOf.set(depotId, set);
      }
      return set;
    };

    const rows = new Map<string, AttendanceDepotRow>(
      ids.map((depotId) => [
        depotId,
        { depotId, present: 0, late: 0, absentRecorded: 0, leave: 0, pending: 0, scheduledDays: 0, attendedScheduled: 0, absentScheduled: 0, unscheduledDays: 0 },
      ]),
    );
    const heads = Object.fromEntries(ATTENDANCE_CELLS.map((c) => [c, new Set<string>()])) as Record<AttendanceCell, Set<string>>;
    const bump = (depotId: string | null, employeeId: string, cell: AttendanceCell): void => {
      const row = depotId && asked.has(depotId) ? rows.get(depotId) : undefined;
      if (!row) return;
      row[cell] += 1;
      heads[cell].add(employeeId);
    };
    const field = { PRESENT: 'present', LATE: 'late', ABSENT: 'absentRecorded', LEAVE: 'leave', PENDING: 'pending' } as const;
    for (const [key, rec] of records) {
      const cell = field[rec.status as keyof typeof field];
      if (cell) bump(rec.depotId, key.slice(0, key.indexOf('|')), cell);
    }
    for (const e of staff) {
      const plan = scheduleOf({
        from,
        to,
        joinDay: dayOf(e.joinDate),
        exitDay: e.exitDate ? dayOf(e.exitDate) : null,
        assignments: assignments.get(e.id) ?? [],
        patterns,
        ownShift: e.shiftId !== null,
        weeklyOffCsv: this.config.weeklyOffDays(e.depotId),
        holidays: holidaysFor(e.depotId),
      });
      for (const day of plan.scheduled) {
        const rec = records.get(`${e.id}|${day}`);
        const at = rec?.depotId ?? e.depotId;
        bump(at, e.id, 'scheduledDays');
        if (rec?.status === 'PRESENT' || rec?.status === 'LATE') bump(at, e.id, 'attendedScheduled');
        else if (!rec || rec.status === 'ABSENT') bump(at, e.id, 'absentScheduled');
      }
      for (const day of plan.unscheduled) {
        bump(records.get(`${e.id}|${day}`)?.depotId ?? e.depotId, e.id, 'unscheduledDays');
      }
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
