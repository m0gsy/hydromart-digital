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
  intervalDays: number;
  lastServicedAt: Date | null;
  nextDueAt: Date;
  status: string;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class MaintenancePrismaRepository implements MaintenanceRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toRecord(row: MaintenanceRow): MaintenanceItem {
    return { ...row, status: row.status as MaintenanceStatus };
  }

  async create(data: CreateMaintenanceData): Promise<MaintenanceItem> {
    const row = await this.prisma.maintenanceItem.create({ data });
    return this.toRecord(row);
  }

  async listForDepot(depotId: string): Promise<MaintenanceItem[]> {
    const rows = await this.prisma.maintenanceItem.findMany({
      where: { depotId },
      orderBy: { nextDueAt: 'asc' },
    });
    return rows.map((r) => this.toRecord(r));
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
