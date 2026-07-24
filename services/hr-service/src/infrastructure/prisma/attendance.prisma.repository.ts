import { Injectable } from '@nestjs/common';
import { Attendance, Prisma } from '../../../prisma/generated/client';

import {
  AttendanceListFilter,
  AttendanceRepository,
  AttendanceSummary,
  CheckOutPatch,
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

  async summary(employeeId: string, from: Date, to: Date): Promise<AttendanceSummary> {
    const workDate = { gte: from, lte: to };
    const [presentDays, lateDays, leaveDays] = await this.prisma.$transaction([
      this.prisma.attendance.count({ where: { employeeId, workDate, status: { in: ['PRESENT', 'LATE'] } } }),
      this.prisma.attendance.count({ where: { employeeId, workDate, status: 'LATE' } }),
      this.prisma.attendance.count({ where: { employeeId, workDate, status: 'LEAVE' } }),
    ]);
    return { presentDays, lateDays, leaveDays };
  }

  patchCheckOut(id: string, patch: CheckOutPatch): Promise<Attendance> {
    return this.prisma.attendance.update({ where: { id }, data: patch });
  }

  async list(filter: AttendanceListFilter): Promise<{ rows: Attendance[]; total: number }> {
    const where: Prisma.AttendanceWhereInput = {
      ...(filter.depotId ? { depotId: filter.depotId } : {}),
      ...(filter.employeeId ? { employeeId: filter.employeeId } : {}),
      ...(filter.from || filter.to
        ? { workDate: { ...(filter.from ? { gte: filter.from } : {}), ...(filter.to ? { lte: filter.to } : {}) } }
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
