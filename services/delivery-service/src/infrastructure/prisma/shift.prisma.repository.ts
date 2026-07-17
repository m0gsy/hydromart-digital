import { Injectable } from '@nestjs/common';

import { ShiftStatus } from '../../domain/shift';
import {
  OpenShiftData,
  ShiftQuery,
  ShiftRecord,
  ShiftRepository,
  ShiftStatusPatch,
} from '../../application/ports/shift.repository';
import { PrismaService } from './prisma.service';

interface ShiftRow {
  id: string;
  driverId: string;
  depotId: string;
  status: string;
  checkInAt: Date;
  checkInLat: number;
  checkInLng: number;
  expectedEndAt: Date;
  checkOutAt: Date | null;
  checkOutLat: number | null;
  checkOutLng: number | null;
  breakSecondsUsed: number;
  breakStartedAt: Date | null;
}

// Open = not checked out yet (see domain isOpen); mirrored here for the query.
const OPEN_STATUSES: ShiftStatus[] = [ShiftStatus.ONLINE, ShiftStatus.BREAK, ShiftStatus.OFFLINE];

@Injectable()
export class ShiftPrismaRepository implements ShiftRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ShiftRow): ShiftRecord {
    return { ...row, status: row.status as ShiftStatus };
  }

  async open(data: OpenShiftData): Promise<ShiftRecord> {
    const row = await this.prisma.shift.create({ data });
    return this.toRecord(row);
  }

  async findById(id: string): Promise<ShiftRecord | null> {
    const row = await this.prisma.shift.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async findOpenByDriver(driverId: string): Promise<ShiftRecord | null> {
    const row = await this.prisma.shift.findFirst({
      where: { driverId, status: { in: OPEN_STATUSES } },
      orderBy: { checkInAt: 'desc' },
    });
    return row ? this.toRecord(row) : null;
  }

  async patchStatus(id: string, patch: ShiftStatusPatch): Promise<ShiftRecord> {
    const row = await this.prisma.shift.update({ where: { id }, data: patch });
    return this.toRecord(row);
  }

  async listByDriver(driverId: string, limit: number): Promise<ShiftRecord[]> {
    const rows = await this.prisma.shift.findMany({
      where: { driverId },
      orderBy: { checkInAt: 'desc' },
      take: limit,
    });
    return rows.map((r) => this.toRecord(r));
  }

  async search(query: ShiftQuery): Promise<ShiftRecord[]> {
    const rows = await this.prisma.shift.findMany({
      where: {
        ...(query.depotId ? { depotId: query.depotId } : {}),
        ...(query.from || query.to
          ? { checkInAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
          : {}),
      },
      orderBy: { checkInAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }
}
