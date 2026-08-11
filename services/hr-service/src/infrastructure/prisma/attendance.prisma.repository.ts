import { Injectable } from '@nestjs/common';

import { depotWhere } from '@hydromart/platform';
import { Attendance, AttendanceStatus, Prisma } from '../../../prisma/generated/client';


import {
  AttendanceListFilter,
  AttendanceRepository,
  AttendanceSummary,
  CheckOutPatch,
  WorkedMinutesRow,
  CreateAttendanceInput,
  ManualAttendanceInput,
} from '../../application/ports/attendance.repository';
import { PrismaService } from './prisma.service';


@Injectable()
export class AttendancePrismaRepository implements AttendanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmployeeAndDate(employeeId: string, workDate: Date): Promise<Attendance | null> {
    return this.prisma.attendance.findUnique({
      where: { employeeId_workDate: { employeeId, workDate } },
    });
  }

  findById(id: string): Promise<Attendance | null> {
    return this.prisma.attendance.findUnique({ where: { id } });
  }

  upsertManual(input: ManualAttendanceInput): Promise<Attendance> {
    const { employeeId, depotId, workDate, status, lateMinutes, checkInAt, checkOutAt } = input;
    const patch = {
      status,
      ...(lateMinutes !== undefined ? { lateMinutes } : {}),
      ...(checkInAt !== undefined ? { checkInAt } : {}),
      ...(checkOutAt !== undefined ? { checkOutAt } : {}),
    };
    return this.prisma.attendance.upsert({
      where: { employeeId_workDate: { employeeId, workDate } },
      create: { employeeId, depotId, workDate, lateMinutes: lateMinutes ?? 0, ...patch },
      update: patch,
    });
  }

  async recordAdjustment(data: {
    attendanceId: string;
    reason: string;
    before: unknown;
    after: unknown;
    approvedBy: string | null;
  }): Promise<void> {
    await this.prisma.attendanceAdjustment.create({
      data: {
        attendanceId: data.attendanceId,
        reason: data.reason,
        before: (data.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        after: (data.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        approvedBy: data.approvedBy,
      },
    });
  }

  create(input: CreateAttendanceInput): Promise<Attendance> {
    return this.prisma.attendance.create({ data: input });
  }

  /**
   * Q-8: this was three COUNTs over the same table and the same filter, wrapped in a
   * read-only `$transaction` — a snapshot bought for arithmetic that summaryMany()
   * already does in one grouped query. Delegating keeps exactly one definition of what
   * "present / late / leave" means; the two used to be kept in step by a comment.
   */
  async summary(employeeId: string, from: Date, to: Date): Promise<AttendanceSummary> {
    const byEmployee = await this.summaryMany([employeeId], from, to);
    return (
      byEmployee.get(employeeId) ?? { presentDays: 0, lateDays: 0, leaveDays: 0, pendingDays: 0 }
    );
  }

  /**
   * The same three counts as `summary`, for a whole set of employees, in one grouped query
   * (audit S-6). The performance dashboard used to call `summary` per employee — three
   * counts each, 600 queries for a 200-person depot.
   */
  async summaryMany(
    employeeIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, AttendanceSummary>> {
    const out = new Map<string, AttendanceSummary>();
    if (employeeIds.length === 0) return out;

    const rows = await this.prisma.attendance.groupBy({
      by: ['employeeId', 'status'],
      where: { employeeId: { in: employeeIds }, workDate: { gte: from, lte: to } },
      _count: { _all: true },
    });
    for (const row of rows) {
      const entry = out.get(row.employeeId) ?? {
        presentDays: 0,
        lateDays: 0,
        leaveDays: 0,
        pendingDays: 0,
      };
      // PRESENT and LATE are both days worked; LATE additionally counts as late. Same
      // arithmetic as summary(), which counts PRESENT+LATE for presentDays.
      if (row.status === 'PRESENT' || row.status === 'LATE') entry.presentDays += row._count._all;
      if (row.status === 'LATE') entry.lateDays += row._count._all;
      if (row.status === 'LEAVE') entry.leaveDays += row._count._all;
      // D2: counted so payroll can leave it out of absence rather than fine it as a no-show.
      if (row.status === 'PENDING') entry.pendingDays += row._count._all;
      out.set(row.employeeId, entry);
    }
    return out;
  }

  /** M24-17: worked minutes per attended day, so payroll can rate holidays separately. */
  listWorkedMinutes(employeeId: string, from: Date, to: Date): Promise<WorkedMinutesRow[]> {
    return this.prisma.attendance.findMany({
      where: { employeeId, workDate: { gte: from, lte: to }, status: { in: ['PRESENT', 'LATE'] } },
      select: { workDate: true, workingMinutes: true, lateMinutes: true },
      orderBy: { workDate: 'asc' },
    });
  }

  patchCheckOut(id: string, patch: CheckOutPatch): Promise<Attendance> {
    return this.prisma.attendance.update({ where: { id }, data: patch });
  }

  patchStatus(id: string, status: AttendanceStatus): Promise<Attendance> {
    return this.prisma.attendance.update({ where: { id }, data: { status } });
  }

  async list(filter: AttendanceListFilter): Promise<{ rows: Attendance[]; total: number }> {
    const where: Prisma.AttendanceWhereInput = {
      ...(filter.depotIds ? { depotId: depotWhere(filter.depotIds) } : {}),
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.from || filter.to
        ? {
            workDate: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.attendance.findMany({
        where,
        orderBy: { workDate: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.attendance.count({ where }),
    ]);
    return { rows, total };
  }
}
