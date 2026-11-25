import { Injectable } from '@nestjs/common';

import { MaintenanceItem, MaintenanceStatus } from '../../domain/maintenance';
import {
  CreateMaintenanceData,
  MaintenanceRepository,
  UpdateMaintenanceData,
} from '../../application/ports/maintenance.repository';
import { PrismaService } from './prisma.service';

interface MaintenanceRow {
  id: string;
  depotId: string;
  name: string;
  category: string;
  intervalDays: number | null;
  intervalM3?: { toString(): string } | null;
  lastServicedAt: Date | null;
  nextDueAt: Date | null;
  status: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class MaintenancePrismaRepository implements MaintenanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: MaintenanceRow): MaintenanceItem {
    return {
      ...row,
      intervalM3: row.intervalM3 ? Number(row.intervalM3.toString()) : null,
      status: row.status as MaintenanceStatus,
    };
  }

  async create(data: CreateMaintenanceData): Promise<MaintenanceItem> {
    const row = await this.prisma.maintenanceItem.create({ data });
    return this.toRecord(row);
  }

  async listForDepot(depotId: string): Promise<MaintenanceItem[]> {
    const rows = await this.prisma.maintenanceItem.findMany({
      where: { depotId },
      orderBy: { nextDueAt: { sort: 'asc', nulls: 'last' } },
    });
    return rows.map((r) => this.toRecord(r));
  }

  async listAllActive(): Promise<Array<MaintenanceItem & { depotName: string }>> {
    const rows = await this.prisma.maintenanceItem.findMany({
      where: { depot: { active: true } },
      include: { depot: { select: { name: true } } },
      orderBy: [{ depotId: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(({ depot, ...row }) => ({ ...this.toRecord(row), depotName: depot.name }));
  }

  async findById(id: string): Promise<MaintenanceItem | null> {
    const row = await this.prisma.maintenanceItem.findUnique({ where: { id } });
    return row ? this.toRecord(row) : null;
  }

  async update(id: string, data: UpdateMaintenanceData): Promise<MaintenanceItem> {
    const row = await this.prisma.maintenanceItem.update({ where: { id }, data });
    return this.toRecord(row);
  }
}
