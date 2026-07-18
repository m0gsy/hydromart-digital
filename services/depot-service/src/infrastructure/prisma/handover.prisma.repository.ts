import { Injectable } from '@nestjs/common';

import { HandoverItem, ShiftHandover } from '../../domain/handover';
import {
  CreateHandoverData,
  HandoverRepository,
} from '../../application/ports/handover.repository';
import { Prisma } from '../../../prisma/generated/client';
import { PrismaService } from './prisma.service';

interface ShiftHandoverRow {
  id: string;
  depotId: string;
  fromShift: string;
  toShift: string;
  fromStaff: string;
  toStaff: string;
  items: unknown;
  note: string | null;
  signedAt: Date | null;
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class HandoverPrismaRepository implements HandoverRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: ShiftHandoverRow): ShiftHandover {
    return {
      ...row,
      items: (row.items ?? []) as HandoverItem[],
    };
  }

  async create(data: CreateHandoverData): Promise<ShiftHandover> {
    const row = await this.prisma.shiftHandover.create({
      data: { ...data, items: data.items as unknown as Prisma.InputJsonValue },
    });
    return this.toRecord(row);
  }

  async listForDepot(depotId: string): Promise<ShiftHandover[]> {
    const rows = await this.prisma.shiftHandover.findMany({
      where: { depotId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async findById(id: string): Promise<ShiftHandover | null> {
    const row = await this.prisma.shiftHandover.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async sign(id: string, signedAt: Date): Promise<ShiftHandover> {
    const row = await this.prisma.shiftHandover.update({ where: { id }, data: { signedAt } });
    return this.toRecord(row);
  }
}
