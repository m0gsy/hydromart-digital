import { Injectable } from '@nestjs/common';
import { Attendance, Prisma } from '../../../prisma/generated/client';

import {
  AttendanceListFilter,
  AttendanceRepository,
  CheckOutPatch,
  CreateAttendanceInput,
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

  create(input: CreateAttendanceInput): Promise<Attendance> {
    return this.prisma.attendance.create({ data: input });
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
